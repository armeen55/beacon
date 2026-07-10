/**
 * source-authority (W5, 2026-07-09, J-69). This is the ONLY place authority
 * gets decided for a draft's cited sources. "EVERY factual draft requires
 * 1-2 authoritative sources before it is paste-ready. No exceptions." The
 * LLM may PROPOSE a source (url/title/domain/claim) inside a structured
 * draft, but its own guess at `authority` is never trusted; this module
 * re-derives it deterministically from the domain alone (plus the tenant's
 * own curated allowlist), so a draft can never talk itself into
 * "authoritative."
 *
 * Rules (checked in order, first match wins):
 *   1. A source with no `claim` is a bare URL. "A bare URL with no claim
 *      association counts as no source" (per the approved architecture), so
 *      it is stamped "unverified" regardless of domain.
 *   2. `.gov` / `.edu`. Government and academic domains are authoritative
 *      everywhere, for every tenant, with no configuration.
 *   3. A small NAMED set of encyclopedic / major-press domains. Generic,
 *      cross-industry, never tenant-specific (English-first product; no
 *      vertical hardcoding).
 *   4. The tenant's own `authoritativeSourceDomains` allowlist
 *      (`BusinessConfig`). Per-tenant DATA, never code. Unset for a tenant
 *      = this tier contributes nothing (byte-identical for every tenant that
 *      hasn't curated one).
 *   5. Anything else with a real claim: "weak" (a real citation, just not
 *      from a domain this gate trusts yet).
 *
 * PURE, no I/O, no LLM, no randomness. Same input always produces the same
 * output. Tenant-agnostic: callers thread in the tenant's own allowlist.
 */

export type SourceAuthority = "authoritative" | "weak" | "unverified";

/** The minimal shape this module needs from a SourceRef, accepts the real
 *  schemas.ts `SourceRef` or any object carrying at least these fields. */
export type ClassifiableSource = {
  url?: string | null;
  domain?: string | null;
  claim?: string | null;
};

/** Universal .gov/.edu-equivalent TLDs treated as authoritative for every
 *  tenant, with no configuration, government and academic sources. */
const AUTHORITATIVE_TLDS = [".gov", ".edu"];

/** A small, generic, cross-industry set of encyclopedic / major wire-service
 *  and public-broadcaster domains. Deliberately NOT vertical-specific (no
 *  Iran/Persian-only sources here, English-first, no tenant hardcoding); a
 *  tenant that needs a subject-specific authority adds it to their own
 *  `authoritativeSourceDomains` allowlist instead of this universal set. */
const NAMED_AUTHORITATIVE_DOMAINS = new Set([
  "britannica.com",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "npr.org",
  "loc.gov",
  "un.org",
  "who.int",
]);

/** Extract a bare domain (no scheme, no "www.", lowercased) from a URL string
 *  or an explicit domain field. Returns "" when neither yields anything
 *  usable, never throws on a malformed URL. */
export function extractDomain(source: ClassifiableSource): string {
  const explicit = (source.domain ?? "").trim().toLowerCase();
  if (explicit) return explicit.replace(/^www\./, "");
  const url = (source.url ?? "").trim();
  if (!url) return "";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isTenantAllowlisted(domain: string, allowlist: readonly string[] | undefined): boolean {
  if (!domain || !allowlist || allowlist.length === 0) return false;
  return allowlist.some((d) => {
    const norm = d.trim().toLowerCase().replace(/^www\./, "");
    return !!norm && (domain === norm || domain.endsWith(`.${norm}`));
  });
}

function isNamedAuthoritative(domain: string): boolean {
  if (!domain) return false;
  if (NAMED_AUTHORITATIVE_DOMAINS.has(domain)) return true;
  return [...NAMED_AUTHORITATIVE_DOMAINS].some((d) => domain.endsWith(`.${d}`));
}

function isAuthoritativeTld(domain: string): boolean {
  return AUTHORITATIVE_TLDS.some((tld) => domain.endsWith(tld));
}

/**
 * Classify ONE source's authority. This is the single source of truth for
 * `SourceRef.authority`, callers should overwrite whatever value the LLM
 * proposed with this function's result rather than trusting the draft's own
 * claim (see `stampSourceAuthority` below for the whole-array helper).
 */
export function classifySourceAuthority(
  source: ClassifiableSource,
  tenantAllowlist?: readonly string[],
): SourceAuthority {
  const claim = (source.claim ?? "").trim();
  if (!claim) return "unverified"; // a bare URL with no claim counts as no source
  const domain = extractDomain(source);
  if (!domain) return "unverified"; // no resolvable domain, nothing to trust
  if (isAuthoritativeTld(domain)) return "authoritative";
  if (isNamedAuthoritative(domain)) return "authoritative";
  if (isTenantAllowlisted(domain, tenantAllowlist)) return "authoritative";
  return "weak";
}

/**
 * Re-stamp a whole sources array with the DETERMINISTIC authority for each
 * entry, discarding whatever the LLM proposed. Pure, returns a new array,
 * never mutates the input. Callers (structured-drafter.ts) run this on every
 * validated draft before it is persisted or handed to the quality gate, so
 * `authority` on a stored draft is always this module's verdict, never the
 * model's guess.
 */
export function stampSourceAuthority<T extends ClassifiableSource>(
  sources: readonly T[] | undefined,
  tenantAllowlist?: readonly string[],
): (T & { authority: SourceAuthority })[] {
  if (!sources || sources.length === 0) return [];
  return sources.map((s) => ({ ...s, authority: classifySourceAuthority(s, tenantAllowlist) }));
}

/** Common short function/stop words excluded from claim-token overlap so a
 *  trivial shared word ("with", "from") can never vacuously satisfy the
 *  "source actually backs THIS claim" check. */
const CLAIM_STOPWORDS = new Set([
  "with", "from", "this", "that", "have", "were", "will", "been", "when",
  "what", "they", "their", "about", "which", "would", "could", "there",
  "these", "those", "other", "into", "over", "such", "than", "then", "your",
  "some", "each", "also", "more", "most", "even", "many", "much", "still",
]);

/** Significant lowercase word tokens (4+ letters, stopwords dropped) used to
 *  check whether a source's `claim` actually overlaps the draft's own text -
 *  an authoritative-but-unrelated citation must never vacuously satisfy the
 *  gate. Pure string processing, no NLP dependency. */
export function claimTokens(text: string): string[] {
  const matches = (text ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return [...new Set(matches)].filter((t) => !CLAIM_STOPWORDS.has(t));
}

/**
 * True when at least one source in `sources` is (a) classified
 * "authoritative" by THIS module (never trusting a pre-stamped value) and
 * (b) its `claim` shares a real content token with `draftText`, an
 * authoritative source cited for an unrelated fact does not count. Zero
 * sources, or sources with no claim overlap, return false, the caller
 * (`draft-quality.ts`) turns that into a "missing_source" verdict for
 * factual drafts.
 */
export function hasQualifyingAuthoritativeSource(
  draftText: string,
  sources: readonly ClassifiableSource[] | undefined,
  tenantAllowlist?: readonly string[],
): boolean {
  if (!sources || sources.length === 0) return false;
  const draftTokens = claimTokens(draftText);
  if (draftTokens.length === 0) return false;
  return sources.some((s) => {
    if (classifySourceAuthority(s, tenantAllowlist) !== "authoritative") return false;
    const sTokens = claimTokens(s.claim ?? "");
    return sTokens.some((t) => draftTokens.includes(t));
  });
}
