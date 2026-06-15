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
  updateTag: vi.fn(),
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
      "Beacon turns your Google Search demand + AI-answer gaps into safe,",
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

  it("'See full list' is rendered as a v2-native button, never as a legacy link", () => {
    // 2026-05-13 follow-up — the previous behavior linked
    // `See full list →` to `/recommendations?legacy=1`, which pushed
    // customers out of v2. The new behavior is an inline toggle
    // (button) that expands the Suggested stack to render every
    // actionable row without leaving v2.
    const queue = Array.from({ length: 12 }, (_, i) =>
      makeRec({ stableKey: `r${i}` }),
    );
    const html = renderV2(queue);
    // The data-attr on the CTA still surfaces for telemetry parity,
    // but it must be on a <button>, never on an <a href=".../?legacy=1">.
    expect(html).toMatch(
      /<button[^>]*data-recommendations-v2-cta="see-all"/,
    );
    // No See-full-list link to legacy anywhere in the rendered output.
    expect(html).not.toMatch(
      /<a[^>]*data-recommendations-v2-cta="see-all"/,
    );
    expect(html).not.toContain("/recommendations?legacy=1");
  });

  it("the Suggested stack renders no anchor pointing into legacy", () => {
    // Bundle 2A V left the working rail defaulting to
    // `/recommendations?legacy=1#rec-<id>`. The 2026-05-13 follow-up
    // re-targets it at the v2 detail page so customers stay in v2 on
    // every click. This invariant pins the contract on every render
    // path the v2 client can produce.
    const mixedQueue = [
      makeRec({ stableKey: "r1" }),
      makeRec({ stableKey: "r2" }, { responseStatus: "accepted" }),
      makeRec({ stableKey: "r3" }, { responseStatus: "accepted" }),
    ];
    const html = renderV2(mixedQueue);
    expect(html).not.toMatch(/href="[^"]*\?legacy=1[^"]*"/);
  });

  it("working rail rows link to the v2 detail page, not to legacy", () => {
    // The working rail only renders when at least one row is in-flight
    // AND at least one row is Suggested (otherwise the v2 client falls
    // into the calm state). Mix the queue accordingly.
    const queue = [
      makeRec({ stableKey: "r1" }),
      makeRec({ stableKey: "r2" }, { responseStatus: "accepted" }),
    ];
    const html = renderV2(queue);
    // Each rail row anchors at `/recommendations/<encoded-row-id>`
    // (the same destination the v2 card's "Review →" uses by default).
    expect(html).toContain('data-recommendations-v2-rail-row="true"');
    // No anchor in the rendered output points at the legacy URL.
    expect(html).not.toMatch(/href="\/recommendations\?legacy=1#rec-/);
    // The rail's row href starts with the v2 detail-page prefix.
    expect(html).toMatch(/<a [^>]*href="\/recommendations\/[^?"]+"/);
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
    expect(html).toContain(
      "Refresh your connected data (Settings → Connectors) to surface the next",
    );
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

  it("no longer renders the 'Open legacy view' customer-facing footer CTA (removed 2026-05-12)", () => {
    // Pre-cleanup: the v2 card stack carried a "Need the table view?
    // Open legacy view →" footer link that made the product feel
    // unfinished. Removed as part of the perf/legacy-bloat audit.
    // The `?legacy=1` query param still routes to the legacy table
    // for rollback — it just isn't advertised.
    const html = renderV2([makeRec()]);
    expect(html).not.toContain('data-recommendations-v2-cta="legacy"');
    expect(html).not.toContain("Open legacy view →");
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

// ─────────────────────────────────────────────────────────────────────
// Bundle 2A V — verification-pass classification contract.
//
// After Bundle 2A shipped with `SUGGESTED_STATUSES = {"new"}`, the
// post-bundle audit caught the filter hiding rows that the legacy
// Executive Strip's "Need review" tile already exposed. The widened
// set must surface needs_review rows in the Suggested stack and keep
// the Working rail focused on actually-in-flight items
// (accepted / shipped / measuring). These tests pin the new contract
// so a future tightening cannot silently re-hide actionable rows.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a fixture rec whose `RecommendationActionRow` will end up at
 * the requested status. We can't directly stamp the action-row status
 * (that's derived inside `buildRecommendationActionRows`), but we CAN
 * drive it via the rec's `response.status` + `edits[].implementation_status`
 * which the builder reads. This helper exists only for the V tests.
 */
function makeRecWithDerivedStatus(
  derivedStatus:
    | "new"
    | "accepted"
    | "shipped"
    | "measuring"
    | "needs_review"
    | "needs_fresh_edit"
    | "deferred"
    | "dismissed",
  stableKey: string,
): RecommendationQueueRow {
  // Mirror the status-derivation paths in
  // `src/domains/recommendations/recommendation-action-rows.ts:statusForRow`.
  //   - responseStatus="dismissed"                       → "dismissed"
  //   - responseStatus="deferred"                        → "deferred"
  //   - responseStatus="accepted" + lifecycle=verified_live → "measuring"
  //   - responseStatus="accepted" + other lifecycle      → "accepted"
  //   - resolution.needsHumanReview=true                 → "needs_review"
  //   - all edits with implementation_status="dismissed" → "needs_fresh_edit"
  //   - no edits                                         → "needs_review"
  //   - no response + lifecycle=verified_live            → "shipped"
  //   - no response + lifecycle=needs_review/wrong_page  → "needs_review"
  //   - else                                             → "new"
  const base = makeRec({ stableKey });
  const stampEditStatus = (
    r: RecommendationQueueRow,
    status: string,
    extra: Partial<RecommendationQueueRow["edits"][number]> = {},
  ): RecommendationQueueRow => ({
    ...r,
    edits: r.edits.map((e) => ({
      ...e,
      implementation_status: status as RecommendationQueueRow["edits"][number]["implementation_status"],
      ...extra,
    })) as RecommendationQueueRow["edits"],
  });

  switch (derivedStatus) {
    case "new":
      return base;
    case "accepted":
      return makeRec({ stableKey }, { responseStatus: "accepted" });
    case "shipped":
      // No response + lifecycle=verified_live → shipped.
      return stampEditStatus(base, "verified_live", {
        live_at: new Date().toISOString(),
      });
    case "measuring":
      // responseStatus=accepted + lifecycle=verified_live → measuring.
      return stampEditStatus(
        makeRec({ stableKey }, { responseStatus: "accepted" }),
        "verified_live",
        { live_at: new Date(Date.now() - 8 * 86400000).toISOString() },
      );
    case "needs_review": {
      // resolution.needsHumanReview=true → needs_review (overrides
      // every lifecycle-derived path below).
      const r = makeRec({ stableKey });
      const recWithReview = {
        ...r.rec,
        resolution: {
          ...(r.rec as { resolution: Record<string, unknown> }).resolution,
          needsHumanReview: true,
        },
      } as RecommendationQueueRow["rec"];
      return { ...r, rec: recWithReview };
    }
    case "needs_fresh_edit":
      // No response + all edits dismissed → needs_fresh_edit.
      return stampEditStatus(base, "dismissed");
    case "deferred":
      return {
        ...base,
        response: {
          recId: stableKey,
          status: "deferred",
          respondedAt: new Date().toISOString(),
          deferUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      };
    case "dismissed":
      return {
        ...base,
        response: {
          recId: stableKey,
          status: "dismissed",
          respondedAt: new Date().toISOString(),
          deferUntil: null,
        },
      };
  }
}

describe("Bundle 2A V — v2 classification contract (post-Bundle-2A audit)", () => {
  it("surfaces 'needs_review' rows in the Suggested stack (per audit's customer-reviewable rule)", () => {
    const queue = [makeRecWithDerivedStatus("needs_review", "rev-1")];
    const html = renderV2(queue);

    // The card should render — not the empty/calm state.
    expect(html).toContain('data-recommendation-v2-card="true"');
    expect(html).not.toContain('data-recommendations-v2-empty="true"');
    expect(html).not.toContain('data-recommendations-v2-calm="true"');

    // The card MUST NOT appear in the working rail (avoids double-render).
    const railRowMatches = html.match(/data-recommendations-v2-rail-row="true"/g) ?? [];
    expect(railRowMatches.length).toBe(0);
  });

  it("does NOT show empty state when at least one Suggested-bucket row exists", () => {
    const queue = [
      makeRecWithDerivedStatus("dismissed", "x1"),
      makeRecWithDerivedStatus("dismissed", "x2"),
      // One needs_review row — should keep the empty state from firing.
      makeRecWithDerivedStatus("needs_review", "rev-only"),
    ];
    const html = renderV2(queue);
    expect(html).not.toContain('data-recommendations-v2-empty="true"');
    expect(html).toContain('data-recommendation-v2-card="true"');
  });

  it("Working rail surfaces accepted + shipped + measuring rows ONLY (no needs_review double-render)", () => {
    const queue = [
      makeRecWithDerivedStatus("new", "n1"),
      makeRecWithDerivedStatus("accepted", "a1"),
      makeRecWithDerivedStatus("shipped", "s1"),
      makeRecWithDerivedStatus("measuring", "m1"),
      makeRecWithDerivedStatus("needs_review", "r1"),
    ];
    const html = renderV2(queue);

    // Rail rendered.
    expect(html).toContain('data-recommendations-v2-rail="working"');

    // Each in-flight status appears in the rail; needs_review does NOT.
    const railStatuses =
      html.match(/data-recommendations-v2-rail-row-status="[^"]*"/g) ?? [];
    expect(railStatuses).toContain('data-recommendations-v2-rail-row-status="accepted"');
    expect(railStatuses).toContain('data-recommendations-v2-rail-row-status="shipped"');
    expect(railStatuses).toContain('data-recommendations-v2-rail-row-status="measuring"');
    expect(railStatuses).not.toContain(
      'data-recommendations-v2-rail-row-status="needs_review"',
    );
  });

  it("calm state inFlightCount mentions ONLY accepted/shipped/measuring (not needs_review or deferred)", () => {
    // Queue has only in-flight + dismissed rows → no Suggested rows
    // → calm state fires. The N in "Beacon is measuring N change(s)"
    // must equal exactly the in-flight count, not the in-flight +
    // needs_review count.
    const queue = [
      makeRecWithDerivedStatus("accepted", "a1"),
      makeRecWithDerivedStatus("shipped", "s1"),
      makeRecWithDerivedStatus("dismissed", "d1"),
    ];
    const html = renderV2(queue);
    expect(html).toContain('data-recommendations-v2-calm="true"');
    expect(html).toContain("Beacon is measuring 2 changes");
  });

  it("Suggested stack renders new + needs_review + needs_fresh_edit rows (mixed bucket)", () => {
    const queue = [
      makeRecWithDerivedStatus("new", "n1"),
      makeRecWithDerivedStatus("needs_review", "r1"),
      makeRecWithDerivedStatus("needs_fresh_edit", "f1"),
      makeRecWithDerivedStatus("dismissed", "d1"), // hidden
      makeRecWithDerivedStatus("deferred", "df1"), // hidden
    ];
    const html = renderV2(queue);
    const cardMatches = html.match(/data-recommendation-v2-card="true"/g) ?? [];
    expect(cardMatches.length).toBe(3);
    // Negative pin: dismissed/deferred rows must NOT appear as cards.
    const cardStatuses =
      html.match(/data-recommendation-v2-status="[^"]*"/g) ?? [];
    expect(cardStatuses).not.toContain('data-recommendation-v2-status="dismissed"');
    expect(cardStatuses).not.toContain('data-recommendation-v2-status="deferred"');
  });
});
