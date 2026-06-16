/**
 * 2026-06-10 — Wix REST connector types (§push layer).
 *
 * Three write surfaces, all official Wix REST APIs:
 *   • CMS Data Items   — query/update collection items (dynamic pages)
 *   • Blog Draft Posts — create draft + publish
 *   • Media Manager    — import a file by URL
 *
 * Same posture as the SEMrush/CallRail connectors: key-auth headers
 * (`Authorization: <api_key>` + `wix-site-id`), server-only, fail-soft
 * discriminated results, injected fetch for tests, key never logged.
 */

export type WixFetchResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "no_key" | "disconnected" | "api_error" | "protected_field";
      detail?: string;
    };

/** One CMS data item (the fields object is collection-specific). */
export type WixDataItem = {
  id: string;
  dataCollectionId: string;
  data: Record<string, unknown>;
};

export type WixDraftPostRef = {
  id: string;
  title: string;
};

/**
 * One field of a discovered Wix data collection (Phase 2 mapper, MAX_SEO_AEO
 * audit P0 #2). Read-only discovery shape — `type` is Wix's field type string
 * (TEXT, RICH_TEXT, NUMBER, …) used only as a heuristic hint, never written.
 */
export type WixDiscoveredField = {
  key: string;
  displayName: string;
  type: string;
};

/**
 * One discovered Wix data collection (read-only listing of /wix-data/v2/
 * collections). Fed to suggestCollectionMapping to pre-fill the guided
 * mapper; never persisted directly (the operator-confirmed
 * WixCollectionMapping is what gets saved). No hardcoding — purely what
 * the connected site returns.
 */
export type WixDiscoveredCollection = {
  id: string;
  displayName: string;
  fields: WixDiscoveredField[];
};

/** url-map row: canonical page URL → the CMS item that renders it. */
export type WixUrlMapEntry = {
  url: string;
  dataCollectionId: string;
  dataItemId: string;
  /** The item field holding the page's slug (how the URL was derived). */
  slugField: string;
  /** Item title-ish label for operator display. */
  label: string | null;
  syncedAt: string;
};

/**
 * Per-collection mapping config the operator fills on /diagnostics/wix:
 * which collections render dynamic pages, the slug field, and the URL
 * prefix the dynamic page mounts at (e.g. "/famous-iranians").
 */
export type WixCollectionMapping = {
  dataCollectionId: string;
  /** Field name carrying the slug, e.g. "slug" or "link-name". */
  slugField: string;
  /** Dynamic-page URL prefix, e.g. "/persian-names". */
  urlPrefix: string;
  /** Optional label field for operator display, e.g. "title". */
  labelField?: string;
  /**
   * OPTIONAL operator-configured map of editable page ROLE → the CMS
   * collection FIELD that renders it, e.g. { title: "title", heading:
   * "h1Text" }. This is what lets Accept push a title/heading edit LIVE
   * to a content page (the push service derives a `field:<x>` target
   * from this when a card has none). UNSET by default → those edits
   * stay paste-ready (today's behavior), so a tenant opts in to live
   * content pushes only by filling this on /diagnostics/wix. Per-tenant,
   * operator-derived — NO hardcoding. Slug-ish fields are still refused
   * downstream (no URL changes ever).
   */
  contentFieldRoles?: {
    /** CMS field rendering the page's <title> / SEO title. */
    title?: string;
    /** CMS field rendering the page's main <h1> heading. */
    heading?: string;
    /**
     * CMS field the page's meta-description SEO Variable references. On
     * Wix, a dynamic page's meta description is populated by an SEO
     * Variable bound to a collection field, so writing this field updates
     * the live meta description (we update the value, never delete the
     * field the variable needs). Sources: Wix "Working with SEO Settings
     * for Dynamic Pages" + "Using Variables in SEO Settings" (2026-06).
     */
    description?: string;
  };
};
