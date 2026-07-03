/**
 * AEO defense pack (BEACON 500 P8, 2026-07-03) - PURE detection logic.
 *
 * All three detectors are pure functions over already-projected rows (the
 * Supabase reads live in load-defense-signals.ts). Kept here so the math is
 * unit-testable on fixtures with no I/O, and so a real 2-capture citation-row
 * fixture can drive the defend-a-cited-query history delta directly.
 *
 * Deterministic, cost-free, empty-safe: every detector returns [] when its
 * pattern is absent, and never fires on thin data.
 */

import type {
  BrandDescriptionMismatch,
  DefendCitedQuery,
  ZeroSourceOpening,
} from "./defense-types";

// ---------------------------------------------------------------------------
// Shared helpers (pure)
// ---------------------------------------------------------------------------

/** Strip "www." + lower-case + trim, the convention every Profound reader in
 *  this codebase uses. Pure. */
export function stripWww(host: string): string {
  return (host ?? "").trim().toLowerCase().replace(/^www\./, "");
}

/** Reference/aggregator platforms that are NOT a displaceable competitor
 *  "locking in" a query - AI citing Wikipedia or Reddit is not a rival taking
 *  the slot. Vertical-agnostic, so safe for every tenant (English-first). */
const REFERENCE_PLATFORMS: ReadonlySet<string> = new Set([
  "wikipedia.org",
  "en.wikipedia.org",
  "reddit.com",
  "youtube.com",
  "quora.com",
  "medium.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "pinterest.com",
  "tripadvisor.com",
  "britannica.com",
]);

export function isReferencePlatform(domain: string): boolean {
  const d = stripWww(domain);
  return REFERENCE_PLATFORMS.has(d);
}

/** A category_id is a UUID-shaped opaque key; never safe to show a customer.
 *  Pure guard so callers can decide whether a resolved label is human-safe. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function isUuidShaped(s: string): boolean {
  return UUID_RE.test(s);
}

// ---------------------------------------------------------------------------
// 1. Zero-source opening
// ---------------------------------------------------------------------------

/** One topic rolled up from `profound_citation_rows`: the observed answers,
 *  the model breadth, and each cited domain's total citation weight. */
export type TopicCitationRollup = {
  categoryId: string;
  /** Best human topic label the loader could resolve (never a UUID). Null when
   *  none is available - the topic is then skipped (no UUID in copy). */
  topicLabel: string | null;
  /** Max observed answers across the topic (executions/answer volume proxy;
   *  the citation stream carries a per-topic answer count). */
  observedAnswers: number;
  modelCount: number;
  /** domain -> total citation_count summed across the window. */
  citationsByDomain: ReadonlyMap<string, number>;
};

export type ZeroSourceParams = {
  /** Enough observed answers that "no confident source" is signal, not thin
   *  data. */
  minObservedAnswers?: number;
  /** The strongest source must sit at or below this share of the topic's
   *  citations for the topic to count as a zero-source opening. */
  maxTopSourceShare?: number;
  /** Cap on how many openings feed the candidate builder per run. */
  maxCandidates?: number;
};

const ZERO_SOURCE_DEFAULTS: Required<ZeroSourceParams> = {
  minObservedAnswers: 10,
  maxTopSourceShare: 0.25,
  maxCandidates: 3,
};

/**
 * A tracked topic AI gets asked about where no one is confidently cited yet:
 * over >= minObservedAnswers observed answers, the strongest cited domain's
 * share of citations is <= maxTopSourceShare (or there are no citations at
 * all). Ranked by observed answers (biggest opening first). Empty when every
 * tracked topic already has a confident source, or on thin data.
 */
export function detectZeroSourceOpenings(
  rollups: ReadonlyArray<TopicCitationRollup>,
  params: ZeroSourceParams = {},
): ZeroSourceOpening[] {
  const p = { ...ZERO_SOURCE_DEFAULTS, ...params };
  const out: ZeroSourceOpening[] = [];

  for (const t of rollups) {
    if (t.observedAnswers < p.minObservedAnswers) continue;
    // A UUID category with no human label would leak into copy - skip it.
    if (!t.topicLabel || isUuidShaped(t.topicLabel)) continue;

    let total = 0;
    let topDomain: string | null = null;
    let topCount = 0;
    for (const [domain, count] of t.citationsByDomain) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topDomain = domain;
      }
    }
    const topShare = total > 0 ? topCount / total : 0;
    // The opening: nobody is confidently cited (no citations at all, or the
    // strongest source is still below the confidence floor).
    if (topShare > p.maxTopSourceShare) continue;

    out.push({
      categoryId: t.categoryId,
      topicLabel: t.topicLabel,
      observedAnswers: t.observedAnswers,
      modelCount: t.modelCount,
      topSourceShare: topShare,
      topSourceDomain: total > 0 ? topDomain : null,
    });
  }

  out.sort((a, b) => b.observedAnswers - a.observedAnswers);
  return out.slice(0, p.maxCandidates);
}

