/**
 * content-lifecycle (2026-07-03, BEACON_500 R19 / N24 - one content-lifecycle
 * engine: prune, merge-and-redirect, retire).
 *
 * PURE / no I/O / no LLM. Classifies each OWNED page, from signals Beacon
 * already stores, into one of five lifecycle stages:
 *
 *   keep    - the page earns its place (real demand, healthy, not competing).
 *   improve - has demand but a fixable weakness; handled by the existing
 *             content triggers (decay/coverage/CTR), NOT by this engine. This
 *             engine never EMITS an "improve" card - it only labels the page so
 *             the classification is total and testable. No candidate row.
 *   prune   - near-zero Google demand AND thin AND nothing links to it AND not
 *             recently published. "Remove it or fold it into a stronger page so
 *             it stops diluting your site."
 *   merge   - two owned pages compete for the same topic and one clearly
 *             dominates (impressions ratio past MERGE_DOMINANCE_RATIO). Fold the
 *             weaker into the stronger and redirect it. Carries a prepared
 *             redirect target (the dominant page). NEVER auto-applied.
 *   retire  - a page about a passed dated event whose demand has collapsed.
 *             "This page is about something that already happened and barely
 *             gets searched now."
 *
 * DEMAND FLOOR IS PINNED: a page with meaningful Google demand is NEVER pruned
 * or retired, no matter how thin or unlinked. The whole point is to remove dead
 * weight, never a page that still earns searches. Pinned by tests.
 *
 * BYTE-IDENTICAL WHEN EMPTY: no pages in -> no verdicts out; no page qualifies
 * for prune/merge/retire -> zero lifecycle candidates (every page classifies
 * keep/improve, which emit nothing). This engine only ADDS cards for the three
 * destructive stages, and every one routes operator-approved-only downstream
 * (merge_pages has generatorActive:false + no eligibility entry; prune/retire
 * emit at confidence "low" -> diagnostic_only). Nothing here ever executes a
 * prune or a redirect - it only proposes one with an honest sentence.
 *
 * The merge side reuses the ownership registry's conflict shape (N2) rather
 * than re-deriving cannibalization, and dedupes against the existing
 * thin_content_overlap / intent_cluster_conflict merge cards by (owner,
 * folded-page) pair at the loader boundary.
 *
 * No em or en dashes anywhere. Never surfaces a lab word ("orphaned", "prune",
 * "retire", "PageRank") in the customer sentence - the sentences say plainly
 * "nothing links to it", "remove or fold it in", "already happened".
 *
 * The customer sentences come from the shared, vocab-scanned copy templates
 * (customer-copy-templates.ts) - pure functions, no I/O - so the strings this
 * engine surfaces pass the same forbidden-vocab invariant every other card does
 * and there is one source of truth per sentence.
 */

import {
  lifecyclePruneCopy,
  lifecycleMergeCopy,
  lifecycleRetireCopy,
} from "@/domains/recommendation-intelligence/customer-copy-templates";

export type LifecycleStage = "keep" | "improve" | "merge" | "prune" | "retire";

/** One owned page's already-stored signals, assembled by the loader. Every
 *  field is what a snapshot / GSC signal / authority row / sitemap already
 *  holds - this core reads them, it never fetches. */
export type LifecyclePageInput = {
  /** Canonical page URL - the identity used across every signal map. */
  url: string;
  /** Total Google impressions over the trailing 90 days (0 when unknown). */
  impressions90d: number;
  /** Total Google clicks over the trailing 90 days (0 when unknown). */
  clicks90d: number;
  /** Stored word count of the page body. */
  wordCount: number;
  /** HTTP status of the last fetch (>=400 pages are excluded from prune/retire
   *  because bad_http_status already owns them; a dead page is a status fix,
   *  not a lifecycle decision). */
  httpStatus: number;
  /** Distinct owned pages that link TO this one (from internal-pagerank). null
   *  when the link graph was unusable (then the "nothing links to it" leg of
   *  the prune rule cannot be asserted and prune abstains). */
  inboundCount: number | null;
  /** Sitemap lastmod ISO date for this URL, when known. Used only to protect a
   *  RECENTLY published page from being pruned (a new thin page deserves a
   *  chance to earn demand before we suggest removing it). Unknown -> not
   *  treated as recent (the page must clear every OTHER prune leg anyway). */
  lastmod: string | null;
  /** Page title (for dated / passed-event detection on the retire leg). */
  title: string | null;
  /** Page H1 (for dated / passed-event detection on the retire leg). */
  h1: string | null;
  /** Whether the page's Google demand has COLLAPSED across two 28-day windows
   *  (from the existing gsc-decay split-window signal): it had real clicks
   *  before and has almost none now. null when no decay signal exists for this
   *  page (then the retire leg abstains - unknown is never evidence of collapse). */
  demandCollapsed: boolean | null;
};

