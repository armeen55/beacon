/**
 * team-scoreboard-store (2026-07-02, master plan item 38; item 43 adds calibration + objections) -
 * persistence for the specialist scoreboard: per-specialist and per (specialist, actionFamily)
 * won/flat/lost tallies + Brier scores, recomputed FULLY from the proof ledger + plan history every
 * time compute-scoreboard.ts runs. Idempotent full-replace posture - the latest write always
 * replaces the tenant's whole scoreboard, no incremental state to corrupt, exactly like
 * algorithm-weather-store.ts's "latest wins" pattern for its own per-tenant summary row.
 *
 * Follows the algorithm-weather-store.ts sibling pattern exactly: a GLOBAL json-store (rows carry
 * tenant_id because the measure-pass tail fans out with no ambient request context) that is
 * Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Item 43 (2026-07-02) - additive accountability fields, both optional so an OLD stored row (written
 * before this shipped) still parses unchanged:
 *   - `specialists[].calibration_bands`: per-specialist conviction-band win rates (calibration.ts).
 *   - `objections`: the tenant-wide objector track record (calibration.ts), a SEPARATE top-level
 *     array (not per-specialist) because an objection is keyed by its plain label, which need not
 *     match any specialist's raw key (see compute-scoreboard.ts's votesFromTeamReview doc).
 */
import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { Tally } from "./brier";
import type { BandTally, ObjectionTally } from "./calibration";

const STORE = "team-scoreboard";

/** One tenant's full scoreboard as of its last recompute - one row per tenant, "latest wins". */
export type TeamScoreboardSnapshot = {
  tenant_id: string;
  computed_at: string;
  /** How many settled (mature, unquarantined) ledger rows this recompute found in total. */
  total_settled: number;
  /** Of those, how many joined to a plan pick that carried a team review (and so contributed
   *  votes). The gap between total_settled and settled_joined is honest: old ledger rows shipped
   *  before the daily-plan/team-review machinery existed, or manually-recorded changes with no
   *  plan behind them, never produce a fabricated vote. */
  settled_joined: number;
  specialists: Array<{
    specialist: string;
    overall: Tally;
    by_family: Record<string, Tally>;
    /** Item 43 - this specialist's realized win rate per conviction band, from its supporting votes
     *  only (a dissenting vote has no stated conviction to band - see calibration.ts). Absent on
     *  rows written before item 43 shipped; a fresh recompute always includes all 4 bands. */
    calibration_bands?: BandTally[];
  }>;
  /** Item 43 - the tenant-wide objection track record: for every objector label that raised an
   *  objection on a pick that shipped anyway, how many times it objected and how often it was
   *  right (the pick lost or landed flat) vs wrong (the pick won anyway). Absent on rows written
   *  before item 43 shipped; a fresh recompute always includes this key (possibly an empty array). */
  objections?: ObjectionTally[];
};

async function readAll(): Promise<TeamScoreboardSnapshot[]> {
  try {
    return (await readStore<TeamScoreboardSnapshot>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/**
 * Full recompute write: replace this tenant's entire scoreboard snapshot in one shot. Idempotent -
 * calling it twice with the same input yields the same stored state. An empty `specialists` array
 * is written too ("recomputed, nothing settled yet" is a different truth from "never computed").
 */
export async function writeTeamScoreboard(snapshot: TeamScoreboardSnapshot): Promise<void> {
  const rows = await readAll();
  const others = rows.filter((r) => r.tenant_id !== snapshot.tenant_id);
  await writeStore(STORE, [...others, snapshot]);
}

/** The tenant's latest scoreboard snapshot, or null when it has never run. Fail-soft -> null. */
export async function loadTeamScoreboard(tenantId: string): Promise<TeamScoreboardSnapshot | null> {
  const rows = await readAll();
  const mine = rows.filter((r) => r.tenant_id === tenantId).sort((a, b) => b.computed_at.localeCompare(a.computed_at));
  return mine[0] ?? null;
}
