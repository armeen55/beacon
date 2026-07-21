/**
 * Architecture invariant — Slice 4.5.D.α₀a.3a — page-classifier
 * applied at the promotion boundary.
 *
 * Content-edit families (`edit_title` · `edit_meta` · `change_h1`
 * · `add_h2_section` · `add_faq` · `add_schema` ·
 * `add_internal_link`) MUST suppress on utility / technical_asset
 * / other page types with `suppression_reason: "skip_page_type"`.
 *
 * Indexability fixes (`fix_*`) BYPASS this skip — operators may
 * need to repair sitemap / robots / status / canonical on any
 * URL kind.
 *
 * Pivot refinement (2026-06-13): first-party Google Search demand
 * signals (`gsc_low_ctr` · `gsc_striking_distance`) override the
 * classifier's AMBIGUOUS `other` verdict — a page Google ranks for
 * queries is a real, trafficked content page. The override is
 * surgical: it relaxes ONLY `other` (the "couldn't place it"
 * bucket), NEVER the positive `utility` / `technical_asset`
 * verdicts, which stay hard-skipped for every signal.
 */

import { describe, it, expect } from "vitest";

import { applyPromotionSafetyGates } from "@/domains/recommendation-intelligence/safety-gates";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { ActionType } from "@/domains/recommendations/action-types";
import type { PageType } from "@/domains/recommendation-intelligence/page-classifier";

const NOW = new Date("2026-05-20T00:00:00.000Z");
const SKIP_TYPES: ReadonlyArray<PageType> = [
  "utility",
  "technical_asset",
  "other",
];

const CONTENT_EDIT_PAIRS: ReadonlyArray<readonly [string, ActionType]> = [
  ["missing_title", "edit_title"],
  ["missing_meta", "edit_meta"],
  ["missing_h1", "change_h1"],
];

const FIX_PAIRS: ReadonlyArray<readonly [string, ActionType]> = [
  ["sitemap_missing", "fix_sitemap"],
  ["robots_blocks_googlebot", "fix_robots"],
  ["bad_http_status", "fix_status_code"],
];

function makeCandidate(
  signal: string,
  actionType: ActionType,
): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-x",
    trigger_signal: signal,
    action_type: actionType,
    generator_kind: "deterministic",
    target_url: "https://example.com/page",
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

describe("recommendation-intelligence-page-classifier-applied-at-promotion", () => {
  // Content-edit families suppressed on every skip page type.
  for (const [signal, action] of CONTENT_EDIT_PAIRS) {
    for (const pt of SKIP_TYPES) {
      it(`content-edit ${signal}::${action} suppressed on ${pt}`, () => {
        const out = applyPromotionSafetyGates(makeCandidate(signal, action), {
          tenantId: "tenant-x",
          targetPageType: pt,
          recommendedEdits: [],
          recommendationResponses: [],
          prerequisiteResolved: true,
          now: NOW,
        });
        expect(out.eligible).toBe(false);
        expect(out.suppression_reason).toBe("skip_page_type");
      });
    }
  }

  // Indexability fixes ARE NOT suppressed on skip page types.
  for (const [signal, action] of FIX_PAIRS) {
    for (const pt of SKIP_TYPES) {
      it(`indexability fix ${signal}::${action} BYPASSES skip on ${pt}`, () => {
        const out = applyPromotionSafetyGates(makeCandidate(signal, action), {
          tenantId: "tenant-x",
          targetPageType: pt,
          recommendedEdits: [],
          recommendationResponses: [],
          prerequisiteResolved: true,
          now: NOW,
        });
        // Eligible OR suppressed by a NON-page-type reason. The
        // `skip_page_type` reason must NEVER apply to fix_*.
        expect(out.suppression_reason).not.toBe("skip_page_type");
      });
    }
  }

  // First-party GSC demand overrides the AMBIGUOUS `other` verdict
  // only.
  const GSC_DEMAND_PAIRS: ReadonlyArray<readonly [string, ActionType]> = [
    ["gsc_low_ctr", "edit_title"],
    ["gsc_striking_distance", "edit_title"],
  ];

  for (const [signal, action] of GSC_DEMAND_PAIRS) {
    it(`GSC demand ${signal}::${action} OVERRIDES skip on ambiguous 'other'`, () => {
      const out = applyPromotionSafetyGates(makeCandidate(signal, action), {
        tenantId: "tenant-x",
        targetPageType: "other",
        recommendedEdits: [],
        recommendationResponses: [],
        prerequisiteResolved: true,
        now: NOW,
      });
      expect(out.suppression_reason).not.toBe("skip_page_type");
      expect(out.eligible).toBe(true);
    });

    // ...but the positive `utility` / `technical_asset` verdicts
    // stay hard-skipped even for GSC demand.
    for (const pt of ["utility", "technical_asset"] as const) {
      it(`GSC demand ${signal}::${action} STILL skipped on positive verdict ${pt}`, () => {
        const out = applyPromotionSafetyGates(makeCandidate(signal, action), {
          tenantId: "tenant-x",
          targetPageType: pt,
          recommendedEdits: [],
          recommendationResponses: [],
          prerequisiteResolved: true,
          now: NOW,
        });
        expect(out.eligible).toBe(false);
        expect(out.suppression_reason).toBe("skip_page_type");
      });
    }
  }
});
