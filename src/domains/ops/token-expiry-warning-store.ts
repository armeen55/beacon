import "server-only";

/**
 * token-expiry-warning-store (BEACON_500 item 84, 2026-07-03) - dedupe state
 * for the T-2-day Google refresh-token expiry email
 * (token-expiry-notify.ts). One row per (tenant, provider) recording the ISO
 * timestamp of the connection's `connected_at` the last warning was sent
 * for - NOT a rolling "last warned at" timestamp, because a rolling clock
 * would suppress a genuine NEW expiry cycle after a reconnect resets
 * connected_at. Keying the dedupe on the grant timestamp means: warned once
 * per expiry cycle, and a fresh reconnect (new connected_at) naturally opens
 * a new cycle without any explicit "clear the warning" step.
 *
 * A small global json-store (fleet cron, no ambient tenant context) -
 * registered in store-classification.ts as "token-expiry-warnings". No
 * Supabase table needed (this is a small, purely internal bookkeeping
 * marker, not customer-facing data) - json-store already durably mirrors to
 * Supabase via SUPABASE_MIRRORED_STORES when registered there; if not
 * registered there yet it still works locally / degrades to file, which is
 * fine for a best-effort dedupe (worst case: one duplicate warning email,
 * never a missed one).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import type { GoogleProviderKind } from "./token-expiry-forecast";

const STORE = "token-expiry-warnings";

export type TokenExpiryWarningRow = {
  tenant_id: string;
  provider: GoogleProviderKind;
  /** The connected_at value of the connection the warning was sent for. */
  warned_for_connected_at: string;
  warned_at: string;
};

/** Read all warning rows. Fail-soft -> []. */
async function readRows(): Promise<TokenExpiryWarningRow[]> {
  try {
    return (await readStore<TokenExpiryWarningRow>(STORE, [])) ?? [];
  } catch (e) {
    log.warn("[token-expiry-warning-store] read failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/** True when a warning has already been sent THIS expiry cycle (i.e. for
 *  this exact connected_at grant timestamp). Fail-soft -> false (never
 *  block a real warning on a read error - a duplicate email is far cheaper
 *  than a silently-missed one). */
export async function alreadyWarnedThisCycle(
  tenantId: string,
  provider: GoogleProviderKind,
  connectedAt: string,
): Promise<boolean> {
  const rows = await readRows();
  return rows.some(
    (r) => r.tenant_id === tenantId && r.provider === provider && r.warned_for_connected_at === connectedAt,
  );
}

/** Record that a warning was sent for this (tenant, provider, connectedAt).
 *  FAIL-SOFT BY CONTRACT: never throws (a dedupe-write failure must never
 *  fail the email send it is recording). */
export async function recordWarningSent(
  tenantId: string,
  provider: GoogleProviderKind,
  connectedAt: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const rows = await readRows();
    const others = rows.filter((r) => !(r.tenant_id === tenantId && r.provider === provider));
    others.push({
      tenant_id: tenantId,
      provider,
      warned_for_connected_at: connectedAt,
      warned_at: now.toISOString(),
    });
    await writeStore(STORE, others);
  } catch (e) {
    log.warn("[token-expiry-warning-store] write failed (warning still sent)", {
      tenantId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
