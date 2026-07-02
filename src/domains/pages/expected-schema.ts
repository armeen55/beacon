/**
 * Phase 1 — Per-asset-type expected schema map + coverage diff.
 *
 * The scanner compares each page's observed `schema_types` against the
 * expected list for its `asset_type`. Pages missing a required type emit
 * a `schema_missing_for_page_type` finding (Day 2 of Phase 1).
 *
 * Seed values reflect the menlo-park natural experiment (the only Ritz
 * location page currently carrying the full LocalBusiness + BreadcrumbList
 * + WebPage + FAQPage stack) and the brand-page stacks already emitted on
 * `/luxury-home-builder-bay-area` and `/custom-home-builder-bay-area`.
 *
 * "oneOf" semantics: an inner `string[]` inside the spec means "any one of
 * these types counts as present" — e.g., LocalBusiness OR
 * HomeAndConstructionBusiness OR ProfessionalService all satisfy the
 * "local business schema" requirement.
 *
 * Pure data + pure function. No I/O, no side effects.
 */

import type { AssetType } from "@/lib/constants";

/**
 * Spec for one asset type. `required` types MUST be present. `recommended`
 * types SHOULD be present; missing them produces a lower-severity finding.
 */
export type ExpectedSchema = {
  required: Array<string | string[]>;
  recommended: Array<string | string[]>;
};

export const EXPECTED_SCHEMA_BY_ASSET_TYPE: Record<AssetType, ExpectedSchema> = {
  homepage: {
    required: [
      "FAQPage",
      [
        "LocalBusiness",
        "HomeAndConstructionBusiness",
        "ProfessionalService",
        "Organization",
      ],
    ],
    recommended: ["WebSite", "BreadcrumbList"],
  },
  city_page: {
    required: [
      "FAQPage",
      "BreadcrumbList",
      "WebPage",
      ["LocalBusiness", "HomeAndConstructionBusiness", "ProfessionalService"],
    ],
    recommended: ["Place"],
  },
  service_page: {
    required: ["FAQPage", "BreadcrumbList", ["Service", "Offer"]],
    recommended: ["HowTo"],
  },
  process_page: {
    required: ["FAQPage", "HowTo"],
    recommended: ["BreadcrumbList"],
  },
  project_page: {
    required: ["FAQPage", "Article", "BreadcrumbList"],
    recommended: ["ImageObject", "Place"],
  },
  brand_page: {
    required: ["FAQPage", "BreadcrumbList"],
    recommended: [
      "Article",
      ["LocalBusiness", "HomeAndConstructionBusiness", "Organization"],
    ],
  },
  hub_page: {
    required: ["BreadcrumbList", ["CollectionPage", "ItemList"]],
    recommended: ["FAQPage"],
  },
  // Non-content asset types — nothing expected. Findings suppressed.
  infrastructure: { required: [], recommended: [] },
  sitemap: { required: [], recommended: [] },
  directory_profile: { required: [], recommended: [] },
  lead_form: {
    required: ["ContactPoint"],
    recommended: ["BreadcrumbList"],
  },
};

/**
 * Coverage diff result. `missing_required` items drive the finding; its
 * length + severity table decide the finding priority.
 */
export type SchemaCoverageDiff = {
  /** Expected types that ARE present on the page. */
  present: string[];
  /** Required types that are NOT present (strings for single, labels for oneOf). */
  missing_required: string[];
  /** Recommended types that are NOT present. */
  missing_recommended: string[];
  /** True when every `required` item is satisfied. */
  satisfies_all_required: boolean;
};

/**
 * Content-site (article/encyclopedia) page expectation — 2026-06-12,
 * Content Schema Engine slice. The `EXPECTED_SCHEMA_BY_ASSET_TYPE` map
 * above is local-service-tuned (FAQPage required on every type), which
 * is why content pages were OUT of the missing-schema trigger's scope
 * and a content tenant (e.g. a Wix encyclopedia) got zero schema
 * recommendations despite schema being its dominant scan finding.
 *
 * Vertical-NEUTRAL and intentionally minimal, grounded in primary docs
 * (full citations in the slice's commit + docs note):
 *   • Google "Article structured data": Article has NO required
 *     properties — "add the properties that apply to your content" —
 *     so proposing Article on an article-shaped content page is
 *     always schema-valid.
 *   • Google "Breadcrumb structured data": BreadcrumbList carries the
 *     page's navigation context; recommended, not required.
 *   • FAQPage is deliberately ABSENT: Google restricted FAQ rich
 *     results (2023) to authoritative gov/health sites, and FAQPage is
 *     only honest when real visible Q&A exists — a later slice may add
 *     it conditionally on detected FAQ elements.
 */
export const CONTENT_PAGE_EXPECTED_SCHEMA: ExpectedSchema = {
  required: ["Article"],
  recommended: ["BreadcrumbList"],
};

/**
 * Biography content-page expectation (2026-07-02, item 73, Wikidata
 * grounding). A content page the `biography-detector` classifies as a
 * person's page should ALSO carry Person JSON-LD alongside Article. AI
 * answer engines resolve people to knowledge-graph entities before citing
 * sources, and Person is Google's own structured-data type for exactly
 * this ("Person" markup: name plus optionally birthDate/jobTitle/sameAs, no
 * required properties beyond `name`, same "add what applies" posture as
 * Article). BreadcrumbList stays recommended, matching the base content
 * spec above.
 *
 * Deliberately vertical-neutral: this spec is only ever selected for a
 * page the pure `detectBiographyPage()` already classified as biography
 * shaped from the page's OWN signals, never applied blanket to all
 * content pages.
 */
export const CONTENT_PAGE_BIOGRAPHY_EXPECTED_SCHEMA: ExpectedSchema = {
  required: ["Article", "Person"],
  recommended: ["BreadcrumbList"],
};

/**
 * Given the observed `schema_types` on a page and the page's `asset_type`,
 * return a structured coverage diff. Caller decides whether to emit a
 * finding (Day 2 of Phase 1 wires this).
 *
 * Pure — no I/O, no exceptions thrown.
 */
export function diffSchemaCoverage(
  assetType: AssetType,
  actualTypes: string[] | null | undefined,
): SchemaCoverageDiff {
  return diffSchemaCoverageForSpec(
    EXPECTED_SCHEMA_BY_ASSET_TYPE[assetType],
    actualTypes,
  );
}

/**
 * Same coverage diff against an explicit spec — lets callers evaluate
 * page classes that are NOT in the AssetType enum (the content-site
 * branch) without widening that enum. Pure; logic extracted verbatim
 * from `diffSchemaCoverage`, which now delegates here.
 */
export function diffSchemaCoverageForSpec(
  expected: ExpectedSchema,
  actualTypes: string[] | null | undefined,
): SchemaCoverageDiff {
  const actual = new Set(actualTypes ?? []);

  const evaluate = (
    spec: Array<string | string[]>,
  ): { present: string[]; missing: string[] } => {
    const out = { present: [] as string[], missing: [] as string[] };
    for (const item of spec) {
      if (Array.isArray(item)) {
        // oneOf semantics — any match counts.
        const match = item.find((t) => actual.has(t));
        if (match) out.present.push(match);
        else out.missing.push(`(one of) ${item.join(" | ")}`);
      } else {
        if (actual.has(item)) out.present.push(item);
        else out.missing.push(item);
      }
    }
    return out;
  };

  const req = evaluate(expected.required);
  const rec = evaluate(expected.recommended);

  return {
    present: [...req.present, ...rec.present],
    missing_required: req.missing,
    missing_recommended: rec.missing,
    satisfies_all_required: req.missing.length === 0,
  };
}
