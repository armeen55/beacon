/**
 * seasonal/seasonality-voice (BEACON_500 item 69) - the seasonality
 * specialist's opinion, through the exact same SpecialistOpinion contract
 * every other teammate (GSC, GA4, Clarity, Profound, ...) uses
 * (src/domains/demand-graph/specialist-opinions.ts). This teammate has one
 * job: know the page family's own demand calendar and SAY SO before a Move
 * ships blind into it.
 *
 * Two things it can say, both DOWNGRADE objections (never a veto - a
 * seasonally-timed page is still worth shipping, just not silently measured
 * as if the calendar didn't exist):
 *
 *   1. "You are about to ship into a demand cliff." Fires when NOW sits
 *      inside the family's detected peak window and the window is about to
 *      close (the falling edge) - the classic trap where a 7/14/28-day
 *      measurement window that starts here rides the wave DOWN and reads as
 *      a loss that has nothing to do with the change.
 *
 *   2. "Demand for this family starts climbing in about N weeks - prep now."
 *      Fires when the family's next peak window opens 4-8 weeks out (the
 *      same proactive lead time seasonal-candidates.ts already uses for its
 *      own "prep now" cards), so a Move riding this family gets the timing
 *      context even when nothing else in the packet mentions it.
 *
 * PURE / deterministic / no I/O / no LLM, same posture as every other
 * emitter in specialist-opinions.ts. Abstains (null) whenever the tenant has
 * no computed family profile for this Move's page (never fabricates a
 * seasonal read off missing data). Tenant-agnostic - reasons only over
 * numbers/dates the profile itself carries, never a hardcoded culture/holiday
 * name.
 */

import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import type { Objection, ScoreContribution, SpecialistOpinion } from "@/domains/demand-graph/specialist-opinions";
import type { FamilyDemandProfile } from "./family-demand-profile";

/** A peak window closing within this many days of "now" counts as "about to
 *  fall off the cliff" - inside the window, but the falling edge is close
 *  enough that a fresh measurement window would span it. */
export const CLIFF_LOOKAHEAD_DAYS = 10;
/** The proactive "prep now" lead window matches seasonal-candidates.ts's own
 *  6-8 week band exactly, so the two voices never disagree about when "soon"
 *  starts. */
export const PREP_LEAD_MIN_WEEKS = 4;
export const PREP_LEAD_MAX_WEEKS = 8;

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthWindowLabel(months: readonly number[]): string {
  if (months.length === 1) return MONTH_NAMES[months[0]! - 1]!;
  return `${MONTH_NAMES[months[0]! - 1]} and ${MONTH_NAMES[months[1]! - 1]}`;
}

