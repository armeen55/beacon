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
 * Decode the `[id]` segment from `params.id`.
 *
 * 2026-05-13 P0 — the detail-route debug panel proved that in Next.js
 * 16, `params.id` arrives PERCENT-ENCODED for client-side navigations
 * (e.g., clicking a `<Link href="/recommendations/${encoded}">` on
 * the v2 list). Earlier Next versions auto-decoded the path segment
 * once before handing it to the page; Next 16 does not. Previously
 * this helper was effectively an identity function on the trimmed
 * input — that worked for the auto-decoded form but left the encoded
 * form in place, so the resolver compared an encoded string against
 * decoded row.ids and every visible card landed on the not-found
 * state.
 *
 * The robust contract: repeatedly `decodeURIComponent` until the
 * string stabilizes or we hit a small iteration cap. This handles:
 *   • already-decoded ids (single iteration, stable, return as-is)
 *   • once-encoded ids (Next 16 default — decode once, second
 *     iteration is stable)
 *   • double-encoded ids (`%253A` → `%3A` → `:`)
 *   • malformed `%` sequences (decodeURIComponent throws — we catch
 *     and return the last successfully-decoded form)
 *
 * The iteration cap (3) is paranoia. Anything beyond double-encoding
 * is almost certainly a bug somewhere upstream, and a third pass on
 * an already-decoded string is a no-op.
 *
 * Returns `null` only for input that can't possibly be a valid
 * recommendation id (empty / non-string / pure whitespace).
 */
export function decodeRecommendationRouteId(
  routeParam: unknown,
): string | null {
  if (typeof routeParam !== "string") return null;
  const trimmed = routeParam.trim();
  if (trimmed.length === 0) return null;

  // Iteratively decode until stable. `decodeURIComponent` is idempotent
  // on already-decoded ASCII / Unicode strings (no `%` triplets → no
  // change → loop exits after the first iteration).
  let current = trimmed;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed percent sequence (e.g., a stray `%` not followed by
      // two hex digits). Keep the last successfully-decoded value;
      // never crash the route handler.
      break;
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * 2026-05-13 P0 — SINGLE CANONICAL HREF BUILDER for `/recommendations/[id]`.
 *
 * The user's "every visible card lands on replaced/handled" report
 * implies a list/detail identity drift somewhere. Eliminate it at the
 * type level: every customer-facing surface that needs to link to a
 * recommendation's detail page MUST use this helper. The list card,
 * the working rail, the See-full-list expanded rows, and any future
 * surface all share one path constructor.
 *
 * `row` is typed loosely (just `{ id: string }`) so meta-action rows
 * and synthesized rows are accepted without coupling this helper to
 * the full `RecommendationActionRow` shape.
 */
export function buildRecommendationDetailHref(row: { id: string }): string {
  return `/recommendations/${encodeRecommendationRouteId(row.id)}`;
}
