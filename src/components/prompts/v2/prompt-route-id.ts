/**
 * Prompts v2B — route-id encode/decode helpers for `/prompts/[id]`.
 *
 * Bundle (2026-05-11) per the maximum-depth UI audit. Mirrors the
 * recommendation-route-id pattern that landed in Bundle 2B. Prompt
 * IDs are usually slug-safe (e.g., `p-winning`, UUIDs) but the
 * contract still passes through `encodeURIComponent` so any future
 * provenance string with `:`, ` `, `[`, `]`, or `/` round-trips
 * safely without 404 or wrong-path routing.
 *
 * Pure / deterministic. No I/O. No throws on well-formed input.
 */

/**
 * Encode a tracked-prompt id for use as the `[id]` segment in
 * `/prompts/<id>`. Round-trip safe for any string.
 *
 * Implementation note: `encodeURIComponent` covers every character
 * unsafe in a URL path segment (`:`, `/`, `?`, `#`, `[`, `]`, `@`,
 * `!`, `$`, `&`, `'`, `(`, `)`, `*`, `+`, `,`, `;`, `=`, ` `, plus
 * all non-ASCII). It does NOT encode the unreserved set (`A-Z`,
 * `a-z`, `0-9`, `-`, `_`, `.`, `~`), which are all safe in path
 * segments per RFC 3986.
 */
export function encodePromptRouteId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * Decode the `[id]` segment Next.js hands us in `params.id`.
 *
 * Next.js decodes the path segment ONCE between the URL bar and
 * the page loader, so by the time we read `params.id` it already
 * matches the value we passed to `encodePromptRouteId`
 * server-side. This helper exists so callers don't have to know
 * that contract, and so there's a single seam for future
 * validation.
 *
 * Returns `null` for inputs that can't possibly be a valid prompt
 * id (empty / non-string / pure whitespace). Otherwise returns
 * the trimmed value as-is. Callers should treat `null` as a
 * not-found path.
 */
export function decodePromptRouteId(routeParam: unknown): string | null {
  if (typeof routeParam !== "string") return null;
  const trimmed = routeParam.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}
