import "server-only";

/**
 * today-view-data (2026-07-01, Move 5) — server loader for the canonical Today slice.
 * Composes the SAME sources /worklist already uses (loadChangesView + the daily-plan
 * view) and runs the pure buildTodayView adapter. NO parallel graph build, NO new
 * persistence, NO second recommendation engine — Today derives from CanonicalChange.
 * Fail-soft: a missing daily plan or changes read degrades to a partial Today.
 */
import { loadChangesView } from "./changes-data";
import { loadDailyExperimentsView, type DailyExperimentsView } from "./daily-experiments-data";
import { buildTodayView, type TodayView, type TodayPlanSummary } from "@/domains/changes/today-view";

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

export async function loadTodayView(): Promise<TodayComposite> {
  const [changesView, daily] = await Promise.all([
    loadChangesView().catch(() => null),
    loadDailyExperimentsView().catch(() => null),
  ]);
  const plan = daily ? planSummaryOf(daily) : null;
  const today = buildTodayView({ changes: changesView?.changes ?? [], strategy: "balanced", plan });
  return { today, daily, hasChanges: !!changesView && changesView.changes.length > 0 };
}
