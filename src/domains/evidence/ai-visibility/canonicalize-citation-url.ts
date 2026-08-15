/**
 * THE ONE canonical form a cited address is matched in. Pure, total, and it never fetches, follows a redirect or throws.
 *
 * It keeps the HOST, which is the whole reason it exists: the path-only normalizer in lib/url cannot tell one of your own pages
 * from an external lookalike (ritzbuilders.com/services is not demattei.com/services), and pages/classify#normalizePageUrl strips
 * only utm_* (letting every other param leak), returns a structured object, and quietly drops m. prefixes.
 *
 * Locked behavior: lowercase the host; strip a leading `www.` and ONLY `www.` (never `m.` or any other prefix); normalize http to
 * https; strip ALL query params and every fragment; strip a trailing slash except on root; preserve the path's exact case. It never
 * fuzzy-matches parent against child paths and never strips a locale prefix.
 *
 * Null for: null, undefined, empty or whitespace; the `needs_new_page` sentinel a create-page recommendation carries in
 * target_url; any non-http(s) scheme (mailto:, javascript:, data:, fragment-only); and anything the URL constructor cannot parse.
 * Applied to BOTH sides of the citation against target_url comparison, so a trailing slash or a `www.` can never fake an uncited verdict.
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

/** One address split into the site and the page on it, by the same strip the key above uses. An empty
 *  `path` means the address names a SITE and no page: "acme.com" credits acme.com, whatever page of it
 *  the answer actually leaned on. */
const siteAndPage = (raw: string): { host: string; path: string } => {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const cut = s.indexOf("/");
  return cut < 0 ? { host: s, path: "" } : { host: s.slice(0, cut), path: s.slice(cut) };
};

/**
 * THE one derivation of "the engine read this page and credited somebody else". A provider reports what it
 * RETRIEVED and what it CITED as two lists and never promises the first excludes the second, so a retrieval
 * list is stored exactly as reported and the not-cited half is subtracted HERE, by canonical url
 * (`https://www.x.com/a/` and `http://x.com/a#top` are one page). Every consumer calls this; reading a
 * stored retrieval list as the answer turns "it read your page" into "it read your page and passed it over".
 * Citations never observable (null) yield NO claim, an empty list rather than the whole retrieval list:
 * "I do not know what it credited" cannot support "it credited somebody else".
 *
 * A CITATION THAT NAMES ONLY A SITE CREDITS THAT SITE. The observation reader deliberately falls back to
 * the bare domain when an engine reports no address for what it credited, and comparing whole urls alone
 * matched none of those to anything: a page that WAS credited then read as read and passed over, which is
 * the harshest verdict this product can reach about a page. So a path-less citation clears every retrieved
 * page on that same site. A citation that names a DIFFERENT page on the site clears only that page.
 */
export function retrievedNotCitedLinks<T extends { url: string }>(
  retrieved: readonly T[] | null | undefined,
  cited: readonly T[] | null | undefined,
): T[] {
  if (retrieved == null || cited == null) return [];
  const credited = new Set(cited.map((c) => comparisonKey(c.url)));
  const creditedSites = new Set(cited.map((c) => siteAndPage(c.url)).filter((c) => c.host && !c.path).map((c) => c.host));
  return retrieved.filter((r) => !credited.has(comparisonKey(r.url)) && !creditedSites.has(siteAndPage(r.url).host));
}

/**
 * THE ONE ANSWER TO "DID THIS ANSWER CREDIT THE ACCOUNT'S OWN SITE", and the only one anything may ask.
 *
 * There were three, and they disagreed. Visibility read a citation as the account's when the host was the
 * account's root or a subdomain of it, and told the operator 31 of 47 answers credited a page of theirs.
 * The decision kernel asked the same question of the same stored rows with a bare `endsWith`, on the
 * provider-reported domain field alone, ignoring the url a citation actually carries: it matched a lookalike
 * host, missed a citation reported as a url with no domain field, and then counted its denominator only over
 * the answers that had ALREADY failed the test, so "across 47 stored answers and never you" was arithmetic
 * about the 16 answers that did not cite the site, printed as a fact about all 47. A card went out telling an
 * operator a page was never cited while the same evidence, on the same day, said it was cited 31 times.
 *
 * One predicate, read off BOTH fields, with a real label boundary so `notiranopedia.com` is somebody else.
 */
export function citesOwnSite(links: readonly { domain?: string | null; url?: string | null }[] | null | undefined,
  site: string | null | undefined): boolean {
  const root = (site ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  if (!root || !links) return false;
  return links.some((l) => [l.domain, l.url].some((raw) => { const h = siteAndPage(String(raw ?? "")).host;
    return !!h && (h === root || h.endsWith(`.${root}`)); }));
}
