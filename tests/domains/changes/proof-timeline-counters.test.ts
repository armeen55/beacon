/**
 * /changes proof-timeline — top-of-page counter helpers (polish
 * bundle, 2026-05-11). After hosted review, the calendar-anchored
 * triplet ("Shipped this month / Working / Needs review") read as
 * 0/0/0 in workspaces whose recent edits were stamped in April.
 *
 * New triplet pinned by these tests: "Recent changes / Watching
 * for signal / Needs attention". Counters derive from the
 * already-resolved result-pill kind so the visible page and the
 * counter strip can never disagree.
 */
import { describe, expect, it } from "vitest";

import {
  computeProofCounters,
  PROOF_COUNTER_LABEL,
  WATCHING_PILL_KINDS,
  NEEDS_ATTENTION_PILL_KINDS,
} from "@/domains/changes/proof-timeline/counters";
import type { ProofPillKind } from "@/domains/changes/proof-timeline/result-pill";

describe("computeProofCounters", () => {
  it("returns zero counters for an empty input", () => {
    expect(computeProofCounters([])).toEqual({
      recentChanges: 0,
      watching: 0,
      needsAttention: 0,
    });
  });

  it("recentChanges always equals the input length, regardless of pill mix", () => {
    const kinds: ProofPillKind[] = [
      "helping",
      "hurting",
      "too_early",
      "needs_review",
      "live",
      "watching",
      "no_signal_yet",
    ];
    const result = computeProofCounters(kinds.map((k) => ({ pillKind: k })));
    expect(result.recentChanges).toBe(kinds.length);
  });

  it("counts watching/too_early/live/no_signal_yet as Watching", () => {
    const result = computeProofCounters([
      { pillKind: "watching" },
      { pillKind: "too_early" },
      { pillKind: "live" },
      { pillKind: "no_signal_yet" },
      { pillKind: "helping" }, // not Watching
      { pillKind: "hurting" }, // not Watching
      { pillKind: "needs_review" }, // not Watching
    ]);
    expect(result.watching).toBe(4);
  });

  it("counts hurting/needs_review as Needs attention", () => {
    const result = computeProofCounters([
      { pillKind: "hurting" },
      { pillKind: "needs_review" },
      { pillKind: "helping" }, // not Needs attention
      { pillKind: "watching" }, // not Needs attention
    ]);
    expect(result.needsAttention).toBe(2);
  });

  it("Helping rows count toward Recent changes but neither action-meaningful counter", () => {
    const result = computeProofCounters([
      { pillKind: "helping" },
      { pillKind: "helping" },
      { pillKind: "helping" },
    ]);
    expect(result.recentChanges).toBe(3);
    expect(result.watching).toBe(0);
    expect(result.needsAttention).toBe(0);
  });

  it("never produces 0/0/0 when the timeline has rows", () => {
    // Pre-polish bug: a workspace with only `helping` rows in April
    // showed 0/0/0 in May. After the polish bundle, even an
    // all-helping workspace shows a non-zero recentChanges value,
    // so the strip never lies about whether content exists.
    const cases: ProofPillKind[][] = [
      ["helping"],
      ["helping", "helping", "helping"],
      ["watching", "watching"],
      ["needs_review"],
      ["live"],
      ["hurting", "helping"],
    ];
    for (const kinds of cases) {
      const result = computeProofCounters(kinds.map((k) => ({ pillKind: k })));
      expect(result.recentChanges).toBeGreaterThan(0);
    }
  });

  it("WATCHING + NEEDS_ATTENTION sets are disjoint", () => {
    for (const kind of WATCHING_PILL_KINDS) {
      expect(NEEDS_ATTENTION_PILL_KINDS.has(kind)).toBe(false);
    }
    for (const kind of NEEDS_ATTENTION_PILL_KINDS) {
      expect(WATCHING_PILL_KINDS.has(kind)).toBe(false);
    }
  });

  it("labels stay customer-safe (no internal jargon)", () => {
    expect(PROOF_COUNTER_LABEL.recentChanges).toBe("Recent changes");
    expect(PROOF_COUNTER_LABEL.watching).toBe("Watching for signal");
    expect(PROOF_COUNTER_LABEL.needsAttention).toBe("Needs attention");
    const banned = [
      "z-score",
      "lifecycle",
      "evidence tier",
      "decision queue",
      "shipped this month",
    ];
    for (const v of Object.values(PROOF_COUNTER_LABEL)) {
      const lower = v.toLowerCase();
      for (const term of banned) {
        expect(lower, `${v} leaked '${term}'`).not.toContain(term);
      }
    }
  });
});
