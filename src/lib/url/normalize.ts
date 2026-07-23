/**
 * URL normalization — canonical helper.
 *
 * History:
 *   - Originally co-located in `src/domains/evidence/product/url-citation-history.ts`
 *     for the citation history index's owned-URL match path.
 *   - Trust Sprint T6.3 (2026-05-06) discovered that recommended_edits.target_url
 *     stores full URLs ("https://ritzbuilders.com/locations/los-altos") while
 *     url_change_outcomes.url stores paths ("/locations/los-altos") — cross-
 *     store joins required ad-hoc analyzer-side normalization.
 *   - Trust Sprint T6.6 (2026-05-06) extracts the helper here so analysis
 *     scripts + future write-time normalization (deferred — see preflight)
 *     can share a single source of truth without pulling in the heavy
 *     url-citation-history transitive imports.
 *
 * Pure. No I/O. Idempotent on already-normalized paths.
 *
 * Contract:
 *   - null/undefined/empty → null
 *   - "https://ritzbuilders.com/locations/los-altos"  → "/locations/los-altos"
 *   - "https://ritzbuilders.com/locations/los-altos/" → "/locations/los-altos"
 *   - "https://ritzbuilders.com/path?query=1#hash"    → "/path"
 *   - "/locations/los-altos"   → "/locations/los-altos"
 *   - "/locations/los-altos/"  → "/locations/los-altos"
 *   - "ritzbuilders.com/locations" (host-prefixed, no protocol) → "/locations"
 *   - "/" → "/"
 *   - URL parse failure → best-effort string parse fallback
 *   - Output is lowercased.
 *
 * External-URL safety:
 *   - "https://demattei.com/services" → "/services"
 *   - The helper does NOT validate that the host belongs to the brand.
 *     Callers that need owned-vs-external classification must do that
 *     SEPARATELY (e.g., by checking the domain against tracked-entities
 *     before passing the URL through this helper). Pass external URLs in
 *     and you'll get a path back — that's the contract; this is a
 *     PATH-NORMALIZER, not an ownership check.
 */

export function normalizeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  let raw = u.trim();
  if (!raw) return null;

  // If it's a full URL, parse via URL constructor (which strips query/hash).
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return path.toLowerCase();
    } catch {
      // Fall through to string-based parse below.
    }
  }

  // Strip protocol if present in weird form, then strip leading host token if any.
  raw = raw.replace(/^https?:\/\//i, "");
  // If it starts with a host-looking segment (contains a "." before any "/"), strip it.
  const firstSlash = raw.indexOf("/");
  const headSegment = firstSlash >= 0 ? raw.slice(0, firstSlash) : raw;
  if (firstSlash >= 0 && headSegment.includes(".")) {
    raw = raw.slice(firstSlash); // keep the path onwards
  }
  // Strip query + hash for fallback path.
  const qIdx = raw.indexOf("?");
  if (qIdx >= 0) raw = raw.slice(0, qIdx);
  const hIdx = raw.indexOf("#");
  if (hIdx >= 0) raw = raw.slice(0, hIdx);
  // Ensure leading slash.
  if (!raw.startsWith("/")) raw = "/" + raw;
  // Strip trailing slashes, lowercase.
  raw = raw.replace(/\/+$/, "") || "/";
  return raw.toLowerCase();
}
