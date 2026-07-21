import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Isolate from the budget store, exactly like batch-adjudicator.test.ts: the gate is
// controlled deterministically and spend recording is observable.
const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

// In-memory strategy-mix store (same isolation pattern as strategy-mix-store.test.ts).
let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

// The dossier is exercised through its own unit tests (build-dossier.test.ts); here we
// stub the I/O loader so run-strategy-review tests focus on the LLM/clamp/fail-open
// contract without needing real GSC/proof-ledger fixtures.
const loadStrategyDossierMock = vi.fn();
vi.mock("./build-dossier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-dossier")>();
  return { ...actual, loadStrategyDossier: (...args: unknown[]) => loadStrategyDossierMock(...args) };
});

import { runStrategyReview, KNOWN_ACTION_FAMILIES } from "./run-strategy-review";
import { loadLatestStrategyMix, appendStrategyMixRecord } from "./strategy-mix-store";
import type { CompleteFn } from "@/domains/llm/structured-drafter";
import type { StrategyDossier } from "./build-dossier";

const DOSSIER: StrategyDossier = {
  tenantId: "t",
  weekOf: "2026-07-06",
  leverRecords: [{ family: "answer_block", won: 3, lost: 1, decided: 4, winRate: 0.75 }],
  totalDecided: 4,
  trends: [],
  seasonalWindows: [],
  calibration: null,
};

function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

const VALID_RESPONSE = {
  leverMix: [{ family: "answer", weight: 1.5, reason: "won 3 of 4" }],
  focusFamilies: [{ family: "iran-flags", reason: "9x its detection floor" }],
  memo: "I am leaning into answer blocks this week because they won 3 of 4. Focus stays on the flags family.",
  confidence: "medium",
};

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stored = [];
  process.env.BEACON_LLM_PROVIDER = "openai";
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
  loadStrategyDossierMock.mockResolvedValue(DOSSIER);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  warnSpy.mockRestore();
  vi.clearAllMocks();
});

describe("KNOWN_ACTION_FAMILIES", () => {
  it("mirrors experiment-eligibility's ExperimentFamily vocabulary", () => {
    expect(KNOWN_ACTION_FAMILIES).toEqual(
      expect.arrayContaining(["title", "meta", "title_meta", "h1", "answer", "link", "schema", "content", "new_page", "other"]),
    );
  });
});

describe("runStrategyReview - happy path", () => {
  it("writes a clamped, dash-stripped record and returns ran: true", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.ran).toBe(true);
    expect(r.record).not.toBeNull();
    expect(r.record!.source).toBe("llm");
    expect(r.record!.leverMix).toEqual([{ family: "answer", weight: 1.5, reason: "won 3 of 4" }]);
    expect(r.record!.focusFamilies).toEqual([{ family: "iran-flags", reason: "9x its detection floor" }]);
    expect(r.record!.memo).toContain("leaning into answer blocks");
  });

  it("persists the record so loadLatestStrategyMix sees it", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    await runStrategyReview("tenant-a", "2026-07-06", { complete });
    const latest = await loadLatestStrategyMix("tenant-a");
    expect(latest?.weekOf).toBe("2026-07-06");
  });

  it("clamps a schema-valid but out-of-app-range weight from the LLM to [0.5, 2.0]", async () => {
    // The schema itself allows 0..10 (a sanity ceiling against garbage); the app-level
    // clamp in apply-mix.ts is the tighter [0.5, 2.0] band the spec requires. 8 is valid
    // JSON per the schema but must still be clamped down before it ever reaches a score.
    const response = { ...VALID_RESPONSE, leverMix: [{ family: "answer", weight: 8, reason: "huge win" }] };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(response) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.record!.leverMix[0]!.weight).toBe(2.0);
  });

  it("drops a family the LLM invented that is not in the known vocabulary", async () => {
    const response = { ...VALID_RESPONSE, leverMix: [{ family: "made_up_lever", weight: 1.8, reason: "x" }] };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(response) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.record!.leverMix).toEqual([]);
  });

  it("dash-strips the memo even if the model used an em dash", async () => {
    const response = { ...VALID_RESPONSE, memo: "I am leaning in — answer blocks won this week and title edits did not." };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(response) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.record!.memo).not.toMatch(/[—–]/);
  });

  it("caps focusFamilies at 3 even if the model proposes more (schema max already enforces this, belt + suspenders)", async () => {
    const response = {
      ...VALID_RESPONSE,
      focusFamilies: [
        { family: "a", reason: "x" },
        { family: "b", reason: "x" },
        { family: "c", reason: "x" },
      ],
    };
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(response) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.record!.focusFamilies.length).toBeLessThanOrEqual(3);
  });
});

