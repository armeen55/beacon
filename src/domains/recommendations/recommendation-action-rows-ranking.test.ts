/**
 * T4.2 (2026-05-06) — Ranking reconciliation tests.
 *
 * The Trust Sprint Phase 2.A audit found that `prioritize.ts` computes
 * a queue score + tier ("now" / "this_week" / "later"), but the
 * customer-facing table re-sorts by a different rubric and discards
 * the prioritizer score. T4.2 threads `tier` + `score` into the row's
 * debug block, computes an `evidenceDepth` per row, and updates the
 * sort to:
 *
 *   1. STATUS BUCKET (preserve)
 *   2. PRIORITIZER TIER (now → this_week → later)
 *   3. PRIORITY (high → medium → low)
 *   4. EVIDENCE DEPTH desc
 *   5. observation count desc
 *   6. id asc
 *
 * Operator scope: a multi-prompt + owned-page H2 must outrank a
 * thin single-prompt FAQ answer, regardless of creation order or
 * priorityForRow's quirks.
 */

import { describe, expect, it } from "vitest";
import {
  buildRecommendationActionRows,
  computeEvidenceDepth,
} from "./recommendation-action-rows";
import type { LiveRecQueueItem } from "./load-queue";
import type { RecommendedEditRow } from "./recommended-edits-persistence";

// ── Fixture builders ───────────────────────────────────────────────────

function makeRec(
  overrides: Partial<LiveRecQueueItem> = {},
): LiveRecQueueItem {
  const base: LiveRecQueueItem = {
    stableKey: "rec-default",
    type: "create_cluster_page",
    title: "Test cluster",
    description: "test",
    affectedPromptIds: ["p1"],
    clusterLabel: "Test Cluster",
    clusterKind: "topic",
    severity: "medium",
    effort: "medium",
    evidence: {
      promptCount: 1,
      observationCount: 6,
      categoryBreakdown: { outranked: 1 },
      dominantCompetitors: [],
      descriptorsNearBrand: [],
      maxSignalStrength: 0.5,
      primaryCompetitors: [],
      brandPrimaryPromptCount: 0,
      fragmentedPromptCount: 0,
    },
    rank: 1,
    score: 5,
    tier: "now",
    reasoning: "test reasoning",
    resolution: {
      tier: "deterministic_only",
      action: "create_new_page",
      motive: "capture_absent_cluster",
      targetUrl: "https://example.com/page",
      reasoning: "test",
      confidence: "medium",
      evidenceRefs: [],
      pageBrief: null,
      suggestedEdits: [],
      cannibalization: null,
      risks: [],
      needsHumanReview: false,
      confidenceReason: "test",
    },
    engineConfidence: {
      confidence: "medium",
      reasons: ["edit_medium_or_lower_confidence"],
    },
    ...overrides,
  };
  return base;
}

function makeEdit(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  const base: RecommendedEditRow = {
    id: "edit-default",
    tenant_id: "tenant-test",
    rec_id: "rec-default",
    action_type: "add_h2_section",
    target_url: "https://example.com/page",
    target_element_key: "h2[new]:abc12345",
    display_label: "Test H2",
    current_text: null,
    proposed_text:
      "Test H2 content with sufficient length to satisfy any structural quality gates that may exist downstream.",
    why: "Test rationale",
    evidence: [{ type: "prompt", promptId: "p1" }],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "openai",
    provider_name: "openai",
    evidence_hash: "evhash",
    model: "gpt-5-mini",
    cost_usd: 0.005,
    created_at: "2026-05-06T00:00:00Z",
    updated_at: "2026-05-06T00:00:00Z",
    implementation_status: "recommended",
  };
  return { ...base, ...overrides };
}

// ── computeEvidenceDepth helper ─────────────────────────────────────────

describe("computeEvidenceDepth", () => {
  it("returns 0 for empty evidence", () => {
    expect(computeEvidenceDepth([])).toBe(0);
  });

  it("returns 1 for a single prompt evidence ref", () => {
    expect(
      computeEvidenceDepth([{ type: "prompt", promptId: "p1" }]),
    ).toBe(1);
  });

  it("rewards multi-prompt with the +1 bonus", () => {
    expect(
      computeEvidenceDepth([
        { type: "prompt", promptId: "p1" },
        { type: "prompt", promptId: "p2" },
      ]),
    ).toBe(2);
  });

  it("counts each grounding-signal category exactly once", () => {
    expect(
      computeEvidenceDepth([
        { type: "prompt", promptId: "p1" },
        { type: "owned_page", url: "https://example.com/x" },
        { type: "competitor", competitorName: "C" },
      ]),
    ).toBe(3);
  });

  it("multi-prompt + owned + competitor + element = 5", () => {
    expect(
      computeEvidenceDepth([
        { type: "prompt", promptId: "p1" },
        { type: "prompt", promptId: "p2" },
        { type: "owned_page", url: "https://example.com/x" },
        { type: "competitor", competitorName: "C" },
        { type: "element", elementKey: "h2[0]:x", url: "https://example.com/x" },
      ]),
    ).toBe(5);
  });
});

