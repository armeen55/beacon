import "server-only";

/**
 * external-event-store (BEACON_500 N32, 2026-07-03) - persistence for the
 * nightly external-event ledger (Google updates + traffic shocks + connector
 * outages + own-site change clusters), so the Results page and change cards see
 * the honest-context caveats without recomputing them, and so the write
 * survives a Vercel lambda recycle.
 *
 * Follows algorithm-weather-store.ts (its sibling) EXACTLY: a GLOBAL json-store
 * (rows carry tenant_id because the nightly cron fans out across tenants with
 * no ambient request context) that is Supabase-mirrored so the write survives
 * Vercel's read-only filesystem. Latest-wins per tenant.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { ExternalEventEntry } from "./external-event-ledger";

const STORE = "external-event-ledger";

/** An event ledger older than this is not trusted as "current context" - the
 *  nightly pass re-detects and re-persists every night anyway. Matches the
 *  algorithm-weather-store staleness floor so the two honest-context layers
 *  expire together. */
const LEDGER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type ExternalEventLedgerRow = {
  tenant_id: string;
  computed_at: string;
  /** The newest finalized day the detection pass ran over, or null. */
  anchor_date: string | null;
  events: ExternalEventEntry[];
};

/** Persist the latest ledger for a tenant (latest wins). An EMPTY event list is
 *  written too: "checked, nothing external happened" is a different truth from
 *  "never checked". */
export async function writeExternalEventLedger(row: ExternalEventLedgerRow): Promise<void> {
  const rows = await readStore<ExternalEventLedgerRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest ledger for the tenant, or null when absent / stale. Fail-soft -> null. */
export async function readExternalEventLedger(
  tenantId: string,
  now: Date = new Date(),
): Promise<ExternalEventLedgerRow | null> {
  try {
    const rows = await readStore<ExternalEventLedgerRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= LEDGER_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's external events, or [] when no fresh
 *  ledger exists. */
export async function loadExternalEvents(
  tenantId: string,
  now: Date = new Date(),
): Promise<ExternalEventEntry[]> {
  const row = await readExternalEventLedger(tenantId, now);
  return row?.events ?? [];
}
