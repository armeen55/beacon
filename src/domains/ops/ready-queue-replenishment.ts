import "server-only";

import { runSingleFlight } from "@/lib/single-flight";
import { runWithTenant } from "@/lib/tenant-context";
import type { CustomerSurface } from "@/app/(shell)/surface-release";
import type { PrepareMovesSummary } from "@/domains/demand-graph/prepare-today-moves";

export const READY_QUEUE_TARGET = 5;
export const READY_QUEUE_MAX_USD = 0.05;

export type ReadyQueueReplenishment = {
  readyBefore: number;
  readyAfter: number;
  prepared: number;
  cached: number;
  skipped: boolean;
};

type ReadyQueueDeps = {
  readSurface: (tenantId: string) => Promise<CustomerSurface | null>;
  refreshSurface: (tenantId: string) => Promise<CustomerSurface>;
  prepare: (
    tenantId: string,
    options: {
      maxN: number;
      maxUsd: number;
      maxNewDrafts: number;
      regenerateRejected: boolean;
      checkWinnability: boolean;
      rankedEntries: NonNullable<CustomerSurface["changes"]["rankedPreparationEntries"]>;
    },
  ) => Promise<PrepareMovesSummary>;
};

async function defaultDeps(): Promise<ReadyQueueDeps> {
  const [{ readCustomerSurface, refreshCustomerSurface }, { prepareTodayMovesForTenant }] = await Promise.all([
    import("@/app/(shell)/surface-release"),
    import("@/domains/demand-graph/prepare-today-moves"),
  ]);
  return {
    readSurface: readCustomerSurface,
    refreshSurface: refreshCustomerSurface,
    prepare: prepareTodayMovesForTenant,
  };
}

/**
 * Cheap queue-maintenance lane. Deep competitor/keyword/AI research keeps its
 * daily cadence; ordinary navigation and queue actions only refill missing
 * copy-ready capacity from the already-ranked, already-cached evidence graph.
 */
export async function replenishReadyQueueForTenant(
  tenantId: string,
  depsOverride?: Partial<ReadyQueueDeps>,
): Promise<ReadyQueueReplenishment> {
  return runSingleFlight(`ready-queue:${tenantId}`, async () => runWithTenant(tenantId, async () => {
    const deps = { ...(await defaultDeps()), ...depsOverride };
    let surface = await deps.readSurface(tenantId).catch(() => null);

    // A missing/stale customer release may not reflect a just-completed action.
    // Rebuild once before deciding which ranked entries actually need preparation.
    if (!surface || surface.changes.summary.ready < READY_QUEUE_TARGET) {
      surface = await deps.refreshSurface(tenantId);
    }

    const readyBefore = surface.changes.summary.ready;
    if (readyBefore >= READY_QUEUE_TARGET) {
      return { readyBefore, readyAfter: readyBefore, prepared: 0, cached: 0, skipped: true };
    }

    const rankedEntries = surface.changes.rankedPreparationEntries ?? [];
    const missing = READY_QUEUE_TARGET - readyBefore;
    const prepared = await deps.prepare(tenantId, {
      // Scan the full authoritative queue, not merely the first few rows. Cached
      // or quality-held drafts cost nothing in this lane and must not prevent a
      // valid lower-ranked candidate from restoring the five-item ready floor.
      maxN: Math.max(READY_QUEUE_TARGET, rankedEntries.length),
      maxUsd: READY_QUEUE_MAX_USD,
      maxNewDrafts: missing,
      regenerateRejected: false,
      checkWinnability: false,
      rankedEntries,
    });

    // Prepared packs hydrate through the worklist builder. Publish the full
    // Today + Changes customer release last so both pages adopt the refill together.
    const published = await deps.refreshSurface(tenantId);
    return {
      readyBefore,
      readyAfter: published.changes.summary.ready,
      prepared: prepared.prepared,
      cached: prepared.cached,
      skipped: false,
    };
  }));
}