// ── Sort: status bucket preserved ──────────────────────────────────────

describe("buildRecommendationActionRows — sort preserves status bucket", () => {
  it("an accepted row never outranks a new row, even with higher prioritizer tier", () => {
    // Accepted row in tier "now" (best possible prioritizer signal)
    const acceptedEdit = makeEdit({
      id: "accepted-edit",
      rec_id: "rec-accepted",
      proposed_text:
        "Accepted edit with sufficient length to pass any downstream gate.",
      implementation_status: "accepted",
    });
    const acceptedRec = makeRec({
      stableKey: "rec-accepted",
      tier: "now",
      score: 100,
      severity: "high",
      evidence: {
        promptCount: 5,
        observationCount: 50,
        categoryBreakdown: { outranked: 5 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 0.9,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });
    // Brand-new row in tier "later" (worst prioritizer signal)
    const newEdit = makeEdit({
      id: "new-edit",
      rec_id: "rec-new",
      proposed_text:
        "Brand-new edit with sufficient length to pass any downstream gate.",
      implementation_status: "recommended",
    });
    const newRec = makeRec({
      stableKey: "rec-new",
      tier: "later",
      score: 1,
      severity: "low",
    });
    const rows = buildRecommendationActionRows({
      queue: [
        // Mark the accepted rec via response.status so statusForRow puts
        // the row in the "accepted" bucket. (editLifecycleStatus alone
        // doesn't change the bucket — operator decision is what counts.)
        {
          rec: acceptedRec,
          response: {
            recId: acceptedRec.stableKey,
            status: "accepted",
            respondedAt: new Date().toISOString(),
            deferUntil: null,
          },
          edits: [acceptedEdit],
        },
        { rec: newRec, response: null, edits: [newEdit] },
      ],
    });
    // The "new" row must rank above the "accepted" row.
    const newRowRank = rows.find((r) => r.id.includes("new-edit"))?.rank;
    const acceptedRowRank = rows.find((r) =>
      r.id.includes("accepted-edit"),
    )?.rank;
    expect(newRowRank).toBeDefined();
    expect(acceptedRowRank).toBeDefined();
    expect(newRowRank!).toBeLessThan(acceptedRowRank!);
  });
});

// ── Sort: prioritizer tier orders within bucket ────────────────────────

describe("buildRecommendationActionRows — prioritizer tier", () => {
  it("a 'now' tier row outranks a 'later' tier row when both are in the same status bucket", () => {
    const nowEdit = makeEdit({
      id: "now-edit",
      rec_id: "rec-now",
      proposed_text: "Now-tier edit content with sufficient length.",
    });
    const nowRec = makeRec({
      stableKey: "rec-now",
      tier: "now",
      score: 50,
    });
    const laterEdit = makeEdit({
      id: "later-edit",
      rec_id: "rec-later",
      proposed_text: "Later-tier edit content with sufficient length.",
    });
    const laterRec = makeRec({
      stableKey: "rec-later",
      tier: "later",
      score: 10,
    });
    const rows = buildRecommendationActionRows({
      queue: [
        { rec: laterRec, response: null, edits: [laterEdit] },
        { rec: nowRec, response: null, edits: [nowEdit] },
      ],
    });
    const nowRank = rows.find((r) => r.id.includes("now-edit"))?.rank;
    const laterRank = rows.find((r) => r.id.includes("later-edit"))?.rank;
    expect(nowRank!).toBeLessThan(laterRank!);
  });
});

// ── Sort: evidence depth tiebreak (the headline T4.2 invariant) ────────

describe("buildRecommendationActionRows — evidence depth tiebreak", () => {
  it("a multi-prompt + owned-page H2 outranks a single-prompt thin FAQ answer (same priority)", () => {
    // Multi-prompt + owned-page H2: rich grounding (depth = 3)
    const richEdit = makeEdit({
      id: "rich-edit",
      rec_id: "rec-rich",
      action_type: "add_h2_section",
      target_element_key: "h2[new]:rich12345",
      proposed_text:
        "Rich H2 with multiple prompts and owned-page evidence backing it.",
      evidence: [
        { type: "prompt", promptId: "p1" },
        { type: "prompt", promptId: "p2" },
        { type: "owned_page", url: "https://example.com/page" },
      ],
    });
    const richRec = makeRec({
      stableKey: "rec-rich",
      tier: "now",
      affectedPromptIds: ["p1", "p2"],
      evidence: {
        promptCount: 2,
        observationCount: 12,
        categoryBreakdown: { outranked: 2 },
        dominantCompetitors: [],
        descriptorsNearBrand: [],
        maxSignalStrength: 0.7,
        primaryCompetitors: [],
        brandPrimaryPromptCount: 0,
        fragmentedPromptCount: 0,
      },
    });

    // Thin FAQ answer: single prompt, no owned page (depth = 1)
    const thinEdit = makeEdit({
      id: "thin-edit",
      rec_id: "rec-thin",
      action_type: "add_faq",
      target_element_key: "faq_answer[new]:thin5678",
      proposed_text:
        "Thin FAQ answer body with single-prompt grounding only.",
      evidence: [{ type: "prompt", promptId: "p1" }],
    });
    // Pair the thin answer with a question so the FAQ-pairing gate doesn't
    // suppress it (we want both rows to render so the sort can compare).
    const thinQuestion = makeEdit({
      id: "thin-question",
      rec_id: "rec-thin",
      action_type: "add_faq",
      target_element_key: "faq_question[new]:thin5678",
      proposed_text: "How long does the project take?",
      evidence: [{ type: "prompt", promptId: "p1" }],
    });
    const thinRec = makeRec({
      stableKey: "rec-thin",
      tier: "now",
    });

    const rows = buildRecommendationActionRows({
      queue: [
        // Thin rec listed first so creation order isn't doing the work
        { rec: thinRec, response: null, edits: [thinQuestion, thinEdit] },
        { rec: richRec, response: null, edits: [richEdit] },
      ],
    });

    const richRank = rows.find((r) => r.id.includes("rich-edit"))?.rank;
    const thinPairRank = rows.find((r) => /faq-pair::thin5678/.test(r.id))
      ?.rank;
    expect(richRank, "rich row not found").toBeDefined();
    expect(thinPairRank, "thin FAQ-pair row not found").toBeDefined();
    expect(
      richRank!,
      "multi-prompt + owned-page H2 must outrank thin single-prompt FAQ pair",
    ).toBeLessThan(thinPairRank!);
  });
});

// ── prioritizer tier + score visible on row.detail.debug ───────────────

describe("buildRecommendationActionRows — prioritizer tier/score threading", () => {
  it("threads rec.tier and rec.score onto detail.debug.prioritizerTier / prioritizerScore", () => {
    const edit = makeEdit({ id: "e1" });
    const rec = makeRec({
      stableKey: "rec-1",
      tier: "this_week",
      score: 42,
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec, response: null, edits: [edit] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.debug.prioritizerTier).toBe("this_week");
    expect(rows[0].detail.debug.prioritizerScore).toBe(42);
  });

  it("evidenceDepth is exposed on detail", () => {
    const edit = makeEdit({
      id: "e1",
      evidence: [
        { type: "prompt", promptId: "p1" },
        { type: "owned_page", url: "https://example.com/x" },
      ],
    });
    const rec = makeRec({ stableKey: "rec-1" });
    const rows = buildRecommendationActionRows({
      queue: [{ rec, response: null, edits: [edit] }],
    });
    expect(rows[0].detail.evidenceDepth).toBe(2);
  });
});

// ── No raw enum/UUID leak in customer-facing copy ──────────────────────

describe("buildRecommendationActionRows — customer-safe copy", () => {
  it("rendered title never contains raw enum names, prioritizer tier strings, or UUIDs", () => {
    const edit = makeEdit({
      id: "e1",
      target_element_key: "h2[new]:abc12345",
      proposed_text: "Concrete H2 body with sufficient length.",
    });
    const rec = makeRec({
      stableKey: "rec-1",
      tier: "this_week",
      score: 42,
    });
    const rows = buildRecommendationActionRows({
      queue: [{ rec, response: null, edits: [edit] }],
    });
    const title = rows[0].title;
    expect(title).not.toMatch(/this_week/);
    expect(title).not.toMatch(/prioritizerTier/);
    expect(title).not.toMatch(/evidenceDepth/);
    expect(title).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    );
  });
});