// ---------------------------------------------------------------------------
// 2. Defend a cited query (2-capture citation-row history delta)
// ---------------------------------------------------------------------------

/** One (topic, capture-date) slice of `profound_citation_rows`: per-domain
 *  citation weight for that day. Two of these (prior + latest) drive the
 *  delta. */
export type TopicCaptureSlice = {
  categoryId: string;
  topicLabel: string | null;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** domain -> citation_count on that date. */
  citationsByDomain: ReadonlyMap<string, number>;
};

export type DefendCitedParams = {
  /** A competitor must clear this citation floor in the latest capture to
   *  count as a real new entrant (guards a stray one-off). */
  minCompetitorCitations?: number;
  maxCandidates?: number;
};

const DEFEND_DEFAULTS: Required<DefendCitedParams> = {
  minCompetitorCitations: 1,
  maxCandidates: 3,
};

/**
 * For each topic, compare the PRIOR capture to the LATEST capture (the caller
 * supplies exactly two dated slices per topic - the two most recent distinct
 * capture dates). A defend-a-cited-query fires when, on a topic the tenant
 * used to own or co-own (own domain cited in the PRIOR capture), a competitor
 * domain that was NOT cited in the prior capture IS cited in the latest
 * capture (>= minCompetitorCitations), and that competitor is not the tenant's
 * own domain and not a reference/aggregator platform.
 *
 * Ranked by the newcomer's latest-capture citations (hardest-pressing first).
 * Empty when no new competitor citation, when the tenant never owned the
 * topic, or when there is no 2-capture history.
 */
export function detectDefendCitedQueries(
  slicesByTopic: ReadonlyMap<string, { prior: TopicCaptureSlice; latest: TopicCaptureSlice }>,
  ownDomains: ReadonlySet<string>,
  params: DefendCitedParams = {},
): DefendCitedQuery[] {
  const p = { ...DEFEND_DEFAULTS, ...params };
  const out: DefendCitedQuery[] = [];

  for (const { prior, latest } of slicesByTopic.values()) {
    const label = latest.topicLabel ?? prior.topicLabel;
    if (!label || isUuidShaped(label)) continue;

    // Did the tenant own/co-own this topic in the prior capture?
    let ownPrior = 0;
    for (const [domain, count] of prior.citationsByDomain) {
      if (ownDomains.has(stripWww(domain))) ownPrior += count;
    }
    if (ownPrior <= 0) continue;

    // A competitor domain cited now that was NOT cited before.
    let worst: { domain: string; citations: number } | null = null;
    for (const [rawDomain, count] of latest.citationsByDomain) {
      const domain = stripWww(rawDomain);
      if (ownDomains.has(domain)) continue;
      if (isReferencePlatform(domain)) continue;
      if (count < p.minCompetitorCitations) continue;
      const priorCount = prior.citationsByDomain.get(rawDomain) ?? prior.citationsByDomain.get(domain) ?? 0;
      if (priorCount > 0) continue; // not new - was already cited before
      if (worst == null || count > worst.citations) {
        worst = { domain, citations: count };
      }
    }
    if (worst == null) continue;

    out.push({
      categoryId: latest.categoryId,
      topicLabel: label,
      competitorDomain: worst.domain,
      competitorCitations: worst.citations,
      ownPriorCitations: ownPrior,
      priorCaptureDate: prior.date,
      latestCaptureDate: latest.date,
    });
  }

  out.sort((a, b) => b.competitorCitations - a.competitorCitations);
  return out.slice(0, p.maxCandidates);
}

// ---------------------------------------------------------------------------
// 3. Brand-description accuracy check
// ---------------------------------------------------------------------------

/** One persisted Profound answer that MENTIONS the tenant's brand, projected
 *  to the fields the accuracy check needs. */
export type BrandMentionAnswer = {
  /** Distinct model label, or null. */
  model: string | null;
  /** The AI answer text (from response_excerpt, ~500 chars). */
  excerpt: string;
};

/** The tenant's own known facts (from business-config) the AI descriptors are
 *  checked against. All lower-cased, de-duplicated by the loader. */
export type KnownBrandFacts = {
  /** e.g. "persian culture guide" / "custom home builder". Empty when unset. */
  industry: string;
  /** e.g. ["san francisco", "atherton"]. */
  locations: ReadonlyArray<string>;
  /** e.g. ["kitchen remodel", "restaurant guide"]. */
  services: ReadonlyArray<string>;
};

