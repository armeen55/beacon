import "server-only";

/**
 * IndexNow ping receipts (BEACON_500 item 75, 2026-07-02).
 *
 * Per-tenant append-only log of every IndexNow ping attempt, so the operator
 * surface can say "I told Bing 12 minutes after this went live" instead of
 * inventing an index-status claim we cannot verify. One receipt per attempt
 * (not per URL in the batch) — v1 always pings one URL at a time (the just
 * -verified-live change), so url/receipt are 1:1.
 *
 * Registered as a per-tenant array store ("indexnow-receipts") in
 * `src/lib/persistence/store-classification.ts`.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "indexnow-receipts";
/** Keep the trail bounded; the UI only ever shows the last 5. */
const MAX_RECEIPTS = 100;

export type IndexNowReceipt = {
  id: string;
  url: string;
  /** ISO 8601 — when the ping was attempted. */
  pingedAt: string;
  ok: boolean;
  /** HTTP status returned by api.indexnow.org, or null on a network failure. */
  status: number | null;
  /** Short human-readable outcome, e.g. "accepted" or "network error". */
  detail: string;
};

function normalizeList(raw: unknown): IndexNowReceipt[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is IndexNowReceipt =>
      x != null &&
      typeof x === "object" &&
      typeof (x as IndexNowReceipt).id === "string" &&
      typeof (x as IndexNowReceipt).url === "string" &&
      typeof (x as IndexNowReceipt).pingedAt === "string",
  );
}

/** Newest-first receipts for the current tenant. Fail-soft to empty. */
export async function getIndexNowReceipts(): Promise<IndexNowReceipt[]> {
  try {
    return normalizeList(await readStore<IndexNowReceipt>(STORE));
  } catch {
    return [];
  }
}

/** Prepend one receipt (newest first) and persist, capped. Fail-soft: a
 *  receipt-write failure never surfaces as an error to the publish path
 *  that triggered it (observability only). */
export async function appendIndexNowReceipt(receipt: IndexNowReceipt): Promise<void> {
  try {
    const existing = await getIndexNowReceipts();
    await writeStore<IndexNowReceipt>(STORE, [receipt, ...existing].slice(0, MAX_RECEIPTS));
  } catch {
    /* observability only - never throw from a receipt write */
  }
}
