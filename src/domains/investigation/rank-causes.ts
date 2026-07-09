/**
 * investigation/rank-causes (2026-07-02, master plan item 53; revised 2026-07-09
 * for operator spec B-10) - PURE diagnosis ranker. Given the evidence findings
 * collect-evidence.ts gathers for a page-family collapse (indexability, cached
 * SERP rank history, recent shipped changes, sitewide algorithm weather),
 * produce a ranked list of plain-English, PAGE-SPECIFIC causes with a
 * confidence tier, a shared (non-causal) weather context, and a headline that
 * states the drop and stops.
 *
 * No I/O. Deterministic. Total: any input combination (including every finding
 * empty) produces a result; the honest answer when nothing points anywhere is
 * "no clear cause found", never a fabricated one.
 *
 * Ranking precedence for page-specific causes (operator-locked, mirrors the
 * indexability decision tree's "structural break beats everything" posture):
 *   1. noindex_meta / bad_status_code on the page itself - a page that stopped
 *      being servable or indexable is a near-certain cause; this ALWAYS ranks
 *      first when present, ahead of any other signal, at "high" confidence.
 *   2. blocked_by_robots / canonical_elsewhere - a page still indexable but
 *      newly hidden from crawlers or redirected elsewhere. "high" confidence.
 *   3. a recent shipped change to one of the family's own pages within the
 *      PROXIMITY_DAYS window before the collapse date - "medium" confidence,
 *      higher when the change is closer to the collapse date.
 *   4. a SERP rank drop on the family's own top queries within the same
 *      window - "low" confidence alone (a lost ranking is as much a symptom
 *      of the collapse as a cause of it), but it corroborates causes 1-3 when
 *      they're also present.
 *   5. nothing found - "none" confidence, an honest single sentence, never a
 *      guess dressed up as a finding.
 *
 * A sitewide algorithm-weather shock overlapping the collapse date is handled
 * SEPARATELY from the causes above (see `WeatherContext`): it is never a
 * page-specific cause, never named "a Google shift", and never repeated per
 * family - it is one honest, shared hedge the caller renders once.
 */

export type IndexabilityFinding = {
  url: string;
  /** True when the live fetch found a noindex meta tag (or "none" robots
   *  directive) that the stored snapshot did not have, or the page has no
   *  stored snapshot at all and is noindexed now. */
  noindexNow: boolean;
  /** True when the live HTTP status is 4xx/5xx/a redirect code. */
  badStatusNow: boolean;
  liveStatus: number | null;
  /** True when the live robots meta blocks Googlebot or the major AI bots via
   *  an X-Robots-Tag-equivalent noindex/none token (same parse as noindex,
   *  kept separate for callers that want to distinguish the sentence). */
  blockedByRobots: boolean;
  /** True when the live canonical tag now points somewhere else. */
  canonicalMismatch: boolean;
  /** ISO date the live check ran, for the sentence. */
  checkedAt: string;
};

export type SerpFinding = {
  query: string;
  fromRank: number;
  toRank: number;
  direction: "up" | "down" | "flat";
};

export type RecentChangeFinding = {
  url: string;
  /** Plain label for what changed, e.g. "meta description" or "answer block". */
  description: string;
  pushedAt: string;
  /** Days between the change and the collapse date (0 = same day; negative =
   *  the change happened AFTER the collapse, still reported for transparency
   *  but never used as a cause). */
  daysBeforeCollapse: number;
};

export type WeatherFinding = {
  label: string;
  start: string;
  end: string;
  kind: "confirmed" | "suspected";
};

export type InvestigationFindings = {
  familyLabel: string;
  collapseDate: string;
  /** The clicks drop the collapse detector measured, as a plain fraction
   *  (0.6 = lost 60 percent), for the headline sentence. Null when the
   *  trigger was the sitewide changepoint rather than a family-level spike. */
  clicksDropPct: number | null;
  indexability: IndexabilityFinding[];
  serp: SerpFinding[];
  recentChanges: RecentChangeFinding[];
  weather: WeatherFinding[];
};

export type RankedCause = {
  kind: "noindex" | "bad_status" | "robots_blocked" | "canonical_elsewhere" | "recent_change" | "serp_drop";
  confidence: "high" | "medium" | "low";
  /** Plain first-person sentence naming the cause. No dashes. */
  sentence: string;
  /** The one action this cause implies, if any. */
  actionSentence: string | null;
};

