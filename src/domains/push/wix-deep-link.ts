/**
 * wix-deep-link (BEACON_500 item 45, 2026-07-02) - PURE resolver from a
 * mapped Wix CMS item to the Wix dashboard URL that opens it as close to
 * the exact edit surface as a Wix URL can reach.
 *
 * Cards link "Open page" (the PUBLIC url) today, so the operator still has
 * to hunt for the item inside the Wix dashboard on every single apply. This
 * resolver derives:
 *   - a Wix Stores PRODUCT  -> the product editor
 *       https://manage.wix.com/dashboard/{siteId}/stores/products/{itemId}
 *   - any other CMS collection item -> the Content Manager for that
 *     collection (opens the collection's item list; Wix's Content Manager
 *     has no stable per-item deep link for non-Stores collections, so the
 *     collection view is the closest honest target)
 *       https://manage.wix.com/dashboard/{siteId}/database/data/{collectionId}
 *
 * No I/O, no server-only import, no clock - a plain function of its
 * arguments so both server loaders and (if ever needed) client code can
 * call it directly, mirroring stage-route.ts's posture. Honest null when
 * any required piece is missing: an unmapped page renders NO link, never a
 * guessed or dead one.
 */

/** The Wix Stores product-catalog collection id (matches push-service.ts /
 *  push-snapshots.ts, which already special-case this same string). */
export const WIX_STORES_PRODUCTS_COLLECTION_ID = "Stores/Products";

export type WixEditorLinkInput = {
  /** The connected site's Wix site id (from the stored connector token).
   *  Never a secret itself, but only meaningful once a site is connected. */
  siteId: string | null | undefined;
  /** The CMS collection id the url-map resolved this page to. */
  dataCollectionId: string | null | undefined;
  /** The CMS item id within that collection, when known. Required for the
   *  Stores product editor link; not needed for the collection-level link. */
  dataItemId?: string | null;
};

function cleanId(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Resolve the Wix dashboard URL for one mapped item, or null when the
 * page isn't resolvable to a live Wix surface yet (no site connected, no
 * collection mapping, or a missing item id on a product). Never returns a
 * dead/guessed link - callers render nothing on null.
 */
export function buildWixEditorLink(input: WixEditorLinkInput): URL | null {
  const siteId = cleanId(input.siteId);
  const dataCollectionId = cleanId(input.dataCollectionId);
  if (siteId == null || dataCollectionId == null) return null;

  if (dataCollectionId === WIX_STORES_PRODUCTS_COLLECTION_ID) {
    const dataItemId = cleanId(input.dataItemId);
    if (dataItemId == null) return null;
    return new URL(
      `https://manage.wix.com/dashboard/${encodeURIComponent(siteId)}/stores/products/${encodeURIComponent(dataItemId)}`,
    );
  }

  return new URL(
    `https://manage.wix.com/dashboard/${encodeURIComponent(siteId)}/database/data/${encodeURIComponent(dataCollectionId)}`,
  );
}
