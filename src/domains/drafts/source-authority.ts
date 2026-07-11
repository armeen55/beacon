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
  groundedNumberSet,
  findSuperlatives,
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
  /** W5 stop-ship F2 (2026-07-09), the exact excerpt (a sentence or adjacent
   *  pair) on the fetched page that entailed this claim - already carried on
   *  the real SourceRef (schemas.ts), so no migration. trust-230 (Codex P1)
   *  uses it as the PREFERRED evidence text for per-claim coverage: what the
   *  fetch actually confirmed, falling back to `claim` only when no excerpt was
   *  persisted (a pre-F2 draft). */
  supportingExcerpt?: string | null;
  /** Drafter last-mile G5 (2026-07-10): the cited domain is authority-strong but
   *  the fetch was refused (403/robots-block), so the claim could not be read +
   *  confirmed. `authority` stays authoritative, `verified` stays false, and the
   *  gate holds the draft as `needs_source_check` rather than `missing_source`. */
  fetchBlocked?: boolean;
  /** Drafter last-mile G6 (2026-07-10): the FULL fetched page text, present ONLY
   *  at generation time (a caller that just fetched this source). When set, the
   *  per-claim coverage check runs findSupportingSpan against this whole page
   *  (fresh spans per draft sentence), so ONE qualifying source page (e.g. a
   *  Wikipedia list) can back MANY sentences of a roundup - not just the single
   *  stamped `supportingExcerpt`. TRANSIENT: not part of SourceRefSchema, never
   *  persisted (the render/eval path keeps using the ~400-char excerpt). Absent
   *  = coverage falls back to supportingExcerpt / claim, byte-identical to before. */
  fetchedText?: string | null;
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
 * Re-audit P2 fix (2026-07-10): normalizes Arabic-Indic (٠-٩, U+0660-0669) and
 * Extended Arabic-Indic / Persian (۰-۹, U+06F0-06F9) digits to their ASCII
 * value - the SAME numeral ranges draft-quality.ts's GENERIC_NUMBER regex
 * already treats as "this is a number". Everything else passes through
 * unchanged (including ASCII digits, which map to themselves).
 */
function normalizeUnicodeDigits(text: string): string {
  return (text ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });
}

/**
 * Re-audit P2 fix (2026-07-10): LOCAL widening of "what counts as a number"
 * for THIS module's protected-sentence + per-span coverage checks only.
 * `draftNumbers` (factual-entailment.ts) stays exactly as-is - ASCII \d-only
 * - for its existing callers (checkFactualEntailment's invented-number
 * firewall keeps its current behavior byte-for-byte, no test there changes).
 * A factual claim written with Persian/Arabic-Indic numerals (e.g. "ایران
 * ۳۰۰۰ گونه دارد") was previously invisible to `sentenceIsProtected` (its
 * only number check was `draftNumbers`'s ASCII \d+), so the sentence carried
 * zero protected tokens and fell into the weaker zero-protected branch below
 * that never checks a number against any source excerpt - a real trust hole
 * for Persian-content tenants. This helper normalizes the digits first, then
 * delegates to `draftNumbers` unchanged (same thousands-stripping, same
 * length>=2 filter), so a Persian-numeral claim is recognized as carrying a
 * checkable number exactly like an ASCII-digit claim: it becomes PROTECTED
 * and its number is actually matched, span-by-span, against a qualifying
 * source's excerpt - not waved through. Because normalization happens before
 * comparison, a Persian-numeral YEAR still lands in the ASCII `structural`
 * set (groundedNumberSet) exactly like an ASCII-digit year would, so the
 * structural-number exclusion (year +/-1, the 7/14/28 proof window) is
 * unchanged in behavior, only in what digits it can now see.
 */
function sentenceNumbers(text: string): string[] {
  return draftNumbers(normalizeUnicodeDigits(text));
}

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
 *   - every protected number in the claim (sentenceNumbers - draftNumbers,
 *     thousands-normalized, plus Persian/Arabic-Indic digit recognition, see
 *     `sentenceNumbers` above) is present, AND
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

  const protectedNumbers = sentenceNumbers(claimText);
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
    const spanNums = new Set(sentenceNumbers(span));
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

/** Negation cues counted symmetrically in a claim sentence and in the span a
 *  source offers to back it. Same list the coverage guard below uses. */
const NEGATION_CUE =
  /\b(?:not|no|never|none|without|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|nor|neither)\b/gi;

