/**
 * load-team-scoreboard (2026-07-02, master plan item 38) - the $0 read edge for surfaces: the
 * tenant's last-computed specialist scoreboard, plus the one honest standup-footer sentence naming
 * the best forecaster. Never recomputes (that is compute-scoreboard.ts's job, run from the
 * measure-pass tail) - this only reads what the last recompute persisted. Fail-soft -> null/silent.
 */
import "server-only";

import { teammateOf } from "@/domains/team/identity";
import { buildBestForecasterLine, recordLine, type SpecialistScoreboardRow } from "./brier";
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
};

function toRows(snapshot: TeamScoreboardSnapshot): SpecialistScoreboardRow[] {
  return snapshot.specialists.map((s) => ({ specialist: s.specialist, overall: s.overall, byFamily: s.by_family }));
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
  return { snapshot, rows, footerLine };
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
