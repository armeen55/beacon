/**
 * Architecture invariant — Slice 4.5.A Recommendation Intelligence
 * Expansion: registry audit + activation plan (2026-05-19).
 *
 * Pins three structural facts that must not drift without a paired
 * audit-doc update:
 *
 *   1. `ACTION_TYPES` registry has exactly 29 entries (14 on-page
 *      copy + 4 technical/structural + 3 page-lifecycle + 1 passive
 *      + 7 off-site authority from Section 7 C7b, 2026-05-16).
 *   2. Exactly three action types carry `generatorActive: true`
 *      in `ACTION_TYPE_REGISTRY` — `edit_title`, `add_h2_section`,
 *      `add_faq`. Every other registered type is inactive.
 *   3. The canonical audit doc lives at
 *      `docs/RECOMMENDATION_INTELLIGENCE_AUDIT.md` and references
 *      the locked active set + slice activation order.
 *
 * Why this invariant exists (Slice 4.5.A scope):
 *   The Section 4.5 plan ships in 7 slices (4.5.A → 4.5.G). Each
 *   later slice expands the registry by flipping `generatorActive`
 *   flags on existing entries AND adding new typed entries
 *   (e.g., 6 typed `create_*_page` variants in 4.5.C per O1 lock).
 *   The audit doc is the canonical sequencing record — without it,
 *   a future slice could quietly flip a flag without updating the
 *   plan, breaking the contract that "every active generator is
 *   matched to a tested deterministic trigger predicate."
 *
 *   This test fails LOUDLY if either side drifts:
 *     - flag flips without doc update → human catches before merge
 *     - new types added without doc update → human catches before
 *       merge
 *     - doc renamed / deleted → human catches before merge
 *
 * Slice 4.5.A explicitly ships NO source changes — only the audit
 * doc + this invariant + a catalog row. Slices 4.5.B+ will edit
 * the registry, and the paired doc update is the gate that lets
 * this invariant pass again.
 *
 * Failure modes this invariant deliberately does NOT catch:
 *   - The audit doc CONTENT being correct → human reviewer.
 *   - The trigger-predicate purity invariant (4.5.B will add a
 *     paired test under the same architecture-invariant pattern).
 *   - Customer-copy template safety (4.5.B + 4.5.D add separate
 *     tests).
 *   - Off-site action types being kept inactive (already pinned
 *     by `off-site-action-types-not-llm-allowed.test.ts` from
 *     Section 7 C7b).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "@/domains/recommendations/action-types";

const REPO_ROOT = resolve(__dirname, "..", "..");
const AUDIT_DOC_PATH = resolve(
  REPO_ROOT,
  "docs",
  "RECOMMENDATION_INTELLIGENCE_AUDIT.md",
);

/** Locked active set per Slice 4.5.C.α₃b audit (2026-05-20). α₃b
 *  adds 1 flip: `add_schema` paired with the new per-snapshot
 *  `missing-schema` deterministic predicate. The predicate reuses
 *  the existing `diffSchemaCoverage()` + `EXPECTED_SCHEMA_BY_ASSET_TYPE`
 *  substrate from `src/domains/pages/expected-schema.ts` (already
 *  shipped as Phase 1 scanning-pipeline substrate). Emits at
 *  `confidence: "low"` → routes to `diagnostic_only` via
 *  `applyQueueRules` (NOT customer queue). Tier-2 sensitive
 *  rationale: existing expectation map is local-service-tuned;
 *  diagnostic-only routing isolates operator validation from
 *  customer-queue impact. Page-type allowlist: homepage / city /
 *  service / project / hub. Safety guards: skip
 *  `extraction_certainty="uncertain"`; fire only when
 *  `!coverage.satisfies_all_required`. Prior active set
 *  (post-4.5.C.α₃a): 11 entries. */
const LOCKED_ACTIVE_SET: ReadonlyArray<ActionType> = [
  "edit_title",
  "edit_meta",
  "change_h1",
  "add_h2_section",
  "add_faq",
  // Slice 4.5.C.α₁ (2026-05-20) — Tier-1 indexability flips.
  "fix_sitemap",
  "fix_robots",
  "fix_status_code",
  "fix_canonical",
  // Slice 4.5.C.α₂ (2026-05-20) — Tier-2 sensitive flip.
  // Predicate emits at confidence: "low"; never reaches the
  // customer queue without operator-validated promotion.
  "fix_noindex",
  // Slice 4.5.C.α₃a (2026-05-20) — orphan-page cross-snapshot
  // flip. Predicate emits at confidence: "medium" so candidates
  // surface in the main diagnostic section (not diagnostic_only).
  "add_internal_link",
  // Slice 4.5.C.α₃b (2026-05-20) — missing-schema flip.
  // Predicate emits at confidence: "low" → routes to
  // diagnostic_only via applyQueueRules. Tier-2 sensitive
  // (industry-tuning safety).
  "add_schema",
  // Slice 4.5.E.α₁a (2026-05-21) — first LLM-assisted flip,
  // paired with the new `weak-h2` predicate at
  // `confidence: "low"` → diagnostic_only routing. NO LLM call
  // from the predicate itself (pure detection layer). The
  // α₀ LLM gateway (locally committed) is callable but NOT
  // invoked by α₁a — gateway invocation lands in α₁b via
  // operator-only env-gated server action.
  "rewrite_h2",
];

