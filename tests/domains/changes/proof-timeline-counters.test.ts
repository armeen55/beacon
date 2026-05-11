/**
 * /changes proof-timeline — top-of-page counter helpers.
 *
 * Pins the bucket → counter rules so a future classifier rename never
 * silently changes the customer-visible headline numbers.
 */
import { describe, expect, it } from "vitest";

import {
  computeProofCounters,
  PROOF_COUNTER_LABEL,
} from "@/domains/changes/proof-timeline/counters";

const NOW = new Date("2026-05-15T12:00:00Z");

describe("computeProofCounters", () => {
  it("returns zero counters for an empty input", () => {
    expect(computeProofCounters([], NOW)).toEqual({
      shippedThisMonth: 0,
      working: 0,
      needsReview: 0,
    });
  });

  it("counts pending_implementation as Working", () => {
    const result = computeProofCounters(
      [
        {
          timestamp: "2026-05-10T00:00:00Z",
          lifecycleClass: "pending_implementation",
        },
        {
          timestamp: "2026-05-01T00:00:00Z",
          lifecycleClass: "pending_implementation",
        },
      ],
      NOW,
    );
    expect(result.working).toBe(2);
    expect(result.shippedThisMonth).toBe(0);
    expect(result.needsReview).toBe(0);
  });

  it("counts needs_review as Needs review", () => {
    const result = computeProofCounters(
      [
        { timestamp: "2026-05-09T00:00:00Z", lifecycleClass: "needs_review" },
      ],
      NOW,
    );
    expect(result.needsReview).toBe(1);
    expect(result.working).toBe(0);
    expect(result.shippedThisMonth).toBe(0);
  });

  it("counts live_verified + scan_confirmed in the current month as Shipped this month", () => {
    const result = computeProofCounters(
      [
        // Current month — both shapes count.
        { timestamp: "2026-05-04T00:00:00Z", lifecycleClass: "live_verified" },
        { timestamp: "2026-05-09T00:00:00Z", lifecycleClass: "scan_confirmed" },
        // Previous month — excluded.
        { timestamp: "2026-04-29T00:00:00Z", lifecycleClass: "live_verified" },
        // Pending — never counts as shipped.
        {
          timestamp: "2026-05-08T00:00:00Z",
          lifecycleClass: "pending_implementation",
        },
        // Imported legacy — excluded even when in the current month.
        {
          timestamp: "2026-05-02T00:00:00Z",
          lifecycleClass: "imported_legacy",
        },
      ],
      NOW,
    );
    expect(result.shippedThisMonth).toBe(2);
    expect(result.working).toBe(1);
    expect(result.needsReview).toBe(0);
  });

  it("treats null lifecycleClass as a no-op (no counters incremented)", () => {
    const result = computeProofCounters(
      [
        { timestamp: "2026-05-09T00:00:00Z", lifecycleClass: null },
        { timestamp: "2026-05-10T00:00:00Z", lifecycleClass: null },
      ],
      NOW,
    );
    expect(result.shippedThisMonth).toBe(0);
    expect(result.working).toBe(0);
    expect(result.needsReview).toBe(0);
  });

  it("ignores rows whose timestamp is unparseable", () => {
    const result = computeProofCounters(
      [
        { timestamp: "not-a-date", lifecycleClass: "live_verified" },
      ],
      NOW,
    );
    expect(result.shippedThisMonth).toBe(0);
  });

  it("labels stay customer-safe (no internal jargon)", () => {
    expect(PROOF_COUNTER_LABEL.shippedThisMonth).toBe("Shipped this month");
    expect(PROOF_COUNTER_LABEL.working).toBe("Working");
    expect(PROOF_COUNTER_LABEL.needsReview).toBe("Needs review");
    const banned = ["z-score", "lifecycle", "evidence tier", "decision queue"];
    for (const v of Object.values(PROOF_COUNTER_LABEL)) {
      const lower = v.toLowerCase();
      for (const term of banned) {
        expect(lower, `${v} leaked '${term}'`).not.toContain(term);
      }
    }
  });
});
