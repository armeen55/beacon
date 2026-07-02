/**
 * daily-evidence-brief (2026-07-01, assistant-first phase 2 slice E) - the "how we know" battlefield
 * for the daily card. PURE: assembles the keyword-research evidence (the page's top searches + their
 * cached DataForSEO demand), the live SERP reaction, and the competitor teardown into a compact,
 * render-ready brief. No I/O: the caller passes the cached demand map (readAllCachedKeywordDemand, a $0
 * reader), the cached SERP patterns, and the competitor teardown facts.
 *
 * HONESTY: DataForSEO exposes paid COMPETITION (low/medium/high), NOT a true keyword-difficulty score,
 * so the default surface is competitionLevel labeled "competition", never "difficulty".
 *
 * Item 18 (2026-07-02): when a create-page verdict run has ALREADY fetched bulk_keyword_difficulty for
 * this exact query (a real 0-100 Google difficulty score, cached, $0 to read again), the row upgrades to
 * that real number instead of the low/medium/high competition label. Still honest: a query with no cached
 * difficulty keeps the unchanged competition label, never a guessed score.
 */

/** One researched keyword row: the term, its cached monthly volume, and paid-competition level. */
export type EvidenceKeyword = {
  term: string;
  /** Avg monthly searches from DataForSEO's cache, or null when there is no cached data. */
  volume: number | null;
  /** Paid-competition level (NOT keyword difficulty), or null. */
  competition: "low" | "medium" | "high" | null;
  /** Item 18: real 0-100 Google keyword-difficulty score when a verdict run already cached one for this
   *  exact query, else null (falls back to the competition label above). */
  difficulty: number | null;
};

/** The live Google top-10 reaction for the page's search: what shape of page wins + who holds it. */
export type EvidenceSerp = {
  /** The query this SERP read is for. */
  query: string;
  /** The winning content shape (list / guide / faq / table / product / ugc / mixed). */
  format: string;
  /** The top domains Google is rewarding (best-first, capped). */
  winningDomains: string[];
  /** The on-page move the winning shape implies (e.g. "lead with a direct answer"). */
  whatToDo: string;
  /**
   * Item 17: the literal observed movement of the tenant's own Google position for
   * this search, e.g. "You moved 9 to 6 on Google for this search since Jun 20."
   * Absent until the append-only SERP history holds two observed positions - honest
   * silence, never inferred.
   */
  rankMovement?: string;
};

/** The top competitor page beating this page, and the specific thing to steal from it. */
export type EvidenceCompetitor = {
  domain: string;
  url: string;
  /** Friendly, actionable "steal this" line derived from the competitor's page structure. */
  whatToSteal: string;
};

export type DailyEvidenceBrief = {
  /** The page's top searches with whatever cached demand we have (best-first). */
  keywords: EvidenceKeyword[];
  /** Sum of known volumes across the shown keywords, or null when none are cached. */
  addressableVolume: number | null;
  /** Live Google SERP reaction for the page's top search (absent until a SERP read is cached). */
  serp?: EvidenceSerp;
  /** The top competitor page + what to steal (absent until a competitor teardown exists). */
  competitor?: EvidenceCompetitor;
};

export type CachedDemand = {
  volume: number | null;
  competition: "low" | "medium" | "high" | null;
  /** Item 18: real cached 0-100 Google keyword-difficulty score, or null/absent when no verdict run has fetched one yet. */
  difficulty?: number | null;
};

/** The subset of a cached SERP pattern the daily card needs (keeps this module dependency-free). */
export type SerpPatternLite = { format: string; winningDomains: string[]; elementImplication: string };

/** The subset of a competitor page teardown the daily card needs to compute "what to steal". Pure. */
export type CompetitorFactsLite = {
  hasAnswerBlock?: boolean;
  hasFaq?: boolean;
  faqQuestionCount?: number;
  schemaTypes?: string[];
  hasToolOrCalculator?: boolean;
  wordCount?: number;
  sectionCount?: number;
  hasReviewSchema?: boolean;
};

/**
 * Pick the best cached SERP reaction for a page from its queries + the cached-pattern map. Returns the
 * first query (best-first order) that has a cached pattern with real winning domains. Pure, null when
 * none cached. Never triggers a live call (that is the operator-gated producer's job).
 */
export function buildSerpEvidence(
  queries: string[],
  serpByTerm: Map<string, SerpPatternLite>,
  opts?: { maxDomains?: number },
): EvidenceSerp | null {
  const maxDomains = opts?.maxDomains ?? 3;
  for (const raw of queries) {
    const q = (raw ?? "").trim();
    if (!q) continue;
    const p = serpByTerm.get(q.toLowerCase());
    if (p && p.winningDomains.length > 0 && p.elementImplication.trim()) {
      return { query: q, format: p.format, winningDomains: p.winningDomains.slice(0, maxDomains), whatToDo: p.elementImplication.trim() };
    }
  }
  return null;
}

