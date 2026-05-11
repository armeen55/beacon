/**
 * /changes proof-timeline — pure resolver truth tables.
 *
 * Pins the customer-vocabulary contract for the single result pill
 * shown on each timeline card. The resolver is the only module that
 * decides which of the seven customer-visible labels a row earns;
 * locking the table here protects the timeline from accidental
 * vocabulary drift.
 */
import { describe, expect, it } from "vitest";

import {
  resolveProofPill,
  type ResolveProofPillInput,
} from "@/domains/changes/proof-timeline/result-pill";

function input(
  overrides: Partial<ResolveProofPillInput> = {},
): ResolveProofPillInput {
  return {
    urlVerdict: null,
    lifecycleClass: null,
    lifecycleStatus: null,
    ...overrides,
  };
}

describe("resolveProofPill", () => {
  it("returns Needs review when the lifecycle class is needs_review", () => {
    const pill = resolveProofPill(input({ lifecycleClass: "needs_review" }));
    expect(pill.kind).toBe("needs_review");
    expect(pill.label).toBe("Needs review");
    expect(pill.tone).toBe("warning");
  });

  it("returns Watching for a pending implementation row", () => {
    const pill = resolveProofPill(
      input({ lifecycleClass: "pending_implementation" }),
    );
    expect(pill.kind).toBe("watching");
    expect(pill.label).toBe("Watching");
    // Watching blurb must signal the row is in-flight.
    expect(pill.blurb.toLowerCase()).toContain("accepted");
  });

  it("returns Needs review when the linked edit is not_found_after_7d, even on a live class", () => {
    const pill = resolveProofPill(
      input({
        lifecycleClass: "live_verified",
        lifecycleStatus: "not_found_after_7d",
      }),
    );
    expect(pill.kind).toBe("needs_review");
  });

  it("returns Helping for url verdict=helping", () => {
    const pill = resolveProofPill(
      input({
        urlVerdict: { verdict: "helping" },
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("helping");
    expect(pill.label).toBe("Helping");
    expect(pill.tone).toBe("success");
  });

  it("returns Hurting for url verdict=hurting", () => {
    const pill = resolveProofPill(
      input({
        urlVerdict: { verdict: "hurting" },
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("hurting");
    expect(pill.label).toBe("Hurting");
    expect(pill.tone).toBe("danger");
  });

  it("returns Too early for the early/insufficient verdict family", () => {
    for (const v of [
      "too_early",
      "not_enough_data",
      "not_enough_native_baseline",
    ] as const) {
      const pill = resolveProofPill(
        input({
          urlVerdict: { verdict: v },
          lifecycleClass: "live_verified",
        }),
      );
      expect(pill.kind, `verdict=${v}`).toBe("too_early");
      expect(pill.label, `verdict=${v}`).toBe("Too early");
    }
  });

  it("returns No signal yet for url verdict=nothing_yet", () => {
    const pill = resolveProofPill(
      input({
        urlVerdict: { verdict: "nothing_yet" },
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("no_signal_yet");
    expect(pill.label).toBe("No signal yet");
  });

  it("returns Watching (early signs, never proof) for url verdict=weak_signal", () => {
    const pill = resolveProofPill(
      input({
        urlVerdict: { verdict: "weak_signal" },
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("watching");
    expect(pill.blurb.toLowerCase()).toContain("early signs");
    // Honesty contract: weak signal is never described as proof.
    expect(pill.blurb.toLowerCase()).not.toContain("proof");
    expect(pill.blurb.toLowerCase()).not.toContain("confirmed");
  });

  it("returns Needs review for verdict=not_implemented", () => {
    const pill = resolveProofPill(
      input({
        urlVerdict: { verdict: "not_implemented" },
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("needs_review");
  });

  it("returns Live for live_verified with no computable verdict", () => {
    const pill = resolveProofPill(
      input({ lifecycleClass: "live_verified", urlVerdict: null }),
    );
    expect(pill.kind).toBe("live");
    expect(pill.label).toBe("Live");
    expect(pill.tone).toBe("success");
  });

  it("returns Watching as the calm default for unclassified rows with no verdict", () => {
    const pill = resolveProofPill(input({ lifecycleClass: "unclassified" }));
    expect(pill.kind).toBe("watching");
    expect(pill.label).toBe("Watching");
  });

  it("never returns a label outside the customer-safe seven-set", () => {
    const allowed = new Set([
      "Helping",
      "Hurting",
      "Too early",
      "No signal yet",
      "Needs review",
      "Live",
      "Watching",
    ]);
    // Exercise every public verdict + lifecycle combination.
    const verdicts = [
      null,
      { verdict: "helping" as const },
      { verdict: "hurting" as const },
      { verdict: "too_early" as const },
      { verdict: "not_enough_data" as const },
      { verdict: "not_enough_native_baseline" as const },
      { verdict: "nothing_yet" as const },
      { verdict: "weak_signal" as const },
      { verdict: "not_implemented" as const },
    ];
    const classes = [
      null,
      "live_verified" as const,
      "pending_implementation" as const,
      "needs_review" as const,
      "imported_legacy" as const,
      "scan_confirmed" as const,
      "unclassified" as const,
    ];
    for (const urlVerdict of verdicts) {
      for (const lifecycleClass of classes) {
        const pill = resolveProofPill({
          urlVerdict,
          lifecycleClass,
          lifecycleStatus: null,
        });
        expect(allowed.has(pill.label)).toBe(true);
      }
    }
  });

  it("never leaks forbidden customer vocabulary in any blurb", () => {
    const allCombos = [
      [null, "live_verified"],
      [null, "needs_review"],
      [null, "pending_implementation"],
      [{ verdict: "helping" as const }, "live_verified"],
      [{ verdict: "hurting" as const }, "live_verified"],
      [{ verdict: "too_early" as const }, "live_verified"],
      [{ verdict: "nothing_yet" as const }, "live_verified"],
      [{ verdict: "weak_signal" as const }, "live_verified"],
    ] as const;
    const banned = [
      "z-score",
      "evidence tier",
      "lifecycle",
      "median_landing",
      "pattern brain",
      "decision matrix",
    ];
    for (const [urlVerdict, lifecycleClass] of allCombos) {
      const pill = resolveProofPill({
        urlVerdict,
        lifecycleClass,
        lifecycleStatus: null,
      });
      const lower = pill.blurb.toLowerCase();
      for (const term of banned) {
        expect(lower, `blurb leaked '${term}'`).not.toContain(term);
      }
    }
  });
});
