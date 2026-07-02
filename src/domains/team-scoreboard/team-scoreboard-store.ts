/**
 * team-scoreboard-store (2026-07-02, master plan item 38) - persistence for the specialist
 * scoreboard: per-specialist and per (specialist, actionFamily) won/flat/lost tallies + Brier
 * scores, recomputed FULLY from the proof ledger + plan history every time compute-scoreboard.ts
 * runs. Idempotent full-replace posture - the latest write always replaces the tenant's whole
 * scoreboard, no incremental state to corrupt, exactly like algorithm-weather-store.ts's
 * "latest wins" pattern for its own per-tenant summary row.
 *
 * Follows the algorithm-weather-store.ts sibling pattern exactly: a GLOBAL json-store (rows carry
 * tenant_id because the measure-pass tail fans out with no ambient request context) that is
 * Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts (SUPABASE_MIRRORED_STORES).
 */
import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { Tally } from "./brier";

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
  }>;
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
