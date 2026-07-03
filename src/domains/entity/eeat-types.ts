/**
 * Entity + author (E-E-A-T) system (BEACON 500 P10, 2026-07-03).
 *
 * Shared pure types for the three deterministic E-E-A-T detectors. This file is
 * a NEW island inside the existing `entity` domain (which already carries an
 * `entity-extract` index and founder-authority tracking); everything here is
 * prefixed `eeat-` so it never collides with those.
 *
 * The three Moves:
 *   1. Sitewide entity + sameAs (v1 118/218): a content page names an entity
 *      Google already knows in its Knowledge Graph (Beacon resolved it to a
 *      Wikidata QID earlier) but the page carries no entity schema linking to
 *      it. Emit an add_schema Move with a ready-to-paste sameAs block.
 *   2. Author / reviewer Person byline (v1 243/263): a guide-shaped content
 *      page has no named author (no Person schema, no visible byline). Emit an
 *      E-E-A-T author-byline Move.
 *   3. Knowledge-Graph / brand presence (v1 372/507): a connector-free check of
 *      whether the tenant's own brand is represented as an entity (Organization
 *      schema with sameAs links present on the site). Surface honestly with a
 *      next step; self-hide when already well-represented.
 *
 * Customer surfaces say "the people and things your pages are about" and "who
 * wrote this", never the lab word "entity". Every type here is pure data.
 */

/**
 * One entity Beacon already resolved to Google's Knowledge Graph, from the
 * SHIPPED Wikidata QID work (the `wikidata-entity-cache` store the biography-QID
 * slice populates). Only matches with a real QID are carried here; `none`
 * matches are dropped by the loader.
 */
export type KnownEntity = {
  /** The name as it appears on the page / was queried (trimmed). */
  name: string;
  /** Wikidata QID (e.g. "Q123"). Always non-null in a KnownEntity. */
  qid: string;
  /** wikidata.org/wiki/<QID>. */
  wikidataUrl: string;
  /** English Wikipedia URL when the match carried one, else null. */
  wikipediaUrl: string | null;
  /** Only a "high" match's sameAs may be auto-pasted; "needs-confirm" is
   *  surfaced for operator confirmation. Both are eligible to link. */
  confidence: "high" | "needs-confirm";
};

/** The pure verdict for the sitewide-entity detector: this page names one or
 *  more Knowledge-Graph entities it does not yet reference in its schema. */
export type EntityLinkGap = {
  url: string;
  /** The known entities named on the page and NOT yet linked in its schema,
   *  deduped by QID, capped for a focused card. */
  entities: KnownEntity[];
  /** The page's observed schema @type strings, for the operator trace. */
  schemaTypes: string[];
  fetchedAt: string;
};

/** One guide-shaped content page + the author signals it does / does not carry. */
export type AuthorPageInput = {
  url: string;
  schemaTypes: string[];
  extractionCertain: boolean;
  /** True when a named-author signal is present (Person schema, or a visible
   *  "By <Name>" byline in the page's own sampled body text). */
  hasAuthorSignal: boolean;
  /** Guide-shaped: an article / guide / how-to page where authorship matters
   *  for trust. A store product page or a bare list does not need a byline. */
  isGuideShaped: boolean;
  fetchedAt: string;
};

/** The pure verdict for the author detector: a guide page with no named author. */
export type AuthorGap = {
  url: string;
  fetchedAt: string;
};

/**
 * The connector-free brand-presence read: does the tenant's OWN site already
 * establish the brand as an entity Google can recognize? Assembled from the
 * homepage / site-root snapshot's schema alone, no external call.
 */
export type BrandPresenceInput = {
  /** The tenant's configured brand name (from business config). */
  brandName: string;
  /** The tenant's configured domain (bare or full). */
  domain: string;
  /** True when a site-root / homepage snapshot carries Organization (or a
   *  more-specific business) schema. */
  hasOrganizationSchema: boolean;
  /** True when that Organization schema carries at least one sameAs link (the
   *  cross-reference that lets Google confirm the entity). */
  hasSameAsLinks: boolean;
  /** The site-root URL the Move anchors on (null when no usable domain). */
  siteRootUrl: string | null;
  /** ISO fetched-at of the site-root snapshot, or now when no snapshot. */
  fetchedAt: string;
};

/** The pure verdict for brand presence: what is missing, and the play. */
export type BrandPresenceGap = {
  siteRootUrl: string;
  brandName: string;
  domain: string;
  /** "no_org_schema" = no Organization schema at all (the bigger gap);
   *  "no_sameas" = has Organization schema but no sameAs cross-links. */
  gap: "no_org_schema" | "no_sameas";
  fetchedAt: string;
};

/**
 * The full pre-assembled input the loader threads into the three pure trigger
 * predicates in one shot. Empty everywhere when there is no data.
 */
export type EeatSignals = {
  entityLinkGaps: EntityLinkGap[];
  authorGaps: AuthorGap[];
  brandPresenceGap: BrandPresenceGap | null;
};
