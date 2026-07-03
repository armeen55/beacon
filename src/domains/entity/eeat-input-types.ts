/**
 * Loader-facing input shapes for the E-E-A-T detectors (BEACON 500 P10,
 * 2026-07-03). These are the pre-assembled, pre-joined rows the loader hands to
 * the pure detectors. Kept separate from `eeat-types` (the verdict shapes) so a
 * predicate importing only verdicts never pulls in the join plumbing.
 */

export type { KnownEntity } from "./eeat-types";
import type { KnownEntity } from "./eeat-types";

/**
 * One content page pre-joined to the known entities its own text names. The
 * loader builds `namedEntities` by matching the page's title / H1 / H2 tokens
 * against the tenant's Wikidata-resolved entity map.
 */
export type EntityPageEntityJoin = {
  url: string;
  /** The page's own schema @type strings (lower-cased comparison in-detector). */
  schemaTypes: string[];
  /**
   * The raw schema content the loader captured for this page (concatenated
   * @type + sameAs + entity-name strings), used ONLY for a conservative
   * "does the page already link this QID?" substring check. Optional; when
   * absent the detector falls back to `schemaTypes.join(" ")`.
   */
  schemaBlob?: string;
  /** Whether extraction was confident. Uncertain pages are skipped. */
  extractionCertain: boolean;
  /** The known entities (Wikidata-resolved) this page's own text names. */
  namedEntities: KnownEntity[];
  /** ISO fetched-at of the snapshot the row came from. */
  fetchedAt: string;
};
