import { describe, it, expect } from "vitest";

import {
  windowRole,
  windowCanSetVerdict,
  windowCanDemote,
  applyDemoteOnly56,
  DEFAULT_WINDOW_PLAN,
  PRIMARY_WINDOW_DAY,
} from "./window-role";
import type { ProofWindowDay } from "./measure";

/**
 * Contract pin for the protocol Section 4.2 repeated-looks structure. These
 * tests ARE the contract: 28 is the single primary verdict-setting window, 56 is
 * demote-only (takes a won away, never grants one), and 7/14/84 are context-only.
 */

describe("windowRole - the verdict role of each window", () => {
  it("28 is the single PRIMARY (verdict-setting) window", () => {
    expect(windowRole(28)).toBe("primary");
    expect(PRIMARY_WINDOW_DAY).toBe(28);
  });

  it("56 is DEMOTE-ONLY (a won that did not hold, never an upgrade)", () => {
    expect(windowRole(56)).toBe("demote_only");
  });

  it("7, 14, and 84 are CONTEXT-only (never write the verdict enum)", () => {
    expect(windowRole(7)).toBe("context");
    expect(windowRole(14)).toBe("context");
    expect(windowRole(84)).toBe("context");
  });

  it("only the primary window may set the verdict enum", () => {
    expect(windowCanSetVerdict(28)).toBe(true);
    for (const d of [7, 14, 56, 84] as ProofWindowDay[]) {
      expect(windowCanSetVerdict(d)).toBe(false);
    }
  });

  it("only the demote-only window may take a won away", () => {
    expect(windowCanDemote(56)).toBe(true);
    for (const d of [7, 14, 28, 84] as ProofWindowDay[]) {
      expect(windowCanDemote(d)).toBe(false);
    }
  });
});

describe("DEFAULT_WINDOW_PLAN - the plan every ship predeclares (protocol 4.2)", () => {
  it("is exactly 7 context, 14 context, 28 primary, 56 demote_only, 84 context", () => {
    expect(DEFAULT_WINDOW_PLAN).toEqual([
      { day: 7, role: "context" },
      { day: 14, role: "context" },
      { day: 28, role: "primary" },
      { day: 56, role: "demote_only" },
      { day: 84, role: "context" },
    ]);
  });

  it("every entry's role agrees with windowRole (no drift between plan and helper)", () => {
    for (const entry of DEFAULT_WINDOW_PLAN) {
      expect(entry.role).toBe(windowRole(entry.day));
    }
  });

  it("has exactly one primary window", () => {
    expect(DEFAULT_WINDOW_PLAN.filter((e) => e.role === "primary")).toHaveLength(1);
  });
});

describe("applyDemoteOnly56 - the demote-only 56 day rule", () => {
  it("demotes a won that did NOT hold to inconclusive", () => {
    const r = applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false });
    expect(r.verdict).toBe("inconclusive");
    expect(r.demoted).toBe(true);
  });

  it("leaves a won that HELD untouched", () => {
    const r = applyDemoteOnly56({ primaryVerdict: "won", heldAt56: true });
    expect(r.verdict).toBe("won");
    expect(r.demoted).toBe(false);
    expect(r.provisional).toBe(false);
  });

  it("NEVER upgrades: a lost or inconclusive at 28 is unchanged regardless of the 56 read", () => {
    for (const primaryVerdict of ["lost", "inconclusive", "insufficient_data", "measuring"] as const) {
      for (const heldAt56 of [true, false]) {
        const r = applyDemoteOnly56({ primaryVerdict, heldAt56 });
        expect(r.verdict).toBe(primaryVerdict);
        expect(r.demoted).toBe(false);
      }
    }
  });

  it("flags a demotion PROVISIONAL until 56 day placebo history supports the window", () => {
    // Default (no support) -> provisional.
    expect(applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false }).provisional).toBe(true);
    // Explicitly unsupported -> provisional.
    expect(
      applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false, placeboHistorySupports56: false })
        .provisional,
    ).toBe(true);
    // Supported -> a demotion is no longer provisional.
    expect(
      applyDemoteOnly56({ primaryVerdict: "won", heldAt56: false, placeboHistorySupports56: true })
        .provisional,
    ).toBe(false);
  });
});
