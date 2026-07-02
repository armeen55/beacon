import "server-only";

/**
 * publish-canary-store (2026-07-02, master plan item 86) - persistence for the
 * nightly publish-path canary: one row per tenant per night recording whether
 * the Wix token still authenticates, whether the url-map still resolves a
 * real page, and whether a dry-run push through the real push path still
 * passes. Follows the pipeline-health-store / warm-receipt-store sibling
 * pattern exactly: a GLOBAL json-store (rows carry tenant_id) because the
 * nightly cron fans out across every tenant with no ambient request context -
 * per-tenant path routing would misfile the rows or read the wrong tenant's
 * file under the ambient-tenant fallback.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES) so the row survives a Vercel lambda recycle and
 * the morning surface reads a real result instead of silent-empty.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "publish-health";

/** A check older than this is not shown as current (honest staleness: if the
 *  nightly canary stopped running, a week-old "all clear" is stale comfort,
 *  not a live guarantee). */
export const PUBLISH_HEALTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PublishHealthRow = {
  tenant_id: string;
  whenIso: string;
  /** null = no Wix connection configured for this tenant (nothing to probe). */
  tokenOk: boolean | null;
  /** null = token check failed/absent, so the url-map spot-check never ran. */
  urlMapOk: boolean | null;
  /** null = publishing is off for this tenant (Ritz hard-block) or the token/
   *  url-map check failed first, so no dry-run was attempted. */
  dryRunOk: boolean | null;
  error?: string;
  /** First-person, plain-language next step, only present when something needs fixing. */
  fixHint?: string;
};

/** Persist the latest check for a tenant (latest wins; other tenants untouched). */
export async function writePublishHealth(row: PublishHealthRow): Promise<void> {
  const rows = await readStore<PublishHealthRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest check for the tenant, or null when absent / older than 7 days. Fail-soft:
 *  a read error never breaks the caller's render (it just sees "no data yet"). */
export async function readPublishHealth(
  tenantId: string,
  now: Date = new Date(),
): Promise<PublishHealthRow | null> {
  try {
    const rows = await readStore<PublishHealthRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.whenIso.localeCompare(a.whenIso));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.whenIso);
    if (!Number.isFinite(age) || age >= PUBLISH_HEALTH_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}
