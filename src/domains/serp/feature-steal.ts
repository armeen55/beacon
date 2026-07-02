/**
 * feature-steal (2026-07-02, BEACON_500 item 25) - PURE detector over the
 * append-only dataforseo_serp_history rows (see dataforseo-serp.ts / serp-history.ts):
 * for every tracked query where the tenant ranks 2-8 organically, does someone else
 * hold stealable real estate (the featured snippet, or a People Also Ask answer) -
 * and is that owner actually beatable?
 *
 * The distinct, named gap this surfaces: a rank-2-8 page is close enough that the
 * missing piece is not "rank higher" but "take the answer box a small blog already
 * owns." Rank 1 pages already own everything worth owning; rank 9+ pages have a
 * bigger problem than a snippet. No I/O, no server-only - the caller passes the
 * already-read history rows.
 *
 * HONESTY: an owner is only called "weak" when its domain is NOT on the major-
 * authority list below (Wikipedia, Britannica, major news, .gov). Those stay
 * honestly marked "strong" / hard to beat - Beacon never tells the operator a
 * Wikipedia snippet is an easy steal.
 */

import { rootDomain } from "./serp-provider";
import type { ParsedFeaturedSnippet, ParsedPaaQuestion } from "./dataforseo-serp";

/** One history row's feature-steal-relevant fields, as read from
 *  dataforseo_serp_history (own_rank already resolved by the writer). */
export type FeatureStealHistoryRow = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  snippetOwner: ParsedFeaturedSnippet | null;
  paaQuestions: ParsedPaaQuestion[];
};

export type StealFeature = "snippet" | "paa";
export type OwnerStrength = "weak" | "strong";

export type FeatureStealCandidate = {
  query: string;
  capturedAt: string;
  ownRank: number;
  feature: StealFeature;
  ownerDomain: string;
  ownerStrength: OwnerStrength;
  format: "paragraph" | "list" | "table" | null;
  /** First-person, dash-clean operator sentence with the concrete facts. */
  sentence: string;
};

/** Domains strong enough that Beacon marks a steal honestly "hard", never an easy
 *  win: encyclopedic, major-news, and government authority sites. Mirrors the
 *  shape (not the exact contents) of the noise/authority lists elsewhere in the
 *  repo (relevance-gate.ts's NOISE_DOMAINS, classify-type.ts's EDITORIAL_PATTERNS,
 *  pages/classify.ts's INSTITUTION_DOMAINS) - this list names STRONG owners, not
 *  noise, so it is kept separate and explicit rather than reused verbatim. */
const MAJOR_AUTHORITY_DOMAINS = [
  "wikipedia.org", "britannica.com", "wikihow.com",
  "nytimes.com", "wsj.com", "bbc.com", "bbc.co.uk", "cnn.com", "reuters.com",
  "forbes.com", "bloomberg.com", "washingtonpost.com", "theguardian.com",
  "usatoday.com", "npr.org", "apnews.com", "time.com",
  "gov", "edu", // suffix families, matched below without the leading dot
];

/** Query only ranks that qualify for a steal: close enough (2-8) that stealing
 *  the box is the missing piece, not "rank higher first". */
const MIN_QUALIFYING_RANK = 2;
const MAX_QUALIFYING_RANK = 8;

const FORMAT_PLAIN: Record<"paragraph" | "list" | "table", string> = {
  paragraph: "a paragraph",
  list: "a list",
  table: "a table",
};

/** Is this domain a major authority (wikipedia / britannica / major news / gov / edu)? */
export function isMajorAuthorityDomain(domain: string): boolean {
  const d = rootDomain(domain) || domain.trim().toLowerCase().replace(/^www\./, "");
  if (!d) return false;
  return MAJOR_AUTHORITY_DOMAINS.some((suffix) =>
    suffix.includes(".") ? d === suffix || d.endsWith(`.${suffix}`) : d.endsWith(`.${suffix}`),
  );
}

/** PURE: does this rank qualify as "close enough to steal" (2-8, inclusive)? */
export function qualifiesForSteal(ownRank: number | null): ownRank is number {
  return typeof ownRank === "number" && Number.isFinite(ownRank) && ownRank >= MIN_QUALIFYING_RANK && ownRank <= MAX_QUALIFYING_RANK;
}

function ownsFeature(ownerDomain: string, tenantDomain: string | null | undefined): boolean {
  const t = rootDomain((tenantDomain ?? "").trim());
  if (!t) return false;
  const d = ownerDomain.toLowerCase();
  return d === t || d.endsWith(`.${t}`);
}

function buildSnippetSentence(query: string, ownRank: number, ownerDomain: string, format: "paragraph" | "list" | "table", strength: OwnerStrength): string {
  const owner = strength === "weak" ? `a small blog (${ownerDomain})` : ownerDomain;
  const shape = FORMAT_PLAIN[format];
  if (strength === "weak") {
    return `The answer box on your #${ownRank} search "${query}" belongs to ${owner}. It answers in ${shape}; a tighter ${format} answer high on your page can take it.`;
  }
  return `The answer box on your #${ownRank} search "${query}" belongs to ${owner}, a strong site. It answers in ${shape}; this one is a hard steal.`;
}

