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

/** Locked active set per Slice 4.5.B.α₁ audit (2026-05-19). α₁
 *  flips `change_h1` paired with the `missing-h1` + `weak-h1` +
 *  `title-h1-mismatch` deterministic trigger predicates. α₀
 *  previously flipped `edit_meta`. α₂ adds no flips; cross-snapshot
 *  duplicate predicates only. */
const LOCKED_ACTIVE_SET: ReadonlyArray<ActionType> = [
  "edit_title",
  "edit_meta",
  "change_h1",
  "add_h2_section",
  "add_faq",
];

/** Locked total count per Slice 4.5.B.α₀ (2026-05-19). α₀ adds 3
 *  new inactive types (update_intro, add_h3_section,
 *  add_image_alt_text). Prior count was 29 (Slice 4.5.A). */
const LOCKED_REGISTRY_COUNT = 32;

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
