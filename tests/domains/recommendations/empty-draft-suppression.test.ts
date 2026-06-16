/**
 * Iranopedia blockers (2026-06-15) — render-time suppression of
 * un-draftable COPY edit rows.
 *
 * A COPY-type edit (title / meta / H1 / H2 / FAQ / section / answer /
 * table / intro) whose `proposed_text` is empty or whitespace renders as a
 * blank "go look at this page" card with nothing to ship. On Iranopedia's
 * recipe/content pages, 11 of 14 stored `edit_meta` drafts had
 * `proposed_text = ""` (a real deterministic gap the LLM is OFF for) — they
 * looked broken in the customer queue.
 *
 * `buildRecommendationActionRows` now drops these rows at RENDER TIME (the
 * underlying row stays in the store, ready to surface once a real draft
 * exists). Directive rows (fix_* / schema / internal-link) and Path-B
 * meta-action rows (create_page / review_decision / regenerate) are
 * unaffected — they legitimately carry a directive or a null
 * `proposedText` by design.
 *
 * Tenant-agnostic: the predicate keys off action_type + draft emptiness
 * only. No tenant / vertical strings.
 */

import { describe, expect, it } from "vitest";

import {
  buildRecommendationActionRows,
  isUndraftableCopyEditRow,
} from "@/domains/recommendations/recommendation-action-rows";
import type { LiveRecQueueItem } from "@/domains/recommendations/load-queue";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

