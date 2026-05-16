/**
 * Architecture invariant — Section 7 C7b operatorLabel customer-vocab
 * contract (2026-05-16).
 *
 * Each of the 7 off-site action types ships an `operatorLabel` that
 * surfaces to customers in at least one rendered path today:
 *
 *   - `src/app/(shell)/recommendations/[id]/recommendation-detail-not-found.tsx:35`
 *     lowercases `ACTION_TYPE_REGISTRY[actionType].operatorLabel` and
 *     embeds it in the user-facing 404 message ("we don't recognize
 *     this <label>"). Off-site types could appear there if a stale
 *     deep-link references a non-existent off-site rec id.
 *
 * Section 7 locked invariant #3 ("no scary/accusatory customer copy")
 * therefore applies to these labels. This scan pins each of the 7
 * labels against the forbidden customer-vocab set.
 *
 * Forbidden phrases (case-insensitive substring on the operatorLabel
 * string itself):
 *   - causal verbs: drove, caused, generated, " made " (with
 *     surrounding spaces — avoids false positives on words like
 *     "main"), led to
 *   - revenue framing: $, revenue, dollars, sales, leads
 *   - operator-only Mode labels: Mode A / Mode B / Mode C
 *   - internal schema enum names: primary_recommendation_count,
 *     total_possible, scope_type, claimable, still_learning
 *   - Section 7 additions:
 *     - " GBP " (full-form "Google Business Profile" required in
 *       visible text)
 *     - "missing" (scary form — soft language "did not find a
 *       confirmed …" required)
 *
 * Allowlist (documented):
 *   - "Google Business Profile" full form is allowed; standalone
 *     "GBP" with surrounding spaces is forbidden.
 */

import { describe, expect, it } from "vitest";

import {
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "@/domains/recommendations/action-types";

const OFF_SITE_ACTION_TYPES: ReadonlyArray<ActionType> = [
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
];

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // Causal verbs.
  { phrase: "drove", rationale: "Causal verb." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (spaces to avoid false-positive on 'main', 'made-up', etc.)." },
  { phrase: "led to", rationale: "Causal phrase." },
  // Revenue framing.
  { phrase: "$", rationale: "Dollar sign — revenue framing forbidden in operatorLabel customer-visible text." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  // Operator-only Mode labels.
  { phrase: "Mode A", rationale: "Operator-only label — never customer-visible." },
  { phrase: "Mode B", rationale: "Operator-only label — never customer-visible." },
  { phrase: "Mode C", rationale: "Operator-only label — never customer-visible." },
  // Internal schema enum names.
  { phrase: "primary_recommendation_count", rationale: "Internal schema field." },
  { phrase: "total_possible", rationale: "Internal schema field." },
  { phrase: "scope_type", rationale: "Internal schema field." },
  { phrase: "claimable", rationale: "Internal status enum." },
  { phrase: "still_learning", rationale: "Internal status enum." },
  // Section 7 additions.
  { phrase: " GBP ", rationale: "Abbreviation — use 'Google Business Profile' in visible text." },
  { phrase: "missing", rationale: "Scary form — Section 7 invariant #3 requires soft 'did not find a confirmed' language." },
];

describe("Architecture — Section 7 C7b operatorLabel customer vocabulary", () => {
  for (const t of OFF_SITE_ACTION_TYPES) {
    const label = ACTION_TYPE_REGISTRY[t].operatorLabel;
    const labelLower = label.toLowerCase();

    it(`${t}: operatorLabel is a non-empty string`, () => {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });

    for (const rule of FORBIDDEN) {
      it(`${t}: operatorLabel does not contain forbidden phrase "${rule.phrase}"`, () => {
        const needle = rule.phrase.toLowerCase();
        const idx = labelLower.indexOf(needle);
        if (idx >= 0) {
          throw new Error(
            `${t}: operatorLabel "${label}" contains forbidden phrase "${rule.phrase}".\n` +
              `Rationale: ${rule.rationale}`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
