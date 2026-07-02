import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CloneBrief } from "./clone-brief";

/**
 * clone-brief-store (2026-07-02, master plan item 60) - persistence for the
 * clone-and-beat brief engine. Same shape as keyword-gap-store.ts: the
 * operator-triggered producer writes ONE row per tenant (latest run wins); the
 * /competitors page reads it at render for $0 (no live Labs call or fetch ever
 * fires on render).
 *
 * GLOBAL json-store (rows carry tenant_id), same rationale as keyword-gap-results:
 * a future cron fan-out would have no ambient request context, so per-tenant path
 * routing would misfile the rows. Registered in store-classification.ts.
 */

const BRIEF_STORE = "clone-brief-results";
/** Matches the keyword-gap-results staleness window - an older run is not shown. */
const BRIEF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Keep the persisted list lean - the page only ever surfaces a handful. */
const MAX_STORED_BRIEFS = 25;

export type StoredCloneBriefs = {
  tenant_id: string;
  computed_at: string;
  briefs: CloneBrief[];
};

export type CloneBriefStoreDeps = {
  readRows: () => Promise<StoredCloneBriefs[]>;
  writeRows: (rows: StoredCloneBriefs[]) => Promise<void>;
};

const defaultDeps: CloneBriefStoreDeps = {
  readRows: () => readStore<StoredCloneBriefs>(BRIEF_STORE, []),
  writeRows: (rows) => writeStore(BRIEF_STORE, rows),
};

/** Persist a run's briefs - one row per tenant, latest wins, list capped. */
export async function writeCloneBriefResults(
  result: StoredCloneBriefs,
  deps: Partial<CloneBriefStoreDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const rows = await d.readRows();
  const others = rows.filter((r) => r.tenant_id !== result.tenant_id);
  await d.writeRows([...others, { ...result, briefs: result.briefs.slice(0, MAX_STORED_BRIEFS) }]);
}

/** Latest fresh (<= 30d) brief run for the tenant, or null. Fail-soft -> null. */
export async function readCloneBriefResults(
  tenantId: string,
  now: Date = new Date(),
  deps: Partial<CloneBriefStoreDeps> = {},
): Promise<StoredCloneBriefs | null> {
  const d = { ...defaultDeps, ...deps };
  try {
    const rows = await d.readRows();
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    if (now.getTime() - Date.parse(latest.computed_at) >= BRIEF_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}
