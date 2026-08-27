import "server-only";

/** evidence/readers/daily-read-cache - ONE DURABLE READ-THROUGH for the heaviest evidence aggregates, keyed by
 *  the data's own watermark. The four GSC/GA4 aggregates cost 1.6 to 6.3 seconds of PostgREST pool time each,
 *  and request-scoped `cache()` "degrades to a no-op outside a React request scope" (ga4-page-values' own
 *  words), so the scheduler and every release rebuild re-paid all four on every pass: 1,008 + 1,457 + 1,505
 *  calls in under four days against a 9-connection PostgREST pool. Under any overlap the pool saturated,
 *  queued requests hit 60-195s origin times, the gateway returned "upstream request timeout", the GSC read
 *  died at the client's own deadline, produce-proposals declared the pass blind, publication refused, and the
 *  customer release went stale for 8+ hours while the sign-in membership read timed out on the same jammed
 *  pool ("Your connection could not be checked twice in a row"). The database itself was IDLE the whole time.
 *  THE WATERMARK IS THE KEY, so invalidation is the data moving and nothing else: a sync that lands new rows
 *  moves max(date) and the next read recomputes; a same-day re-read is one small store row. A FAILED OR
 *  PARTIAL COMPUTE IS NEVER BANKED (`cacheable: false`), because a failure cached durably is a lie the whole
 *  account reads back all day, where today it dies with the request. Store failures fail open to the live
 *  compute, exactly the behavior every caller has today. */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const STORE = "daily-evidence";

type Row = { tenant_id: string; kind: string; watermark: string; computedAt: string; payload: unknown };

/** ONE BLOB READ PER PASS, NOT FOUR. Each of the four readers asked the store for the whole blob to find its
 *  own kind, so a single rebuild pulled the same ~700KB four times: the cache that fixed pool saturation was
 *  quietly the account's biggest egress line (measured live by the cost trace). The blob is shared in-process
 *  for a few seconds, exactly long enough for one pass's four readers; a write refreshes it. */
const SHARE_MS = process.env.VITEST === "true" ? 0 : 45_000; // hermetic tests re-read per call, the same convention the credit breaker uses
const shared = new Map<string, { rows: Row[]; at: number }>();
async function readRows(tenantId: string): Promise<Row[]> {
  const held = shared.get(tenantId);
  if (held && Date.now() - held.at < SHARE_MS) return held.rows;
  const rows = await readStore<Row>(STORE, [], { tenantId });
  shared.set(tenantId, { rows, at: Date.now() });
  return rows;
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
      const rows = await readRows(tenantId);
      const next = [...rows.filter((r) => !(r.tenant_id === tenantId && r.kind === kind)),
        { tenant_id: tenantId, kind, watermark, computedAt: new Date().toISOString(), payload: fresh.payload }];
      await writeStore<Row>(STORE, next, { tenantId });
      shared.set(tenantId, { rows: next, at: Date.now() });
    } catch (e) {
      log.warn("[daily-read-cache] the day's row did not persist; served live and the next read pays again", { tenantId, kind, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return fresh.payload;
}