/** A merge conflict already resolved by the ownership registry (N2): a dominant
 *  owner page and one weaker page competing for the same topic. The loader
 *  passes the impression split so the ratio gate is checkable here (pure). */
export type LifecycleMergeConflict = {
  /** The dominant page - the redirect target (all authority points here). */
  ownerUrl: string;
  /** The weaker page - the merge/redirect candidate (this is what we fold in). */
  foldUrl: string;
  /** Owner's share of the combined impressions on the shared topic (0..1). */
  ownerShare: number;
  /** The plain topic/query label the two pages compete for. */
  topicLabel: string;
};

export type LifecycleVerdict = {
  url: string;
  stage: LifecycleStage;
  /** Plain first-person-safe sentence, dash-free, no lab words. Empty for
   *  keep/improve (they emit no card). */
  reason: string;
  /** For a merge verdict: the prepared redirect target (the dominant page all
   *  authority should point to). null for every other stage. NEVER auto-applied. */
  redirectTarget: string | null;
  /** Operator-only structured trace (never customer-facing). */
  evidence: string;
};

export type ContentLifecycleResult = {
  verdicts: LifecycleVerdict[];
  counts: Record<LifecycleStage, number>;
};

// ---------------------------------------------------------------------------
// Thresholds (the engineering-chosen constants, each justified).
// ---------------------------------------------------------------------------

/** Prune leg: "almost no Google traffic" - below this many 90-day impressions a
 *  page is effectively invisible in search. 5 is the plan's own floor. */
export const PRUNE_MAX_IMPRESSIONS_90D = 5;
/** Prune leg: "very thin" - below this word count there is not enough on the
 *  page to earn a citation or a ranking. Matches the plan's < 200. */
export const PRUNE_MAX_WORD_COUNT = 200;
/** A page with AT LEAST this many 90-day impressions has MEANINGFUL demand and
 *  is NEVER pruned or retired, however thin or unlinked. The hard floor that
 *  protects real pages. Deliberately well above the prune ceiling so the two
 *  can never both be true. */
export const MEANINGFUL_DEMAND_IMPRESSIONS_90D = 30;
/** Prune leg: a page whose sitemap lastmod is newer than this many days is
 *  "recently published" and protected - a new thin page deserves time to earn
 *  demand before we suggest removing it. */
export const RECENTLY_PUBLISHED_DAYS = 90;
/** Merge leg: the dominant page must hold at least this share of the combined
 *  impressions to be a "clear" winner worth folding the other into (a 5:1 ratio
 *  = the winner holds >= 5/6 ~= 0.83). The plan's own ">5:1". */
export const MERGE_DOMINANCE_RATIO = 5;
/** Retire leg: a passed-event page must sit at or below this many 90-day
 *  impressions to count as demand-collapsed enough to retire (higher than the
 *  prune floor - a dated event may still get a trickle, but if it has real
 *  ongoing demand we keep it and just refresh). Still well under the meaningful
 *  floor so a genuinely popular annual event page is never retired. */
export const RETIRE_MAX_IMPRESSIONS_90D = 20;
/** Retire leg: how many whole years back a year in the title/H1/URL must sit to
 *  read as a PASSED, dated event (a 2021 conference page in 2026 is passed; a
 *  2026 page is current). Mirrors the claim-graph aged-year lookback. */
export const PASSED_YEAR_LOOKBACK_YEARS = 2;

const DAY_MS = 86_400_000;

/** Share the owner needs so the winner:loser ratio clears MERGE_DOMINANCE_RATIO.
 *  ownerShare / (1 - ownerShare) >= R  <=>  ownerShare >= R / (R + 1). */
export const MERGE_MIN_OWNER_SHARE =
  MERGE_DOMINANCE_RATIO / (MERGE_DOMINANCE_RATIO + 1);

const zeroCounts = (): Record<LifecycleStage, number> => ({
  keep: 0,
  improve: 0,
  merge: 0,
  prune: 0,
  retire: 0,
});

