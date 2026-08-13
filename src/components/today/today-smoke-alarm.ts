/**
 * today-smoke-alarm: THE one page-key rule, and nothing else.
 *
 * The alarm builder that once lived here was retired with the Today command it fed (it rendered on no
 * surface and spoke in first person, which the voice no longer allows). What survives is the key both
 * sides of the ready-fix lookup are built from, so a page written two ways is still one page.
 *
 * PURE, no I/O.
 */

/**
 * The full normalized page key used for the ready-fix lookup. THE one key rule: today-view-data keys its
 * ready proposals with this same function, so both sides of the lookup are built by one implementation
 * (host prefix removed, one trailing slash removed, "/" fallback). It carries NO length cap, so a
 * long-URL page is compared key-for-key.
 */
export function normalizedFixKey(u: string): string {
  const path = (u.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "")) || "/";
  // One page written two ways is still one page: GSC reports percent-encoded paths while our own records
  // hold the readable form, and a case difference is a representation artifact far more often than it is a
  // second page. Both sides run through here, so decoding and lowercasing keeps the two representations equal.
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { decoded = path; }
  return decoded.toLowerCase();
}
