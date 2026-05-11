/**
 * Bundle 2A — RecommendationsV2Client render tests.
 *
 * Verifies that the v2 client:
 *   • renders the layout marker (`data-recommendations-layout="v2-card-stack"`)
 *   • renders one card per "new"/Suggested rec, capped at 7
 *   • surfaces the working rail when accepted/measuring/shipped rows exist
 *   • renders the calm + empty states correctly
 *   • includes the legacy escape-hatch link
 *   • never leaks operator vocabulary
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { RecommendationsV2Client } from "@/app/(shell)/recommendations/recommendations-v2-client";
import type {
  RecommendationQueueRow,
  RecommendationWatchRow,
} from "@/app/(shell)/recommendations/page";

// Reuse the same fixture shape as render-output-cleanup.test.tsx so we
// exercise the actual `buildRecommendationActionRows` helper.
function makeRec(
  overrides: Partial<RecommendationQueueRow["rec"]> = {},
  options: { responseStatus?: "accepted" | null } = {},
): RecommendationQueueRow {
  const stableKey = (overrides.stableKey as string | undefined) ?? "rec-fix-1";
  const rec = {
    stableKey,
    type: "create_cluster_page",
    title: "fixture title",
    description: "fixture description",
    affectedPromptIds: ["p-1", "p-2", "p-3"],
    clusterLabel: "Atherton modern home builder",
    clusterKind: "geo",
    evidence: {
      promptCount: 3,
      observationCount: 8,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 70,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    severity: "medium",
    effort: "low",
    score: 7,
    tier: "now",
    rank: 1,
    reasoning:
      "AI is citing other builders for this cluster; Ritz has no dedicated page.",
    resolution: {
      action: "create_new_page",
      motive: "capture_absent_cluster",
      targetUrl: "needs_new_page",
      confidence: "medium",
      confidenceReason: "AI cites Greenberg on 4 of 7 observations.",
      tier: "inventory",
      reasoning: "test",
      cannibalization: null,
      evidenceRefs: [],
      proposedSlug: null,
    },
    engineConfidence: { confidence: "medium", reasons: [] },
    ...overrides,
  } as unknown as RecommendationQueueRow["rec"];

  return {
    rec,
    response:
      options.responseStatus === "accepted"
        ? {
            recId: rec.stableKey,
            status: "accepted",
            respondedAt: new Date().toISOString(),
            deferUntil: null,
          }
        : null,
    edits: [
      {
        id: `${rec.stableKey}__add_faq__faq[new]:abc`,
        tenant_id: "tenant-test",
        rec_id: rec.stableKey,
        action_type: "add_faq",
        target_url: "https://ritzbuilders.com/services/whole-home-remodel",
        target_element_key: "faq[new]:abc",
        display_label: "How design-build cuts modern home costs",
        current_text: null,
        proposed_text:
          "Design-build keeps architecture, engineering, and construction under one roof.",
        why: "Design-build framing is missing on the current page.",
        evidence: [],
        expected_impact: null,
        difficulty: "low",
        confidence: "medium",
        measurement_plan:
          "Track citation rate on Atherton modern-home prompts for 14 days.",
        risks: [],
        source: "openai",
        provider_name: "openai",
        evidence_hash: "deadbeef",
        model: "gpt-5-mini",
        cost_usd: 0.0025,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        implementation_status:
          options.responseStatus === "accepted" ? "accepted" : "recommended",
        live_at: null,
        live_snapshot_id: null,
        live_match_confidence: null,
        live_match_kind: null,
        live_element_key: null,
        not_found_reason: null,
      },
    ] as RecommendationQueueRow["edits"],
  };
}

const promptTextById = {
  "p-1": "best modern home builder atherton",
  "p-2": "modern home builder bay area",
  "p-3": "luxury home renovation atherton",
};

function renderV2(
  queue: RecommendationQueueRow[],
  watchlist: RecommendationWatchRow[] = [],
): string {
  return renderToStaticMarkup(
    <RecommendationsV2Client
      queue={queue}
      watchlist={watchlist}
      matrixDate="2026-05-10"
      promptTextById={promptTextById}
    />,
  );
}

describe("Bundle 2A — RecommendationsV2Client", () => {
  it("renders the v2 layout marker", () => {
    const html = renderV2([makeRec()]);
    expect(html).toContain('data-recommendations-layout="v2-card-stack"');
  });

  it("renders the page header + subline (Updated <date>)", () => {
    const html = renderV2([makeRec()]);
    expect(html).toContain(">Recommendations</h1>");
    expect(html).toContain(
      "Beacon turns AI visibility gaps into concrete website tasks.",
    );
    expect(html).toContain("Updated 2026-05-10.");
  });

  it("renders one v2 card per Suggested (status=new) rec", () => {
    const queue = [
      makeRec({ stableKey: "r1" }),
      makeRec({ stableKey: "r2" }),
      makeRec({ stableKey: "r3" }),
    ];
    const html = renderV2(queue);
    const matches = html.match(/data-recommendation-v2-card="true"/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it("caps the suggested stack at 7 cards even when more recs are queued", () => {
    const queue = Array.from({ length: 12 }, (_, i) =>
      makeRec({ stableKey: `r${i}` }),
    );
    const html = renderV2(queue);
    const cardMatches = html.match(/data-recommendation-v2-card="true"/g) ?? [];
    expect(cardMatches.length).toBe(7);
    expect(html).toContain('data-recommendations-v2-cta="see-all"');
    expect(html).toContain("Showing the top 7 of 12 recommendations.");
  });

  it("renders the calm state when every rec is accepted/in-flight", () => {
    const queue = [
      makeRec({ stableKey: "r1" }, { responseStatus: "accepted" }),
      makeRec({ stableKey: "r2" }, { responseStatus: "accepted" }),
    ];
    const html = renderV2(queue);
    expect(html).toContain('data-recommendations-v2-calm="true"');
    expect(html).toContain("You");
    expect(html).toContain("caught up on suggestions");
  });

  it("renders the empty state when the queue is empty", () => {
    const html = renderV2([]);
    expect(html).toContain('data-recommendations-v2-empty="true"');
    expect(html).toContain("No recommendations right now.");
    expect(html).toContain("Beacon is watching for the next clear opportunity");
  });

  it("renders the working rail when accepted/measuring/shipped rows exist", () => {
    const queue = [
      makeRec({ stableKey: "r1" }),
      makeRec({ stableKey: "r2" }, { responseStatus: "accepted" }),
    ];
    const html = renderV2(queue);
    expect(html).toContain('data-recommendations-v2-rail="working"');
    expect(html).toContain('data-recommendations-v2-rail-row="true"');
  });

  it("omits the working rail when no rows are in flight", () => {
    const html = renderV2([makeRec({ stableKey: "r1" })]);
    expect(html).not.toContain('data-recommendations-v2-rail="working"');
  });

  it("renders the legacy escape-hatch footer link", () => {
    const html = renderV2([makeRec()]);
    expect(html).toContain('data-recommendations-v2-cta="legacy"');
    expect(html).toContain("/recommendations?legacy=1");
    expect(html).toContain("Open legacy view →");
  });

  it("never renders raw schema fields, IDs, or hashes", () => {
    const html = renderV2([makeRec()]);
    expect(html).not.toContain("deadbeef");
    expect(html).not.toContain("evidence_hash");
    expect(html).not.toContain("resolver_tier");
    expect(html).not.toContain("rec_id");
    expect(html).not.toContain("stableKey");
  });
});
