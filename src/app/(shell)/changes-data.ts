import "server-only";

/**
 * changes-data (2026-07-01) — server loader for the canonical Changes list. Fans in the EXISTING
 * sources (the ActionPack worklist + today's daily plan + reservations) and runs the pure
 * buildCanonicalChanges adapter. READ-ONLY, fail-soft, no new persistence. Returns the canonical
 * changes + a sourceId→TodayMove map so a row can expand into the existing rich card (no rewrite of
 * working actions).
 */
import { currentTenantId } from "@/lib/tenant-context";
import { loadMovesWorklist } from "./moves/moves-data";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations } from "@/domains/experiments/daily-experiment-plan-store";
import { buildCanonicalChanges, type CanonicalMoveInput } from "@/domains/changes/build-canonical-changes";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import { statusView } from "@/domains/changes/canonical-change";
import type { TodayMove } from "./today-moves-data";

export type ChangesView = {
  changes: CanonicalChange[];
  movesById: Record<string, TodayMove>;
  summary: { todo: number; ready: number; measuring: number; results: number; selectedForToday: number; protectedPages: number };
  hasPlan: boolean;
  planAccepted: boolean;
};

export async function loadChangesView(): Promise<ChangesView> {
  const tenantId = await currentTenantId();
  const [wl, accepted, preview, reservations] = await Promise.all([
    loadMovesWorklist().catch(() => ({ moves: [] as TodayMove[], stats: undefined })),
    getAcceptedPlan(tenantId),
    getLatestPreviewPlan(tenantId),
    listActiveReservations(tenantId),
  ]);
  const plan = accepted ?? preview;
  const moves = (wl.moves ?? []) as TodayMove[];

  const moveInputs: CanonicalMoveInput[] = moves.map((m) => ({
    id: m.id,
    actionType: m.action,
    actionTone: m.actionTone,
    query: m.query,
    targetUrl: m.targetUrl,
    pageLabel: m.pageLabel,
    why: m.why,
    rankWhy: m.rankWhy,
    score: m.score,
    demand: m.demand,
    proofStatus: m.proofStatus ?? null,
    alreadyMeasuring: m.alreadyMeasuring,
    pageMeasuring: m.pageMeasuring,
    preparedReady: m.preparedChecklist?.readyToReview,
    preparedDraftText: m.preparedDraftText ?? null,
    alternateOpportunities: (m.also ?? []).slice(0, 4),
  }));

  const changes = buildCanonicalChanges({ tenantId, moves: moveInputs, plan: plan ?? null, reservations });

  const movesById: Record<string, TodayMove> = {};
  for (const m of moves) movesById[m.id] = m;

  const summary = { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 };
  for (const c of changes) {
    if (c.status === "skipped") continue;
    summary[statusView(c.status)] += 1;
    if (c.selectedForToday) summary.selectedForToday += 1;
    if (c.protectedControl) summary.protectedPages += 1;
  }

  return { changes, movesById, summary, hasPlan: !!plan, planAccepted: !!accepted };
}
