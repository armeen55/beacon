/**
 * Bundle 2B (Plan: ~/.claude/plans/i-want-a-maximum-depth-curried-curry.md) —
 * route-id encode/decode helpers for the /recommendations/[id] detail page.
 *
 * RecommendationActionRow ids are NOT slug-safe. Real fixture ids look like:
 *   - "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:d1b049c63d8a"
 *   - "rec-explore-brief-fix-8__add_h2_section__h2[new]:abc"
 *
 * They contain characters that are unsafe in URL path segments (`:`, ` `,
 * `[`, `]`, `/`) and that Next.js's `[id]` segment matcher cannot accept
 * raw. Without encoding, links would either 404 or route to the wrong path.
 *
 * Contract:
 *   - `encodeRecommendationRouteId(id)` — produces a path-safe segment
 *     using `encodeURIComponent`. Round-trip safe for ANY string.
 *   - `decodeRecommendationRouteId(routeParam)` — accepts the value Next.js
 *     hands us in `params.id`. Next decodes the path segment ONCE before
 *     it reaches us, so this helper is effectively an identity function on
 *     well-formed input — but it's exported as a named function so callers
 *     don't have to know the Next.js decoding contract, and so we have a
 *     single seam to add validation later if needed.
 *
 * Pure / deterministic. No I/O. No throws on well-formed input.
 */

/**
 * Encode a `RecommendationActionRow.id` for use as the `[id]` segment in
 * `/recommendations/<id>`. Round-trip safe for any string.
 *
 * Implementation note: `encodeURIComponent` covers every character that is
 * unsafe in a URL path segment (`:`, `/`, `?`, `#`, `[`, `]`, `@`, `!`,
 * `$`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `;`, `=`, ` `, plus all
 * non-ASCII). It does NOT encode the unreserved set (`A-Z`, `a-z`, `0-9`,
 * `-`, `_`, `.`, `~`), which are all safe in path segments per RFC 3986.
 */
export function encodeRecommendationRouteId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * Decode the `[id]` segment Next.js hands us in `params.id`.
 *
 * Next.js decodes the path segment ONCE between the URL bar and the page
 * loader, so by the time we read `params.id` it already matches the value
 * we passed to `encodeRecommendationRouteId` server-side. This helper
 * exists so callers don't have to know that contract — and so there's a
 * single seam for future validation (e.g., reject ids that exceed a
 * length cap, or that contain control characters).
 *
 * Returns `null` for inputs that can't possibly be a valid recommendation
 * id (empty / non-string / pure whitespace). Otherwise returns the trimmed
 * value as-is.
 */
export function decodeRecommendationRouteId(
  routeParam: unknown,
): string | null {
  if (typeof routeParam !== "string") return null;
  const trimmed = routeParam.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}