/**
 * A small, high-signal, VERTICAL-AGNOSTIC map of mutually-exclusive industry
 * families. If the tenant's own industry falls in one family and an AI answer
 * asserts the brand belongs to a DIFFERENT family, that is a deterministic
 * contradiction (a restaurant guide described as a hotel chain). Keys are
 * family labels; values are the tokens that place a phrase in that family.
 * Deliberately narrow: only fire on clearly-incompatible families, never on
 * near-synonyms. English-first; never tenant-hardcoded.
 */
const INDUSTRY_FAMILIES: ReadonlyArray<{ family: string; tokens: ReadonlyArray<string> }> = [
  { family: "restaurant", tokens: ["restaurant", "eatery", "diner", "cafe", "food truck"] },
  { family: "hotel", tokens: ["hotel", "resort", "motel", "hostel", "lodging"] },
  { family: "law_firm", tokens: ["law firm", "attorney", "lawyer", "legal services"] },
  { family: "medical_clinic", tokens: ["clinic", "hospital", "medical center", "dental practice"] },
  { family: "software", tokens: ["software company", "saas", "app developer", "software platform"] },
  { family: "retail_store", tokens: ["retail store", "boutique", "clothing store", "shop"] },
  { family: "construction", tokens: ["home builder", "construction company", "contractor", "remodeler"] },
  { family: "real_estate", tokens: ["real estate agency", "realtor", "brokerage"] },
];

function familyOf(text: string): string | null {
  const t = text.toLowerCase();
  for (const f of INDUSTRY_FAMILIES) {
    for (const tok of f.tokens) {
      if (t.includes(tok)) return f.family;
    }
  }
  return null;
}

/** First sentence-ish fragment of an excerpt, trimmed for a copy snippet.
 *  Never fabricated - a coarse honest read of the AI's own text. Pure. */
function firstSentence(excerpt: string, max = 160): string {
  const s = (excerpt ?? "").trim().replace(/\s+/g, " ");
  const m = s.match(/^.*?[.!?](\s|$)/);
  const frag = (m ? m[0] : s).trim();
  return frag.length > max ? frag.slice(0, max - 3).trimEnd() + "..." : frag;
}

export type BrandDescriptionParams = {
  maxCandidates?: number;
};

const BRAND_DESC_DEFAULTS: Required<BrandDescriptionParams> = {
  maxCandidates: 2,
};

/**
 * Compare AI-attributed descriptors (from persisted answers that mention the
 * brand) against the tenant's own known facts. Fires deterministically when:
 *
 *   - INDUSTRY: the AI text places the brand in a DIFFERENT mutually-exclusive
 *     industry family than the tenant's configured industry (and the tenant's
 *     own family is NOT also present in the text - a page may list both).
 *
 * (Location/service families are intentionally NOT auto-flagged in v1: a
 * mention of another city or service is usually additive context, not a
 * contradiction, so flagging them would be noisy. The type keeps room for
 * them; industry-family contradiction is the one high-precision case v1
 * ships.)
 *
 * Empty when there is no brand mention, no known industry to check against, or
 * no contradiction. Ranked by nothing beyond input order (single high-signal
 * case), capped at maxCandidates.
 */
export function detectBrandDescriptionMismatches(
  mentions: ReadonlyArray<BrandMentionAnswer>,
  facts: KnownBrandFacts,
  params: BrandDescriptionParams = {},
): BrandDescriptionMismatch[] {
  const p = { ...BRAND_DESC_DEFAULTS, ...params };
  const out: BrandDescriptionMismatch[] = [];
  if (mentions.length === 0) return out;

  const ownIndustry = facts.industry.trim().toLowerCase();
  const ownFamily = ownIndustry ? familyOf(ownIndustry) : null;
  if (!ownFamily) return out; // nothing precise to contradict against

  const seen = new Set<string>();
  for (const m of mentions) {
    if (out.length >= p.maxCandidates) break;
    const text = (m.excerpt ?? "").toLowerCase();
    if (!text) continue;

    const aiFamily = familyOf(text);
    if (!aiFamily || aiFamily === ownFamily) continue;
    // If the tenant's OWN family also appears in the same text, it is not a
    // clean contradiction (the answer may describe both) - skip.
    const ownFamilyTokens = INDUSTRY_FAMILIES.find((f) => f.family === ownFamily)?.tokens ?? [];
    if (ownFamilyTokens.some((tok) => text.includes(tok))) continue;

    // The specific descriptor phrase the AI used (the matched wrong-family
    // token), sourced verbatim from the answer.
    const wrongTokens = INDUSTRY_FAMILIES.find((f) => f.family === aiFamily)?.tokens ?? [];
    const aiDescriptor = wrongTokens.find((tok) => text.includes(tok)) ?? aiFamily;

    const dedupeKey = `${aiFamily}::${aiDescriptor}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      factKind: "industry",
      ownFact: facts.industry.trim(),
      aiDescriptor,
      evidenceExcerpt: firstSentence(m.excerpt),
      model: m.model,
    });
  }

  return out;
}
