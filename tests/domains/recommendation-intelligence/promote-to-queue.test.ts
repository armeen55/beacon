/**
 * 2026-05-20 — Slice 4.5.D.α₀a.3b — promote-to-queue orchestrator
 * unit tests.
 *
 * Operator-locked coverage:
 *   empty input · happy path · 4 safety-gate passthroughs ·
 *   priority sort + tiebreaker · 2 cap suppressions · surplus
 *   retention · safety-suppressed rows not counted against caps ·
 *   determinism · keys on every row · missing pageTypeByUrl
 *   fails closed.
 */

import { describe, it, expect } from "vitest";

import {
  MAX_ROWS_PER_FAMILY,
  MAX_ROWS_PER_PAGE,
  buildSignalClassCountByUrl,
  selectPromotableCandidates,
} from "@/domains/recommendation-intelligence/promote-to-queue";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";
import type { PromotionEditAnchor } from "@/domains/recommendation-intelligence/dedupe-cooldown";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const TENANT = "tenant-x";

function makeCandidate(
  partial: Partial<RecommendationCandidateRow> & {
    target_url: string | null;
  },
): RecommendationCandidateRow {
  return {
    tenant_id: TENANT,
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "deterministic",
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

function makeEdit(
  partial: Partial<PromotionEditAnchor> & {
    tenant_id: string;
    action_type: PromotionEditAnchor["action_type"];
    target_url: string;
  },
): PromotionEditAnchor {
  return {
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...partial,
  };
}

function pageTypeMap(
  entries: Array<[string, PageType]>,
): ReadonlyMap<string, PageType> {
  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Empty + happy path
// ---------------------------------------------------------------------------

describe("selectPromotableCandidates — empty + happy path", () => {
  it("empty triggerCandidates → empty result", () => {
    expect(
      selectPromotableCandidates({
        tenantId: TENANT,
        triggerCandidates: [],
        recommendedEdits: [],
        recommendationResponses: [],
        pageTypeByUrl: pageTypeMap([]),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("one customer-queue-ready candidate → 1 eligible row", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/a" }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([["https://example.com/a", "service"]]),
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.eligible).toBe(true);
    expect(out[0]!.tier).toBe("customer-queue-ready");
    expect(out[0]!.suppression_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Safety-gate passthrough
// ---------------------------------------------------------------------------

describe("selectPromotableCandidates — safety-gate passthrough", () => {
  it("diagnostic-only candidate stays ineligible with diagnostic_only_tier", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({
          trigger_signal: "missing_schema",
          action_type: "add_schema",
          target_url: "https://example.com/a",
        }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([["https://example.com/a", "service"]]),
      now: NOW,
    });
    expect(out[0]!.eligible).toBe(false);
    expect(out[0]!.tier).toBe("diagnostic-only");
    expect(out[0]!.suppression_reason).toBe("diagnostic_only_tier");
  });

  it("low-confidence candidate stays ineligible with low_confidence", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({
          confidence: "low",
          target_url: "https://example.com/a",
        }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([["https://example.com/a", "service"]]),
      now: NOW,
    });
    expect(out[0]!.eligible).toBe(false);
    expect(out[0]!.suppression_reason).toBe("low_confidence");
  });

  it("cooldown suppression carries cooldown_expires_at to output", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/a" }),
      ],
      recommendedEdits: [
        makeEdit({
          tenant_id: TENANT,
          action_type: "edit_title",
          target_url: "https://example.com/a",
          implementation_status: "dismissed",
          updated_at: "2026-05-15T00:00:00.000Z", // 5d ago → 90d cooldown
        }),
      ],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([["https://example.com/a", "service"]]),
      now: NOW,
    });
    expect(out[0]!.eligible).toBe(false);
    expect(out[0]!.suppression_reason).toBe("in_cooldown");
    expect(out[0]!.cooldown_expires_at).toBe("2026-08-13T00:00:00.000Z");
  });

  it("accepted-ancestor passthrough → accepted_ancestor_exists", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/a" }),
      ],
      recommendedEdits: [
        makeEdit({
          tenant_id: TENANT,
          action_type: "edit_title",
          target_url: "https://example.com/a",
          target_element_key: null,
          implementation_status: "accepted",
          updated_at: "2025-12-01T00:00:00.000Z", // >30d so cooldown clear
        }),
      ],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([["https://example.com/a", "service"]]),
      now: NOW,
    });
    expect(out[0]!.suppression_reason).toBe("accepted_ancestor_exists");
  });
});

