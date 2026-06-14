/**
 * 2026-06-10 — the vertical-AGNOSTIC page-shape layer (P0 wall 5).
 *
 * The brain's existing patterns are keyed by SEGMENT (deliberate
 * isolation), which architecturally prevents the dream's signature
 * trick: a page-shape that wins for a home builder teaching an
 * encyclopedia. This module adds the abstraction that makes the
 * transfer possible WITHOUT weakening tenant isolation:
 *
 *   • Features are STRUCTURAL ONLY — has an FAQ block, has a table,
 *    has schema, word-count band, heading density. No text, no URLs,
 *    no tenant ids ever leave this layer's outputs.
 *   • The aggregate pools ALL tenants (cross-vertical by design) and
 *    answers one question per feature: are pages WITH this shape
 *    cited by AI more often than pages WITHOUT it?
 *
 * Pure compute. Gating (BEACON_CROSS_TENANT_BRAIN) and I/O live in the
 * loader (load-page-shape-patterns.ts).
 */

import type { PageSnapshot } from "@/domains/pages/types";

export type PageShapeFeature =
  | "faq_block"
  | "table"
  | "schema_markup"
  | "long_form"
  | "rich_headings";

export const PAGE_SHAPE_FEATURES: readonly PageShapeFeature[] = [
  "faq_block",
  "table",
  "schema_markup",
  "long_form",
  "rich_headings",
];

/** Human labels for surfaces — plain English, no jargon. */
export const PAGE_SHAPE_LABELS: Readonly<Record<PageShapeFeature, string>> = {
  faq_block: "a question-and-answer section",
  table: "a comparison or data table",
  schema_markup: "structured data markup",
  long_form: "in-depth copy (1,200+ words)",
  rich_headings: "a well-sectioned layout (5+ headings)",
};

export type PageShapeFeatures = Readonly<Record<PageShapeFeature, boolean>>;

/** Extract structural features from a snapshot. Pure; no text retained. */
export function extractPageShape(snap: PageSnapshot): PageShapeFeatures {
  return {
    faq_block: (snap.faqs?.length ?? 0) > 0 || (snap.faq_schema_block_count ?? 0) > 0,
    table: (snap.table_count ?? 0) > 0,
    schema_markup: (snap.schema_types?.length ?? 0) > 0,
    long_form: (snap.word_count ?? 0) >= 1200,
    rich_headings: (snap.h2_list?.length ?? 0) + (snap.h3_count ?? 0) >= 5,
  };
}

export type PageShapeInput = {
  features: PageShapeFeatures;
  /** Was this page's URL cited by any AI answer for its tenant? */
  cited: boolean;
  /**
   * wave-5 #4 (2026-06-14) — ANONYMOUS per-tenant discriminator (a small
   * integer index assigned at load time, NEVER the tenant id/domain). Used
   * ONLY to count DISTINCT contributing tenants per split side so a
   * "X pages cited N× more often" network claim can't be made from a single
   * tenant's pages. Privacy-safe: an opaque index reveals nothing.
   */
  tenantBucket: number;
};

export type PageShapePattern = {
  feature: PageShapeFeature;
  withPages: number;
  withCited: number;
  withoutPages: number;
  withoutCited: number;
  citedRateWith: number;
  citedRateWithout: number;
  /** citedRateWith / citedRateWithout; null when either side is empty
   *  or the without-rate is 0 (no meaningful ratio). */
  lift: number | null;
};

/** Minimum pages on EACH side of the split before a pattern is real. */
export const PAGE_SHAPE_MIN_PAGES_PER_SIDE = 10;

/**
 * wave-5 #4 (2026-06-14) — minimum DISTINCT tenants on EACH side before a
 * cross-tenant lift is emitted. A "pages like yours get cited more" claim is
 * only honestly cross-tenant when both sides draw from ≥2 different tenants;
 * otherwise one tenant's pages alone could manufacture the pattern. (The
 * loader already requires ≥2 active tenants to run at all; this ensures the
 * SPLIT itself is multi-tenant, not just the pool.)
 */
export const PAGE_SHAPE_MIN_TENANTS_PER_SIDE = 2;

/**
 * Aggregate the cross-tenant pool into per-feature patterns. Pure.
 * Outputs carry counts + rates ONLY (privacy-safe by construction).
 */
export function aggregatePageShapePatterns(
  inputs: PageShapeInput[],
): PageShapePattern[] {
  const out: PageShapePattern[] = [];
  for (const feature of PAGE_SHAPE_FEATURES) {
    let withPages = 0;
    let withCited = 0;
    let withoutPages = 0;
    let withoutCited = 0;
    // wave-5 #4: count DISTINCT contributing tenants on each side.
    const withTenants = new Set<number>();
    const withoutTenants = new Set<number>();
    for (const i of inputs) {
      if (i.features[feature]) {
        withPages++;
        withTenants.add(i.tenantBucket);
        if (i.cited) withCited++;
      } else {
        withoutPages++;
        withoutTenants.add(i.tenantBucket);
        if (i.cited) withoutCited++;
      }
    }
    const citedRateWith = withPages > 0 ? withCited / withPages : 0;
    const citedRateWithout = withoutPages > 0 ? withoutCited / withoutPages : 0;
    const lift =
      withPages >= PAGE_SHAPE_MIN_PAGES_PER_SIDE &&
      withoutPages >= PAGE_SHAPE_MIN_PAGES_PER_SIDE &&
      // wave-5 #4: both sides must be genuinely multi-tenant, else suppress.
      withTenants.size >= PAGE_SHAPE_MIN_TENANTS_PER_SIDE &&
      withoutTenants.size >= PAGE_SHAPE_MIN_TENANTS_PER_SIDE &&
      citedRateWithout > 0
        ? citedRateWith / citedRateWithout
        : null;
    out.push({
      feature,
      withPages,
      withCited,
      withoutPages,
      withoutCited,
      citedRateWith,
      citedRateWithout,
      lift,
    });
  }
  return out;
}

/**
 * The strongest honest insight for the morning surface, or null when
 * nothing qualifies (lift ≥ minLift with both sides at the page
 * minimum). One plain-English sentence; counts shown so the claim is
 * checkable.
 */
export function formatNetworkInsight(
  patterns: PageShapePattern[],
  minLift = 1.3,
): string | null {
  const qualified = patterns
    .filter((p) => p.lift !== null && p.lift >= minLift)
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0));
  const best = qualified[0];
  if (!best) return null;
  const ratio = (best.lift ?? 0).toFixed(1);
  const total = best.withPages + best.withoutPages;
  return `Across your businesses, pages with ${PAGE_SHAPE_LABELS[best.feature]} get cited by AI ${ratio}× more often (${total} pages compared).`;
}
