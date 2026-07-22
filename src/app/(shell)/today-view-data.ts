import "server-only";

/**
 * today-view-data (2026-07-01, Move 5), server loader for the canonical Today slice.
 * Composes the SAME source /changes already uses (loadChangesView) and runs the pure
 * buildTodayView adapter. NO parallel graph build, NO new persistence, NO second
 * recommendation engine, Today derives from CanonicalChange. Fail-soft: a missing
 * changes read degrades to a partial Today.
 */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt } from "./changes-data";
import { buildTodayView, type TodayView } from "@/domains/changes/today-view";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";

export type TodayComposite = {
  today: TodayView;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
};

/** FP3 ONE-COUNT RULE - Today's measuring/resultsAvailable counts are the SAME canonical
 *  ledger pair the ChangesView release already computed (countLedgerLifecycle), never a
 *  second CanonicalChange.status recount. The `?? 0` guards a pre-FP3 persisted snapshot
 *  that predates the canonical fields. Exported for the boundary regression test (defect
 *  A, 2026-07-20): this is the exact mapping the customer-surface composition threads into
 *  buildTodayView before the blob is persisted, so a broken mapping here is what would
 *  reintroduce the "today blob says 7 while changes says 25" divergence. */
export function ledgerCountsOf(v: import("./changes-data").ChangesView | null): { measuring: number; decided: number } {
  return { measuring: v?.measuringCountCanonical ?? 0, decided: v?.decidedCountCanonical ?? 0 };
}

async function loadTodayViewUncached(): Promise<TodayComposite> {
  const changesView = await loadChangesView().catch(() => null);
  const today = buildTodayView({
    changes: changesView?.changes ?? [],
    strategy: "balanced",
    plan: null,
    ledgerCounts: ledgerCountsOf(changesView),
  });
  return { today, hasChanges: !!changesView && changesView.changes.length > 0 };
}

/** Compose Today from the exact Changes release that will ship beside it. */
export async function buildTodayCompositeFromChanges(changesView: import("./changes-data").ChangesView): Promise<TodayComposite> {
  const today = buildTodayView({
    changes: changesView.changes,
    strategy: "balanced",
    plan: null,
    ledgerCounts: ledgerCountsOf(changesView),
  });
  return { today, hasChanges: changesView.changes.length > 0 };
}

/**
 * Item 93 - SWR surface for Today (same pattern as /changes): serve the last snapshot
 * instantly, background-refresh via after() once stale, invalidate on plan mutations.
 * Only the first-ever load (or the one right after an invalidation) pays the compute.
 *
 * Exported for tests (`loadTodayViewWithSwr`); this wrapper resolves the ambient
 * tenant once and threads it through explicitly, same as loadChangesView does.
 */
export async function loadTodayView(): Promise<TodayComposite> {
  return loadTodayViewWithSwr(await currentTenantId());
}

/** Injectable builder so tests can drive the SWR flow without the real Changes/Daily
 *  compose (mirrors changes-data.ts's ChangesViewBuilder). */
type TodayViewBuilder = (tenantId: string) => Promise<TodayComposite>;

/**
 * Exported for tests; render paths go through loadTodayView above.
 *
 * ONE REBUILD BODY (loader consolidation, 2026-07-21): stale or cold, the only
 * thing this loader ever schedules is refreshCustomerSurface - the same
 * single-flighted release build /changes schedules - so Today and Changes can
 * never race two concurrent worklist/fuse builds for the same tenant. The
 * customer release is the ONLY persisted Today snapshot (the legacy
 * today-surface shadow blob is retired); a cold tenant composes synchronously
 * once and is warm from the scheduled release build onward.
 */
export async function loadTodayViewWithSwr(
  tenantId: string,
  deps: { build?: TodayViewBuilder } = {},
): Promise<TodayComposite> {
  const build = deps.build ?? loadTodayViewUncached;
  const scheduleReleaseRebuild = () =>
    after(async () => {
      const { refreshCustomerSurface } = await import("./surface-release");
      await refreshCustomerSurface(tenantId).catch(() => null);
    });

  const customer = await readCustomerSurface(tenantId).catch(() => null);
  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild();
    return {
      ...customer.today,
      surfaceVersion: customer.releaseId,
      // Same date-bomb guard /changes applies: an epoch-0 invalidation stamp is
      // never a real build time, so it must not ride into the composite.
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  // Cold: compose synchronously so the first render still has its greeting and
  // ranked moves, and schedule the release build that makes the next visit warm.
  scheduleReleaseRebuild();
  return build(tenantId);
}
