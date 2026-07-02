import "server-only";

/**
 * page-factory/batch-store (BEACON 500 item 62) - persistence for the entity-
 * attribute page factory's weekly production line. One row per (tenant, weekOf):
 * the demand-validated, drafted-but-STAGED candidates for that week, plus the
 * operator's per-page approve/skip/published status.
 *
 * Follows the strategy-mix-history / refresh-queue sibling pattern: a GLOBAL
 * json-store (rows carry tenant_id because the weekly cron fans out across
 * tenants with no ambient request context) that is Supabase-mirrored so the
 * write survives Vercel's read-only filesystem.
 *
 * UNLIKE strategy-mix-history (append-only, immutable history), a batch row is
 * MUTATED after creation as the operator approves/skips each page - this store
 * is closer to autopilot-state: one evolving row per key, updated in place.
 * History is still kept (capped) so a stale week's batch remains visible after
 * a newer week's batch exists, but the CURRENT week's row is updated, not
 * re-appended, on every approve/skip.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "page-factory-batches";

/** Keep at most this many weeks of batch history per tenant (oldest dropped first). */
export const MAX_BATCH_HISTORY_WEEKS = 8;

export type FactoryBatchItemStatus = "pending" | "approved" | "skipped" | "published";

export type FactoryBatchItem = {
  /** Stable slug from entity-attribute-factory.ts - the idempotency + dedupe key. */
  slug: string;
  title: string;
  entity: string;
  attribute: string;
  /** The cached DataForSEO keyword this candidate matched, when any. */
  matchedKeyword: string | null;
  /** Real cached monthly search volume backing the demand floor, or null when the
   *  candidate passed on graph demand alone (no cached keyword match). */
  searchVolume: number | null;
  /** Which demand source cleared the governance floor for this candidate. */
  demandSource: "cached_keyword" | "graph_demand";
  /** Why this candidate was selected (plain-English, shown on the review card). */
  why: string;
  status: FactoryBatchItemStatus;
  /** Target URL this page will publish to, once known (operator may set on approve). */
  targetUrl: string | null;
  /** LLM spend for this candidate's brief + full-page draft. */
  costUsd: number;
  /** ISO timestamp of the last status change. */
  updatedAt: string;
};

export type FactoryBatchRecord = {
  tenant_id: string;
  /** ISO date (Monday) the batch applies to - the idempotency key alongside tenant_id. */
  weekOf: string;
  items: FactoryBatchItem[];
  /** Candidates that passed relevance/dedupe but had no cached keyword volume yet -
   *  queued for the next capped keyword batch, never drafted this week. */
  queuedForKeywordBatch: Array<{ slug: string; title: string }>;
  /** Total LLM spend across every drafted item this week. */
  totalCostUsd: number;
  /** ISO timestamp this batch was generated. */
  generatedAt: string;
};

async function readAll(): Promise<FactoryBatchRecord[]> {
  try {
    return (await readStore<FactoryBatchRecord>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/** Full batch history for a tenant, oldest first. Fail-soft -> []. */
export async function loadFactoryBatchHistory(tenantId: string): Promise<FactoryBatchRecord[]> {
  const rows = await readAll();
  return rows.filter((r) => r.tenant_id === tenantId).sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

/** The most recent batch for a tenant, or null when none exists yet. Fail-soft -> null. */
export async function loadLatestFactoryBatch(tenantId: string): Promise<FactoryBatchRecord | null> {
  const history = await loadFactoryBatchHistory(tenantId);
  return history.length > 0 ? history[history.length - 1]! : null;
}

/** True when a batch for this tenant + week already exists (the weekly idempotency
 *  guard the cron route checks before generating a second batch the same week). */
export async function hasFactoryBatchForWeek(tenantId: string, weekOf: string): Promise<boolean> {
  const rows = await readAll();
  return rows.some((r) => r.tenant_id === tenantId && r.weekOf === weekOf);
}

/**
 * Create this week's batch, once per (tenant, weekOf). No-op (returns false) when a
 * batch for this tenant+week already exists - a second same-week cron run never
 * overwrites the operator's in-progress approve/skip decisions. Trims the tenant's
 * own history to MAX_BATCH_HISTORY_WEEKS, leaving every OTHER tenant's rows untouched.
 */
export async function createFactoryBatch(record: FactoryBatchRecord): Promise<boolean> {
  try {
    const rows = await readAll();
    if (rows.some((r) => r.tenant_id === record.tenant_id && r.weekOf === record.weekOf)) return false;
    const mine = rows.filter((r) => r.tenant_id === record.tenant_id);
    const others = rows.filter((r) => r.tenant_id !== record.tenant_id);
    const trimmed = [...mine, record].sort((a, b) => a.weekOf.localeCompare(b.weekOf)).slice(-MAX_BATCH_HISTORY_WEEKS);
    await writeStore(STORE, [...others, ...trimmed]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update ONE item's status within a tenant's batch for a given week (approve / skip /
 * mark published). Fail-soft -> false when the batch or the item isn't found, never
 * throws. Never touches any other tenant's rows or any other week's batch.
 */
export async function updateFactoryBatchItemStatus(args: {
  tenantId: string;
  weekOf: string;
  slug: string;
  status: FactoryBatchItemStatus;
  targetUrl?: string | null;
  now?: Date;
}): Promise<boolean> {
  try {
    const rows = await readAll();
    const idx = rows.findIndex((r) => r.tenant_id === args.tenantId && r.weekOf === args.weekOf);
    if (idx === -1) return false;
    const record = rows[idx]!;
    const itemIdx = record.items.findIndex((i) => i.slug === args.slug);
    if (itemIdx === -1) return false;
    const updatedItem: FactoryBatchItem = {
      ...record.items[itemIdx]!,
      status: args.status,
      targetUrl: args.targetUrl !== undefined ? args.targetUrl : record.items[itemIdx]!.targetUrl,
      updatedAt: (args.now ?? new Date()).toISOString(),
    };
    const items = [...record.items];
    items[itemIdx] = updatedItem;
    const updatedRecord: FactoryBatchRecord = { ...record, items };
    const newRows = [...rows];
    newRows[idx] = updatedRecord;
    await writeStore(STORE, newRows);
    return true;
  } catch {
    return false;
  }
}
