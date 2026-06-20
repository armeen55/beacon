import "server-only";

/**
 * GSC Proof ledger — read loader (Phase 5, Path B).
 *
 * Loads the tenant's shipped-change records and RE-MEASURES each against fresh
 * GSC on read (no cron — same on-demand posture as the proof recompute action).
 * Returns display-ready records; does not persist (a GET stays side-effect-free).
 */

import { loadShippedChanges, type ShippedChangeRecord } from "./shipped-change-store";
import { measureRecord } from "./run-measurement";

export async function loadProofLedger(
  tenantId: string,
  now: Date = new Date(),
): Promise<ShippedChangeRecord[]> {
  const records = await loadShippedChanges().catch(() => [] as ShippedChangeRecord[]);
  if (records.length === 0) return [];
  const measured = await Promise.all(
    records.map((r) => measureRecord(tenantId, r, now).catch(() => r)),
  );
  return measured;
}
