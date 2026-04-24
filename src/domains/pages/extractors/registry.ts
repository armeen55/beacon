/**
 * Sprint 6A.1 Phase 3 (2026-04-24) — Extractor registry.
 *
 * Single source of truth for the universe of page-element types Beacon
 * knows how to extract from an HTML page or a JSON-LD block. Every row
 * in `page_element_inventory.element_type` is drawn from this enum.
 *
 * v1 policy: full 31-type enum registered from day one. Exactly 13 have
 * `active: true` — only those get extracted into Supabase during scan.
 * The remaining 18 ship as registered-but-inactive so the system knows
 * the full space of element types it will one day inspect, without
 * requiring an architecture change to add them. Sprint 6A.2 (or any
 * later phase) flips them on by editing this one file.
 *
 * The registry is DATA-ONLY — no `extract` function references. The
 * mapping from ElementType to its actual extractor function lives
 * separately in Phase 6A.1.5's extractor module, which imports this
 * registry as configuration. Keeping the two separate means this file
 * can be imported by both server and client code with zero bundle
 * risk, and a future docs surface can diff the registry as plain data.
 *
 * No DB writes. No generators. No UI. No LLM. No actual extraction
 * logic. Adding a new element type = append one entry to
 * `ELEMENT_TYPES` and one spec to `EXTRACTOR_REGISTRY`.
 */

// ── Source category ─────────────────────────────────────────────────────────

/**
 * Where in the page the extractor reads from. Useful for:
 *   - diagnostic rollups ("html_faq extractors emitted N rows across M
 *     URLs this scan")
 *   - phased activation ("turn on html_blocks extractors in 6A.2")
 *   - debugging ("schema_jsonld extractors failed on 3 URLs — which
 *     ones, and what was the parse error?")
 */
export const EXTRACTOR_SOURCE_CATEGORIES = [
  "html_head", // <title>, <meta>, <link rel="canonical">, <meta property="og:*">
  "html_headings", // <h1>..<h6>
  "html_faq", // <details>, FAQ sections by heuristic, FAQPage JSON-LD mainEntity
  "schema_jsonld", // all JSON-LD blocks (types + properties)
  "html_links", // <a href>
  "entity_mention", // NER + business-config dictionary
  "html_blocks", // structural content blocks (tables, lists, CTAs, testimonials, ...)
  "external", // off-page references (external citations, authority links)
] as const;

export type ExtractorSourceCategory =
  (typeof EXTRACTOR_SOURCE_CATEGORIES)[number];

// ── Element type enum ───────────────────────────────────────────────────────

