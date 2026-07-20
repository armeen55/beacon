import "server-only";

/**
 * today-view-data (2026-07-01, Move 5), server loader for the canonical Today slice.
 * Composes the SAME sources /changes already uses (loadChangesView + the daily-plan
 * view) and runs the pure buildTodayView adapter. NO parallel graph build, NO new
 * persistence, NO second recommendation engine, Today derives from CanonicalChange.
 * Fail-soft: a missing daily plan or changes read degrades to a partial Today.
 */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView } from "./changes-data";
import { loadDailyExperimentsView, type DailyExperimentsView } from "./daily-experiments-data";
import { buildTodayView, type TodayView, type TodayPlanSummary } from "@/domains/changes/today-view";
import { readTodaySurface, writeTodaySurface, isTodaySurfaceStale } from "./today-surface-store";
import { readCustomerSurface, isCustomerSurfaceStale } from "./customer-surface-store";

export type TodayComposite = {
  today: TodayView;
  daily: DailyExperimentsView | null;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
};

function planSummaryOf(v: DailyExperimentsView): TodayPlanSummary | null {
  const d = v.dashboard;
  if (d.acceptedPlan && v.checklist) {
    const s = v.checklist.summary;
    const status: TodayPlanSummary["status"] = s.left > 0 ? "accepted" : s.active > 0 ? "in_progress" : "completed";
    return { status, selectedCount: d.acceptedPlan.selected.length, leftToApply: s.left };
  }
  if (d.previewPlan) return { status: "preview", selectedCount: d.previewPlan.selected.length, leftToApply: 0 };
  return null;
}

/** FP3 ONE-COUNT RULE - Today's measuring/resultsAvailable counts are the SAME canonical
 *  ledger pair the ChangesView release already computed (countLedgerLifecycle), never a
 *  second CanonicalChange.status recount. The `?? 0` guards a pre-FP3 persisted snapshot
 *  that predates the canonical fields. */
function ledgerCountsOf(v: import("./changes-data").ChangesView | null): { measuring: number; decided: number } {
  return { measuring: v?.measuringCountCanonical ?? 0, decided: v?.decidedCountCanonical ?? 0 };
}

async function loadTodayViewUncached(): Promise<TodayComposite> {
  const [changesView, daily] = await Promise.all([
    loadChangesView().catch(() => null),
    loadDailyExperimentsView().catch(() => null),
  ]);
  const plan = daily ? planSummaryOf(daily) : null;
  const today = buildTodayView({
    changes: changesView?.changes ?? [],
    strategy: "balanced",
    plan,
    ledgerCounts: ledgerCountsOf(changesView),
  });
  return { today, daily, hasChanges: !!changesView && changesView.changes.length > 0 };
}

/** Compose Today from the exact Changes release that will ship beside it. */
export async function buildTodayCompositeFromChanges(changesView: import("./changes-data").ChangesView): Promise<TodayComposite> {
  const daily = await loadDailyExperimentsView().catch(() => null);
  const plan = daily ? planSummaryOf(daily) : null;
  const today = buildTodayView({
    changes: changesView.changes,
    strategy: "balanced",
    plan,
    ledgerCounts: ledgerCountsOf(changesView),
  });
  return { today, daily, hasChanges: changesView.changes.length > 0 };
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
 * Exported for tests; render paths go through loadTodayView above. Sibling fix
 * (2026-07-10 hygiene batch) - thread the EXPLICIT tenantId into both the read and
 * the after() background write, the same P2-f discipline changes-surface-store
 * already applies: writeTodaySurface's own persistence would otherwise resolve the
 * write's tenant via json-store's ambient currentTenantSlug() (request-header-based),
 * which is not guaranteed correct in a background task outside the render's request
 * scope.
 */
export async function loadTodayViewWithSwr(
  tenantId: string,
  deps: { build?: TodayViewBuilder } = {},
): Promise<TodayComposite> {
  const build = deps.build ?? loadTodayViewUncached;
  const customer = await readCustomerSurface(tenantId).catch(() => null);
  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) {
      after(async () => {
        const { refreshCustomerSurface } = await import("./customer-surface-refresh");
        await refreshCustomerSurface(tenantId).catch(() => null);
      });
    }
    return {
      ...customer.today,
      surfaceVersion: customer.releaseId,
      surfaceComputedAt: customer.computedAt,
    };
  }
  const cached = await readTodaySurface(tenantId).catch(() => null);
  if (cached) {
    if (isTodaySurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          const fresh = await build(tenantId);
          await writeTodaySurface(fresh, new Date().toISOString(), tenantId);
        } catch {
          /* best-effort background refresh; the next visit retries */
        }
      });
    }
    return cached.data;
  }
  const fresh = await build(tenantId);
  await writeTodaySurface(fresh, new Date().toISOString(), tenantId);
  return fresh;
}

/**
 * Background warm-pass entry (BEACON 500 item 13): rebuild the Today composite NOW and
 * persist the SWR snapshot - the same `loadTodayViewUncached` + write the background
 * refresh runs. Beacon has no scheduler (no cron triggers this); it exists so an
 * on-demand background pass can refresh the surface after a signed-in visit lands.
 * `tenantId` is threaded explicitly through the write (the compose itself still reads
 * the ambient/runWithTenant-scoped tenant this refresh is wrapped in) so the
 * persisted snapshot can never land under json-store's ambient resolution disagreeing
 * with the tenant this refresh was actually called for. Build-then-write: a failed
 * rebuild throws and the previous snapshot stays in place.
 */
export async function refreshTodaySurface(tenantId: string): Promise<void> {
  const fresh = await loadTodayViewUncached();
  await writeTodaySurface(fresh, new Date().toISOString(), tenantId);
}
