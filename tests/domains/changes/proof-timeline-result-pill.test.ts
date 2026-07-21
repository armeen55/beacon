/**
 * /changes proof-timeline — pure resolver truth tables.
 *
 * Pins the customer-vocabulary contract for the single result pill
 * shown on each timeline card. The resolver is the only module that
 * decides which of the seven customer-visible labels a row earns;
 * locking the table here protects the timeline from accidental
 * vocabulary drift.
 *
 * Verdict-engine consolidation (2026-07-21, CORE 100K Lane F): the
 * resolver now reads the proof-gsc measurement presentation summary
 * (maturity + direction + verdict), the same maturity model Results
 * renders. A row with no proof coverage must say plainly it is not
 * being measured, never an invented verdict.
 */
import { describe, expect, it } from "vitest";

import {
  resolveProofPill,
  type ProofMeasurementSummary,
  type ResolveProofPillInput,
} from "@/domains/changes/proof-timeline/result-pill";

function proofOf(
  overrides: Partial<ProofMeasurementSummary> = {},
): ProofMeasurementSummary {
  return {
    maturity: "collecting",
    direction: "unknown",
    verdict: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<ResolveProofPillInput> = {},
): ResolveProofPillInput {
  return {
    proof: null,
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
    // Watching blurb must signal the row is in-flight (waiting to go live).
    expect(pill.blurb.toLowerCase()).toContain("waiting");
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

  it("returns Helping only for a MATURE helped result", () => {
    const pill = resolveProofPill(
      input({
        proof: proofOf({
          maturity: "mature_result",
          direction: "positive",
          verdict: "helped",
        }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("helping");
    expect(pill.label).toBe("Helping");
    expect(pill.tone).toBe("success");
    // The verdict source is Google, and the blurb says so plainly.
    expect(pill.blurb.toLowerCase()).toContain("google");
  });

  it("returns Hurting only for a MATURE did_not_help result", () => {
    const pill = resolveProofPill(
      input({
        proof: proofOf({
          maturity: "mature_result",
          direction: "negative",
          verdict: "did_not_help",
        }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("hurting");
    expect(pill.label).toBe("Hurting");
    expect(pill.tone).toBe("danger");
  });

  it("an early positive read is Watching, NEVER Helping (honesty invariant)", () => {
    for (const maturity of [
      "early_checkpoint",
      "interim_checkpoint",
      "attribution_limited",
    ] as const) {
      const pill = resolveProofPill(
        input({
          proof: proofOf({ maturity, direction: "positive" }),
          lifecycleClass: "live_verified",
        }),
      );
      expect(pill.kind, `maturity=${maturity}`).toBe("watching");
      expect(pill.blurb.toLowerCase()).toContain("early signs");
      // Honesty contract: an early read is never described as proof.
      expect(pill.blurb.toLowerCase()).not.toContain("proof");
      expect(pill.blurb.toLowerCase()).not.toContain("confirmed");
    }
  });

  it("an early negative read is Watching, NEVER Hurting", () => {
    const pill = resolveProofPill(
      input({
        proof: proofOf({ maturity: "early_checkpoint", direction: "negative" }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("watching");
    expect(pill.tone).toBe("info");
  });

  it("an early read with no direction yet is Too early", () => {
    const pill = resolveProofPill(
      input({
        proof: proofOf({ maturity: "early_checkpoint", direction: "unknown" }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("too_early");
    expect(pill.label).toBe("Too early");
  });

  it("returns Too early for the pre-checkpoint family", () => {
    for (const maturity of ["scheduled", "collecting", "blocked_data"] as const) {
      const pill = resolveProofPill(
        input({
          proof: proofOf({ maturity }),
          lifecycleClass: "live_verified",
        }),
      );
      expect(pill.kind, `maturity=${maturity}`).toBe("too_early");
      expect(pill.label, `maturity=${maturity}`).toBe("Too early");
    }
  });

  it("returns No signal yet for a mature result without lift and for inconclusive", () => {
    const matureNoLift = resolveProofPill(
      input({
        proof: proofOf({
          maturity: "mature_result",
          direction: "neutral",
          verdict: "no_lift",
        }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(matureNoLift.kind).toBe("no_signal_yet");
    expect(matureNoLift.label).toBe("No signal yet");

    const inconclusive = resolveProofPill(
      input({
        proof: proofOf({ maturity: "inconclusive", direction: "neutral" }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(inconclusive.kind).toBe("no_signal_yet");
  });

  it("returns No signal yet (stopped waiting) for unresolved", () => {
    const pill = resolveProofPill(
      input({
        proof: proofOf({ maturity: "unresolved" }),
        lifecycleClass: "live_verified",
      }),
    );
    expect(pill.kind).toBe("no_signal_yet");
    expect(pill.blurb.toLowerCase()).toContain("stopped waiting");
  });

  it("returns Live with an honest not-measured line for live_verified without proof coverage", () => {
    const pill = resolveProofPill(
      input({ lifecycleClass: "live_verified", proof: null }),
    );
    expect(pill.kind).toBe("live");
    expect(pill.label).toBe("Live");
    expect(pill.tone).toBe("success");
    // No invented verdict: the blurb says plainly it is not being measured.
    expect(pill.blurb.toLowerCase()).toContain("not measuring");
  });

  it("returns Watching with the honest not-measured line as the calm default", () => {
    const pill = resolveProofPill(input({ lifecycleClass: "unclassified" }));
    expect(pill.kind).toBe("watching");
    expect(pill.label).toBe("Watching");
    expect(pill.blurb.toLowerCase()).toContain("not measuring");
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
    const proofs: Array<ProofMeasurementSummary | null> = [
      null,
      proofOf({ maturity: "scheduled" }),
      proofOf({ maturity: "collecting" }),
      proofOf({ maturity: "blocked_data" }),
      proofOf({ maturity: "unresolved" }),
      proofOf({ maturity: "early_checkpoint", direction: "positive" }),
      proofOf({ maturity: "early_checkpoint", direction: "negative" }),
      proofOf({ maturity: "interim_checkpoint", direction: "neutral" }),
      proofOf({ maturity: "attribution_limited", direction: "positive" }),
      proofOf({ maturity: "inconclusive", direction: "neutral" }),
      proofOf({ maturity: "mature_result", direction: "positive", verdict: "helped" }),
      proofOf({ maturity: "mature_result", direction: "negative", verdict: "did_not_help" }),
      proofOf({ maturity: "mature_result", direction: "neutral", verdict: "no_lift" }),
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
    for (const proof of proofs) {
      for (const lifecycleClass of classes) {
        const pill = resolveProofPill({
          proof,
          lifecycleClass,
          lifecycleStatus: null,
        });
        expect(allowed.has(pill.label)).toBe(true);
      }
    }
  });

  it("never leaks forbidden customer vocabulary in any blurb", () => {
    const allCombos: Array<
      [ProofMeasurementSummary | null, "live_verified" | "needs_review" | "pending_implementation" | "unclassified"]
    > = [
      [null, "live_verified"],
      [null, "needs_review"],
      [null, "pending_implementation"],
      [null, "unclassified"],
      [proofOf({ maturity: "mature_result", verdict: "helped" }), "live_verified"],
      [proofOf({ maturity: "mature_result", verdict: "did_not_help" }), "live_verified"],
      [proofOf({ maturity: "early_checkpoint", direction: "positive" }), "live_verified"],
      [proofOf({ maturity: "early_checkpoint", direction: "negative" }), "live_verified"],
      [proofOf({ maturity: "inconclusive" }), "live_verified"],
      [proofOf({ maturity: "unresolved" }), "live_verified"],
      [proofOf({ maturity: "collecting" }), "live_verified"],
    ];
    const banned = [
      "z-score",
      "evidence tier",
      "lifecycle",
      "median_landing",
      "pattern brain",
      "decision matrix",
      "maturity",
      "checkpoint",
      "calibration",
      "baseline",
      "experiment",
      "control",
      "treatment",
      "serp",
    ];
    for (const [proof, lifecycleClass] of allCombos) {
      const pill = resolveProofPill({
        proof,
        lifecycleClass,
        lifecycleStatus: null,
      });
      const lower = pill.blurb.toLowerCase();
      for (const term of banned) {
        expect(lower, `blurb leaked '${term}'`).not.toContain(term);
      }
      // No em or en dashes ever in operator-facing copy.
      expect(pill.blurb).not.toMatch(/[–—]/);
    }
  });
});