/** Path (or the whole URL when unparseable) for the customer sentence. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * Does this page read as a PASSED, dated event? Deterministic: a four-digit
 * year (in the 1900-2099 range) appears in the title, H1, or URL path, and that
 * year is strictly older than PASSED_YEAR_LOOKBACK_YEARS before now. A future or
 * current year is NOT passed. Pure; `now` injected for test determinism.
 */
export function looksLikePassedEvent(
  page: Pick<LifecyclePageInput, "title" | "h1" | "url">,
  now: Date,
): boolean {
  const nowYear = now.getUTCFullYear();
  const hay = `${page.title ?? ""} ${page.h1 ?? ""} ${pathOf(page.url)}`;
  let sawYear = false;
  for (const m of hay.match(/\b(?:19|20)\d{2}\b/g) ?? []) {
    sawYear = true;
    const year = Number.parseInt(m, 10);
    // A current/future year means the page is NOT a passed event, even if some
    // OTHER older year also appears - err on the side of keeping.
    if (year >= nowYear - PASSED_YEAR_LOOKBACK_YEARS + 1) return false;
  }
  return sawYear;
}

function isRecentlyPublished(lastmod: string | null, now: Date): boolean {
  if (!lastmod) return false;
  const ms = Date.parse(lastmod);
  if (!Number.isFinite(ms)) return false;
  return now.getTime() - ms <= RECENTLY_PUBLISHED_DAYS * DAY_MS;
}

/**
 * Classify ONE page from its stored signals. Merge is handled separately (it is
 * a page-PAIR decision, not a single-page one), so this returns keep / improve /
 * prune / retire only. The precedence, most-severe first:
 *
 *   1. Any page with MEANINGFUL demand -> keep (the hard protective floor).
 *   2. A page returning an error/redirect -> keep here (bad_http_status owns it;
 *      a dead page is a status fix, not a lifecycle removal).
 *   3. prune: near-zero demand AND thin AND nothing links to it AND not
 *      recently published.
 *   4. retire: a passed dated event whose demand has collapsed / is near zero.
 *   5. improve: has some demand but did not qualify above (the existing content
 *      triggers own it).
 *   6. keep: everything else.
 */
export function classifyPage(
  page: LifecyclePageInput,
  now: Date,
): LifecycleVerdict {
  const path = pathOf(page.url);

  // (1) HARD PROTECTIVE FLOOR: real demand is never pruned or retired.
  if (page.impressions90d >= MEANINGFUL_DEMAND_IMPRESSIONS_90D) {
    return {
      url: page.url,
      stage: "keep",
      reason: "",
      redirectTarget: null,
      evidence: `keep: meaningful_demand impressions_90d=${page.impressions90d} (>= ${MEANINGFUL_DEMAND_IMPRESSIONS_90D})`,
    };
  }

  // (2) Dead/redirecting pages belong to the status fix, not a lifecycle card.
  if (page.httpStatus >= 400) {
    return {
      url: page.url,
      stage: "keep",
      reason: "",
      redirectTarget: null,
      evidence: `keep: http_status=${page.httpStatus} (status fix owns this, not lifecycle)`,
    };
  }

  // (3) PRUNE: near-zero demand + thin + nothing links to it + not fresh.
  const nearZeroDemand = page.impressions90d < PRUNE_MAX_IMPRESSIONS_90D;
  const thin = page.wordCount < PRUNE_MAX_WORD_COUNT;
  // inboundCount null means the link graph was unusable - we cannot assert
  // "nothing links to it", so the prune leg abstains (honest, never a guess).
  const nothingLinks = page.inboundCount != null && page.inboundCount === 0;
  const recentlyPublished = isRecentlyPublished(page.lastmod, now);
  if (nearZeroDemand && thin && nothingLinks && !recentlyPublished) {
    return {
      url: page.url,
      stage: "prune",
      reason: lifecyclePruneCopy(path, page.impressions90d),
      redirectTarget: null,
      evidence:
        `prune: impressions_90d=${page.impressions90d} (< ${PRUNE_MAX_IMPRESSIONS_90D}); ` +
        `word_count=${page.wordCount} (< ${PRUNE_MAX_WORD_COUNT}); inbound=0; recently_published=false`,
    };
  }

  // (4) RETIRE: a passed dated event whose demand has collapsed / is near zero.
  const passedEvent = looksLikePassedEvent(page, now);
  const lowEnoughToRetire = page.impressions90d <= RETIRE_MAX_IMPRESSIONS_90D;
  // Demand collapse is EITHER the split-window signal saying it fell off, OR a
  // page that is already near-zero (a passed event that never had demand). null
  // collapse + non-near-zero impressions -> abstain.
  const collapsed =
    page.demandCollapsed === true ||
    page.impressions90d < PRUNE_MAX_IMPRESSIONS_90D;
  if (passedEvent && lowEnoughToRetire && collapsed) {
    return {
      url: page.url,
      stage: "retire",
      reason: lifecycleRetireCopy(path, page.impressions90d),
      redirectTarget: null,
      evidence:
        `retire: passed_event=true; impressions_90d=${page.impressions90d} (<= ${RETIRE_MAX_IMPRESSIONS_90D}); ` +
        `demand_collapsed=${String(page.demandCollapsed)}`,
    };
  }

  // (5) improve vs (6) keep: a page with SOME demand that did not qualify for a
  // destructive stage is left to the existing content triggers (improve); a
  // page with essentially no demand and no destructive verdict is kept as-is.
  const stage: LifecycleStage = page.impressions90d > 0 ? "improve" : "keep";
  return {
    url: page.url,
    stage,
    reason: "",
    redirectTarget: null,
    evidence: `${stage}: impressions_90d=${page.impressions90d}; word_count=${page.wordCount}`,
  };
}

