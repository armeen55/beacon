import "server-only";

/**
 * 2026-05-19 — Slice 9.A2γ.1 — pure helper that resolves a GA4 Data
 * API `pagePath` dimension value to a full URL using the tenant's
 * domain.
 *
 * Why this exists:
 *   GA4 Data API returns the `pagePath` dimension as a relative path
 *   (`/services/whole-home-remodel`, with or without trailing slash).
 *   Beacon's recommended_edits.target_url is stored as a full URL
 *   (`https://ritzbuilders.com/services/whole-home-remodel`). Mode A
 *   matches via `canonicalizeCitationUrl` (citation-lifecycle helper)
 *   which intentionally returns `null` for path-only inputs — its
 *   locked contract is "full URLs only" (Phase A.1 D3).
 *
 *   Normalizing at PERSIST time means every row stored in
 *   `ga4_url_traffic` is a full URL — the existing canonicalizer
 *   handles it cleanly without modification, Mode A's compute stays
 *   identical, and downstream consumers don't need to know about
 *   GA4's path-only quirk. This is the operator-locked
 *   smallest-safe-fix posture from the 9.A2γ.1 diagnosis.
 *
 * Posture (locked):
 *   • Pure synchronous function.
 *   • No I/O, no logger, no clock reads, no module imports beyond
 *     `server-only`. The caller is responsible for passing a domain
 *     and (separately) deciding whether to emit a warn when domain
 *     is empty.
 *   • Never throws on any input shape.
 *   • Deterministic on input.
 *
 * Behavior:
 *   • `pagePath` null / undefined / empty / whitespace-only → `""`.
 *   • `pagePath` already a full `http://` or `https://` URL →
 *     trimmed input, unchanged.
 *   • `pagePath` starts with `/` AND `domain` is non-empty →
 *     `https://{cleanedDomain}{pagePath}`. Preserves trailing slash
 *     so the downstream canonicalizer's trailing-slash normalization
 *     rule handles it consistently across rows.
 *   • `pagePath` starts with `/` AND `domain` is empty / whitespace →
 *     trimmed pagePath unchanged (soft-fail). The caller logs a
 *     single warn; Mode A continues to return `no_traffic_data` for
 *     these rows, which is the correct operator-diagnostic state.
 *   • `pagePath` is neither full URL nor `/`-prefixed (defensive) →
 *     trimmed input unchanged. Mode A's canonicalizer will return
 *     null upstream.
 *
 * Domain hygiene:
 *   `cleanDomain` strips a leading `http(s)://` (defensive against
 *   accidental scheme inclusion), strips leading `www.`, lowercases
 *   the host, and strips trailing slashes. This mirrors the
 *   `src/lib/site-config.ts:40` shape the rest of the codebase uses
 *   for `business-config.domain`.
 *
 * Pinned by:
 *   • tests/lib/connectors/ga4/normalize-page-path.test.ts
 *   • tests/architecture/ga4-url-traffic-stored-as-full-url.test.ts
 */

/**
 * Pure helper args. Both fields are optional/nullable at the type
 * level so the caller never has to guard before calling — the helper
 * handles every shape internally.
 */
export type NormalizeGa4PagePathArgs = {
  pagePath: string | null | undefined;
  domain: string | null | undefined;
};

export function normalizeGa4PagePathToFullUrl(
  args: NormalizeGa4PagePathArgs,
): string {
  const raw = (args.pagePath ?? "").trim();
  if (raw === "") return "";

  // Already a full URL — pass through unchanged. Lowercase scheme
  // check covers `http://`, `https://`, `HTTP://`, etc.
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  // Path-only: prefix with `https://{cleanedDomain}` when domain
  // is present; otherwise soft-fail to the trimmed pagePath.
  if (raw.startsWith("/")) {
    const cleanedDomain = cleanDomain(args.domain);
    if (cleanedDomain === "") {
      return raw;
    }
    return `https://${cleanedDomain}${raw}`;
  }

  // Defensive: neither full URL nor `/`-prefixed. Return trimmed
  // input; the canonicalizer will reject it upstream and Mode A
  // will surface `no_traffic_data` honestly.
  return raw;
}

/** Strip protocol / `www.` / trailing slashes; lowercase the host. */
function cleanDomain(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = raw.trim().toLowerCase();
  if (s === "") return "";
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/\/+$/, "");
  return s;
}

/** Test-only export of the domain cleaner. */
export const __testing = {
  cleanDomain,
};