/** Locked total count per Slice 4.5.C.α₀ (2026-05-19). 4.5.C.α₀
 *  added 5 new inactive indexability-remediation types
 *  (fix_sitemap, fix_robots, fix_noindex, fix_status_code,
 *  fix_canonical). Prior count was 32 (Slice 4.5.B.α₀). Slice
 *  4.5.C.α₁ (2026-05-20) flips 4 of the 5 indexability types
 *  to `generatorActive: true` paired with their predicates;
 *  total registry count UNCHANGED at 37. */
const LOCKED_REGISTRY_COUNT = 37;

describe("Slice 4.5.A — registry inventory + active set", () => {
  it(`registers exactly ${LOCKED_REGISTRY_COUNT} action types`, () => {
    expect(ACTION_TYPES.length).toBe(LOCKED_REGISTRY_COUNT);
  });

  it("registers exactly the locked active set as generatorActive: true", () => {
    const active = ACTION_TYPES.filter(
      (t) => ACTION_TYPE_REGISTRY[t].generatorActive === true,
    ).sort();
    const locked = [...LOCKED_ACTIVE_SET].sort();
    expect(active).toEqual(locked);
  });

  it("registers every non-active type with generatorActive: false (binary flag)", () => {
    const activeSet = new Set<ActionType>(LOCKED_ACTIVE_SET);
    for (const t of ACTION_TYPES) {
      const flag = ACTION_TYPE_REGISTRY[t].generatorActive;
      if (activeSet.has(t)) {
        expect(flag, `${t} must be generatorActive: true`).toBe(true);
      } else {
        expect(flag, `${t} must be generatorActive: false`).toBe(false);
      }
    }
  });

  it("registers every ACTION_TYPES entry with a matching ACTION_TYPE_REGISTRY spec", () => {
    for (const t of ACTION_TYPES) {
      const spec = ACTION_TYPE_REGISTRY[t];
      expect(spec, `missing spec for action type ${t}`).toBeDefined();
      expect(spec.actionType).toBe(t);
    }
  });
});

describe("Slice 4.5.A — audit doc presence + canonical references", () => {
  it("audit doc exists at docs/RECOMMENDATION_INTELLIGENCE_AUDIT.md", () => {
    expect(existsSync(AUDIT_DOC_PATH)).toBe(true);
  });

  it("audit doc references the locked active set", () => {
    const src = readFileSync(AUDIT_DOC_PATH, "utf-8");
    for (const t of LOCKED_ACTIVE_SET) {
      expect(
        src,
        `audit doc must reference active generator '${t}'`,
      ).toContain(t);
    }
  });

  it(`audit doc references the locked registry count (${LOCKED_REGISTRY_COUNT})`, () => {
    const src = readFileSync(AUDIT_DOC_PATH, "utf-8");
    expect(src).toContain(String(LOCKED_REGISTRY_COUNT));
  });

  it("audit doc references the 4.5.A → 4.5.G slice sequence", () => {
    const src = readFileSync(AUDIT_DOC_PATH, "utf-8");
    for (const slice of [
      "4.5.A",
      "4.5.B",
      "4.5.C",
      "4.5.D",
      "4.5.E",
      "4.5.F",
      "4.5.G",
    ]) {
      expect(src, `audit doc must reference slice ${slice}`).toContain(
        slice,
      );
    }
  });

  it("audit doc references the 7 Section-7 off-site types as locked-inactive", () => {
    const src = readFileSync(AUDIT_DOC_PATH, "utf-8");
    for (const t of [
      "claim_gbp",
      "optimize_gbp_profile",
      "request_gbp_reviews",
      "claim_or_optimize_houzz",
      "claim_or_optimize_yelp",
      "submit_to_industry_directory",
      "pursue_local_pr",
    ]) {
      expect(
        src,
        `audit doc must reference off-site action type '${t}'`,
      ).toContain(t);
    }
  });
});