function buildPaaSentence(query: string, ownRank: number, ownerDomain: string, strength: OwnerStrength): string {
  const owner = strength === "weak" ? `a small blog (${ownerDomain})` : ownerDomain;
  if (strength === "weak") {
    return `A People Also Ask question on your #${ownRank} search "${query}" is answered by ${owner}. A direct answer on your page can take it.`;
  }
  return `A People Also Ask question on your #${ownRank} search "${query}" is answered by ${owner}, a strong site. This one is a hard steal.`;
}

/**
 * PURE: reduce one query's most recent history row into its steal candidates
 * (snippet and/or PAA), or [] when the rank does not qualify, the tenant already
 * owns the feature, or nothing stealable rendered. Never fabricates - a query
 * with no snippet/PAA observed yields no candidate for that feature.
 */
export function computeFeatureSteal(row: FeatureStealHistoryRow, tenantDomain: string | null | undefined): FeatureStealCandidate[] {
  if (!qualifiesForSteal(row.ownRank)) return [];
  const ownRank = row.ownRank;
  const out: FeatureStealCandidate[] = [];

  if (row.snippetOwner && !ownsFeature(row.snippetOwner.ownerDomain, tenantDomain)) {
    const strength: OwnerStrength = isMajorAuthorityDomain(row.snippetOwner.ownerDomain) ? "strong" : "weak";
    out.push({
      query: row.query,
      capturedAt: row.capturedAt,
      ownRank,
      feature: "snippet",
      ownerDomain: row.snippetOwner.ownerDomain,
      ownerStrength: strength,
      format: row.snippetOwner.format,
      sentence: buildSnippetSentence(row.query, ownRank, row.snippetOwner.ownerDomain, row.snippetOwner.format, strength),
    });
  }

  const paaWithAnswer = row.paaQuestions.find((q) => q.answerDomain && !ownsFeature(q.answerDomain, tenantDomain));
  if (paaWithAnswer && paaWithAnswer.answerDomain) {
    const strength: OwnerStrength = isMajorAuthorityDomain(paaWithAnswer.answerDomain) ? "strong" : "weak";
    out.push({
      query: row.query,
      capturedAt: row.capturedAt,
      ownRank,
      feature: "paa",
      ownerDomain: paaWithAnswer.answerDomain,
      ownerStrength: strength,
      format: null,
      sentence: buildPaaSentence(row.query, ownRank, paaWithAnswer.answerDomain, strength),
    });
  }

  return out;
}

/**
 * PURE: steal candidates across every query in the input, one candidate set per
 * query taken from its MOST RECENT capture (never mixing feature owners across
 * different days). Weak-owner candidates sort first (the actionable ones), then
 * by rank ascending (closer wins first).
 */
export function computeFeatureSteals(
  rows: FeatureStealHistoryRow[],
  tenantDomain: string | null | undefined,
): FeatureStealCandidate[] {
  const byQuery = new Map<string, FeatureStealHistoryRow[]>();
  for (const r of rows) {
    const list = byQuery.get(r.query) ?? [];
    list.push(r);
    byQuery.set(r.query, list);
  }
  const out: FeatureStealCandidate[] = [];
  for (const list of byQuery.values()) {
    const latest = [...list].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)).at(-1);
    if (!latest) continue;
    out.push(...computeFeatureSteal(latest, tenantDomain));
  }
  return out.sort((a, b) => {
    if (a.ownerStrength !== b.ownerStrength) return a.ownerStrength === "weak" ? -1 : 1;
    if (a.ownRank !== b.ownRank) return a.ownRank - b.ownRank;
    return a.query.localeCompare(b.query);
  });
}

/** Only the weak-owner candidates - the ones Beacon can honestly queue as a move. */
export function weakOwnerSteals(candidates: FeatureStealCandidate[]): FeatureStealCandidate[] {
  return candidates.filter((c) => c.ownerStrength === "weak");
}

/** At most this many feature-steal hints reach the plan builder per night -
 *  the same bounded-hint precedent as trend-radar/spike-hints.ts and
 *  seasonal/seasonal-hints.ts, composing beside them without flooding the plan. */
export const MAX_FEATURE_STEAL_HINTS_PER_NIGHT = 2;

/** The note attached to a daily candidate whose target query has a weak-owner
 *  feature-steal candidate. Carries the format so the answer-block drafter can
 *  match it (paragraph vs list vs table). */
export type FeatureStealHintNote = {
  query: string;
  feature: StealFeature;
  ownerDomain: string;
  format: "paragraph" | "list" | "table" | null;
  sentence: string;
};

/**
 * Weak-owner steal candidates -> Map<normalized query, FeatureStealHintNote>,
 * bounded. Candidates arrive pre-sorted (weak-owner + closer rank first, see
 * computeFeatureSteals), so the bound keeps the sharpest ones. One hint per
 * query (first wins) - strong-owner (hard) candidates never become a hint here,
 * they stay informational only.
 */
export function buildFeatureStealHintNotes(
  candidates: FeatureStealCandidate[],
  limit: number = MAX_FEATURE_STEAL_HINTS_PER_NIGHT,
): Map<string, FeatureStealHintNote> {
  const out = new Map<string, FeatureStealHintNote>();
  for (const c of weakOwnerSteals(candidates)) {
    if (out.size >= limit) break;
    const key = c.query.trim().toLowerCase();
    if (!key || out.has(key)) continue;
    out.set(key, { query: c.query, feature: c.feature, ownerDomain: c.ownerDomain, format: c.format, sentence: c.sentence });
  }
  return out;
}