/**
 * Build one merge verdict from a registry conflict, when the dominance ratio
 * clears the gate. Returns null when the split is too close to justify folding
 * one page into the other (a near-even split is a competition to resolve some
 * OTHER way, not a clear merge). The redirect target is the dominant owner.
 */
export function classifyMerge(
  conflict: LifecycleMergeConflict,
): LifecycleVerdict | null {
  if (conflict.ownerUrl === conflict.foldUrl) return null;
  if (conflict.ownerShare < MERGE_MIN_OWNER_SHARE) return null;
  const ownerPath = pathOf(conflict.ownerUrl);
  const foldPath = pathOf(conflict.foldUrl);
  const ownerPct = Math.round(conflict.ownerShare * 100);
  return {
    url: conflict.foldUrl,
    stage: "merge",
    reason: lifecycleMergeCopy(ownerPath, foldPath, ownerPct),
    redirectTarget: conflict.ownerUrl,
    evidence:
      `merge: owner=${conflict.ownerUrl}; fold=${conflict.foldUrl}; owner_share=${conflict.ownerShare.toFixed(2)} ` +
      `(>= ${MERGE_MIN_OWNER_SHARE.toFixed(2)}); topic="${conflict.topicLabel}"`,
  };
}

/**
 * THE engine: classify every owned page + every merge conflict into one
 * lifecycle result. Pure and deterministic. Verdicts are returned in a stable
 * order (input page order, then merge conflicts) so downstream capping is
 * reproducible.
 *
 * A page that a merge conflict already folds (its foldUrl) is REMOVED from the
 * single-page prune/retire consideration for that same page - one lifecycle
 * card per page, and merge (which preserves the page's value via a redirect)
 * wins over prune/retire (which discards it).
 */
export function classifyContentLifecycle(input: {
  pages: ReadonlyArray<LifecyclePageInput>;
  mergeConflicts?: ReadonlyArray<LifecycleMergeConflict>;
  now?: Date;
}): ContentLifecycleResult {
  const now = input.now ?? new Date();
  const counts = zeroCounts();
  const verdicts: LifecycleVerdict[] = [];

  // Merge first, so a folded page is claimed before single-page classification.
  const mergedFoldUrls = new Set<string>();
  const mergeVerdicts: LifecycleVerdict[] = [];
  for (const conflict of input.mergeConflicts ?? []) {
    const v = classifyMerge(conflict);
    if (!v) continue;
    if (mergedFoldUrls.has(v.url)) continue; // one merge card per folded page
    mergedFoldUrls.add(v.url);
    mergeVerdicts.push(v);
  }

  for (const page of input.pages) {
    if (mergedFoldUrls.has(page.url)) continue; // merge already owns this page
    const v = classifyPage(page, now);
    verdicts.push(v);
    counts[v.stage] += 1;
  }

  for (const v of mergeVerdicts) {
    verdicts.push(v);
    counts[v.stage] += 1;
  }

  return { verdicts, counts };
}