/**
 * NEGATION-PARITY (trust-230, Codex P1). Parity (0 = affirmative, 1 = negated)
 * of the negation cues in a fragment. A protected claim and the span that
 * supposedly backs it must AGREE here: an affirmative source can never cover a
 * negated claim (and vice versa), even when every entity, number, and content
 * token lines up. Even counts fold back to affirmative (a double negative), so
 * "it is not uncommon" reads affirmative, matching how the words scan.
 */
function negationParity(text: string): number {
  return ((text ?? "").match(NEGATION_CUE) ?? []).length % 2;
}

/**
 * A sentence is PROTECTED (it makes a checkable claim that needs a source) when
 * it carries a non-structural number, a named entity, or a superlative. A
 * framing sentence with none of those asserts nothing verifiable and needs no
 * source. `structural` is groundedNumberSet("", nowYear) - the year window and
 * the 7/14/28 proof-window constants, which are methodology, not claims. The
 * number check uses `sentenceNumbers` (re-audit P2 fix), so a Persian/Arabic-
 * Indic numeral protects a sentence exactly like an ASCII digit does.
 */
function sentenceIsProtected(sentence: string, structural: Set<string>): boolean {
  if (sentenceNumbers(sentence).some((n) => !structural.has(n))) return true;
  if (extractCapitalizedSpans(sentence).length > 0) return true;
  if (findSuperlatives(sentence).length > 0) return true;
  return false;
}

/** The verdict of the per-claim coverage check: whether every checkable claim
 *  in a draft is backed by a verified authoritative source, which claims are
 *  still unproven, and the receipts (claim + source + backing excerpt) for the
 *  ones that ARE proven. */
export type FactCoverageResult = {
  covered: boolean;
  /** Up to 5 protected sentences no qualifying source could back. */
  uncovered: string[];
  /** One row per PROVEN protected claim: the claim, the source it was proven
   *  against, and the exact excerpt on that source that entailed it. */
  receipts: { claim: string; sourceUrl: string; excerpt: string }[];
};

/**
 * trust-230 (Codex P1), the fix for the vacuous single-token bug. The old
 * check passed a factual draft the moment ANY authoritative + verified source
 * shared ONE content token with the draft, so a generic topic word ("Iran")
 * satisfied it while the draft's actual claims went unbacked. This replaces
 * that with real, per-claim coverage, reusing `findSupportingSpan` SYMMETRICALLY
 * (draft sentence as the claim, the source's evidence as the page text):
 *
 *   (a) QUALIFYING SOURCES are authoritative (re-derived here, never the LLM's
 *       guess) AND generation-time verified. Each contributes its
 *       `supportingExcerpt` (what the fetch actually confirmed) or, absent one,
 *       its `claim`. Zero qualifying sources => nothing can be backed.
 *   (b) The draft is split into sentences; only PROTECTED sentences (a
 *       non-structural number, a named entity, or a superlative) need a source.
 *   (c) A protected sentence is COVERED when some qualifying source's evidence
 *       yields findSupportingSpan(sentence, evidence).supported AND the two
 *       agree in negation parity (an affirmative source cannot back a negated
 *       claim). The first match wins and is recorded as a receipt.
 *   (d) covered = EVERY protected sentence covered. A factual draft with NO
 *       isolable protected sentence (e.g. a lowercase definitional assertion)
 *       is covered only when >= 1 qualifying source exists - never vacuously,
 *       since the caller already established the draft is factual.
 *
 * PURE, no I/O, no LLM. Tenant-agnostic: no vertical vocabulary, callers thread
 * in the tenant's own allowlist.
 */
