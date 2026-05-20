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
});