/**
 * B-10 (operator spec 2026-07-09): a site-wide algorithm shock is NOT a
 * page-specific cause we can claim credit or blame for - it is shared context
 * that applies equally to every page on the site. It is deliberately kept out
 * of `causes` so it can never be rendered as "Most likely cause" for one
 * family, and never the word "Google shift" (an invented, overclaimed label)
 * - just the honest, hedged observation that the whole site moved together.
 */
export type WeatherContext = {
  /** The one shared, non-causal sentence. Rendered ONCE across every card in
   *  the section, never duplicated per item. */
  sentence: string;
  /** The shock window's start date (ISO), for de-duplicating identical
   *  windows across multiple families in the same render. */
  windowStart: string;
};

export type InvestigationDiagnosis = {
  familyLabel: string;
  collapseDate: string;
  /** ONE line: states the drop with numbers. Never embeds a cause claim -
   *  operator: "just state the drop and shut up" (B-10, 2026-07-09). Any
   *  cause found lives in `causes` below, rendered exactly once there. */
  headline: string;
  /** Ranked, page-specific causes only, most likely first. Empty when none
   *  was found. Never includes a site-wide weather shock - see
   *  `weatherContext`. */
  causes: RankedCause[];
  /** Non-null when a site-wide shock overlapped this collapse window. Not a
   *  claimed cause of THIS family's drop - render its sentence once for the
   *  whole section, never per item. Optional for older stored rows written
   *  before this field existed. */
  weatherContext?: WeatherContext | null;
  /** True when at least one page-specific cause was found; false means "no
   *  clear cause found", the honest default. A site-wide weather shock alone
   *  does not count as a cause here (it is not page-specific). */
  hasCause: boolean;
};

/** How close a shipped change must be to the collapse date to count as a
 *  plausible cause (as opposed to unrelated background churn). */
export const CHANGE_PROXIMITY_DAYS = 10;

