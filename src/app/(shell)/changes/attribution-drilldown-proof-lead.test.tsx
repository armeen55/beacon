/**
 * AttributionDrilldown — plain-English proof lead render pin.
 *
 * The Proof Engine's diff-in-diff result must reach the customer as a
 * readable sentence, not just analyst jargon. This renders the real
 * AttributionDrilldown with a `computed` outcome and asserts the plain-
 * English headline appears in the SSR markup (and that a `weak_estimate`
 * outcome renders the honest "still measuring" line, never a causal claim).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AttributionDrilldown } from "./attribution-drilldown";
import type { StoredChangeOutcome } from "@/domains/attribution/change-outcome-store";

function outcome(
  status: StoredChangeOutcome["status"],
  adjusted_lift: number,
): StoredChangeOutcome {
  const isComputed = status === "computed";
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
    confidence: "high",
    warnings: [],
    rationale: "engine rationale string",
    computed: isComputed
      ? {
          kind: "computed",
          overall: {
            platform: "all",
            treated_pre_avg: 1,
            treated_post_avg: 1 + adjusted_lift,
            control_pre_avg: 1,
            control_post_avg: 1,
            treated_delta: adjusted_lift,
            control_delta: 0,
            adjusted_lift,
            relative_lift: 0.5,
            controls_used: 3,
            pre_days_observed: 14,
            post_days_observed: 14,
          },
          per_platform: [],
        }
      : null,
    raw: isComputed
      ? null
      : {
          kind: "raw",
          overall: {
            platform: "all",
            treated_pre_avg: 1,
            treated_post_avg: 2,
            treated_delta: 1,
            pre_days_observed: 14,
            post_days_observed: 7,
            caveat: "treated-only; not a causal estimate",
          },
          per_platform: [],
        },
    matched_control_count: isComputed ? 3 : 0,
    matched_control_urls: [],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    sparklines: null,
    computed_at: "2026-05-30T00:00:00.000Z",
  };
}

describe("AttributionDrilldown plain-English proof lead", () => {
  it("renders the causal headline for a computed positive lift", () => {
    const html = renderToStaticMarkup(
      <AttributionDrilldown outcome={outcome("computed", 2)} />,
    );
    expect(html).toContain("more AI citations a day than comparable pages");
    expect(html).toContain('data-proof-sentence="helping"');
    // The engine rationale still renders below as supporting detail.
    expect(html).toContain("engine rationale string");
  });

  it("renders 'still measuring' for a weak_estimate — never a causal claim", () => {
    const html = renderToStaticMarkup(
      <AttributionDrilldown outcome={outcome("weak_estimate", 0)} />,
    );
    expect(html).toContain("Still measuring");
    expect(html).toContain('data-proof-sentence="watching"');
    expect(html).not.toContain("comparable pages that didn't change");
  });
});
