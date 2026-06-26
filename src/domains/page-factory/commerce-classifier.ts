/**
 * commerce-classifier (2026-06-25, Sprint 6 · plan P8) — PURE.
 *
 * GSC/GA4 see only URLs, so Beacon can't tell a product page from an article today
 * (the plan: "a product/commerce classifier … none active today"). This deterministic
 * classifier reads the URL shape (plus optional Wix-collection membership when the
 * caller has it) to tag a page as product / collection / content. Tenant-agnostic +
 * configurable — NO hardcoded store path; a new site overrides the patterns via config.
 * It only LABELS pages; it never asserts inventory exists.
 *
 * Pinned by commerce-classifier.test.ts.
 */

export type CommerceKind = "product" | "collection" | "content";

export type CommercePatterns = {
  /** URL path segments that mark a single product (case-insensitive). */
  productSegments?: string[];
  /** URL path segments that mark a store category / collection. */
  collectionSegments?: string[];
};

export type CommerceClassification = {
  kind: CommerceKind;
  /** Why we classified it this way (the matched segment, or "url-leaf"/"none"). */
  matched: string;
};

// Conservative, widely-true defaults. Collection segments are checked when the
// segment is the LAST path part (a listing page); product segments win when they
// appear with a slug after them (a specific item).
const DEFAULT_PRODUCT = ["product", "products", "item", "items", "p", "sku", "buy"];
const DEFAULT_COLLECTION = ["collection", "collections", "category", "categories", "shop", "store", "catalog"];

function pathParts(url: string): string[] {
  let path = url.trim();
  // strip scheme + host + query/hash
  path = path.replace(/^[a-z]+:\/\//i, "");
  const slash = path.indexOf("/");
  path = slash === -1 ? "" : path.slice(slash);
  path = path.split("?")[0].split("#")[0];
  return path.split("/").map((p) => p.toLowerCase()).filter(Boolean);
}

/**
 * Classify a URL as product / collection / content. PURE.
 * - `isWixProduct` (when the caller knows it from the Wix store) forces "product".
 */
export function classifyCommerceUrl(
  url: string,
  opts: CommercePatterns & { isWixProduct?: boolean; isWixCollection?: boolean } = {},
): CommerceClassification {
  if (opts.isWixProduct) return { kind: "product", matched: "wix-store-product" };
  if (opts.isWixCollection) return { kind: "collection", matched: "wix-store-collection" };

  const parts = pathParts(url);
  if (parts.length === 0) return { kind: "content", matched: "none" };

  const productSegs = (opts.productSegments ?? DEFAULT_PRODUCT).map((s) => s.toLowerCase());
  const collectionSegs = (opts.collectionSegments ?? DEFAULT_COLLECTION).map((s) => s.toLowerCase());
  const last = parts[parts.length - 1];

  // Product: a product segment followed by a slug (a specific item).
  for (let i = 0; i < parts.length - 1; i++) {
    if (productSegs.includes(parts[i])) return { kind: "product", matched: parts[i] };
  }
  // Collection: a store/category segment as the listing leaf, OR a known collection
  // segment anywhere without a trailing item slug.
  if (collectionSegs.includes(last)) return { kind: "collection", matched: last };
  for (const seg of parts.slice(0, -1)) {
    if (collectionSegs.includes(seg)) return { kind: "collection", matched: seg };
  }
  // A bare product segment as the leaf (e.g. /shop) → collection-like listing.
  if (productSegs.includes(last) && last !== "p") return { kind: "collection", matched: last };

  return { kind: "content", matched: "none" };
}

/** Count a set of URLs by commerce kind. PURE. */
export function summarizeCommerce(
  urls: string[],
  opts: CommercePatterns = {},
): { product: number; collection: number; content: number; total: number } {
  const acc = { product: 0, collection: 0, content: 0, total: 0 };
  for (const u of urls) {
    if (!u) continue;
    acc.total++;
    acc[classifyCommerceUrl(u, opts).kind]++;
  }
  return acc;
}
