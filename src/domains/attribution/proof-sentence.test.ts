/**
 * proof-sentence — plain-English voice of the causal Proof Engine.
 *
 * Pins the honesty rules: cause-and-effect language ONLY for `computed`,
 * confidence tier always spoken, weak/insufficient/zero/ineligible all
 * render as "still measuring" / "nothing to measure" (never a causal claim),
 * and low-confidence computed results are softened, not overstated.
 */

import { describe, it, expect } from "vitest";

import { buildProofSentence } from "./proof-sentence";
import type { StoredChangeOutcome } from "./change-outcome-store";
import type { ConfidenceTier } from "./natural-controls";

function outcome(
  status: StoredChangeOutcome["status"],
  opts: {
    adjusted_lift?: number;
    relative_lift?: number | null;
    controls_used?: number;
    confidence?: ConfidenceTier;
  } = {},
): StoredChangeOutcome {
  const isComputed = status === "computed";
  const lift = opts.adjusted_lift ?? 2;
  return {
    source_id: "x",
    classifier_version: "test",
    stored_at: "2026-05-30T00:00:00.000Z",
    taxonomy_layer: "change",
    primary_bucket: "content.faq.add",
    child_tags: [],
    paired_with: [],
    bundle_parent_id: null,
    bundle_size: 1,
    url: "/services/roofing",
    url_type: "service",
    treatment_date: "2026-05-15",
    pre_window: { start: "2026-05-01", end: "2026-05-14" },
    post_window: { start: "2026-05-16", end: "2026-05-29" },
    status,
    confidence: opts.confidence ?? "high",
    warnings: [],
    rationale: "test",
    computed: isComputed
      ? {
          kind: "computed",
          overall: {
            platform: "all",
            treated_pre_avg: 1,
            treated_post_avg: 1 + lift,
            control_pre_avg: 1,
            control_post_avg: 1,
            treated_delta: lift,
            control_delta: 0,
            adjusted_lift: lift,
            relative_lift: opts.relative_lift ?? null,
            controls_used: opts.controls_used ?? 3,
            pre_days_observed: 14,
            post_days_observed: 14,
          },
          per_platform: [],
        }
      : null,
    raw: null,
    matched_control_count: opts.controls_used ?? 3,
    matched_control_urls: [],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    sparklines: null,
    computed_at: "2026-05-30T00:00:00.000Z",
  };
}

describe("buildProofSentence", () => {
  it("computed + positive lift → helping, with cause-and-effect language", () => {
    const s = buildProofSentence(
      outcome("computed", { adjusted_lift: 2, relative_lift: 0.5, controls_used: 3 }),
    );
    expect(s.tone).toBe("helping");
    expect(s.headline).toContain("+2 more AI citations a day");
    expect(s.headline).toContain("comparable pages that didn't change");
    expect(s.headline).toContain("+50% more");
    expect(s.sub).toContain("3 similar pages");
    expect(s.sub.toLowerCase()).toContain("cause-and-effect");
  });

  it("computed + low confidence → helping but SOFTENED, never overstated", () => {
    const s = buildProofSentence(
      outcome("computed", { adjusted_lift: 1.5, confidence: "low", controls_used: 2 }),
    );
    expect(s.tone).toBe("helping");
    expect(s.sub.toLowerCase()).toContain("early");
    // The hard "cause-and-effect, not coincidence" claim is reserved for
    // non-low confidence.
    expect(s.sub.toLowerCase()).not.toContain("cause-and-effect");
  });

  it("singular citation reads grammatically (+1 citation, no 's')", () => {
    const s = buildProofSentence(outcome("computed", { adjusted_lift: 1 }));
    expect(s.headline).toContain("+1 more AI citation a day");
    expect(s.headline).not.toContain("+1 more AI citations");
  });

  it("computed + negative lift → hurting", () => {
    const s = buildProofSentence(outcome("computed", { adjusted_lift: -1.5, controls_used: 4 }));
    expect(s.tone).toBe("hurting");
    expect(s.headline.toLowerCase()).toContain("lost about 1.5");
    expect(s.headline.toLowerCase()).toContain("working against you");
  });

  it("computed + near-zero lift → flat (no move)", () => {
    const s = buildProofSentence(outcome("computed", { adjusted_lift: 0.2 }));
    expect(s.tone).toBe("flat");
    expect(s.headline.toLowerCase()).toContain("didn't move");
  });

  it("weak_estimate / no_controls → watching, NEVER a causal claim", () => {
    for (const status of ["weak_estimate", "no_controls"] as const) {
      const s = buildProofSentence(outcome(status));
      expect(s.tone).toBe("watching");
      expect(s.headline.toLowerCase()).toContain("still measuring");
      expect(s.headline.toLowerCase()).not.toContain("caused");
    }
  });

  it("insufficient_post_data → too soon to tell", () => {
    const s = buildProofSentence(outcome("insufficient_post_data"));
    expect(s.tone).toBe("watching");
    expect(s.headline.toLowerCase()).toContain("too soon");
  });

  it("zero_signal → nothing to measure (tone none)", () => {
    const s = buildProofSentence(outcome("zero_signal"));
    expect(s.tone).toBe("none");
    expect(s.headline.toLowerCase()).toContain("nothing to measure");
  });

  it("ineligible / unsupported → not page-measurable (tone none)", () => {
    for (const status of ["unsupported_scope", "ineligible_layer", "ineligible_event"] as const) {
      const s = buildProofSentence(outcome(status));
      expect(s.tone).toBe("none");
      expect(s.headline.toLowerCase()).toContain("measure page-by-page");
    }
  });
});