export const ELEMENT_TYPES = [
  // ── Head / meta (3 active, 2 inactive) ──
  "title",
  "meta",
  "canonical",
  "og_title",
  "og_desc",
  // ── Heading hierarchy (3 active) ──
  "h1",
  "h2",
  "h3",
  // ── FAQ (2 active) ──
  "faq_question",
  "faq_answer",
  // ── Schema (2 active) ──
  "schema_type",
  "schema_property",
  // ── Links (1 active, 1 inactive) ──
  "internal_link",
  "external_link",
  // ── Entity mentions (2 active, 2 inactive) ──
  "city_mention",
  "service_mention",
  "entity_mention",
  "competitor_mention",
  // ── Structural blocks (all 12 inactive in v1) ──
  "table",
  "table_row",
  "list",
  "cta",
  "testimonial",
  "proof",
  "project_card",
  "answer_block",
  "comparison_block",
  "cost_section",
  "timeline_section",
  "service_area_grid",
  // ── External (inactive) ──
  "external_citation",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

// ── Spec shape ──────────────────────────────────────────────────────────────

export type ExtractorSpec = {
  /** The element type identifier. Redundant with the map key, but lets
   *  callers pass around a single `ExtractorSpec` without losing
   *  provenance. */
  elementType: ElementType;
  /**
   * Whether Phase 6A.1.5's extractor pipeline should run for this type
   * during scan. v1 = 13 active. Remaining 18 flip on when their
   * downstream generator needs them (Sprint 6A.2 and beyond).
   */
  active: boolean;
  /**
   * Extraction heuristic version. Bumped whenever the extractor's
   * logic changes in a way that invalidates previously-stored rows.
   * Persisted per-row on `page_element_inventory.extractor_version`;
   * future re-extract jobs can detect stale rows by version mismatch.
   */
  version: number;
  /** Operator-facing short label for UI badges + diagnostics. */
  operatorLabel: string;
  /** Where the extractor reads from — see `ExtractorSourceCategory`. */
  sourceCategory: ExtractorSourceCategory;
};

// ── Registry ────────────────────────────────────────────────────────────────

export const EXTRACTOR_REGISTRY: Record<ElementType, ExtractorSpec> = {
  // ── html_head ────────────────────────────────────────────────────────────
  title: {
    elementType: "title",
    active: true,
    version: 1,
    operatorLabel: "Title tag",
    sourceCategory: "html_head",
  },
  meta: {
    elementType: "meta",
    active: true,
    version: 1,
    operatorLabel: "Meta description",
    sourceCategory: "html_head",
  },
  canonical: {
    elementType: "canonical",
    active: true,
    version: 1,
    operatorLabel: "Canonical URL",
    sourceCategory: "html_head",
  },
  og_title: {
    elementType: "og_title",
    active: false,
    version: 1,
    operatorLabel: "Open Graph title",
    sourceCategory: "html_head",
  },
  og_desc: {
    elementType: "og_desc",
    active: false,
    version: 1,
    operatorLabel: "Open Graph description",
    sourceCategory: "html_head",
  },
  // ── html_headings ────────────────────────────────────────────────────────
  h1: {
    elementType: "h1",
    active: true,
    version: 1,
    operatorLabel: "H1 heading",
    sourceCategory: "html_headings",
  },
  h2: {
    elementType: "h2",
    active: true,
    version: 1,
    operatorLabel: "H2 heading",
    sourceCategory: "html_headings",
  },
  h3: {
    elementType: "h3",
    active: true,
    version: 1,
    operatorLabel: "H3 heading",
    sourceCategory: "html_headings",
  },
  // ── html_faq ─────────────────────────────────────────────────────────────
  faq_question: {
    elementType: "faq_question",
    active: true,
    version: 1,
    operatorLabel: "FAQ question",
    sourceCategory: "html_faq",
  },
  faq_answer: {
    elementType: "faq_answer",
    active: true,
    version: 1,
    operatorLabel: "FAQ answer",
    sourceCategory: "html_faq",
  },
  // ── schema_jsonld ────────────────────────────────────────────────────────
  schema_type: {
    elementType: "schema_type",
    active: true,
    version: 1,
    operatorLabel: "Schema @type",
    sourceCategory: "schema_jsonld",
  },
  schema_property: {
    elementType: "schema_property",
    active: true,
    version: 1,
    operatorLabel: "Schema property",
    sourceCategory: "schema_jsonld",
  },
  // ── html_links ───────────────────────────────────────────────────────────
  internal_link: {
    elementType: "internal_link",
    active: true,
    version: 1,
    operatorLabel: "Internal link",
    sourceCategory: "html_links",
  },
  external_link: {
    elementType: "external_link",
    active: false,
    version: 1,
    operatorLabel: "External link",
    sourceCategory: "html_links",
  },
  // ── entity_mention ───────────────────────────────────────────────────────
  city_mention: {
    elementType: "city_mention",
    active: true,
    version: 1,
    operatorLabel: "City mention",
    sourceCategory: "entity_mention",
  },
  service_mention: {
    elementType: "service_mention",
    active: true,
    version: 1,
    operatorLabel: "Service mention",
    sourceCategory: "entity_mention",
  },
  entity_mention: {
    elementType: "entity_mention",
    active: false,
    version: 1,
    operatorLabel: "Entity mention",
    sourceCategory: "entity_mention",
  },
  competitor_mention: {
    elementType: "competitor_mention",
    active: false,
    version: 1,
    operatorLabel: "Competitor mention",
    sourceCategory: "entity_mention",
  },
  // ── html_blocks (all inactive in v1) ─────────────────────────────────────
  table: {
    elementType: "table",
    active: false,
    version: 1,
    operatorLabel: "Table",
    sourceCategory: "html_blocks",
  },
  table_row: {
    elementType: "table_row",
    active: false,
    version: 1,
    operatorLabel: "Table row",
    sourceCategory: "html_blocks",
  },
  list: {
    elementType: "list",
    active: false,
    version: 1,
    operatorLabel: "List",
    sourceCategory: "html_blocks",
  },
  cta: {
    elementType: "cta",
    active: false,
    version: 1,
    operatorLabel: "Call-to-action block",
    sourceCategory: "html_blocks",
  },
  testimonial: {
    elementType: "testimonial",
    active: false,
    version: 1,
    operatorLabel: "Testimonial block",
    sourceCategory: "html_blocks",
  },
  proof: {
    elementType: "proof",
    active: false,
    version: 1,
    operatorLabel: "Proof / credential block",
    sourceCategory: "html_blocks",
  },
  project_card: {
    elementType: "project_card",
    active: false,
    version: 1,
    operatorLabel: "Project card",
    sourceCategory: "html_blocks",
  },
  answer_block: {
    elementType: "answer_block",
    active: false,
    version: 1,
    operatorLabel: "Answer block",
    sourceCategory: "html_blocks",
  },
  comparison_block: {
    elementType: "comparison_block",
    active: false,
    version: 1,
    operatorLabel: "Comparison block",
    sourceCategory: "html_blocks",
  },
  cost_section: {
    elementType: "cost_section",
    active: false,
    version: 1,
    operatorLabel: "Cost section",
    sourceCategory: "html_blocks",
  },
  timeline_section: {
    elementType: "timeline_section",
    active: false,
    version: 1,
    operatorLabel: "Timeline / process section",
    sourceCategory: "html_blocks",
  },
  service_area_grid: {
    elementType: "service_area_grid",
    active: false,
    version: 1,
    operatorLabel: "Service-area grid",
    sourceCategory: "html_blocks",
  },
  // ── external ─────────────────────────────────────────────────────────────
  external_citation: {
    elementType: "external_citation",
    active: false,
    version: 1,
    operatorLabel: "External citation",
    sourceCategory: "external",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Registry lookup. Throws on drift (shouldn't happen — the type system
 *  should prevent reaching here with a bad key). */
export function getExtractorSpec(elementType: ElementType): ExtractorSpec {
  const spec = EXTRACTOR_REGISTRY[elementType];
  if (!spec) {
    throw new Error(
      `EXTRACTOR_REGISTRY is missing a spec for "${elementType}" — registry/enum drift`,
    );
  }
  return spec;
}

/** Returns the element types whose extractor runs in v1 (13 of them). */
export function listActiveElementTypes(): ElementType[] {
  return ELEMENT_TYPES.filter((t) => EXTRACTOR_REGISTRY[t].active);
}

/** Returns every element type that sources from the given category. */
export function listElementTypesBySourceCategory(
  category: ExtractorSourceCategory,
): ElementType[] {
  return ELEMENT_TYPES.filter(
    (t) => EXTRACTOR_REGISTRY[t].sourceCategory === category,
  );
}

/** Type guard — narrow an unknown string to ElementType. Useful at the
 *  Supabase-read boundary where `element_type` arrives as text. */
export function isValidElementType(s: unknown): s is ElementType {
  return (
    typeof s === "string" &&
    (ELEMENT_TYPES as readonly string[]).includes(s)
  );
}
