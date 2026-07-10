/**
 * family-win-propagation (BEACON_500 item 29, 2026-07-02) - PURE core that turns a proven win
 * on one page into a bounded, ranked list of "do this again" candidates for its untreated
 * siblings in the same page family (daily-experiment-planner's pageFamilyOf grouping, e.g.
 * iran-animals/persian-cheetah -> every other iran-animals/* page).
 *
 * Why this exists: today a win on one page teaches Beacon nothing about its siblings - the
 * SAME lever that just won stays untried on 5 to 20 near-identical pages. A real SEO team's
 * biggest lever is compounding a proven move across a page family; this module is that
 * compounding step, made deterministic and $0.
 *
 * Inputs are pre-filtered by the caller (composition, not fetching):
 *   - `wonRecords`: ONLY records the caller has already confirmed are a MATURE, positive
 *     result (measurement-maturity's verdict === "helped" - a mature_result with a positive
 *     direction, never an early 7/14-day read). This module does not re-derive maturity; it
 *     trusts what it is given, exactly like proof-history-voice trusts its settled rows.
 *   - `familyPages`: candidate sibling pages (same pageFamily as a win) the caller has already
 *     restricted to pages that have GSC demand (the caller's normal demand floor).
 *   - `eligibility`: the experiment-eligibility verdict per sibling PATH, from the same
 *     `assessEligibility`/`deriveExperimentStates` the rest of the daily batch uses - so a
 *     mid-measurement page, an active control, or a page with a same-family no-lift is
 *     excluded by construction, never re-implemented here.
 *   - `recentShips`: an explicit "already has this exact lever" guard (recent shipped actionType
 *     per path), belt-and-suspenders on top of the eligibility gate (a page can be eligible by
 *     the ledger's family logic yet still have literally received the identical lever - e.g. a
 *     compound-edit path change - so we check both).
 *
 * PURE, no I/O, no LLM, no paid calls, deterministic $0. Bounded to MAX_PROPAGATION_CANDIDATES
 * per night, best-demand-first. Pinned by family-win-propagation.test.ts.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { actionFamilyOf, type ExperimentEligibility, type ExperimentFamily } from "./experiment-eligibility";
import { pageFamilyOf } from "./daily-experiment-planner";
import { FAMILY_PLAIN } from "./proof-history-voice";

/** Max family-propagation candidates emitted per night (hard rule: bounded). */
export const MAX_PROPAGATION_CANDIDATES = 3;

/** A page eligible to receive a propagated lever, keyed by path/url + its GSC demand. */
export type FamilyPage = {
  url: string;
  pageLabel: string;
  /** GSC demand floor - the caller has already confirmed this is a real, non-zero signal. */
  impressions: number;
};

/** One propagated candidate: a proven lever, moved to an untreated sibling page. */
export type FamilyPropagationCandidate = {
  page: string;
  pageFamily: string;
  lever: ExperimentFamily;
  actionType: string;
  /** The page that already proved this lever wins (the evidence source). */
  sourceWinPage: string;
  /** First-person, plain-business sentence for the daily card ("This exact change already
   *  won on the cheetah page this month. Same move, next page."). No em/en dashes ever. */
  sentence: string;
  /** Bounded score multiplier the planner can fold in like the team-review multiplier
   *  (>1 = boosted, since a proven-family win is a near-certain follow-up). */
  boost: number;
  impressions: number;
};

function pathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

/** Plain-language "when" for the source win, from its shipped date, month-only (no exact day
 *  needed for the sentence, keeps it evergreen across a re-render on a later day). */
function monthPhraseOf(shippedAt: string): string {
  const d = new Date(shippedAt);
  if (Number.isNaN(d.getTime())) return "this month";
  return `in ${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`;
}

function siblingLabelOf(url: string): string {
  const segs = pathOf(url).split("/").filter(Boolean);
  return (segs.at(-1) ?? "this page").replace(/[-_]+/g, " ");
}

/**
 * Build the propagation sentence: first person, plain business language, names the source
 * page's lever and the family, never a code/lab word, never an em or en dash.
 */