function pageFamilyOfPath(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

/** The current occurrence's [start, end) for a 1-2 adjacent-month window,
 *  anchored to `now`'s year (or the prior year, when now falls in the tail of
 *  a window that wrapped Dec->Jan). PURE. Returns the window edges as
 *  epoch-ms so the caller can test "is now inside" and "how far to the end". */
function currentMonthWindowEdges(months: readonly number[], now: Date): { startMs: number; endMs: number } {
  const y = now.getUTCFullYear();
  const first = months[0]!;
  const last = months[months.length - 1]!;
  // Try this calendar year's occurrence of the window first; if `now` falls
  // clearly after it, that's simply not the active occurrence.
  const startThisYear = Date.UTC(y, first - 1, 1);
  const endYear = last < first ? y + 1 : y; // wraps Dec(12)->Jan(1)
  const endThisYear = Date.UTC(endYear, last, 1); // first day of the month AFTER `last`
  return { startMs: startThisYear, endMs: endThisYear };
}

/** Days from `now` until the window's own next peakStartDate (0 if inside a
 *  window that started in the past but hasn't ended yet is handled by the
 *  caller separately - this only answers "how far to the NEXT start"). */
function daysUntilNextStart(months: readonly number[], now: Date): number {
  const y = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const first = months[0]!;
  const year = first >= nowMonth ? y : y + 1;
  const startMs = Date.UTC(year, first - 1, 1);
  return Math.round((startMs - now.getTime()) / DAY_MS);
}

type CliffCheck = { insideWindow: boolean; daysToClose: number; monthsLabel: string; confidence: "one_season" | "repeated" };

/** Is `now` inside this family's annual peak window, and if so how many days
 *  until it closes? PURE. */
function annualCliffCheck(profile: FamilyDemandProfile, now: Date): CliffCheck | null {
  const annual = profile.annual[0];
  if (!annual) return null;
  const { startMs, endMs } = currentMonthWindowEdges(annual.months, now);
  const nowMs = now.getTime();
  if (nowMs < startMs || nowMs >= endMs) return null; // not currently inside the window
  const daysToClose = Math.round((endMs - nowMs) / DAY_MS);
  return { insideWindow: true, daysToClose, monthsLabel: monthWindowLabel(annual.months), confidence: annual.confidence };
}

/**
 * The seasonality specialist's opinion for one Move. PURE, $0. Abstains when
 * no family profile is known for this Move's page (create-page candidates
 * with no owned URL yet also abstain - there is no family history to check).
 */
export function emitSeasonalOpinion(
  p: EvidencePacket,
  extras: { nowIso?: string; seasonalProfile?: FamilyDemandProfile | null } = {},
): SpecialistOpinion | null {
  const nowIso = extras.nowIso ?? new Date().toISOString();
  const now = new Date(nowIso);
  const profile = extras.seasonalProfile;
  if (!profile) return null; // no computed profile for this family -> abstain

  const url = p.yourPage.url;
  const pageFamily = url ? pageFamilyOfPath(url) : profile.pageFamily;

  const objections: Objection[] = [];
  const scoreContribution: ScoreContribution = {};
  let claim: string;
  let confidence = 0.5;

  const cliff = annualCliffCheck(profile, now);
  if (cliff && cliff.daysToClose <= CLIFF_LOOKAHEAD_DAYS) {
    // About to ship into (or right at the edge of) a demand cliff: the peak
    // window this family rides is closing within the lookahead - a fresh
    // measurement window started now would span the falling edge and could
    // read as a loss that is really just the season ending.
    const confidenceWord = cliff.confidence === "repeated" ? "repeats every year" : "showed up once so far";
    const dayWord = cliff.daysToClose === 1 ? "day" : "days";
    claim = `This page's family is riding a demand wave in ${cliff.monthsLabel} that ${confidenceWord}, and that wave closes in about ${cliff.daysToClose} ${dayWord}. Shipping right now measures into the falling edge.`;
    objections.push({
      kind: "seasonal_demand_cliff",
      against: ["create_page", "edit_existing_page", "change_title_meta", "add_answer_block"],
      severity: "downgrade",
      detail: `Peak window ${cliff.monthsLabel} closes in ~${cliff.daysToClose} days - a measurement window started now would ride the demand drop-off, not the change.`,
      evidenceRefs: [
        {
          specialist: "seasonal",
          source: "computed",
          key: pageFamily,
          detail: `annual peak months=${cliff.monthsLabel} daysToClose=${cliff.daysToClose} confidence=${cliff.confidence}`,
        },
      ],
    });
    scoreContribution.scoreMultiplier = 0.85;
    confidence = cliff.confidence === "repeated" ? 0.7 : 0.5;

    return {
      specialist: "seasonal",
      claim,
      evidenceRefs: [
        {
          specialist: "seasonal",
          source: "computed",
          key: pageFamily,
          detail: `annual peak months=${cliff.monthsLabel} confidence=${cliff.confidence}`,
        },
      ],
      confidence,
      suggestedMoveTypes: [],
      objections,
      scoreContribution,
      staleAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  // Proactive prep: the family's next annual window opens 4-8 weeks out.
  const annual = profile.annual[0];
  if (annual) {
    const daysOut = daysUntilNextStart(annual.months, now);
    const weeksOut = daysOut / WEEK_DAYS;
    if (weeksOut >= PREP_LEAD_MIN_WEEKS && weeksOut <= PREP_LEAD_MAX_WEEKS) {
      const roundedWeeks = Math.round(weeksOut);
      const confidenceWord = annual.confidence === "repeated" ? "repeats every year" : "showed up once so far";
      claim = `Demand for this page's family starts climbing toward ${monthWindowLabel(annual.months)} in about ${roundedWeeks} weeks (it ${confidenceWord}). Prep now so this is live before the wave.`;
      confidence = annual.confidence === "repeated" ? 0.65 : 0.45;
      return {
        specialist: "seasonal",
        claim,
        evidenceRefs: [
          {
            specialist: "seasonal",
            source: "computed",
            key: pageFamily,
            detail: `annual peak months=${monthWindowLabel(annual.months)} weeksOut=${roundedWeeks} confidence=${annual.confidence}`,
          },
        ],
        confidence,
        suggestedMoveTypes: [],
        objections: [],
        scoreContribution: {},
        staleAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }
  }

  return null; // profile known but neither a cliff nor an approaching window right now -> stay silent
}
