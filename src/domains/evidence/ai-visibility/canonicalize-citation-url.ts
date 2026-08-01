/**
 * 2026-05-13 Phase A.1 Step 3 — citation-lifecycle URL canonicalizer.
 *
 * Pure, total function that turns a raw URL string into the canonical
 * form used for first-citation matching. Built for Phase A.1 per
 * Section 2 Decision Lock D3 because neither of the two existing
 * helpers cleanly satisfies the locked contract:
 *
 *   • `src/lib/url/normalize.ts` is a PATH-ONLY normalizer (strips host).
 *     Citation matching needs host to distinguish owned URLs from
 *     external lookalikes (`ritzbuilders.com/services` ≠
 *     `demattei.com/services`).
 *
 *   • `src/domains/evidence/pages/classify.ts#normalizePageUrl` is closer but
 *     (a) only strips `utm_*` query params, leaving others to leak,
 *     (b) returns a structured `{url, domain, path}` object, and
 *     (c) silently strips `m.` mobile-host prefixes (outside D3).
 *     Modifying it would touch four production callers
 *     (attribution / citation-index / evidence-tier / discover).
 *
 * Locked behavior (Section 2 Decision Lock D3):
 *   - Lowercase host
 *   - Strip leading `www.` (and ONLY `www.` — do NOT strip `m.` or
 *     other prefixes)
 *   - Normalize `http://` to `https://`
 *   - Strip ALL query params (not just `utm_*`)
 *   - Strip fragments
 *   - Strip trailing slash (except root `/`)
 *   - Preserve exact path case
 *   - Do NOT fuzzy-match parent/child paths
 *   - Do NOT strip locale prefixes (D14 deferred)
 *   - Do NOT follow redirects, do NOT fetch
 *
 * Returns `null` for: null/undefined/empty/whitespace; the
 * `"needs_new_page"` sentinel that `recommended_edits.target_url`
 * uses for create-page recs; non-http(s) schemes (`mailto:`,
 * `javascript:`, `data:`, fragment-only); and any input the URL
 * constructor cannot parse. Never throws.
 *
 * Used by:
 *   - `compute-time-to-citation.ts` (Step 4) — applies on both sides
 *     of the citation ↔ target_url comparison so trailing-slash and
 *     `www.` mismatches don't produce false uncited verdicts.
 */

/**
 * Sentinel `target_url` value emitted by create-page recommendations.
 * Mirrors the one in `eligibility.ts`; kept inline so this module
 * stays free of cross-citation-lifecycle imports.
 */
const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";

/**
 * Match the leading scheme of a URI: `mailto:` / `https:` / `javascript:`
 * etc. Used to early-reject non-http(s) schemes before handing to the
 * URL constructor (some schemes parse successfully but aren't web
 * URLs we want to canonicalize).
 */
const SCHEME_PREFIX_REGEX = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

export function canonicalizeCitationUrl(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Create-page sentinel: not a real URL; the eligibility predicate
  // already excludes these rows, but defense-in-depth keeps the
  // canonicalizer honest if a caller forgets the upstream check.
  if (trimmed === NEEDS_NEW_PAGE_SENTINEL) return null;

  // Fragment-only inputs (`#section`) are not URLs.
  if (trimmed.startsWith("#")) return null;

  // Early-reject non-http(s) schemes. Doing this BEFORE the URL
  // constructor matters because `new URL("mailto:foo@bar")` succeeds
  // but produces a value we don't want to treat as a web URL.
  const schemeMatch = SCHEME_PREFIX_REGEX.exec(trimmed);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Path-only inputs (`/foo`), host-without-scheme (`example.com/foo`),
    // and other unparseable strings land here. Phase A.1's contract is
    // full URLs only; path-only canonicalization is the existing
    // `src/lib/url/normalize.ts` helper's job.
    return null;
  }

  // Belt-and-suspenders: the scheme regex above caught most non-web
  // schemes, but the URL constructor accepts a wider set than our
  // regex. Re-check after parse.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Defensive: some malformed inputs parse to an empty hostname
  // (e.g., `"https:///just-path"`). Reject so we don't emit
  // `https:///foo` as a canonical form.
  if (!url.hostname) return null;

  // Lowercase host + strip leading `www.` ONLY. `m.` and other
  // subdomain prefixes are preserved exactly (D3).
  let host = url.hostname.toLowerCase();
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }
  if (host === "") return null;

  // Credibility guard: a citation-lifecycle URL must be a credible
  // public hostname. WHATWG URL parsing accepts inputs like
  // `https:///just-path` (the next path segment becomes the hostname,
  // producing `host=just-path`), but those aren't real public web
  // hosts and shouldn't survive canonicalization.
  //
  // Minimal rule: the hostname (after www. strip) must contain at
  // least one `.` AND every dot-separated label must be non-empty.
  // This rejects single-label hosts (`just-path`, `localhost`) and
  // malformed dot-edge inputs (`.com`, `foo.`, `foo..bar`), while
  // accepting every realistic public hostname including subdomains
  // (`m.ritzbuilders.com`, `blog.ritzbuilders.com`,
  // `beacon-bice.vercel.app`, `sub.example.co.uk`).
  //
  // Not a full DNS/TLD validator — that would be brittle (new TLDs
  // ship constantly) and isn't D3's job. This is the minimum guard
  // that keeps Phase A.1's metric honest against the WHATWG
  // edge case.
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => label === "")) {
    return null;
  }

  // Preserve path case. Strip trailing slash unless the path is
  // just root.
  let path = url.pathname || "/";
  if (path !== "/") {
    path = path.replace(/\/+$/, "");
    if (path === "") path = "/";
  }

  // Always emit https. Query string + fragment are intentionally
  // dropped by reading only `pathname`.
  return `https://${host}${path}`;
}

/** The comparison key for one observed link: the canonical form when the URL parses, and the same strip of
 *  scheme, `www.`, query, fragment and trailing slash by hand when it does not, so a link the canonicalizer
 *  refuses still compares against itself instead of silently matching nothing. */
const comparisonKey = (raw: string): string =>
  canonicalizeCitationUrl(raw)
  ?? raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/**
 * THE one derivation of "the engine read this page and credited somebody else". A provider reports what it
 * RETRIEVED and what it CITED as two lists and never promises the first excludes the second, so a retrieval
 * list is stored exactly as reported and the not-cited half is subtracted HERE, by canonical url
 * (`https://www.x.com/a/` and `http://x.com/a#top` are one page). Every consumer calls this; reading a
 * stored retrieval list as the answer turns "it read your page" into "it read your page and passed it over".
 * Citations never observable (null) yield NO claim, an empty list rather than the whole retrieval list:
 * "I do not know what it credited" cannot support "it credited somebody else".
 */
export function retrievedNotCitedLinks<T extends { url: string }>(
  retrieved: readonly T[] | null | undefined,
  cited: readonly T[] | null | undefined,
): T[] {
  if (retrieved == null || cited == null) return [];
  const credited = new Set(cited.map((c) => comparisonKey(c.url)));
  return retrieved.filter((r) => !credited.has(comparisonKey(r.url)));
}
