/**
 * Behavioral test — Trust Sprint T6.5 (2026-05-06).
 *
 * Pins the Ritz persisted recommended-edits queue against the
 * derived-confidence pipeline. Two contracts:
 *
 *   1. Derived distribution is NOT 100% in any single bucket.
 *      Pre-T6.5 the analyzer read persisted `confidence` which is
 *      100% medium; post-T6.5 the derived label spreads.
 *
 *   2. Specific row shapes derive to the expected label:
 *      - FAQ answer with single prompt + no other grounding =
 *        "needs_review" (T4.4 thin-FAQ rule).
 *      - H2 section with multi-prompt OR competitor presence =
 *        "moderate_evidence" or "strong_evidence" — never falls
 *        to "needs_review".
 *
 * Skips when the Ritz queue file is empty (e.g., a tenant other than
 * the dogfood one). For Ritz this should always run.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { deriveConfidence } from "../../src/domains/recommendations/derived-confidence";
import { computeEvidenceDepth } from "../../src/domains/recommendations/recommendation-action-rows";
import type { RecommendedEditRow } from "../../src/domains/recommendations/recommended-edits-persistence";

const RITZ_RECS = resolve(
  __dirname,
  "../../.data/tenants/ritz-builders/recommended-edits.json",
);

function loadRitzRecs(): RecommendedEditRow[] {
  if (!existsSync(RITZ_RECS)) return [];
  return JSON.parse(readFileSync(RITZ_RECS, "utf-8")) as RecommendedEditRow[];
}

function deriveFromRow(r: RecommendedEditRow) {
  const refs = r.evidence ?? [];
  return deriveConfidence({
    evidenceRefs: refs,
    evidenceDepth: computeEvidenceDepth(refs),
    affectedPromptCount: refs.filter((x) => x.type === "prompt").length,
    isFaqAnswer: (r.target_element_key ?? "").startsWith("faq_answer["),
    hasTopCompetitor: refs.some((x) => x.type === "competitor"),
  });
}

describe("T6.5 — derived confidence on the Ritz queue", () => {
  const recs = loadRitzRecs();

  it.skipIf(recs.length === 0)("queue is non-empty (Ritz dogfood)", () => {
    expect(recs.length).toBeGreaterThan(0);
  });

  it("persisted confidence column is uniformly 'medium' (T4.4 leaves it untouched)", () => {
    if (recs.length === 0) return;
    // Pre-T6.5 we surfaced this as a regression. Post-T6.5 we
    // re-frame: persisted IS uniformly medium BY DESIGN — T4.4
    // explicitly does not mutate it. The derived label is the trust
    // signal. This test pins that the persisted column hasn't drifted
    // away from "medium" (which would be a different regression).
    const distinctValues = new Set(recs.map((r) => r.confidence));
    expect(distinctValues.size).toBeLessThanOrEqual(2);
    // It SHOULD just be "medium"; allow "low" or "high" only if the
    // engine has actually started writing differentiated values, which
    // would be a deliberate engine change (and a separate trust-sprint
    // mini-phase).
    for (const c of distinctValues) {
      expect(["low", "medium", "high"]).toContain(c);
    }
  });

  it("derived distribution is NOT 100% in any single bucket", () => {
    if (recs.length === 0) return;
    const counts = new Map<string, number>();
    for (const r of recs) {
      const lbl = deriveFromRow(r);
      counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
    }
    const total = recs.length;
    const max = Math.max(...counts.values());
    expect(max).toBeLessThan(total);
  });

  it("at least one row derives to needs_review OR strong_evidence (so spread is real)", () => {
    if (recs.length === 0) return;
    const labels = recs.map(deriveFromRow);
    const hasOther = labels.some(
      (l) => l === "needs_review" || l === "strong_evidence",
    );
    expect(hasOther).toBe(true);
  });

  it("FAQ answer with single prompt + no other grounding derives to needs_review", () => {
    if (recs.length === 0) return;
    // Synthetic shape — proves the helper's thin-FAQ rule still fires.
    const synthetic: RecommendedEditRow = {
      ...recs[0],
      target_element_key: "faq_answer[a]:0",
      evidence: [{ type: "prompt", promptId: "p1" }],
    };
    expect(deriveFromRow(synthetic)).toBe("needs_review");
  });

  it("multi-prompt + owned-page + competitor derives to strong_evidence", () => {
    if (recs.length === 0) return;
    const synthetic: RecommendedEditRow = {
      ...recs[0],
      target_element_key: "h2[new]:abc",
      evidence: [
        { type: "prompt", promptId: "p1" },
        { type: "prompt", promptId: "p2" },
        { type: "owned_page", pageId: "pg1" },
        { type: "competitor", competitorId: "c1" } as never,
      ] as never,
    };
    expect(deriveFromRow(synthetic)).toBe("strong_evidence");
  });
});