export function draftFactsCoveredBySources(
  draftText: string,
  sources: readonly ClassifiableSource[] | undefined,
  tenantAllowlist?: readonly string[],
  nowYear: number = new Date().getFullYear(),
): FactCoverageResult {
  const text = (draftText ?? "").trim();
  const structural = groundedNumberSet("", nowYear); // year window + 7/14/28
  const protectedSentences = text
    ? text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => sentenceIsProtected(s, structural))
    : [];

  const qualifying = (sources ?? []).filter(
    (s) => classifySourceAuthority(s, tenantAllowlist) === "authoritative" && s.verified === true,
  );

  // No individually-isolable protected sentence. This function is only reached
  // (via hasQualifyingAuthoritativeSource) once the CALLER already established
  // the draft is factual (isFactualClaim / SPECIFIC_FACT), so a factual claim
  // with nothing to pin per sentence (e.g. a lowercase definitional assertion)
  // must STILL be backed by at least one qualifying authoritative source - never
  // waved through vacuously. A TRULY claim-free draft never reaches here (its
  // caller's isFactualClaim is false), so it stays exempt at the call site, not
  // here.
  if (protectedSentences.length === 0) {
    if (qualifying.length === 0) return { covered: false, uncovered: [], receipts: [] };
    const backer = qualifying[0]!;
    return {
      covered: true,
      uncovered: [],
      receipts: [
        {
          claim: text,
          sourceUrl: (backer.url ?? backer.domain ?? "").trim(),
          excerpt: (backer.supportingExcerpt ?? backer.claim ?? "").trim().slice(0, EXCERPT_MAX_CHARS),
        },
      ],
    };
  }

  // No qualifying source -> every protected claim is unproven.
  if (qualifying.length === 0) {
    return { covered: false, uncovered: protectedSentences.slice(0, 5), receipts: [] };
  }

  const receipts: FactCoverageResult["receipts"] = [];
  const uncovered: string[] = [];
  for (const sentence of protectedSentences) {
    let matched = false;
    for (const s of qualifying) {
      // G6 (2026-07-10): prefer the FULL fetched page text when a caller supplied
      // it (generation time), so one qualifying source page can back MANY
      // sentences of a roundup - a 10-name list is structurally impossible to
      // cover from a single ~400-char stamped excerpt. Falls back to the persisted
      // excerpt (render/eval path), then the bare claim (pre-F2 draft).
      const evidence = (s.fetchedText ?? s.supportingExcerpt ?? s.claim ?? "").trim();
      if (!evidence) continue; // an authoritative + verified source with no text backs nothing
      const span = findSupportingSpan(sentence, evidence, nowYear);
      if (!span.supported || span.excerpt == null) continue;
      // An affirmative source can never cover a negated claim (and vice versa).
      if (negationParity(sentence) !== negationParity(span.excerpt)) continue;
      receipts.push({
        claim: sentence,
        sourceUrl: (s.url ?? s.domain ?? "").trim(),
        excerpt: span.excerpt,
      });
      matched = true;
      break;
    }
    if (!matched) uncovered.push(sentence);
  }

  return { covered: uncovered.length === 0, uncovered: uncovered.slice(0, 5), receipts };
}

/**
 * Boolean wrapper over `draftFactsCoveredBySources` (kept as the name the
 * draft-quality gate already calls). True only when EVERY protected claim in
 * `draftText` is backed by an authoritative + generation-time-verified source
 * whose excerpt actually entails it. Zero sources, unverified/weak sources, or
 * a source that backs only some claims all return false, the caller
 * (`draft-quality.ts`) turns that into a "missing_source" verdict for factual
 * drafts (and a persisted pre-P0-1 draft, whose sources default to
 * verified=false, honestly reads "Needs a source" until regenerated).
 */
export function hasQualifyingAuthoritativeSource(
  draftText: string,
  sources: readonly ClassifiableSource[] | undefined,
  tenantAllowlist?: readonly string[],
  nowYear?: number,
): boolean {
  return draftFactsCoveredBySources(draftText, sources, tenantAllowlist, nowYear).covered;
}

/**
 * Drafter last-mile G6 (2026-07-10): does ONE authoritative page's FULL TEXT
 * entail the draft's own claims? Used at GENERATION time by the drafter's
 * source-verification step to decide whether a fetchable authoritative page whose
 * model-written META-claim did not span-match should STILL verify. A roundup list
 * page ("List of Iranian singers") backs its many names through the PAGE, not
 * through the one-line claim the model attached to the citation; requiring the
 * meta-claim to span-match wrongly forced such a page to `weak`.
 *
 * The bar is the SAME per-sentence + negation-parity discipline as
 * draftFactsCoveredBySources (never looser): a protected draft sentence counts
 * only when the page yields findSupportingSpan(sentence, pageText).supported AND
 * the two agree in negation parity. `entails` is true when at least one protected
 * sentence is covered (this page genuinely backs part of the draft; the full
 * every-sentence arbitration still happens in draftFactsCoveredBySources). Returns
 * the first covering span so a verified roundup source still carries a persistable
 * ~400-char receipt for the fetchedText-stripped render path. PURE, no I/O.
 */
