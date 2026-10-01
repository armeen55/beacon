import "server-only";

/** Watermarks bind heavy evidence aggregates to the current source data.
 * Failed or partial computations never become the day's bank; store failures serve live.
 * Each tenant shares pending reads; SQL merges complete rows across instances.
 * Only the returned acknowledged bank is cached, never an uncommitted candidate. */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const STORE = "daily-evidence";

type Row = { tenant_id: string; kind: string; watermark: string; computedAt: string; payload: unknown };

/** ONE BLOB READ PER PASS, NOT FOUR. Each of the four readers asked the store for the whole blob to find its
 *  own kind, so a single rebuild pulled the same ~700KB four times: the cache that fixed pool saturation was
 *  quietly the account's biggest egress line (measured live by the cost trace). The blob is shared in-process
 *  for a few seconds, exactly long enough for one pass's four readers; a write refreshes it. */
const SHARE_MS = process.env.VITEST === "true" ? 0 : 45_000; // hermetic tests re-read per call, the same convention the credit breaker uses
const shared = new Map<string, { rows: Promise<Row[]>; at: number }>();
function readRows(tenantId: string, saved?: Promise<Row[]>): Promise<Row[]> {
  const held = shared.get(tenantId);
  const current = held && Date.now() - held.at < SHARE_MS;
  if (!saved && current) return held.rows;
  const slot = { rows: saved ?? readStore<Row>(STORE, [], { tenantId }), at: Infinity };
  shared.set(tenantId, slot);
  slot.rows = slot.rows.then(
    rows => { slot.at = Date.now(); return rows; },
    error => {
      if (shared.get(tenantId) === slot) {
        if (held && Number.isFinite(held.at)) shared.set(tenantId, held); else shared.delete(tenantId);
      }
      throw error;
    });
  return slot.rows;
}

export async function readThroughDaily<P>(args: {
  tenantId: string; kind: string; watermark: string | null;
  compute: () => Promise<{ payload: P; cacheable: boolean }>;
}): Promise<P> {
  const { tenantId, kind, watermark } = args;
  // No watermark means the cheap max(date) probe itself failed: compute live, bank nothing.
  if (watermark) {
    try {
      const rows = await readRows(tenantId);
      const mine = rows.find((r) => r.tenant_id === tenantId && r.kind === kind);
      if (mine && mine.watermark === watermark) return mine.payload as P;
    } catch { /* an unreadable store is a cache miss, never an outage */ }
  }
  const fresh = await args.compute();
  if (watermark && fresh.cacheable) {
    try {
      await readRows(tenantId, writeStore<Row>(STORE,
        [{ tenant_id: tenantId, kind, watermark, computedAt: new Date().toISOString(), payload: fresh.payload }], { tenantId }));
    } catch (e) {
      log.warn("[daily-read-cache] the day's row did not persist; served live and the next read pays again", { tenantId, kind, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return fresh.payload;
}
