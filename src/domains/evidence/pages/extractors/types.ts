/**
 * Sprint 6A.1 Phase 5 (2026-04-24) — Extractor shared types.
 *
 * ExtractorContext carries the pieces an extractor needs beyond the raw
 * HTML + its parsed PageSnapshot: the page URL (for internal-link
 * origin comparison) and any dictionaries (for city/service/entity
 * mention matching).
 *
 * ExtractedElement is the output shape — the minimum data needed to
 * produce a page_element_inventory row. The dispatcher wraps each row
 * with tenant_id / page_id / observed_at / source_snapshot_id / id at
 * the upsert boundary (Phase 6A.1.6).
 */

import type { ElementType } from "./registry";

/**
 * Context the dispatcher provides to every extractor. Dictionaries are
 * optional — if absent, dictionary-based extractors (city_mention,
 * service_mention) return zero rows gracefully. The dispatcher itself
 * is pure: everything it needs is passed in, nothing module-level.
 */
export type ExtractorContext = {
  /** Absolute URL of the page being extracted. Used by internal_link
   *  to compare origins. Required. */
  pageUrl: string;
  /** Ordered list of city names to match against body text (for
   *  `city_mention`). Case-insensitive, word-boundary matching. */
  cityDictionary?: string[];
  /** Ordered list of service names for `service_mention`. */
  serviceDictionary?: string[];
  /** Ordered list of tracked entity names (6A.2 activation). */
  entityDictionary?: string[];
  /** Ordered list of competitor brand names (6A.2 activation). */
  competitorDictionary?: string[];
};

/**
 * A single extracted element, ready for upsert to
 * page_element_inventory after the dispatcher wraps it with DB-layer
 * fields (tenant_id, page_id, url, observed_at, source_snapshot_id, id).
 */
export type ExtractedElement = {
  elementType: ElementType;
  /** Stable per-snapshot identity built via `positionalKey` /
   *  `singletonKey` / `newElementKey` / `schemaTypeKey` /
   *  `schemaPropertyKey` from `element-key.ts`. */
  elementKey: string;
  /** Operator-facing label built via `displayLabel` from
   *  `element-key.ts`. */
  displayLabel: string;
  /** Actual content (title text, heading text, FAQ question, link
   *  anchor, mention term, schema property value). Nullable for
   *  structural-only elements like `schema_type`. */
  elementText: string | null;
  /** Extractor-specific extras that shouldn't drive identity but are
   *  useful for diagnostics / downstream enrichment: `{ href, anchor,
   *  faq_source, occurrences, ... }`. */
  elementMetadata: Record<string, unknown>;
  /** `EXTRACTOR_REGISTRY[elementType].version`. Persisted so future
   *  re-extract jobs can detect stale rows by mismatched version. */
  extractorVersion: number;
};

/**
 * Signature every extractor must implement. Pure function —
 * HTML + snapshot + context in, rows out. No I/O, no mutation. */
export type Extractor = (
  snapshot: import("../types").PageSnapshot,
  html: string,
  ctx: ExtractorContext,
) => ExtractedElement[];
