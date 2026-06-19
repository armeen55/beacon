/**
 * Insight layer — Workbench route helpers (operator-OS rebuild, Phase 2).
 *
 * The Workbench locks onto ONE page. Its URL is `/workbench/[encodedPagePath]`
 * where the segment encodes the page PATH (e.g. `/iran-flags/iran-islamic-republic-flag-history`).
 * A page path contains slashes, so it must be percent-encoded into a SINGLE
 * dynamic segment. We reuse the battle-tested recommendation route-id encoder
 * (`encodeURIComponent` + iterative decode that survives Next 16's encoding)
 * and normalize the result to the SAME path key the Page Surgeon / Opportunity
 * loaders use (host-stripped, leading slash, no trailing slash). PURE.
 */

import {
  encodeRecommendationRouteId,
  decodeRecommendationRouteId,
} from "@/components/recommendations/v2/recommendation-route-id";

/**
 * Normalize any URL-or-path into the canonical PATH key used across the insight
 * + Page Surgeon loaders (`toPath`): strip scheme+host, drop query/hash, force a
 * leading slash, strip the trailing slash (except root). Returns null for input
 * that can't be a page path (empty / non-string).
 */
export function normalizeWorkbenchPath(
  input: string | null | undefined,
): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  // Strip scheme + host if a full URL was passed.
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  // Drop query + fragment.
  s = s.split("#")[0].split("?")[0];
  if (!s) return "/";
  if (!s.startsWith("/")) s = "/" + s;
  // Strip trailing slash(es), keep root as "/".
  s = s.replace(/\/+$/, "") || "/";
  return s;
}

/** Encode a page path into the `[encodedPagePath]` route segment. */
export function encodeWorkbenchPath(path: string): string {
  return encodeRecommendationRouteId(normalizeWorkbenchPath(path) ?? path);
}

/**
 * Decode the `[encodedPagePath]` route param back into a normalized page path.
 * Handles Next 16's percent-encoding (incl. double-encoding) via the shared
 * iterative decoder, then normalizes to the loader path key. Null ⇒ invalid.
 */
export function decodeWorkbenchPath(param: unknown): string | null {
  const decoded = decodeRecommendationRouteId(param);
  return normalizeWorkbenchPath(decoded);
}

/** The single href builder every surface uses to link into the Workbench. */
export function workbenchHref(path: string): string {
  return `/workbench/${encodeWorkbenchPath(path)}`;
}
