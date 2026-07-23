/**
 * compute-scoreboard (2026-07-02, master plan item 38) - the I/O edge that joins the proof ledger's
 * SETTLED verdicts back to the TeamReview voices frozen on the daily plan pick that shipped them,
 * scores every voice with brier.ts, and persists a full recompute to the team-scoreboard store.
 *
 * Join (generalizes findForecastedPickForProofId in forecast-calibration.ts): a settled
 * ShippedChangeRecord's id is the proofId written onto `plan.execution.items[pickId].proofId` at
 * activation time; pickId then looks up the frozen pick in `plan.selected`, which carries the
 * `teamReview` the team argued at planning time (team-review.ts). We read plans + the ledger once
 * each and join in memory - the same shape run-measurement.ts already uses for the calibration
 * ledger (items 27/28), just generalized to fetch the WHOLE pick record instead of only its
 * forecast fields.
 *
 * Eligibility mirrors src/domains/learning/load-experiment-outcomes.ts EXACTLY: a settled row must
 * clear deriveMeasurementMaturity's "mature_result" gate (28-day window closed, sufficient controls
 * and baseline impressions, a real won/lost call) AND not be quarantined by an accidental same-page
 * overlap or a detected algorithm-weather shock. A row that fails any of those reads as still
 * "measuring" and contributes NO vote - the scoreboard trains on final answers only, exactly like
 * the learning prior does, and for the same reason (a 7/14-day read can still reverse).
 *
 * Deterministic, $0, idempotent: a full recompute from the ledger + plans every time, no
 * incremental state to corrupt. NEVER mutates a plan record or a ledger row - read-only over both.
 */
import "server-only";

