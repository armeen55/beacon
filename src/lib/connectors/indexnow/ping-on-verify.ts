import "server-only";

/**
 * The verify-live -> IndexNow wiring point (BEACON_500 item 75, 2026-07-02).
 *
 * Called ONLY after `probeLiveText` (src/domains/push/push-service.ts)
 * authoritatively confirms a change is live on an operator-approved publish.
 * This is a standards-based change notification for an ALREADY-published
 * page, not a new outward channel: nothing here ever fires before a human
 * has approved the push AND the push has landed AND the live probe found the
 * text on the page.
 *
 * Fire-and-forget + fail-soft: a failed or skipped ping never affects the
 * publish result the caller already returned to the operator. Every attempt
 * (or self-hidden skip) is NOT separately receipted when skipped - a receipt
 * only exists for an actual ping attempt, so the diagnostics trail stays
 * honest ("I pinged Bing for this page" means a network call really
 * happened).
 *
 * Self-hiding: with no per-tenant IndexNow key configured, this is a no-op.
 * Ritz (tenant-ritz-founder) can never reach this path because it is only
 * ever called downstream of a live write, and the existing push rails
 * hard-refuse Ritz before any write happens.
 */

import { log } from "@/lib/logger";
import { pingIndexNowForUrl } from "./client";
import { getIndexNowConfig } from "./config-store";
import { appendIndexNowReceipt, type IndexNowReceipt } from "./receipts-store";
import { getTenant } from "@/domains/tenants/store";

/**
 * Ping IndexNow for one URL that was just confirmed live, and record a
 * receipt. NEVER throws. No-op (no receipt written) when the tenant has not
 * configured an IndexNow key - that is the documented self-hide, not a
 * failure.
 */
export async function pingIndexNowOnVerifiedLive(args: {
  tenantId: string;
  url: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<void> {
  try {
    const config = await getIndexNowConfig();
    if (config == null) return; // lane self-hidden: no key configured yet

    let host = config.host;
    if (!host) {
      try {
        host = new URL(args.url).host;
      } catch {
        host = undefined;
      }
    }
    if (!host) return; // cannot resolve a host to ping for

    const now = args.now ?? new Date();
    const result = await pingIndexNowForUrl(
      { url: args.url, key: config.key, keyLocation: config.keyLocation },
      args.fetchImpl,
    );

    const receipt: IndexNowReceipt = {
      id: `indexnow-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      url: args.url,
      pingedAt: now.toISOString(),
      ok: result.ok,
      status: result.status,
      detail: result.ok ? "accepted" : result.error,
    };
    await appendIndexNowReceipt(receipt);

    if (result.ok) {
      log.info("[indexnow] told Bing about a live change", {
        tenantId: args.tenantId,
        url: args.url,
        status: result.status,
      });
    }
  } catch (err) {
    // Belt-and-suspenders: this function must never throw into a publish path.
    log.warn("[indexnow] ping-on-verify-live failed (non-blocking)", {
      tenantId: args.tenantId,
      url: args.url,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fire-and-forget wrapper for callers on a request path that must not await
 * the ping (keeps the operator's "staged"/"pushed" response fast). Swallows
 * all outcomes - the receipt store is the only durable record.
 */
export function scheduleIndexNowPing(args: {
  tenantId: string;
  url: string;
  fetchImpl?: typeof fetch;
}): void {
  void pingIndexNowOnVerifiedLive(args);
}

/** Convenience for a caller that already resolved the tenant. Exported for
 *  potential future use where the domain override matters more than the URL's
 *  own host (kept small and unused by default call sites, which pass the URL
 *  host implicitly via `pingIndexNowOnVerifiedLive`). */
export async function tenantConfiguredHost(tenantId: string): Promise<string | null> {
  try {
    const config = await getIndexNowConfig();
    if (config?.host) return config.host;
    const tenant = await getTenant(tenantId);
    return tenant?.domain || null;
  } catch {
    return null;
  }
}
