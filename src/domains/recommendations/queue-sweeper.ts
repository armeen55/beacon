import "server-only";

/**
 * 2026-06-11 (night shift, inventory #114/#49) — the queue staleness
 * sweeper. Direct hygiene consequence of the nightly autopilot: the
 * queue refills itself every night, but nothing expired stale cards,
 * so "a short queue of exact moves" would drift into an unbounded
 * backlog of aging ones.
 *
 * Rules (deliberately conservative):
 *   • ONLY auto-promoted rows are ever swept
 *     (source === "deterministic_promotion"). Operator-created,
 *     factory, packet-generator, accepted, pushed rows: never touched.
 *   • TTL: a card still sitting in "recommended" QUEUE_TTL_DAYS after
 *     creation is stale noise → status "expired".
 *   • Cap: beyond MAX_PENDING_PER_TENANT pending auto-promoted cards,
 *     the OLDEST overflow expires ("short queue", not infinite list).
 *   • "expired" is machine hygiene, not operator rejection: its
 *     promotion cooldown is 30 days (vs dismissed: 90), so a trigger
 *     that still fires re-promotes the move a month later.
 *
 * Runs inside the nightly generation job (live mode only) — no new
 * cron, same idempotent upsert path as promotion.
 */

import { getRepository } from "@/lib/persistence/repositories";
import { syncRecommendedEdits } from "@/lib/persistence/dual-write";
import {
  persistRecommendedEditsLocal,
  type RecommendedEditRow,
} from "@/domains/recommendations/recommended-edits-persistence";

export const QUEUE_TTL_DAYS = 30;
export const MAX_PENDING_PER_TENANT = 50;

/** Only rows the machine put in the queue are the machine's to expire. */
const SWEEPABLE_SOURCE = "deterministic_promotion";

export type QueueExpiry = {
  row: RecommendedEditRow;
  reason: "ttl" | "overflow";
};

export type SweepSelection = {
  expiries: QueueExpiry[];
  pendingBefore: number;
  pendingAfter: number;
};

/** Pure selection: which rows expire tonight, and why. */
export function selectQueueExpiries(
  rows: RecommendedEditRow[],
  now: Date,
  opts: { ttlDays?: number; maxPending?: number } = {},
): SweepSelection {
  const ttlDays = opts.ttlDays ?? QUEUE_TTL_DAYS;
  const maxPending = opts.maxPending ?? MAX_PENDING_PER_TENANT;
  const cutoff = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const sweepable = rows.filter(
    (r) =>
      (r.implementation_status ?? "recommended") === "recommended" &&
      r.source === SWEEPABLE_SOURCE,
  );

  const expiries: QueueExpiry[] = [];
  const surviving: RecommendedEditRow[] = [];
  for (const r of sweepable) {
    if (r.created_at < cutoff) expiries.push({ row: r, reason: "ttl" });
    else surviving.push(r);
  }

  // Cap overflow: keep the newest maxPending, expire the rest (oldest first).
  if (surviving.length > maxPending) {
    const byNewest = [...surviving].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const r of byNewest.slice(maxPending)) {
      expiries.push({ row: r, reason: "overflow" });
    }
  }

  return {
    expiries,
    pendingBefore: sweepable.length,
    pendingAfter: sweepable.length - expiries.length,
  };
}

export type SweepResult = {
  expiredTtl: number;
  expiredOverflow: number;
  pendingAfter: number;
  sync_warning: string | null;
};

export type SweepDeps = {
  loadRows?: (tenantId: string) => Promise<RecommendedEditRow[]>;
  persistLocal?: (rows: RecommendedEditRow[]) => Promise<void>;
  syncRows?: (rows: RecommendedEditRow[], tenantId: string) => Promise<void>;
  now?: Date;
};

/** Sweep one tenant's queue. Idempotent (status upsert by row id). */
export async function sweepQueueForTenant(
  tenantId: string,
  deps: SweepDeps = {},
): Promise<SweepResult> {
  const now = deps.now ?? new Date();
  const load =
    deps.loadRows ?? ((id: string) => getRepository().forTenant(id).getRecommendedEdits());
  const rows = await load(tenantId);
  const { expiries, pendingAfter } = selectQueueExpiries(rows, now);

  if (expiries.length === 0) {
    return { expiredTtl: 0, expiredOverflow: 0, pendingAfter, sync_warning: null };
  }

  const nowIso = now.toISOString();
  const updated = expiries.map(({ row }) => ({
    ...row,
    implementation_status: "expired" as const,
    updated_at: nowIso,
  }));

  await (deps.persistLocal ?? persistRecommendedEditsLocal)(updated);
  let sync_warning: string | null = null;
  try {
    await (deps.syncRows ?? syncRecommendedEdits)(updated, tenantId);
  } catch (err) {
    sync_warning = err instanceof Error ? err.message : String(err);
  }

  return {
    expiredTtl: expiries.filter((e) => e.reason === "ttl").length,
    expiredOverflow: expiries.filter((e) => e.reason === "overflow").length,
    pendingAfter,
    sync_warning,
  };
}
