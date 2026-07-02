import "server-only";

/**
 * today-view-data (2026-07-01, Move 5) — server loader for the canonical Today slice.
 * Composes the SAME sources /worklist already uses (loadChangesView + the daily-plan
 * view) and runs the pure buildTodayView adapter. NO parallel graph build, NO new
 * persistence, NO second recommendation engine — Today derives from CanonicalChange.
 * Fail-soft: a missing daily plan or changes read degrades to a partial Today.
 */
import { after } from "next/server";
import { loadChangesView } from "./changes-data";
import { loadDailyExperimentsView, type DailyExperimentsView } from "./daily-experiments-data";
import { buildTodayView, type TodayView, type TodayPlanSummary } from "@/domains/changes/today-view";
import { readTodaySurface, writeTodaySurface, isTodaySurfaceStale } from "./today-surface-store";

export type TodayComposite = { today: TodayView; daily: DailyExperimentsView | null; hasChanges: boolean };

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

async function loadTodayViewUncached(): Promise<TodayComposite> {
  const [changesView, daily] = await Promise.all([
    loadChangesView().catch(() => null),
    loadDailyExperimentsView().catch(() => null),
  ]);
  const plan = daily ? planSummaryOf(daily) : null;
  const today = buildTodayView({ changes: changesView?.changes ?? [], strategy: "balanced", plan });
  return { today, daily, hasChanges: !!changesView && changesView.changes.length > 0 };
}

/**
 * Item 93 - SWR surface for Today (same pattern as /worklist): serve the last snapshot
 * instantly, background-refresh via after() once stale, invalidate on plan mutations.
 * Only the first-ever load (or the one right after an invalidation) pays the compute.
 */
export async function loadTodayView(): Promise<TodayComposite> {
  const cached = await readTodaySurface().catch(() => null);
  if (cached) {
    if (isTodaySurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          const fresh = await loadTodayViewUncached();
          await writeTodaySurface(fresh, new Date().toISOString());
        } catch {
          /* best-effort background refresh; the next visit retries */
        }
      });
    }
    return cached.data;
  }
  const fresh = await loadTodayViewUncached();
  await writeTodaySurface(fresh, new Date().toISOString());
  return fresh;
}
