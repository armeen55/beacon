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
      reason: "no_key" | "disconnected" | "api_error";
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
};