/** The observed own-rank movement the sentence builder needs (from serp-history's rankDelta). */
export type RankMovementInput = {
  fromRank: number;
  toRank: number;
  /** ISO timestamp of the earlier observation - becomes the "since Jun 20" date. */
  fromAt: string;
};

/**
 * Item 17: turn a REAL observed rank delta into one first-person sentence for the daily
 * card's live-SERP evidence line. Pure. Null in (no two observed positions yet) = null
 * out - honest silence. Lower rank number = higher on Google, so 9 to 6 is a win; we
 * state the literal numbers either way and never dress a drop up as anything else.
 */
export function buildRankMovementSentence(delta: RankMovementInput | null | undefined): string | null {
  if (!delta) return null;
  if (!Number.isFinite(delta.fromRank) || !Number.isFinite(delta.toRank)) return null;
  const sinceMs = Date.parse(delta.fromAt);
  if (!Number.isFinite(sinceMs)) return null;
  const since = new Date(sinceMs).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (delta.fromRank === delta.toRank) {
    return `You have held spot ${delta.toRank} on Google for this search since ${since}.`;
  }
  return `You moved ${delta.fromRank} to ${delta.toRank} on Google for this search since ${since}.`;
}

/**
 * Turn a competitor page's structure into a friendly, actionable "steal this" line (top 3 highest-
 * leverage stealable elements). Pure. Returns null when the page has no stealable structure (so a thin
 * competitor never produces a hollow "steal nothing" line).
 */
export function whatToSteal(facts: CompetitorFactsLite | null | undefined): string | null {
  if (!facts) return null;
  const wins: string[] = [];
  if (facts.hasAnswerBlock) wins.push("a direct answer at the top");
  if (facts.hasFaq) wins.push(`an FAQ section${facts.faqQuestionCount ? ` (${facts.faqQuestionCount} questions)` : ""}`);
  if (facts.hasToolOrCalculator) wins.push("an interactive tool");
  if ((facts.schemaTypes?.length ?? 0) > 0) wins.push("structured data (schema)");
  if ((facts.wordCount ?? 0) >= 1500) wins.push(`more depth (about ${Math.round((facts.wordCount ?? 0) / 100) * 100} words)`);
  if ((facts.sectionCount ?? 0) >= 5) wins.push(`${facts.sectionCount} clear sections`);
  if (facts.hasReviewSchema) wins.push("review markup");
  if (wins.length === 0) return null;
  return wins.slice(0, 3).join(", ");
}

/**
 * Build the competitor-teardown evidence for a page: the top competitor's domain + the specific thing
 * to steal. Pure. Returns null unless there is a real domain AND something stealable (so the card never
 * shows a competitor with no takeaway).
 */
export function buildCompetitorEvidence(input: {
  domain: string | null | undefined;
  url: string | null | undefined;
  facts?: CompetitorFactsLite | null;
}): EvidenceCompetitor | null {
  const domain = (input.domain ?? "").trim().replace(/^www\./, "");
  const steal = whatToSteal(input.facts);
  if (!domain || !steal) return null;
  return { domain, url: (input.url ?? "").trim(), whatToSteal: steal };
}

/**
 * Build the keyword-research brief for a page from its top queries + the cached demand map. Returns
 * null unless at least one query has cached demand (so the card never shows an empty section). Pure.
 */
export function buildKeywordBrief(
  queries: string[],
  demandByTerm: Map<string, CachedDemand>,
  opts?: { max?: number },
): DailyEvidenceBrief | null {
  const max = opts?.max ?? 6;
  const seen = new Set<string>();
  const keywords: EvidenceKeyword[] = [];
  for (const raw of queries) {
    const term = (raw ?? "").trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    const d = demandByTerm.get(key);
    keywords.push({ term, volume: d?.volume ?? null, competition: d?.competition ?? null, difficulty: d?.difficulty ?? null });
    if (keywords.length >= max) break;
  }
  // Only surface a brief when we actually have cached demand for at least one keyword; otherwise it is
  // just the query list with no research value (and would read as an empty "keyword research" box).
  if (!keywords.some((k) => k.volume != null || k.competition != null)) return null;

  const vols = keywords.map((k) => k.volume).filter((v): v is number => typeof v === "number" && v > 0);
  const addressableVolume = vols.length ? vols.reduce((s, v) => s + v, 0) : null;
  return { keywords, addressableVolume };
}
