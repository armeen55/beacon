import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId, runWithTenant } from "@/lib/tenant-context";
import { runSingleFlight } from "@/lib/single-flight";
import type { ChangesView } from "./changes-data";
import type { TodayComposite } from "./today-view-data";

/**
 * surface-release (CORE 100K cutover, 2026-07-22) - the atomic Today+Changes
 * customer release and THE one rebuild body. The rebuild now PRODUCES this
 * tenant's ChangeProposals (decision kernel, cold gated drafter) then reads them
 * back into the ranked Changes + Today views. This release is the ONLY persisted
 * snapshot both routes read.
 */

const STORE = "customer-surface";
export const CUSTOMER_SURFACE_FRESH_MS = 15 * 60 * 1000;

/** One atomic customer-visible release. Engineering producers may update their
 * own caches independently, but Today and Changes only adopt a new release when
 * every core section below was assembled successfully. */
export type CustomerSurface = {
  schemaVersion: 2;
  releaseId: string;
  computedAt: string;
  tenantId: string;
  changes: ChangesView;
  today: TodayComposite;
};

export async function readCustomerSurface(tenantId: string): Promise<CustomerSurface | null> {
  const rows = await readStore<CustomerSurface>(STORE, [], { tenantId }).catch(() => [] as CustomerSurface[]);
  const row = rows[0];
  if (!row || row.schemaVersion !== 2 || row.tenantId !== tenantId || !row.changes || !row.today) return null;
  return row;
}

export async function writeCustomerSurface(surface: CustomerSurface): Promise<void> {
  await writeStore<CustomerSurface>(STORE, [surface], { tenantId: surface.tenantId });
}

/** Soft invalidation: keep the complete prior release visible while the next
 * request rebuilds a replacement. */
export async function invalidateCustomerSurface(tenantId?: string): Promise<void> {
  const id = tenantId ?? await currentTenantId().catch(() => "");
  if (!id) return;
  const existing = await readCustomerSurface(id).catch(() => null);
  if (!existing) return;
  await writeStore<CustomerSurface>(
    STORE,
    [{ ...existing, computedAt: new Date(0).toISOString() }],
    { tenantId: id },
  ).catch(() => {});
}

/**
 * THE one invalidation entry for operator mutations that change what Today or
 * Changes should show (ship / teardown-refresh / accept / settle). Age-stamps
 * both core surface caches - the worklist intermediate and the customer
 * release - so the very next navigation serves the previous ranking instantly
 * and one background rebuild replaces it. Never hard-empties anything; a
 * rebuilding screen after a click is a bug, not a refresh. Fail-soft per store
 * (the dynamic import keeps this module cycle-free at init time).
 */
export async function invalidateCoreSurfaces(tenantId?: string): Promise<void> {
  await invalidateCustomerSurface(tenantId).catch(() => {});
}

export function isCustomerSurfaceStale(computedAt: string, nowMs: number): boolean {
  const t = Date.parse(computedAt);
  return !Number.isFinite(t) || nowMs - t > CUSTOMER_SURFACE_FRESH_MS;
}

/** Build all core customer state first, publish the one versioned release last.
 *  THE one rebuild body for Today + Changes (single-flight key
 *  "customer-surface:{tenantId}"): every stale/cold reader and every warm pass
 *  converges here, so one tenant can never run two concurrent worklist/fuse
 *  builds. Build-then-publish: a failed build throws and the previous release
 *  stays in place. (Builders are imported at call time - this module is a leaf
 *  at init, so the loaders that read the release can import it statically.) */
export async function refreshCustomerSurface(tenantId: string): Promise<CustomerSurface> {
  return runSingleFlight(`customer-surface:${tenantId}`, async () => runWithTenant(tenantId, async () => {
    const [{ produceProposalsForTenant }, { buildChangesViewUncached }, { buildTodayCompositeFromChanges }] =
      await Promise.all([
        import("@/domains/decision/produce-proposals"),
        import("./changes-data"),
        import("./today-view-data"),
      ]);
    // PRODUCE first: the cold, gated, budgeted drafter turns cached evidence into
    // persisted ChangeProposals, so a newly drafted move is Ready in the release we
    // are about to publish. Fail-soft: a production hiccup still publishes whatever
    // proposals are already persisted.
    await produceProposalsForTenant(tenantId).catch(() => null);
    const changes = await buildChangesViewUncached(tenantId);
    const today = await buildTodayCompositeFromChanges(changes);
    const computedAt = new Date().toISOString();
    const releaseId = `${tenantId}:${computedAt}`;
    const surface: CustomerSurface = {
      schemaVersion: 2,
      releaseId,
      computedAt,
      tenantId,
      changes,
      today: { ...today, surfaceVersion: releaseId, surfaceComputedAt: computedAt },
    };
    // Atomically publish the one shared release consumed by Today + Changes.
    await writeCustomerSurface(surface);
    return surface;
  }));
}
