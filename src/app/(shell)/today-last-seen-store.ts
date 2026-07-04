import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";

/**
 * today-last-seen-store (P21, v1 238 - "while you were away") - a tiny per-tenant
 * record of the operator's LAST visit to Today: when they last looked, and a snapshot
 * of the canonical lifecycle counts at that moment (decided + won + toDo). The
 * while-you-were-away block reads this on the next visit and reports only the DELTA -
 * how many changes finished measuring, how many won, how many new opportunities
 * appeared - then writes a fresh mark so the same news never shows twice.
 *
 * Server truth (not localStorage) so "while you were away" survives a refresh or a
 * different device, matching every other count on Today. Same discipline as
 * results-surface-store.ts: tenant-scoped (store-classification.ts), Supabase-mirrored
 * (json-store.ts), fail-soft (a read/write outage hides the block, never throws into
 * the page render). Snapshotting counts (not raw rows) keeps this row tiny and means
 * the delta is computed against the SAME numbers Results and the tiles show.
 */

const STORE = "today-last-seen";

/** The three canonical lifecycle counts we snapshot to diff against next visit. All
 *  come from the shared FP3 lifecycle loader, so the delta can never contradict the
 *  tiles, the measuring strip, or Results. */
export type LastSeenCounts = {
  /** Shipped changes with a final read (mature won or lost). Results' decided total. */
  decided: number;
  /** The subset of decided whose verdict is "won". Results' Wins band. */
  won: number;
  /** Open ideas on the canonical Changes list. */
  toDo: number;
};

export type TodayLastSeenRow = {
  /** ISO timestamp of the operator's previous Today visit. */
  seenAt: string;
  /** The canonical counts captured at that previous visit. */
  counts: LastSeenCounts;
};

/** Read the previous visit mark, or null on first-ever visit / any store outage. */
export async function readTodayLastSeen(): Promise<TodayLastSeenRow | null> {
  const rows = await readStore<TodayLastSeenRow>(STORE, []).catch(() => [] as TodayLastSeenRow[]);
  const row = rows[0];
  if (!row || typeof row.seenAt !== "string" || !row.counts) return null;
  return row;
}

/** Stamp this visit as the new "last seen" mark. Fail-soft: a write outage just means
 *  the next visit compares against the older mark (or hides), never a thrown render. */
export async function writeTodayLastSeen(
  counts: LastSeenCounts,
  seenAtIso: string,
): Promise<void> {
  await writeStore<TodayLastSeenRow>(STORE, [{ seenAt: seenAtIso, counts }]).catch(() => {});
}
