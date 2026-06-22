import "server-only";

import { after } from "next/server";

import { log } from "@/lib/logger";
import { autoRefreshStaleConnectorsForTenant } from "./cron-sync";

/**
 * On-USE connector auto-refresh (2026-06-22) — replaces "click Pull my data".
 *
 * Call this from the app shell. It schedules a connector refresh via next/after
 * so it runs AFTER the response is sent (zero added page latency), and the
 * refresh itself only touches sources whose data is stale (per-provider
 * threshold, gated by the durable last_synced_at), so firing it on every app
 * visit can't hammer egress or paid API quota. Fully fail-soft: a missing
 * request scope, a thrown sync, or anything else is swallowed — it can NEVER
 * break or slow the page it's attached to.
 */
export function scheduleConnectorAutoRefresh(tenantId: string): void {
  if (!tenantId) return;
  try {
    after(async () => {
      try {
        const results = await autoRefreshStaleConnectorsForTenant(tenantId);
        if (results.length > 0) {
          log.info("[auto-refresh] on-use refresh ran", {
            tenantId,
            refreshed: results.length,
            ok: results.filter((r) => r.ok).length,
          });
        }
      } catch (e) {
        log.warn("[auto-refresh] on-use refresh failed (non-blocking)", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  } catch {
    // after() is only valid inside a request scope — ignore outside one.
  }
}
