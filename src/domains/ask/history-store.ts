import "server-only";

/**
 * ask/history-store (BEACON_500 item 59) - the /ask chat's recent Q+A history. Follows
 * the adjudicator-history/strategy-mix-history sibling pattern exactly: readStore/
 * writeStore (registered in store-classification.ts's TENANT_SCOPED_STORES, mirrored to
 * Supabase in json-store.ts's SUPABASE_MIRRORED_STORES so it survives Vercel's
 * read-only lambda filesystem), append-only, capped at MAX_HISTORY entries so the file
 * never grows unbounded. Per-tenant (the file itself is tenant-routed - no tenant_id
 * column needed on each row, matching page-snapshots/scan-findings and every other
 * simple per-tenant array store).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { AskHistoryEntry } from "./types";

const STORE = "ask-history";

/** Keep at most this many recent Q+A entries per tenant (oldest dropped first). */
export const MAX_HISTORY = 50;

async function readAll(): Promise<AskHistoryEntry[]> {
  try {
    return (await readStore<AskHistoryEntry>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/** Full history, newest first. Fail-soft -> []. */
export async function loadAskHistory(): Promise<AskHistoryEntry[]> {
  const rows = await readAll();
  return [...rows].sort((a, b) => b.askedAt.localeCompare(a.askedAt));
}

/** Append one Q+A entry, capped at MAX_HISTORY (oldest dropped first). Fail-soft: a
 *  write failure never blocks the operator from seeing the answer they just got - it
 *  only means this one turn won't persist into history. */
export async function appendAskHistory(entry: AskHistoryEntry): Promise<boolean> {
  try {
    const rows = await readAll();
    const trimmed = [...rows, entry].sort((a, b) => a.askedAt.localeCompare(b.askedAt)).slice(-MAX_HISTORY);
    await writeStore(STORE, trimmed);
    return true;
  } catch {
    return false;
  }
}