import { loadShippedChanges, type ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { readRecordsForLearning, learningVerdictOf } from "@/domains/proof-gsc/kernel";
import { actionFamilyOf } from "@/domains/proof-gsc/change-family";

// The experiments domain (daily plans, team-review) was removed. Minimal inline types keep this
// module's exported contract intact; with no plan store to read, the settled-verdict -> team-review
// join simply finds nothing (settledJoined stays 0) and the scoreboard falls back to its
// fresh-tenant empty shape.
type TeamReview = {
  voices: Array<{ specialist: string; label: string; confidencePct: number }>;
  objections: Array<{ label: string; severity: "veto" | "downgrade" }>;
};
type PlannedExperimentRecord = { id: string; teamReview?: TeamReview };
type DailyExperimentPlanRecord = {
  execution?: { items?: Record<string, { proofId?: string }> };
  selected: PlannedExperimentRecord[];
};
import {
  voiceProbability,
  dissentProbability,
  buildSpecialistScoreboard,
  type ScoredVote,
  type SpecialistScoreboardRow,
} from "./brier";
import {
  buildCalibrationBands,
  buildObjectionTrackRecord,
  type ConvictionObservation,
  type ObjectionObservation,
} from "./calibration";
import { writeTeamScoreboard } from "./team-scoreboard-store";

/** Same generous history window run-measurement.ts already uses for the calibration join (items
 *  27/28) - plans are daily, so this covers roughly 3-4 months of nightly batches. */
const PLAN_HISTORY_LIMIT = 120;

/** Below this many settled votes for a specialist, its Brier score still computes but the surface
 *  contract (item 38) keeps the standup footer silent - see buildBestForecasterLine's caller. */
export const MIN_SETTLED_PICKS_FOR_FOOTER = 5;

/**
 * Find the plan pick that activated into this settled proof row, generalizing
 * findForecastedPickForProofId (forecast-calibration.ts) to return the FULL pick record (so its
 * teamReview and actionType-bearing lever are available) instead of only the numeric forecast.
 * PURE. Returns null when no plan recorded this proofId (old ledger rows shipped before the daily
 * plan/execution machinery existed, or a manually-recorded change with no plan behind it) - those
 * settle honestly with zero votes, never a fabricated join.
 */
export function findPlanPickForProofId(
  plans: DailyExperimentPlanRecord[],
  proofId: string,
): PlannedExperimentRecord | null {
  for (const plan of plans) {
    const items = plan.execution?.items ?? {};
    for (const [pickId, item] of Object.entries(items)) {
      if (item.proofId !== proofId) continue;
      return plan.selected.find((p) => p.id === pickId) ?? null;
    }
  }
  return null;
}

/** Turn one settled record's team review into scored votes: one per supporting voice, one per
 *  dissenting (objecting) specialist. team-review.ts persists a supporting voice keyed by its raw
 *  specialist id (`voices[].specialist`, e.g. "gsc") but an objection only by its plain operator
 *  label (`objections[].label`, e.g. "Search demand" - the raw key is dropped when team-review.ts
 *  builds the persisted record from debate-summary.ts's richer DebateObjection). So specialist
 *  IDENTITY for scoring is the voice's raw key when it supported, or its plain label when it only
 *  objected - both land in the same `specialist` field on the vote, and the standup surface already
 *  runs every specialist key through teammateOf(), which tolerates an unknown key by falling back to
 *  a neutral "Specialist" identity rather than crashing. A specialist that both supports and objects
 *  on the same pick is scored once, on its supporting claim (its raw key wins the dedupe below). */
export function votesFromTeamReview(
  review: TeamReview,
  actionFamily: string,
  outcome: 0 | 1,
): ScoredVote[] {
  const supportingLabels = new Set(review.voices.map((v) => v.label));
  const votes: ScoredVote[] = review.voices.map((v) => ({
    specialist: v.specialist,
    actionFamily,
    probability: voiceProbability("supporting", v.confidencePct),
    outcome,
  }));
  for (const o of review.objections) {
    if (supportingLabels.has(o.label)) continue; // already scored via its supporting claim above
    votes.push({
      specialist: o.label,
      actionFamily,
      probability: dissentProbability(o.severity),
      outcome,
    });
  }
  return votes;
}

/** Item 43 - one conviction observation per SUPPORTING voice on this settled pick (dissenting voices
 *  carry no stated conviction, only a severity, so they never feed the calibration bands - see
 *  calibration.ts's module doc). Raw `confidencePct` is kept (not the derived win probability) since
 *  banding reads "how sure it sounded", the same number the operator sees on the card. Keyed by the
 *  voice's raw specialist id, same identity convention as votesFromTeamReview's supporting branch. */
export function convictionObservationsFromTeamReview(review: TeamReview, outcome: 0 | 1): ConvictionObservation[] {
  return review.voices.map((v) => ({ specialist: v.specialist, conviction: v.confidencePct, outcome }));
}

/** Item 43 - one objection observation per objector on this settled pick. A pick only reaches
 *  plan.selected (and so only ever settles) when the team review did NOT veto it off content work
 *  (team-review.ts: a content-routing veto removes the candidate from the batch entirely) - so every
 *  objection joined here already shipped over the objector's concern, exactly the "ships over an
 *  objection" case item 43 asks for. Keyed by the objector's plain label (objections carry no raw
 *  specialist key - see votesFromTeamReview's doc). */
export function objectionObservationsFromTeamReview(review: TeamReview, outcome: 0 | 1): ObjectionObservation[] {
  return review.objections.map((o) => ({ objectorLabel: o.label, severity: o.severity, outcome }));
}

export type TeamScoreboardSummary = {
  rows: SpecialistScoreboardRow[];
  settledJoined: number;
  totalSettled: number;
  computedAt: string;
};

/**
 * Full recompute: read the ledger + plan history once, join every SETTLED (mature, unquarantined)
 * record to the plan pick that shipped it, score every voice on that pick's team review against the
 * real outcome, and aggregate. Read-only over both the ledger and plans - never writes back to
 * either. Fail-soft: any read failure yields an empty scoreboard rather than a thrown error, since
 * this always rides as an isolated tail step (see the measure-pass wiring).
 */
export async function buildTeamScoreboardSummary(tenantId: string, now: Date = new Date()): Promise<TeamScoreboardSummary> {
  let records: ShippedChangeRecord[];
  // The daily-plan store was removed with the experiments domain; there are no plans to join, so
  // every settled row settles honestly with zero votes (settledJoined = 0) instead of a fabricated
  // join. The scoreboard then reads with its fresh-tenant defaults, exactly like a tenant that
  // never settled a plan-backed pick.
  const plans: DailyExperimentPlanRecord[] = [];
  try {
    records = await loadShippedChanges();
  } catch {
    return { rows: [], settledJoined: 0, totalSettled: 0, computedAt: now.toISOString() };
  }

  const settledVerdicts = readRecordsForLearning(records, now).map(learningVerdictOf);

  let totalSettled = 0;
  let settledJoined = 0;
  const votes: ScoredVote[] = [];
  // Item 43 - the same settled-and-joined picks, additionally read for conviction bands (keyed by
  // specialist) and the objection track record (keyed by objector label, tenant-wide).
  const convictionsBySpecialist = new Map<string, ConvictionObservation[]>();
  const objectionObservations: ObjectionObservation[] = [];

  for (let idx = 0; idx < records.length; idx += 1) {
    const r = records[idx];
    const verdict = settledVerdicts[idx];
    if (verdict !== "won" && verdict !== "lost") continue; // only a real settled call carries a vote
    totalSettled++;

    const pick = findPlanPickForProofId(plans, r.id);
    const review = pick?.teamReview;
    if (!review) continue; // no plan/no team review behind this ship - honest skip, not a guess

    settledJoined++;
    const outcome: 0 | 1 = verdict === "won" ? 1 : 0;
    const actionFamily = actionFamilyOf(r.actionType);
    votes.push(...votesFromTeamReview(review, actionFamily, outcome));

    for (const obs of convictionObservationsFromTeamReview(review, outcome)) {
      const arr = convictionsBySpecialist.get(obs.specialist) ?? [];
      arr.push(obs);
      convictionsBySpecialist.set(obs.specialist, arr);
    }
    objectionObservations.push(...objectionObservationsFromTeamReview(review, outcome));
  }

  const rows = buildSpecialistScoreboard(votes);
  const objectionTrackRecord = buildObjectionTrackRecord(objectionObservations);
  const computedAt = now.toISOString();

  await writeTeamScoreboard({
    tenant_id: tenantId,
    computed_at: computedAt,
    total_settled: totalSettled,
    settled_joined: settledJoined,
    specialists: rows.map((row) => ({
      specialist: row.specialist,
      overall: row.overall,
      by_family: row.byFamily,
      calibration_bands: buildCalibrationBands(convictionsBySpecialist.get(row.specialist) ?? []),
    })),
    objections: objectionTrackRecord,
  });

  return { rows, settledJoined, totalSettled, computedAt };
}