function pctSentence(clicksDropPct: number | null): string {
  if (clicksDropPct === null || !Number.isFinite(clicksDropPct)) return "lost a large share of its clicks";
  const pct = Math.round(Math.abs(clicksDropPct) * 100);
  return `lost about ${pct} percent of its clicks`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Rank causes for one indexability finding into 0-2 entries (noindex/status
 *  take priority over robots/canonical on the SAME page, since a page that
 *  isn't servable makes the other checks moot). PURE. */
function causesForIndexability(f: IndexabilityFinding): RankedCause[] {
  const when = formatDate(f.checkedAt);
  if (f.noindexNow) {
    return [
      {
        kind: "noindex",
        confidence: "high",
        sentence: `The page went noindex. I found a noindex tag on the live page as of ${when}.`,
        actionSentence: "Remove the noindex tag. This looks like an accident, not an intentional change.",
      },
    ];
  }
  if (f.badStatusNow) {
    const statusLabel = f.liveStatus != null ? `a ${f.liveStatus} status` : "an error status";
    return [
      {
        kind: "bad_status",
        confidence: "high",
        sentence: `The page is returning ${statusLabel} instead of loading normally, checked ${when}.`,
        actionSentence: "Fix the page so it loads normally again. Google cannot rank a page that errors out.",
      },
    ];
  }
  const out: RankedCause[] = [];
  if (f.blockedByRobots) {
    out.push({
      kind: "robots_blocked",
      confidence: "high",
      sentence: `The page is now blocked from crawlers, checked ${when}.`,
      actionSentence: "Remove the crawler block. This is very likely blocking the page from ranking at all.",
    });
  }
  if (f.canonicalMismatch) {
    out.push({
      kind: "canonical_elsewhere",
      confidence: "high",
      sentence: `The page's canonical tag now points to a different URL, checked ${when}.`,
      actionSentence: "Fix the canonical tag to point back to this page, or confirm the redirect is intentional.",
    });
  }
  return out;
}

/** Rank the best recent-change cause, or null when none is close enough to the
 *  collapse date to plausibly be a cause. PURE. Ties broken by proximity. */
function causeForRecentChanges(changes: ReadonlyArray<RecentChangeFinding>): RankedCause | null {
  const candidates = changes.filter((c) => c.daysBeforeCollapse >= 0 && c.daysBeforeCollapse <= CHANGE_PROXIMITY_DAYS);
  if (candidates.length === 0) return null;
  const best = [...candidates].sort((a, b) => a.daysBeforeCollapse - b.daysBeforeCollapse)[0]!;
  const when = formatDate(best.pushedAt);
  const dayWord = best.daysBeforeCollapse <= 1 ? "the day before" : `${best.daysBeforeCollapse} days before`;
  return {
    kind: "recent_change",
    confidence: "medium",
    sentence: `I changed the ${best.description} on ${when}, ${dayWord} the drop started.`,
    actionSentence: `Check the ${best.description} change I shipped on ${when}. If it looks wrong, I would revert it.`,
  };
}

/** Build the shared, non-causal weather context, or null when no shock
 *  window overlaps the collapse date. PURE. A confirmed update ranks ahead
 *  of a merely suspected one when both are present. Deliberately never names
 *  a specific cause or says "Google shift" - it is an honest hedge shared
 *  across the whole section, not a claim about this one family. */
function weatherContextFor(weather: ReadonlyArray<WeatherFinding>): WeatherContext | null {
  if (weather.length === 0) return null;
  const confirmed = weather.find((w) => w.kind === "confirmed");
  const w = confirmed ?? weather[0]!;
  const when = formatDate(w.start);
  return {
    sentence: `The whole site moved together around ${when}, so this is probably not specific to these pages.`,
    windowStart: w.start,
  };
}

/** Rank a SERP-drop corroborating cause, or null when no query lost rank in
 *  the family's tracked queries. Always "low" confidence alone - a lost
 *  ranking is a symptom as much as a cause. PURE. */
function causeForSerp(serp: ReadonlyArray<SerpFinding>): RankedCause | null {
  const drops = serp.filter((s) => s.direction === "down");
  if (drops.length === 0) return null;
  const worst = [...drops].sort((a, b) => b.toRank - b.fromRank - (a.toRank - a.fromRank))[0]!;
  return {
    kind: "serp_drop",
    confidence: "low",
    sentence: `Its Google ranking for "${worst.query}" fell from position ${worst.fromRank} to ${worst.toRank} around the same time.`,
    actionSentence: null,
  };
}

/**
 * THE ranker: findings in, a diagnosis out. Deterministic, pure, total.
 * Empty findings on every source produce an honest "no clear cause found"
 * diagnosis rather than a guess.
 *
 * B-10 (operator spec 2026-07-09): the headline states the drop and stops -
 * it never embeds a cause sentence (that would duplicate the same sentence
 * the caller renders again from `causes`). A site-wide weather shock is never
 * a claimed cause of one family's drop; it comes back separately as
 * `weatherContext`, an honest shared hedge the caller renders once, not per
 * family.
 */
export function rankCauses(findings: InvestigationFindings): InvestigationDiagnosis {
  const causes: RankedCause[] = [];

  // Structural breaks first, one page's noindex/status always wins outright.
  for (const f of findings.indexability) {
    causes.push(...causesForIndexability(f));
  }
  // Recent changes are family-level (one entry, the single best explanation),
  // ranked below any structural break found.
  const changeCause = causeForRecentChanges(findings.recentChanges);
  if (changeCause) causes.push(changeCause);
  const serpCause = causeForSerp(findings.serp);
  if (serpCause) causes.push(serpCause);

  // Stable sort by confidence tier (high, medium, low). Within the high tier,
  // noindex always wins outright even over another page's bad status code (a
  // noindex is a near-certain deliberate-or-accidental cause; a bad status
  // could just as easily be transient) - kindRank breaks that tie explicitly
  // so the result never depends on which page happened to be checked first.
  // Every other tie keeps insertion order, which already reflects the
  // documented precedence.
  const rank: Record<RankedCause["confidence"], number> = { high: 0, medium: 1, low: 2 };
  const kindRank: Partial<Record<RankedCause["kind"], number>> = { noindex: 0 };
  const ranked = [...causes].sort((a, b) => {
    const tierDiff = rank[a.confidence] - rank[b.confidence];
    if (tierDiff !== 0) return tierDiff;
    return (kindRank[a.kind] ?? 1) - (kindRank[b.kind] ?? 1);
  });

  const weatherContext = weatherContextFor(findings.weather);
  const dropPhrase = pctSentence(findings.clicksDropPct);
  const when = formatDate(findings.collapseDate);
  const headline = `The ${findings.familyLabel} family ${dropPhrase} starting ${when}.`;

  if (ranked.length === 0) {
    return {
      familyLabel: findings.familyLabel,
      collapseDate: findings.collapseDate,
      // A site-wide shock already explains the drop honestly (via
      // weatherContext, rendered once for the whole section) - stating it
      // again per family here would be the exact duplication B-10 fixed.
      headline: weatherContext
        ? headline
        : `${headline} I checked the page, the crawlers, recent changes, and site-wide shifts, and found no clear cause. I would look at this one by hand.`,
      causes: [],
      weatherContext,
      hasCause: false,
    };
  }

  return {
    familyLabel: findings.familyLabel,
    collapseDate: findings.collapseDate,
    headline,
    causes: ranked,
    weatherContext,
    hasCause: true,
  };
}