describe("runStrategyReview - idempotency", () => {
  it("a second call for the same tenant+week reports already_ran and does not overwrite", async () => {
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    await runStrategyReview("tenant-a", "2026-07-06", { complete });
    const secondResponse = { ...VALID_RESPONSE, memo: "a different memo entirely, this should never be stored" };
    const r2 = await runStrategyReview("tenant-a", "2026-07-06", { complete: vi.fn(fakeComplete([{ text: JSON.stringify(secondResponse) }])) });
    expect(r2.ran).toBe(false);
    expect(r2.reason).toBe("already_ran");
    const latest = await loadLatestStrategyMix("tenant-a");
    expect(latest!.memo).toContain("leaning into answer blocks");
  });
});

describe("runStrategyReview - fail open, loudly, to no change", () => {
  it("is OFF (no record, no warn) when BEACON_LLM_PROVIDER is not openai and there is no previous mix", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("off");
    expect(r.record).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("carries the PREVIOUS week's mix forward unchanged when the budget is blocked", async () => {
    // Seed a previous week's mix.
    await appendStrategyMixRecord({
      tenant_id: "tenant-a",
      weekOf: "2026-06-29",
      leverMix: [{ family: "meta", weight: 1.2, reason: "steady" }],
      focusFamilies: [],
      memo: "Last week's memo.",
      appliedAt: "2026-06-28T22:00:00.000Z",
      source: "llm",
    });
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("blocked_budget");
    expect(r.record!.source).toBe("fail_open");
    expect(r.record!.leverMix).toEqual([{ family: "meta", weight: 1.2, reason: "steady" }]);
    expect(r.record!.memo).toBe("Last week's memo.");
    const warns = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("[strategy-review] FAIL OPEN"));
    expect(warns.length).toBeGreaterThan(0);
  });

  it("carries the previous mix forward on validation failure (invalid JSON, retried once, still bad)", async () => {
    await appendStrategyMixRecord({
      tenant_id: "tenant-a",
      weekOf: "2026-06-29",
      leverMix: [{ family: "meta", weight: 1.2, reason: "steady" }],
      focusFamilies: [],
      memo: "Last week's memo.",
      appliedAt: "2026-06-28T22:00:00.000Z",
      source: "llm",
    });
    const complete = vi.fn(fakeComplete([{ text: "not json" }, { text: "still not json" }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.ran).toBe(false);
    expect(r.record!.source).toBe("fail_open");
    expect(r.record!.leverMix).toEqual([{ family: "meta", weight: 1.2, reason: "steady" }]);
  });

  it("writes NO record (null) on failure when there is no previous week to carry forward", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.ran).toBe(false);
    expect(r.record).toBeNull();
  });

  it("fails open when the dossier build itself throws", async () => {
    loadStrategyDossierMock.mockRejectedValueOnce(new Error("gsc down"));
    await appendStrategyMixRecord({
      tenant_id: "tenant-a",
      weekOf: "2026-06-29",
      leverMix: [{ family: "meta", weight: 1.2, reason: "steady" }],
      focusFamilies: [],
      memo: "Last week's memo.",
      appliedAt: "2026-06-28T22:00:00.000Z",
      source: "llm",
    });
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    const r = await runStrategyReview("tenant-a", "2026-07-06", { complete });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("dossier_failed");
    expect(r.record!.source).toBe("fail_open");
    expect(complete).not.toHaveBeenCalled();
  });

  it("never throws even when appendStrategyMixRecord itself would throw", async () => {
    const mod = await import("./strategy-mix-store");
    const spy = vi.spyOn(mod, "appendStrategyMixRecord").mockRejectedValueOnce(new Error("disk gone"));
    const complete = vi.fn(fakeComplete([{ text: JSON.stringify(VALID_RESPONSE) }]));
    await expect(runStrategyReview("tenant-a", "2026-07-06", { complete })).resolves.toBeDefined();
    spy.mockRestore();
  });
});
