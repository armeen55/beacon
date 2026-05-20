/**
 * Architecture invariant — Slice 4.5.D.α₀a.3b — MAX_ROWS_PER_PAGE
 * cap locked at 5 (Section 4.5.O7).
 *
 * Behavioral: 6 distinct customer-queue-ready signals on the same
 * URL produce exactly 5 eligible rows; the surplus row flips to
 * `eligible: false` with `suppression_reason: "max_rows_per_page"`.
 * Surplus rows are NOT deleted — they remain in the output so
 * operator-only diagnostics (α₀b) can show the full picture.
 */

import { describe, it, expect } from "vitest";

import {
  MAX_ROWS_PER_PAGE,
  selectPromotableCandidates,
} from "@/domains/recommendation-intelligence/promote-to-queue";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";
const URL = "https://example.com/over-capped";

function makeCandidate(
  partial: Pick<RecommendationCandidateRow, "trigger_signal" | "action_type">,
): RecommendationCandidateRow {
  return {
    tenant_id: TENANT,
    generator_kind: "deterministic",
    target_url: URL,
    topic_cluster_label: "metadata",
    evidence: [{ kind: "page_snapshot", ref: "snap-1" }],
    confidence: "high",
    impact_estimate: "high",
    customer_copy: "x",
    operator_evidence: "x",
    dedupe_key: "x",
    cooldown_key: "y",
    created_from_signal_at: "2026-05-19T00:00:00.000Z",
    safety_flags: [],
    ...partial,
  };
}

describe("recommendation-intelligence-max-rows-per-page", () => {
  it("MAX_ROWS_PER_PAGE constant is locked at 5", () => {
    expect(MAX_ROWS_PER_PAGE).toBe(5);
  });

  it("6 distinct customer-queue-ready signals on the same URL → exactly 5 eligible + 1 max_rows_per_page", () => {
    const candidates: RecommendationCandidateRow[] = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
      }),
      makeCandidate({
        trigger_signal: "missing_meta",
        action_type: "edit_meta",
      }),
      makeCandidate({
        trigger_signal: "missing_h1",
        action_type: "change_h1",
      }),
      makeCandidate({
        trigger_signal: "sitemap_missing",
        action_type: "fix_sitemap",
      }),
      makeCandidate({
        trigger_signal: "robots_blocks_googlebot",
        action_type: "fix_robots",
      }),
      makeCandidate({
        trigger_signal: "bad_http_status",
        action_type: "fix_status_code",
      }),
    ];

    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: candidates,
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: new Map<string, PageType>([[URL, "service"]]),
      now: NOW,
    });

    const eligible = out.filter(
      (r) => r.eligible && r.candidate.target_url === URL,
    );
    expect(eligible.length).toBe(MAX_ROWS_PER_PAGE);

    const capped = out.filter(
      (r) => r.suppression_reason === "max_rows_per_page",
    );
    expect(capped.length).toBe(1);
    // Surplus row is KEPT (not deleted).
    expect(out.length).toBe(candidates.length);
  });
});