// ---------------------------------------------------------------------------
// Sort + tie-break
// ---------------------------------------------------------------------------

describe("selectPromotableCandidates — sort + tiebreak", () => {
  it("indexability outranks content polish at the same page-importance", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({
          trigger_signal: "missing_title",
          action_type: "edit_title",
          target_url: "https://example.com/content",
        }),
        makeCandidate({
          trigger_signal: "sitemap_missing",
          action_type: "fix_sitemap",
          target_url: "https://example.com/indexability",
        }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([
        ["https://example.com/content", "service"],
        ["https://example.com/indexability", "service"],
      ]),
      now: NOW,
    });
    expect(out[0]!.candidate.action_type).toBe("fix_sitemap");
    expect(out[1]!.candidate.action_type).toBe("edit_title");
    expect(out[0]!.priority_score).toBeGreaterThan(out[1]!.priority_score);
  });

  it("same-priority rows tiebreak by promotion_dedupe_key ascending", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/zebra" }),
        makeCandidate({ target_url: "https://example.com/alpha" }),
        makeCandidate({ target_url: "https://example.com/mango" }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([
        ["https://example.com/zebra", "service"],
        ["https://example.com/alpha", "service"],
        ["https://example.com/mango", "service"],
      ]),
      now: NOW,
    });
    expect(out).toHaveLength(3);
    // All same priority → sorted by promotion_dedupe_key ascending.
    const keys = out.map((r) => r.promotion_dedupe_key);
    expect(keys).toEqual([...keys].sort());
  });
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

describe("selectPromotableCandidates — caps", () => {
  it("MAX_ROWS_PER_PAGE = 5; surplus flips to max_rows_per_page", () => {
    const url = "https://example.com/over-capped";
    const signals: Array<{
      trigger_signal: string;
      action_type: RecommendationCandidateRow["action_type"];
    }> = [
      { trigger_signal: "missing_title", action_type: "edit_title" },
      { trigger_signal: "missing_meta", action_type: "edit_meta" },
      { trigger_signal: "missing_h1", action_type: "change_h1" },
      { trigger_signal: "sitemap_missing", action_type: "fix_sitemap" },
      {
        trigger_signal: "robots_blocks_googlebot",
        action_type: "fix_robots",
      },
      { trigger_signal: "bad_http_status", action_type: "fix_status_code" },
    ];
    const candidates = signals.map((s) =>
      makeCandidate({
        trigger_signal: s.trigger_signal,
        action_type: s.action_type,
        target_url: url,
      }),
    );
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: candidates,
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([[url, "service"]]),
      now: NOW,
    });
    const eligible = out.filter((r) => r.eligible);
    const cappedPage = out.filter(
      (r) => r.suppression_reason === "max_rows_per_page",
    );
    expect(eligible.length).toBe(MAX_ROWS_PER_PAGE);
    expect(cappedPage.length).toBe(1);
  });

  it("MAX_ROWS_PER_FAMILY = 10; surplus flips to max_rows_per_family", () => {
    const urls = Array.from(
      { length: 11 },
      (_, i) => `https://example.com/p${i}`,
    );
    const candidates = urls.map((u) => makeCandidate({ target_url: u }));
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: candidates,
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap(
        urls.map((u) => [u, "service" as PageType]),
      ),
      now: NOW,
    });
    const eligible = out.filter((r) => r.eligible);
    const cappedFamily = out.filter(
      (r) => r.suppression_reason === "max_rows_per_family",
    );
    expect(eligible.length).toBe(MAX_ROWS_PER_FAMILY);
    expect(cappedFamily.length).toBe(1);
  });

  it("surplus rows are KEPT in output (not deleted)", () => {
    const url = "https://example.com/keeps-surplus";
    const candidates = Array.from({ length: 7 }, (_, i) =>
      makeCandidate({
        trigger_signal: i === 0 ? "missing_title" : `extra_${i}`,
        action_type: "edit_title",
        target_url: url,
        topic_cluster_label: `topic-${i}`,
      }),
    );
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: candidates,
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([[url, "service"]]),
      now: NOW,
    });
    // Every input row appears in output (none deleted).
    expect(out.length).toBe(candidates.length);
  });

  it("safety-suppressed rows are NOT counted against caps", () => {
    // 5 eligible content edits on same URL would cap the page.
    // Add a 6th candidate that is safety-suppressed (low confidence).
    // The remaining 5 must stay eligible.
    const url = "https://example.com/safety-not-counted";
    const candidates: RecommendationCandidateRow[] = [
      makeCandidate({
        trigger_signal: "missing_title",
        action_type: "edit_title",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "missing_meta",
        action_type: "edit_meta",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "missing_h1",
        action_type: "change_h1",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "sitemap_missing",
        action_type: "fix_sitemap",
        target_url: url,
      }),
      makeCandidate({
        trigger_signal: "robots_blocks_googlebot",
        action_type: "fix_robots",
        target_url: url,
      }),
      // Safety-suppressed (low confidence) — must NOT consume a cap slot.
      makeCandidate({
        confidence: "low",
        target_url: url,
      }),
    ];
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: candidates,
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([[url, "service"]]),
      now: NOW,
    });
    const eligible = out.filter((r) => r.eligible);
    expect(eligible.length).toBe(5);
    // No row should be capped — only safety-suppressed (low_confidence).
    const cappedAny = out.filter(
      (r) =>
        r.suppression_reason === "max_rows_per_page" ||
        r.suppression_reason === "max_rows_per_family",
    );
    expect(cappedAny.length).toBe(0);
    const lowConfidenceRow = out.find(
      (r) => r.suppression_reason === "low_confidence",
    );
    expect(lowConfidenceRow).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Determinism + output shape
