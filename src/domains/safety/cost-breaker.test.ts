import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  decideBreaker,
  globalMonthlyCapUsd,
  globalSpendStatusLine,
  getGlobalSpendStatus,
  assertPaidCallAllowed,
  DEFAULT_GLOBAL_MONTHLY_CAP_USD,
} from "./cost-breaker";

describe("globalMonthlyCapUsd - safe default, never unlimited", () => {
  it("reads a positive numeric env", () => {
    expect(globalMonthlyCapUsd({ BEACON_GLOBAL_MONTHLY_CAP_USD: "250" } as unknown as NodeJS.ProcessEnv)).toBe(250);
  });
  it("falls back to the SAFE default on unset / NaN / zero / negative (unset never means unlimited)", () => {
    expect(globalMonthlyCapUsd({} as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_GLOBAL_MONTHLY_CAP_USD);
    expect(globalMonthlyCapUsd({ BEACON_GLOBAL_MONTHLY_CAP_USD: "not-a-number" } as unknown as NodeJS.ProcessEnv)).toBe(100);
    expect(globalMonthlyCapUsd({ BEACON_GLOBAL_MONTHLY_CAP_USD: "0" } as unknown as NodeJS.ProcessEnv)).toBe(100);
    expect(globalMonthlyCapUsd({ BEACON_GLOBAL_MONTHLY_CAP_USD: "-5" } as unknown as NodeJS.ProcessEnv)).toBe(100);
  });
});

describe("decideBreaker - the pure trip decision", () => {
  it("does NOT trip when spend + projection is under the ceiling", () => {
    const v = decideBreaker({ spentUsd: 0.42, capUsd: 100, projectedUsd: 0.003 });
    expect(v.tripped).toBe(false);
    if (!v.tripped) expect(v.spentUsd).toBe(0.42);
  });

  it("trips AT the ceiling boundary (spent >= cap), matching the per-platform caps", () => {
    const v = decideBreaker({ spentUsd: 100, capUsd: 100, projectedUsd: 0 });
    expect(v.tripped).toBe(true);
    if (v.tripped) expect(v.reason).toContain("$100");
  });

  it("trips when the projected cost would push OVER the ceiling", () => {
    const v = decideBreaker({ spentUsd: 99.999, capUsd: 100, projectedUsd: 0.01 });
    expect(v.tripped).toBe(true);
  });

  it("a KNOWN cost may land EXACTLY on the ceiling from below (not over-strict)", () => {
    const v = decideBreaker({ spentUsd: 99.5, capUsd: 100, projectedUsd: 0.5 });
    expect(v.tripped).toBe(false);
  });

  it("FAIL-CLOSED on unknown spend (null) - the paid path asked and we could not confirm", () => {
    const v = decideBreaker({ spentUsd: null, capUsd: 100, projectedUsd: 0.003 });
    expect(v.tripped).toBe(true);
    if (v.tripped) {
      expect(v.spentUsd).toBeNull();
      expect(v.reason).toContain("$100");
    }
  });

  it("the trip reason carries no banned dashes", () => {
    const v = decideBreaker({ spentUsd: 100, capUsd: 100 });
    if (v.tripped) expect(v.reason).not.toMatch(/[‒–—―]/);
  });
});

describe("globalSpendStatusLine - the honest one line", () => {
  it("quotes the concrete spend and ceiling", () => {
    expect(globalSpendStatusLine({ spentUsd: 0.42, capUsd: 100 })).toBe(
      "I have spent $0.42 of my $100 monthly ceiling across all research.",
    );
  });
  it("renders a calm checking line (never a fake zero) when spend is unknown", () => {
    expect(globalSpendStatusLine({ spentUsd: null, capUsd: 100 })).toContain("checking my total spend");
  });
  it("carries no banned dashes", () => {
    expect(globalSpendStatusLine({ spentUsd: 12.5, capUsd: 100 })).not.toMatch(/[‒–—―]/);
  });
});

describe("assertPaidCallAllowed - the enforcement seam", () => {
  it("allows a paid call when combined spend is well under the ceiling", async () => {
    const v = await assertPaidCallAllowed(
      { projectedCostUsd: 0.02 },
      {
        env: { BEACON_GLOBAL_MONTHLY_CAP_USD: "100" } as unknown as NodeJS.ProcessEnv,
        readGlobalMonthSpendUsd: async () => 5,
        now: () => new Date("2026-07-03T00:00:00Z"),
      },
    );
    expect(v.tripped).toBe(false);
  });

  it("trips at the ceiling (belt-and-suspenders over the per-platform caps)", async () => {
    const v = await assertPaidCallAllowed(
      { projectedCostUsd: 0.02 },
      {
        env: {} as unknown as NodeJS.ProcessEnv, // default cap 100
        readGlobalMonthSpendUsd: async () => 100,
        now: () => new Date("2026-07-03T00:00:00Z"),
      },
    );
    expect(v.tripped).toBe(true);
  });

  it("FAILS CLOSED when the combined spend cannot be read", async () => {
    const v = await assertPaidCallAllowed(
      {},
      {
        env: {} as unknown as NodeJS.ProcessEnv,
        readGlobalMonthSpendUsd: async () => null,
        now: () => new Date("2026-07-03T00:00:00Z"),
      },
    );
    expect(v.tripped).toBe(true);
  });

  it("FAILS CLOSED when the read THROWS (never leaks the exception)", async () => {
    const v = await assertPaidCallAllowed(
      {},
      {
        env: {} as unknown as NodeJS.ProcessEnv,
        readGlobalMonthSpendUsd: async () => {
          throw new Error("supabase down");
        },
        now: () => new Date("2026-07-03T00:00:00Z"),
      },
    );
    expect(v.tripped).toBe(true);
  });
});

describe("getGlobalSpendStatus - read-only snapshot for surfaces", () => {
  it("returns the combined spend + resolved ceiling", async () => {
    const s = await getGlobalSpendStatus({
      env: { BEACON_GLOBAL_MONTHLY_CAP_USD: "80" } as unknown as NodeJS.ProcessEnv,
      readGlobalMonthSpendUsd: async () => 3.14,
      now: () => new Date(),
    });
    expect(s).toEqual({ spentUsd: 3.14, capUsd: 80 });
  });
  it("returns null spend (calm fallback) on a read error - NEVER blocks a surface", async () => {
    const s = await getGlobalSpendStatus({
      env: {} as unknown as NodeJS.ProcessEnv,
      readGlobalMonthSpendUsd: async () => {
        throw new Error("down");
      },
      now: () => new Date(),
    });
    expect(s.spentUsd).toBeNull();
    expect(s.capUsd).toBe(100);
  });
});
