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

import { createHash } from "node:crypto";
import {
  draftNumbers,
  extractCapitalizedSpans,
  entityGrounded,
} from "./factual-entailment";

export type SourceAuthority = "authoritative" | "weak" | "unverified";

/** The minimal shape this module needs from a SourceRef, accepts the real
 *  schemas.ts `SourceRef` or any object carrying at least these fields. */
export type ClassifiableSource = {
  url?: string | null;
  domain?: string | null;
  claim?: string | null;
  /** W5 P0-1 (2026-07-09), set at GENERATION time by structured-drafter.ts
   *  after actually fetching the URL and confirming the fetched text carries
   *  this claim's tokens. The gate below requires this true, so a hallucinated
   *  .gov/.edu URL (which the domain classifier alone would call
   *  "authoritative") is held until a real fetch confirms it. Absent/false on
   *  every pre-P0-1 persisted draft, which then honestly reads "Needs a
   *  source" until regenerated. */
  verified?: boolean;
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

/** Minimum share of a claim's central content tokens that must appear WITHIN
 *  one candidate span for that span to count as actually backing the claim. */
export const CLAIM_SPAN_MIN_COVERAGE = 0.6;
/** Max characters of a supporting excerpt persisted alongside a verified source. */
const EXCERPT_MAX_CHARS = 400;

export type SupportingSpan = {
  /** True when a single sentence / adjacent-sentence pair carries the claim. */
  supported: boolean;
  /** The trimmed excerpt (<= 400 chars) that backs the claim, or null. */
  excerpt: string | null;
  /** sha256(excerpt) first 16 hex chars - a stable content fingerprint, or null. */
  contentHash: string | null;
};

/**
 * W5 stop-ship F2 (2026-07-09), the SPAN-LEVEL claim verifier. Replaces the
 * old whole-page token-share check (`claimSupportedByText`), which passed when
 * a claim's words were merely SCATTERED across an unrelated page. Instead this
 * requires the claim to be entailed by ONE localized span - a single sentence
 * or an adjacent-sentence pair - so a genuine supporting passage is found and
 * a page that only happens to contain the same words in different places is
 * NOT accepted.
 *
 * A span qualifies iff, WITHIN that span:
 *   - every protected number in the claim (draftNumbers, thousands-normalized)
 *     is present, AND
 *   - every capitalized entity span in the claim (extractCapitalizedSpans) is
 *     grounded (entityGrounded), AND
 *   - at least CLAIM_SPAN_MIN_COVERAGE of the claim's central content tokens
 *     (claimTokens) appear.
 * The highest-coverage qualifying span wins (shortest on a tie); its trimmed
 * <=400-char excerpt and a sha256-16 content hash are returned so the caller
 * can persist exactly what backed the claim. PURE, no I/O, never throws.
 */
export function findSupportingSpan(
  claim: string,
  pageText: string,
  nowYear: number = new Date().getFullYear(),
): SupportingSpan {
  // `nowYear` keeps the number semantics aligned with groundedNumberSet / the
  // factual-entailment gate (year-adjacent + proof-window numbers), even though
  // the per-span number check below compares against the span's own literals.
  void nowYear;
  const claimText = (claim ?? "").trim();
  const text = (pageText ?? "").trim();
  if (!claimText || !text) return { supported: false, excerpt: null, contentHash: null };

  const protectedNumbers = draftNumbers(claimText);
  const entities = extractCapitalizedSpans(claimText);
  const central = claimTokens(claimText);
  // Nothing concrete to verify against -> cannot confirm support.
  if (protectedNumbers.length === 0 && entities.length === 0 && central.length === 0) {
    return { supported: false, excerpt: null, contentHash: null };
  }

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    candidates.push(sentences[i]!);
    if (i + 1 < sentences.length) candidates.push(`${sentences[i]} ${sentences[i + 1]}`);
  }

  let best: { span: string; coverage: number } | null = null;
  for (const span of candidates) {
    const spanNums = new Set(draftNumbers(span));
    if (!protectedNumbers.every((n) => spanNums.has(n))) continue;
    const spanLower = span.toLowerCase();
    if (!entities.every((e) => entityGrounded(e, spanLower))) continue;
    const spanTokens = new Set(claimTokens(span));
    const hits = central.filter((t) => spanTokens.has(t)).length;
    const coverage = central.length === 0 ? 1 : hits / central.length;
    if (coverage < CLAIM_SPAN_MIN_COVERAGE) continue;
    if (
      best == null ||
      coverage > best.coverage ||
      (coverage === best.coverage && span.length < best.span.length)
    ) {
      best = { span, coverage };
    }
  }

  if (best == null) return { supported: false, excerpt: null, contentHash: null };
  const excerpt = best.span.trim().slice(0, EXCERPT_MAX_CHARS);
  const contentHash = createHash("sha256").update(excerpt).digest("hex").slice(0, 16);
  return { supported: true, excerpt, contentHash };
}

/**
 * True when at least one source in `sources` is (a) classified
 * "authoritative" by THIS module (never trusting a pre-stamped value), (b)
 * GENERATION-TIME VERIFIED (`verified === true`, W5 P0-1, set only after
 * structured-drafter.ts fetched the URL and confirmed the page text carries
 * the claim - so a hallucinated .gov/.edu URL never passes on domain class
 * alone), and (c) its `claim` shares a real content token with `draftText`,
 * an authoritative source cited for an unrelated fact does not count. Zero
 * sources, unverified sources, or sources with no claim overlap all return
 * false, the caller (`draft-quality.ts`) turns that into a "missing_source"
 * verdict for factual drafts (and a persisted pre-P0-1 draft, whose sources
 * default to verified=false, honestly reads "Needs a source" until
 * regenerated).
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
    if (s.verified !== true) return false; // W5 P0-1: must be generation-time verified
    const sTokens = claimTokens(s.claim ?? "");
    return sTokens.some((t) => draftTokens.includes(t));
  });
}