export function pageEntailsDraftClaims(
  draftText: string,
  pageText: string,
  nowYear: number = new Date().getFullYear(),
): { entails: boolean; excerpt: string | null; contentHash: string | null } {
  const text = (draftText ?? "").trim();
  const page = (pageText ?? "").trim();
  if (!text || !page) return { entails: false, excerpt: null, contentHash: null };
  const structural = groundedNumberSet("", nowYear);
  const protectedSentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => sentenceIsProtected(s, structural));
  if (protectedSentences.length === 0) return { entails: false, excerpt: null, contentHash: null };
  let first: { excerpt: string; contentHash: string } | null = null;
  for (const sentence of protectedSentences) {
    const span = findSupportingSpan(sentence, page, nowYear);
    if (!span.supported || span.excerpt == null) continue;
    if (negationParity(sentence) !== negationParity(span.excerpt)) continue;
    if (!first) first = { excerpt: span.excerpt, contentHash: span.contentHash ?? "" };
  }
  return { entails: first != null, excerpt: first?.excerpt ?? null, contentHash: first?.contentHash ?? null };
}

/**
 * Drafter last-mile G4 (2026-07-10): the MARKETING-superlative net (bare
 * promotional ranking words) the structured drafter's content firewall uses,
 * lifted here so the drafter and the coverage check agree on what counts as a
 * superlative. Disjoint-by-design from factual-entailment's `findSuperlatives`
 * (which catches "the largest/first/only ..." and "most \w+"): this one adds
 * the bare puffery ("leading", "best-known", "premier", "world-class") that has
 * no leading article. The union of the two is the full set of claims that need
 * a superlative-asserting source.
 */
const MARKETING_SUPERLATIVE =
  /\b(?:best|leading|number one|top-rated|guaranteed|world-class|world class|ultimate|premier|best-known|best known|renowned|foremost|preeminent|unrivalled|unrivaled|unparalleled)\b|#1/gi;

/**
 * G4: every superlative phrase in `text` - the union of the ranking net
 * (factual-entailment.findSuperlatives: "the largest", "most famous", ...) and
 * the marketing net (MARKETING_SUPERLATIVE: "leading", "best-known", ...). Pure,
 * deterministic, lowercased + deduped. Empty = the text asserts no superlative.
 */
export function findAllSuperlatives(text: string): string[] {
  const out = new Set<string>(findSuperlatives(text));
  for (const m of (text ?? "").matchAll(MARKETING_SUPERLATIVE)) out.add(m[0].toLowerCase());
  return [...out];
}

/**
 * Drafter last-mile G4 (2026-07-10): SUPERLATIVE-PARITY coverage. A superlative
 * is the highest-risk unsupported claim, so the firewall must NOT ship one the
 * evidence does not prove - AND it must not blanket-reject a superlative-intent
 * topic ("most famous iranian singers") whose answer legitimately ranks.
 *
 * This is the deterministic middle: a superlative sentence is GROUNDED only when
 * some QUALIFYING source (authoritative - re-derived here, never the LLM's guess
 * - AND generation-time verified) offers a supporting span that ITSELF asserts a
 * superlative (superlative-parity, mirroring the negation-parity guard). A source
 * that merely mentions the entity, or backs the sentence's non-superlative facts
 * without asserting the ranking, does NOT ground the superlative.
 *
 * Returns every superlative phrase from a superlative-bearing draft sentence that
 * no qualifying source asserts. Empty = every superlative in the draft is source-
 * asserted (or the draft has none). The drafter uses a non-empty result to
 * trigger ONE rephrase retry, then fails closed - an ungrounded superlative never
 * ships. PURE, no I/O; callers thread the tenant's own allowlist.
 */
export function ungroundedSuperlatives(
  draftText: string,
  sources: readonly ClassifiableSource[] | undefined,
  tenantAllowlist?: readonly string[],
  nowYear: number = new Date().getFullYear(),
): string[] {
  const text = (draftText ?? "").trim();
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => findAllSuperlatives(s).length > 0);
  if (sentences.length === 0) return [];

  const qualifying = (sources ?? []).filter(
    (s) => classifySourceAuthority(s, tenantAllowlist) === "authoritative" && s.verified === true,
  );

  const ungrounded = new Set<string>();
  for (const sentence of sentences) {
    let asserted = false;
    for (const s of qualifying) {
      const evidence = (s.fetchedText ?? s.supportingExcerpt ?? s.claim ?? "").trim();
      if (!evidence) continue;
      const span = findSupportingSpan(sentence, evidence, nowYear);
      if (!span.supported || span.excerpt == null) continue;
      // Superlative-parity: the backing span must ITSELF carry a superlative, not
      // merely ground the sentence's entities/facts.
      if (findAllSuperlatives(span.excerpt).length === 0) continue;
      asserted = true;
      break;
    }
    if (!asserted) for (const phrase of findAllSuperlatives(sentence)) ungrounded.add(phrase);
  }
  return [...ungrounded];
}