function synthesizeQueueItem(
  recId: string,
  edits: Array<
    Partial<RecommendedEditRow> & {
      action_type: RecommendedEditRow["action_type"];
      target_element_key: string | null;
    }
  >,
): {
  rec: LiveRecQueueItem;
  response: null;
  edits: RecommendedEditRow[];
} {
  const fullEdits: RecommendedEditRow[] = edits.map((e, idx) => ({
    id: `${recId}__${e.action_type}__${e.target_element_key ?? "null"}`,
    tenant_id: "tenant-fixture",
    rec_id: recId,
    action_type: e.action_type,
    target_url: e.target_url ?? "https://example.com/content/page",
    target_element_key: e.target_element_key,
    display_label: e.display_label ?? null,
    current_text: e.current_text ?? null,
    // IMPORTANT: respect an explicit empty string — do NOT default-fill it,
    // otherwise the suppression case can't be expressed.
    proposed_text:
      "proposed_text" in e ? (e.proposed_text as string | null) : `Proposed ${idx}`,
    why: e.why ?? "Synthetic why",
    evidence: e.evidence ?? [],
    expected_impact: e.expected_impact ?? null,
    difficulty: e.difficulty ?? "low",
    confidence: e.confidence ?? "medium",
    measurement_plan: e.measurement_plan ?? null,
    risks: e.risks ?? [],
    source: e.source ?? "deterministic_promotion",
    provider_name: e.provider_name ?? null,
    evidence_hash: e.evidence_hash ?? "h",
    model: e.model ?? null,
    cost_usd: e.cost_usd ?? null,
    created_at: e.created_at ?? new Date().toISOString(),
    updated_at: e.updated_at ?? new Date().toISOString(),
    implementation_status: e.implementation_status ?? "recommended",
    live_at: e.live_at ?? null,
    live_snapshot_id: e.live_snapshot_id ?? null,
    live_match_confidence: e.live_match_confidence ?? null,
    live_match_kind: e.live_match_kind ?? null,
    live_element_key: e.live_element_key ?? null,
    not_found_reason: e.not_found_reason ?? null,
  }));
  const rec = {
    stableKey: recId,
    type: "expand_existing_page",
    title: `Synthetic title for ${recId}`,
    description: "synthetic",
    affectedPromptIds: ["p-1", "p-2"],
    clusterLabel: "Cluster",
    clusterKind: "topic",
    evidence: {
      promptCount: 2,
      observationCount: 4,
      categoryBreakdown: {},
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 50,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    severity: "medium",
    effort: "low",
    score: 5,
    tier: "now",
    rank: 1,
    reasoning: "synthetic",
    resolution: {
      action: "expand_existing_page",
      motive: "improve_close_prompt",
      targetUrl: "https://example.com/content/page",
      confidence: "medium",
      confidenceReason: "synthetic",
      reasoning: "synthetic",
      tier: "deterministic_only",
      evidenceRefs: [],
      pageBrief: null,
      suggestedEdits: [],
      risks: [],
      cannibalization: null,
      needsHumanReview: false,
    },
    engineConfidence: { confidence: "medium", reasons: [] },
  } as unknown as LiveRecQueueItem;
  return { rec, response: null, edits: fullEdits };
}

describe("isUndraftableCopyEditRow (pure predicate)", () => {
  it("TRUE for a COPY edit with empty / whitespace proposed_text", () => {
    expect(
      isUndraftableCopyEditRow({ actionType: "edit_meta", proposedText: "" }),
    ).toBe(true);
    expect(
      isUndraftableCopyEditRow({ actionType: "edit_title", proposedText: "   " }),
    ).toBe(true);
    expect(
      isUndraftableCopyEditRow({ actionType: "change_h1", proposedText: null }),
    ).toBe(true);
    expect(
      isUndraftableCopyEditRow({
        actionType: "add_h2_section",
        proposedText: undefined,
      }),
    ).toBe(true);
  });

  it("FALSE for a COPY edit with real copy", () => {
    expect(
      isUndraftableCopyEditRow({
        actionType: "edit_meta",
        proposedText: "A real, clean meta description in the page's own words.",
      }),
    ).toBe(false);
  });

  it("FALSE for DIRECTIVE / structural action types regardless of emptiness", () => {
    // These never render as blank copy cards — their composer returns null
    // (no row) rather than an empty proposed_text. They are not COPY edits.
    for (const actionType of [
      "fix_robots",
      "fix_canonical",
      "fix_sitemap",
      "add_schema",
      "fix_schema",
      "add_internal_link",
      "fix_page_experience",
    ] as const) {
      expect(isUndraftableCopyEditRow({ actionType, proposedText: "" })).toBe(
        false,
      );
    }
  });
});

describe("buildRecommendationActionRows — empty-draft COPY rows are suppressed", () => {
  const promptTextById = { "p-1": "prompt 1", "p-2": "prompt 2" };

  it("hides an edit_meta row whose proposed_text is empty (the Iranopedia blank-card case)", () => {
    const queue = [
      synthesizeQueueItem("rec-blank-meta", [
        { action_type: "edit_meta", target_element_key: null, proposed_text: "" },
      ]),
    ];
    const rows = buildRecommendationActionRows({ queue, promptTextById });
    // The only edit was un-draftable → the rec surfaces no row at all (it is
    // NOT re-routed to a confusing "regenerate" meta-action; it simply waits
    // for a real draft).
    expect(rows).toEqual([]);
  });

  it("keeps the clean edits and drops only the empty ones within the same rec", () => {
    const queue = [
      synthesizeQueueItem("rec-mixed", [
        {
          action_type: "edit_title",
          target_element_key: "title-1",
          proposed_text: "A clean, specific page title",
        },
        {
          action_type: "edit_meta",
          target_element_key: "meta-1",
          proposed_text: "   ", // whitespace-only → suppressed
        },
        {
          action_type: "change_h1",
          target_element_key: "h1-1",
          proposed_text: null, // null → suppressed
        },
      ]),
    ];
    const rows = buildRecommendationActionRows({ queue, promptTextById });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actionType).toBe("edit_title");
    expect(rows[0]!.detail.proposedText).toBe("A clean, specific page title");
  });

  it("does NOT suppress a directive row (fix_canonical) that carries a non-empty directive", () => {
    const queue = [
      synthesizeQueueItem("rec-directive", [
        {
          action_type: "fix_canonical",
          target_element_key: null,
          proposed_text:
            'Set the canonical link on https://example.com/content/page to itself.',
        },
      ]),
    ];
    const rows = buildRecommendationActionRows({ queue, promptTextById });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail.proposedText).toContain("canonical");
  });

  it("suppresses a FAQ pair whose question copy is empty", () => {
    const queue = [
      synthesizeQueueItem("rec-faq-blank", [
        {
          action_type: "add_faq",
          target_element_key: "faq_question[new]:hash01",
          proposed_text: "", // empty question text → suppressed
        },
        {
          action_type: "add_faq",
          target_element_key: "faq_answer[new]:hash01",
          proposed_text: "An answer with real content.",
        },
      ]),
    ];
    const rows = buildRecommendationActionRows({ queue, promptTextById });
    expect(rows).toEqual([]);
  });

  it("keeps a FAQ pair whose question copy is real", () => {
    const queue = [
      synthesizeQueueItem("rec-faq-ok", [
        {
          action_type: "add_faq",
          target_element_key: "faq_question[new]:hash02",
          proposed_text: "What makes a good Persian rug?",
        },
        {
          action_type: "add_faq",
          target_element_key: "faq_answer[new]:hash02",
          proposed_text: "A good Persian rug is hand-knotted with natural dyes.",
        },
      ]),
    ];
    const rows = buildRecommendationActionRows({ queue, promptTextById });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actionType).toBe("add_faq");
  });
});