export function buildPropagationSentence(input: {
  leverPlain: string;
  sourceLabel: string;
  monthPhrase: string;
  siblingLabel: string;
}): string {
  return `This exact change (${input.leverPlain}) already won on the ${input.sourceLabel} page ${input.monthPhrase}. Same move, next page: ${input.siblingLabel}.`;
}

export type FindFamilyPropagationInput = {
  /** Mature, positive-verdict ("helped") records only - the caller's job to pre-filter. */
  wonRecords: ShippedChangeRecord[];
  /** Candidate sibling pages (any family) with confirmed GSC demand. */
  familyPages: FamilyPage[];
  /** Per-sibling-PATH experiment eligibility (from assessEligibility over the same ledger). */
  eligibility: Map<string, ExperimentEligibility>;
  /** Per-PATH set of action types already shipped recently (explicit same-lever guard,
   *  belt-and-suspenders on top of `eligibility`). Optional - defaults to none recorded. */
  recentShips?: Map<string, Set<string>>;
  /** Bound override for tests; defaults to MAX_PROPAGATION_CANDIDATES. */
  maxCandidates?: number;
};

/**
 * Find bounded, ranked family-propagation candidates: for every mature win, look at its
 * (pageFamily, actionFamily), find untreated siblings with demand, drop anything ineligible
 * or that already has this lever, and rank the survivors by demand (best-first) capped at
 * `maxCandidates` across the WHOLE batch (not per win) - a single spectacular win should not
 * flood the night; the strongest few sibling opportunities across all wins win the slots.
 */
export function findFamilyPropagationCandidates(input: FindFamilyPropagationInput): FamilyPropagationCandidate[] {
  const cap = input.maxCandidates ?? MAX_PROPAGATION_CANDIDATES;
  const recentShips = input.recentShips ?? new Map<string, Set<string>>();
  const pageByPath = new Map<string, FamilyPage>();
  for (const p of input.familyPages) pageByPath.set(pathOf(p.url), p);

  // One win per (pageFamily, actionFamily) - the FIRST (best-attributed) mature win found;
  // duplicate wins in the same family+lever don't multiply candidates, they just confirm it.
  const winByKey = new Map<string, ShippedChangeRecord>();
  for (const r of input.wonRecords) {
    const family = pageFamilyOf(r.path || r.page);
    const lever = actionFamilyOf(r.actionType);
    const key = `${family}::${lever}`;
    if (!winByKey.has(key)) winByKey.set(key, r);
  }
  if (winByKey.size === 0) return [];

  const candidatesByPath = new Map<string, FamilyPropagationCandidate>();
  for (const [key, win] of winByKey) {
    const [family, lever] = key.split("::") as [string, ExperimentFamily];
    const winPath = pathOf(win.path || win.page);

    for (const page of input.familyPages) {
      const sibPath = pathOf(page.url);
      if (sibPath === winPath) continue; // never propose the win page to itself
      if (pageFamilyOf(page.url) !== family) continue; // same family only

      const already = candidatesByPath.get(sibPath);
      if (already) continue; // one propagation candidate per sibling page

      const elig = input.eligibility.get(sibPath);
      // E-39: auto-propagation stays CONSERVATIVE - only pushes a proven win onto a
      // fully CLEAN sibling, never a mid-measurement / comparison page (admit-with-
      // caution). Not a lockout: that page still surfaces its own daily candidate.
      if (!elig || !elig.eligible || elig.reason !== "clean") continue;

      const shippedHere = recentShips.get(sibPath);
      if (shippedHere && [...shippedHere].some((a) => actionFamilyOf(a) === lever)) continue; // already has this lever

      const leverPlain = FAMILY_PLAIN[lever] ?? "a change";
      const sentence = buildPropagationSentence({
        leverPlain,
        sourceLabel: siblingLabelOf(winPath),
        monthPhrase: monthPhraseOf(win.shippedAt),
        siblingLabel: page.pageLabel || siblingLabelOf(page.url),
      });

      candidatesByPath.set(sibPath, {
        page: page.url,
        pageFamily: family,
        lever,
        actionType: win.actionType,
        sourceWinPage: win.path || win.page,
        sentence,
        boost: 1.3, // near-certain follow-up: a modest, visible, bounded lift over a fresh guess
        impressions: page.impressions,
      });
    }
  }

  return [...candidatesByPath.values()]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, Math.max(0, cap));
}
