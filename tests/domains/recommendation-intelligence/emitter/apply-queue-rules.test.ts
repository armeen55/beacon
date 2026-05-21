/**
 * Slice 4.5.B.α₀ — emitter/apply-queue-rules unit tests.
 *
 * The α₀ gate enforces 4 of the eventual 10 rules per master plan
 * §4.5.12: specific + evidence-backed + confidence + safety-flag.
 */

import { describe, expect, it } from "vitest";

import { applyQueueRules } from "@/domains/recommendation-intelligence/emitter/apply-queue-rules";
import type {
  CandidateConfidence,
  CandidateSafetyFlag,
  RecommendationCandidateRow,
} from "@/domains/recommendation-intelligence/emitter/candidate-row";

function makeRow(overrides: Partial<RecommendationCandidateRow> = {}): RecommendationCandidateRow {
  return {
    tenant_id: "t",
    trigger_signal: "missing_meta",
    action_type: "edit_meta",
    generator_kind: "deterministic",
    target_url: "https://example.com/a",
    topic_cluster_label: "Meta description",
    evidence: [{ kind: "page_snapshot", ref: "https://example.com/a" }],
    confidence: "high" as CandidateConfidence,
    impact_estimate: "medium",
    customer_copy: "Add a meta description.",
    operator_evidence: "meta is null",
    dedupe_key: "deadbeef",
    cooldown_key: "cafebabe",
    created_from_signal_at: "2026-05-19T00:00:00Z",
    safety_flags: [] as ReadonlyArray<CandidateSafetyFlag>,
    ...overrides,
  };
}

describe("applyQueueRules", () => {
  it("passes a fully-formed candidate", () => {
    const { candidates, diagnostic_only } = applyQueueRules([makeRow()]);
    expect(candidates).toHaveLength(1);
    expect(diagnostic_only).toHaveLength(0);
  });

  it("drops rows with null target_url (rule 1: SPECIFIC)", () => {
    const result = applyQueueRules([makeRow({ target_url: null })]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(0);
  });

  it("drops rows with empty-string target_url (rule 1: SPECIFIC)", () => {
    const result = applyQueueRules([makeRow({ target_url: "" })]);
    expect(result.candidates).toHaveLength(0);
  });

  it("drops rows targeting the `needs_new_page` sentinel (rule 1)", () => {
    const result = applyQueueRules([
      makeRow({ target_url: "needs_new_page" }),
    ]);
    expect(result.candidates).toHaveLength(0);
  });

  it("drops rows with empty evidence (rule 2: EVIDENCE-BACKED)", () => {
    const result = applyQueueRules([makeRow({ evidence: [] })]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(0);
  });

  it("routes low-confidence rows to diagnostic_only (rule 3: CONFIDENCE)", () => {
    const result = applyQueueRules([makeRow({ confidence: "low" })]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(1);
  });

  it("routes safety-flagged rows to diagnostic_only (rule 4: SAFETY)", () => {
    const result = applyQueueRules([
      makeRow({ safety_flags: ["unsupported_claim_risk"] }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(1);
  });

  it("preserves input order within each bucket", () => {
    const a = makeRow({ target_url: "https://example.com/a", dedupe_key: "a" });
    const b = makeRow({
      target_url: "https://example.com/b",
      dedupe_key: "b",
      confidence: "low",
    });
    const c = makeRow({ target_url: "https://example.com/c", dedupe_key: "c" });
    const result = applyQueueRules([a, b, c]);
    expect(result.candidates.map((r) => r.dedupe_key)).toEqual(["a", "c"]);
    expect(result.diagnostic_only.map((r) => r.dedupe_key)).toEqual(["b"]);
  });

  it("medium confidence is treated as 'candidate', not 'diagnostic_only'", () => {
    const result = applyQueueRules([makeRow({ confidence: "medium" })]);
    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostic_only).toHaveLength(0);
  });

  // ─────────────────────────────────────────────────────────────
  // Slice 4.5.F (2026-05-21) — off-site shared queue carve-out.
  // ─────────────────────────────────────────────────────────────

  function makeOffSiteRow(
    overrides: Partial<RecommendationCandidateRow> = {},
  ): RecommendationCandidateRow {
    return makeRow({
      trigger_signal: "off_site:gbp",
      action_type: "claim_gbp",
      generator_kind: "human_task",
      target_url: null,
      topic_cluster_label: "off-site:gbp",
      ...overrides,
    });
  }

  it("(α₂.4.5.F) off-site row with target_url=null + high confidence → diagnostic_only (NOT candidates)", () => {
    const result = applyQueueRules([
      makeOffSiteRow({ confidence: "high", safety_flags: [] }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(1);
    expect(result.diagnostic_only[0]!.action_type).toBe("claim_gbp");
  });

  it("(α₂.4.5.F) off-site row with target_url=null + low confidence → diagnostic_only", () => {
    const result = applyQueueRules([
      makeOffSiteRow({ confidence: "low" }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(1);
  });

  it("(α₂.4.5.F) off-site row with target_url=null + safety_flag set → diagnostic_only", () => {
    const result = applyQueueRules([
      makeOffSiteRow({ safety_flags: ["unsupported_claim_risk"] }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(1);
  });

  it("(α₂.4.5.F) ON-PAGE row with target_url=null STILL DROPS (regression guard — only off-site rows bypass Rule 1)", () => {
    const result = applyQueueRules([
      makeRow({ target_url: null, action_type: "edit_title" }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(0);
  });

  it("(α₂.4.5.F) ON-PAGE row with target_url='needs_new_page' STILL DROPS (sentinel forbidden for non-off-site)", () => {
    const result = applyQueueRules([
      makeRow({ target_url: "needs_new_page", action_type: "edit_title" }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(0);
  });

  it("(α₂.4.5.F) off-site row WITH a non-null URL also routes to diagnostic_only (carve-out is generous on inputs, locked on routing)", () => {
    const result = applyQueueRules([
      makeOffSiteRow({ target_url: "https://example.com/whatever" }),
    ]);
    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostic_only).toHaveLength(1);
  });

  it.each([
    "claim_gbp",
    "optimize_gbp_profile",
    "request_gbp_reviews",
    "claim_or_optimize_houzz",
    "claim_or_optimize_yelp",
    "submit_to_industry_directory",
    "pursue_local_pr",
  ] as const)(
    "(α₂.4.5.F) all 7 off-site action types route to diagnostic_only, never candidates [%s]",
    (actionType) => {
      const result = applyQueueRules([
        makeOffSiteRow({ action_type: actionType, confidence: "high", safety_flags: [] }),
      ]);
      expect(result.candidates).toHaveLength(0);
      expect(result.diagnostic_only).toHaveLength(1);
    },
  );

  it("(α₂.4.5.F) mixed batch: 1 on-page candidate + 1 off-site → on-page in candidates, off-site in diagnostic_only", () => {
    const onPage = makeRow({
      target_url: "https://example.com/onpage",
      dedupe_key: "onpage-dk",
      action_type: "edit_title",
    });
    const offSite = makeOffSiteRow({
      dedupe_key: "offsite-dk",
      confidence: "high",
    });
    const result = applyQueueRules([onPage, offSite]);
    expect(result.candidates.map((r) => r.dedupe_key)).toEqual(["onpage-dk"]);
    expect(result.diagnostic_only.map((r) => r.dedupe_key)).toEqual(["offsite-dk"]);
  });
});