// ---------------------------------------------------------------------------

describe("selectPromotableCandidates — determinism + output shape", () => {
  it("same input fed twice → same output sequence (byte-for-byte on keys)", () => {
    const input = {
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/a" }),
        makeCandidate({ target_url: "https://example.com/b" }),
        makeCandidate({ target_url: "https://example.com/c" }),
      ],
      recommendedEdits: [] as PromotionEditAnchor[],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([
        ["https://example.com/a", "service"],
        ["https://example.com/b", "service"],
        ["https://example.com/c", "service"],
      ]),
      now: NOW,
    };
    const a = selectPromotableCandidates(input);
    const b = selectPromotableCandidates(input);
    expect(a.map((r) => r.promotion_dedupe_key)).toEqual(
      b.map((r) => r.promotion_dedupe_key),
    );
  });

  it("every result row carries both promotion keys (40-char hex sha1)", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/a" }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([["https://example.com/a", "service"]]),
      now: NOW,
    });
    expect(out[0]!.promotion_dedupe_key).toMatch(/^[0-9a-f]{40}$/);
    expect(out[0]!.promotion_cooldown_key).toMatch(/^[0-9a-f]{40}$/);
    expect(out[0]!.promotion_dedupe_key).not.toBe(
      out[0]!.promotion_cooldown_key,
    );
  });

  it("missing pageTypeByUrl entry fails closed via safety gates (content-edit)", () => {
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({ target_url: "https://example.com/unknown" }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([]), // empty map; lookup returns undefined → null
      now: NOW,
    });
    expect(out[0]!.eligible).toBe(false);
    expect(out[0]!.suppression_reason).toBe("missing_target_page_type");
  });
});

// ---------------------------------------------------------------------------
// Fusion corroboration (FUSION_ROADMAP item #3, 2026-06-14)
// ---------------------------------------------------------------------------

