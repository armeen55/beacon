/**
 * load-team-scoreboard (2026-07-02, master plan item 38; item 43 adds the accountability layer) -
 * the $0 read edge for surfaces: the tenant's last-computed specialist scoreboard, plus the honest
 * one-line reads a standup strip can show verbatim. Never recomputes (that is compute-scoreboard.ts's
 * job, run from the measure-pass tail) - this only reads what the last recompute persisted.
 * Fail-soft -> null/silent throughout.
 */
import "server-only";

import { teammateOf } from "@/domains/team/identity";
import { buildBestForecasterLine, recordLine, type SpecialistScoreboardRow } from "./brier";
import { buildCalibrationLine, buildObjectionTrackRecordLine, type BandTally, type ObjectionTally } from "./calibration";
import { loadTeamScoreboard, type TeamScoreboardSnapshot } from "./team-scoreboard-store";

/** Below this many settled-and-joined picks, the standup footer stays silent (item 38's surface
 *  contract) - a best-forecaster claim off a handful of picks is not yet honest. */
export const MIN_SETTLED_FOR_STANDUP_FOOTER = 5;

export type TeamScoreboardView = {
  snapshot: TeamScoreboardSnapshot;
  rows: SpecialistScoreboardRow[];
  /** Null below MIN_SETTLED_FOR_STANDUP_FOOTER settled-and-joined picks, or when no specialist
   *  clears the footer's own minimum sample bar. */
  footerLine: string | null;
  /** Item 43 - the honest conviction-calibration sentence for whichever specialist has the most
   *  banded observations clearing its own 5-observation minimum, e.g. "Search demand argues at 80
   *  percent conviction and is right 74 percent of the time." Null below the bar or on a snapshot
   *  written before item 43 shipped (no calibration_bands on any specialist). */
  calibrationLine: string | null;
  /** Item 43 - the honest objection-track-record sentence for the objector with the most objections
   *  clearing its own 5-observation minimum, e.g. "Visitor behavior objected 4 times this quarter and
   *  was right twice." Null below the bar or when nothing has ever shipped over an objection. */
  objectionLine: string | null;
};

function toRows(snapshot: TeamScoreboardSnapshot): SpecialistScoreboardRow[] {
  return snapshot.specialists.map((s) => ({ specialist: s.specialist, overall: s.overall, byFamily: s.by_family }));
}

/** Item 43 - pick the calibration line from the specialist with the most total banded observations
 *  (ties broken by name), so the standup surface always leads with the specialist that has argued
 *  the most, not an arbitrary array order. Null when nobody has calibration_bands yet (an old
 *  snapshot from before item 43, or a snapshot with zero settled+joined picks) or nobody clears the
 *  calibration line's own small-n bar. */
function bestCalibrationLine(snapshot: TeamScoreboardSnapshot): string | null {
  let best: { label: string; bands: BandTally[]; total: number } | null = null;
  for (const s of snapshot.specialists) {
    const bands = s.calibration_bands;
    if (!bands) continue;
    const total = bands.reduce((sum, b) => sum + b.n, 0);
    if (total === 0) continue;
    if (!best || total > best.total || (total === best.total && s.specialist < best.label)) {
      best = { label: teammateOf(s.specialist).name, bands, total };
    }
  }
  return best ? buildCalibrationLine(best.label, best.bands) : null;
}

/** The tenant's last-computed scoreboard, view-ready. Null when it has never run. */
export async function loadTeamScoreboardView(tenantId: string): Promise<TeamScoreboardView | null> {
  let snapshot: TeamScoreboardSnapshot | null;
  try {
    snapshot = await loadTeamScoreboard(tenantId);
  } catch {
    return null;
  }
  if (!snapshot) return null;
  const rows = toRows(snapshot);
  const footerLine =
    snapshot.settled_joined >= MIN_SETTLED_FOR_STANDUP_FOOTER
      ? buildBestForecasterLine(rows, MIN_SETTLED_FOR_STANDUP_FOOTER, (specialist) => teammateOf(specialist).name)
      : null;
  const calibrationLine = bestCalibrationLine(snapshot);
  const objectionLine = buildObjectionTrackRecordLine(snapshot.objections ?? []);
  return { snapshot, rows, footerLine, calibrationLine, objectionLine };
}

/** One specialist's tiny record line ("5 of 6"), or null when it has no settled votes yet. Reads
 *  the last-computed scoreboard - $0, no recompute. Used by a chip that wants a per-specialist
 *  record without pulling the whole view. */
export async function loadSpecialistRecordLine(tenantId: string, specialist: string): Promise<string | null> {
  let snapshot: TeamScoreboardSnapshot | null;
  try {
    snapshot = await loadTeamScoreboard(tenantId);
  } catch {
    return null;
  }
  const row = snapshot?.specialists.find((s) => s.specialist === specialist);
  return row ? recordLine(row.overall) : null;
}

/** Item 43 - one specialist's own calibration line ("argues at 80 percent conviction and is right 74
 *  percent of the time"), for a chip's tooltip/detail. Null when that specialist has no
 *  calibration_bands yet, or none of its bands clear the 5-observation minimum. Reads the
 *  last-computed scoreboard only - $0, no recompute. */
export async function loadSpecialistCalibrationLine(tenantId: string, specialist: string): Promise<string | null> {
  let snapshot: TeamScoreboardSnapshot | null;
  try {
    snapshot = await loadTeamScoreboard(tenantId);
  } catch {
    return null;
  }
  const row = snapshot?.specialists.find((s) => s.specialist === specialist);
  const bands = row?.calibration_bands;
  if (!bands) return null;
  return buildCalibrationLine(teammateOf(specialist).name, bands);
}

/** Item 43 - the full tenant-wide objection track record, view-ready (empty array when the
 *  scoreboard has never run or nothing has ever objected). Used by a detail view that wants every
 *  objector's numbers, not just the single headline sentence. */
export async function loadObjectionTrackRecord(tenantId: string): Promise<ObjectionTally[]> {
  try {
    const snapshot = await loadTeamScoreboard(tenantId);
    return snapshot?.objections ?? [];
  } catch {
    return [];
  }
}
