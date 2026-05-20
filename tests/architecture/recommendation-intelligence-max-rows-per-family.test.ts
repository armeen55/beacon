/**
 * Architecture invariant — Slice 4.5.D.α₀a.3b — MAX_ROWS_PER_FAMILY
 * cap locked at 10 (Section 4.5.O8).
 *
 * Behavioral: 11 candidates across 11 distinct URLs, all same
 * `action_type` (`edit_title`), produce exactly 10 eligible
 * rows; the surplus row flips to `eligible: false` with
 * `suppression_reason: "max_rows_per_family"`. Surplus rows are
 * NOT deleted.
 */

import { describe, it, expect } from "vitest";

import {
  MAX_ROWS_PER_FAMILY,
  selectPromotableCandidates,
} from "@/domains/recommendation-intelligence/promote-to-queue";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";

function makeCandidate(targetUrl: string): RecommendationCandidateRow {
  return {
    tenant_id: TENANT,
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "deterministic",
    target_url: targetUrl,
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
  };
}

describe("recommendation-intelligence-max-rows-per-family", () => {
  it("MAX_ROWS_PER_FAMILY constant is locked at 10", () => {
    expect(MAX_ROWS_PER_FAMILY).toBe(10);
  });

  it("11 distinct URLs all targeting edit_title → exactly 10 eligible + 1 max_rows_per_family", () => {
    const urls = Array.from(
      { length: 11 },
      (_, i) => `https://example.com/p${i}`,
    );
    const candidates = urls.map(makeCandidate);
    const pageTypes = new Map<string, PageType>(
      urls.map((u) => [u, "service" as PageType]),
    );

    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: candidates,
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypes,
      now: NOW,
    });

    const eligible = out.filter((r) => r.eligible);
    expect(eligible.length).toBe(MAX_ROWS_PER_FAMILY);

    const capped = out.filter(
      (r) => r.suppression_reason === "max_rows_per_family",
    );
    expect(capped.length).toBe(urls.length - MAX_ROWS_PER_FAMILY);
    // Surplus row is KEPT (not deleted).
    expect(out.length).toBe(urls.length);
  });
});