/** Distinct entity keys across `fragments`, each fragment scanned SEPARATELY -
 *  extractCapitalizedSpans's own multi-word-run behavior (treating "Mohammad-
 *  Reza Shajarian" as ONE entity) is exactly right WITHIN one fragment, but
 *  joining several entities' names into a single blob first (no punctuation
 *  between them) would let the same greedy run merge two different people
 *  into one span, or chop a long list into arbitrary 4-word groups - neither
 *  is a real entity count. Scanning each evidence fragment (a query, a brief,
 *  one outline bullet, one FAQ, one evidence hint) on its own avoids that. A
 *  trailing possessive is folded so "Iran" and "Iran's" count as ONE entity,
 *  not two. */
function distinctEntityCount(fragments: readonly string[]): number {
  const entities = new Set<string>();
  for (const f of fragments) {
    for (const span of extractCapitalizedSpans(f ?? "")) {
      entities.add(span.toLowerCase().replace(/'s$/, ""));
    }
  }
  return entities.size;
}

/**
 * Pilot loop 4 (2026-07-10): true when `fragments` (the drafter's own evidence
 * fields - query, brief, outline entries, FAQs, evidence hints - each passed
 * SEPARATELY, never pre-joined) name THREE OR MORE distinct entities - a
 * "most famous X" / "top N" roundup, where each entity's own per-claim facts
 * need that entity's OWN reference page, never a shared bare list/index page
 * (see ENTITY_REFERENCE_INSTRUCTION in structured-drafter.ts, the caller).
 * Reuses the SAME entity extraction the entailment/coverage gates already use
 * (extractCapitalizedSpans) so "entity" here means exactly what those gates
 * already treat as a named-entity claim, never a separate heuristic that
 * could disagree with them. A single-fact topic (0-2 named entities, e.g.
 * "the national animal of Iran") returns false, so the per-entity citation
 * guidance stays scoped to genuine roundups. PURE, no I/O.
 */
export function isEntityRichTopic(fragments: readonly string[], minEntities = 3): boolean {
  return distinctEntityCount(fragments) >= minEntities;
}

/** URL path shapes that are a bare list/index rather than one entity's own
 *  page - Wikipedia-style "List_of_..." / "Lists_of_...", a "/list/" or
 *  "/lists/" segment, or a directory index (a bare "/index", "/index.html",
 *  trailing slash with no further path). Deliberately generic (path-shaped,
 *  not Wikipedia-specific) so any encyclopedia/reference site's own list page
 *  is caught the same way. */
const LIST_OR_INDEX_URL_PATTERN =
  /(?:^|[/_-])lists?[_-]?of[_-]|\/lists?(?:[/?#]|$)|\/index(?:\.\w+)?(?:[/?#]|$)/i;

/**
 * Pilot loop 4 (2026-07-10): true when `url` looks like a bare list/index
 * page rather than one entity's own reference page - the exact proven gap
 * from the pilot re-run (the model cited Wikipedia's List_of_Iranian_singers,
 * which names every singer but discusses none of their honors/songs, so it
 * cannot entail a per-singer claim; that singer's OWN Wikipedia article
 * could). Used to filter "sources you may cite" candidates BEFORE they ever
 * reach the prompt - never to police what the model actually cites (the
 * existing generation-time source verification + per-claim coverage gate
 * still decide that, unchanged). A malformed/empty URL is not a list/index
 * page (nothing to flag). PURE, no I/O.
 */
export function looksLikeListOrIndexUrl(url: string): boolean {
  const u = (url ?? "").trim();
  if (!u) return false;
  let path = u;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
    path = new URL(withScheme).pathname;
  } catch {
    // Keep the raw string - a malformed URL still gets a best-effort path scan.
  }
  return LIST_OR_INDEX_URL_PATTERN.test(path);
}