describe("buildSignalClassCountByUrl", () => {
  const URL = "https://example.com/page";

  it("two candidates of the SAME class corroborate only ONCE", () => {
    // gsc_low_ctr + gsc_striking_distance are both the GSC-demand class.
    const counts = buildSignalClassCountByUrl([
      makeCandidate({ target_url: URL, trigger_signal: "gsc_low_ctr" }),
      makeCandidate({
        target_url: URL,
        trigger_signal: "gsc_striking_distance",
      }),
    ]);
    expect(counts.get(URL)).toBe(1);
  });

  it("GSC-demand + Clarity-friction on the same URL → 2 distinct classes", () => {
    const counts = buildSignalClassCountByUrl([
      makeCandidate({ target_url: URL, trigger_signal: "gsc_striking_distance" }),
      makeCandidate({ target_url: URL, trigger_signal: "clarity_friction" }),
    ]);
    expect(counts.get(URL)).toBe(2);
  });

  it("GA4 value above baseline adds a third class to a corroborated URL", () => {
    const counts = buildSignalClassCountByUrl(
      [
        makeCandidate({ target_url: URL, trigger_signal: "gsc_decay" }),
        makeCandidate({ target_url: URL, trigger_signal: "clarity_friction" }),
      ],
      new Map([[URL, 1.25]]), // > 1.0 baseline
    );
    expect(counts.get(URL)).toBe(3);
  });

  it("GA4 weight at the 1.0 baseline does NOT add a value class", () => {
    const counts = buildSignalClassCountByUrl(
      [makeCandidate({ target_url: URL, trigger_signal: "gsc_low_ctr" })],
      new Map([[URL, 1.0]]), // exactly baseline → not above
    );
    expect(counts.get(URL)).toBe(1);
  });

  it("non-fusion trigger signals contribute no class", () => {
    const counts = buildSignalClassCountByUrl([
      makeCandidate({ target_url: URL, trigger_signal: "missing_title" }),
      makeCandidate({ target_url: URL, trigger_signal: "sitemap_missing" }),
    ]);
    // No GSC/Clarity/GA4 class present → URL not in the map (count 0).
    expect(counts.get(URL) ?? 0).toBe(0);
  });

  it("classes are scoped per-URL (no cross-URL bleed)", () => {
    const A = "https://example.com/a";
    const B = "https://example.com/b";
    const counts = buildSignalClassCountByUrl([
      makeCandidate({ target_url: A, trigger_signal: "gsc_low_ctr" }),
      makeCandidate({ target_url: B, trigger_signal: "clarity_friction" }),
    ]);
    // Each URL has exactly ONE class; neither reaches the ≥2 threshold.
    expect(counts.get(A)).toBe(1);
    expect(counts.get(B)).toBe(1);
  });
});

describe("selectPromotableCandidates — fusion re-rank (item #3)", () => {
  it("a 2-class-corroborated content page outranks an identical single-signal page", () => {
    const FUSED = "https://example.com/fused";
    const SOLO = "https://example.com/solo";
    const out = selectPromotableCandidates({
      tenantId: TENANT,
      triggerCandidates: [
        // FUSED carries GSC-demand + Clarity-friction (2 classes).
        makeCandidate({
          target_url: FUSED,
          trigger_signal: "gsc_striking_distance",
          action_type: "edit_title",
          confidence: "high",
        }),
        makeCandidate({
          target_url: FUSED,
          trigger_signal: "clarity_friction",
          action_type: "edit_meta",
          confidence: "high",
        }),
        // SOLO carries only GSC-demand (1 class) — same trigger as FUSED's
        // GSC card so the ONLY difference is the corroboration.
        makeCandidate({
          target_url: SOLO,
          trigger_signal: "gsc_striking_distance",
          action_type: "edit_title",
          confidence: "high",
        }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([
        [FUSED, "service"],
        [SOLO, "service"],
      ]),
      now: NOW,
    });
    const fusedGsc = out.find(
      (r) =>
        r.candidate.target_url === FUSED &&
        r.candidate.trigger_signal === "gsc_striking_distance",
    )!;
    const soloGsc = out.find((r) => r.candidate.target_url === SOLO)!;
    expect(fusedGsc.priority_score).toBeGreaterThan(soloGsc.priority_score);
  });

  it("a single-signal page scores identically with and without the fusion pre-pass", () => {
    // One URL, one GSC card, no second class → corroboration is a no-op.
    const URL = "https://example.com/single";
    const input = {
      tenantId: TENANT,
      triggerCandidates: [
        makeCandidate({
          target_url: URL,
          trigger_signal: "gsc_low_ctr",
          action_type: "edit_title",
          confidence: "high",
        }),
      ],
      recommendedEdits: [],
      recommendationResponses: [],
      pageTypeByUrl: pageTypeMap([[URL, "service"]]),
      now: NOW,
    };
    const out = selectPromotableCandidates(input);
    // Bare gsc_low_ctr/edit_title/service/high:
    // (28 + 0 + 12) * 1.0 / 1.0 = 40, no fusion term.
    expect(out[0]!.priority_score).toBe(40);
  });
});
