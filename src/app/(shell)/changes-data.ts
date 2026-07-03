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
import { readPublishHealth } from "@/domains/push/publish-canary-store";
// D7 (honest opportunity math) - the SAME bias-correction factor + per-family empirical capture
// band build-today-preview.ts already resolves for the nightly plan, reused here so the ranked
// Changes list forecasts with the tenant's own track record instead of the static 25/75 fallback
// whenever enough settled history exists. Read-only; this file only reads the cached ledger.
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, captureDistributionFromCalibrationRecords } from "@/domains/experiments/forecast-calibration";
import { canonicalMoveType } from "@/domains/learning/experiment-prior";
import { blendCaptureBand } from "@/domains/experiments/empirical-capture";
import { captureHypothesis } from "@/domains/forecast/hypothesis-log";
// UX0 (2026-07-02) - the SAME canonical "measuring" count Today reads (page.tsx A2:
// the proof ledger's own verdict field), so the worklist header never shows a
// different number than Today for the same word. Read-only import; proof-gsc is
// owned by a concurrent workstream, this file only reads its cached loader.
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
// D4/N1 (unified allocator, 2026-07-02) - fuse D2's AEO gap verdicts + D3's SERP steal briefs +
// undercovered keyword-library demand onto this SAME ranked list, so /worklist becomes the
// operator's "one ranked decision" across every opportunity source, not just the ActionPack
// worklist. Read-only additive lanes; a lane outage narrows the fused set, never blocks the page.
import { fuseUnifiedList } from "@/domains/allocator/load-unified-list";

export type ChangesView = {
  changes: CanonicalChange[];
  movesById: Record<string, TodayMove>;
  summary: { todo: number; ready: number; measuring: number; results: number; selectedForToday: number; protectedPages: number };
  hasPlan: boolean;
  planAccepted: boolean;
  /** B7 (worklist fix batch) - only set when Ready is 0, so the tab isn't a bare "0" with no
   *  reason. Distinguishes "your Wix pages aren't mapped yet" from "nothing to prepare right now". */
  readyZeroHint: string | null;
  /** UX0 (2026-07-02) - THE canonical "measuring" count (same proof-ledger verdict field
   *  Today's page.tsx A2 reads). `summary.measuring` above stays the count of changes in
   *  THIS list that are measuring (a worklist-scoped subset); this is the whole-tenant
   *  truth so the Measuring tab can say "10 of 16 here" instead of silently disagreeing
   *  with Today's number. Equal to `summary.measuring` whenever every measuring proof
   *  record also has a matching worklist move (the common case). */
  measuringCountCanonical: number;
};

export async function loadChangesView(): Promise<ChangesView> {
  const tenantId = await currentTenantId();
  // Move 3 — every source is fail-soft so one failing store can never blank the whole
  // Changes list. A plan-store outage drops the "today" slice but keeps the ranked moves;
  // a worklist outage keeps any selected plan items. The page renders with what loaded.
  const [wl, accepted, preview, reservations, ledgerRows, calibrationRecords] = await Promise.all([
    loadMovesWorklist().catch(() => ({ moves: [] as TodayMove[], stats: undefined })),
    getAcceptedPlan(tenantId).catch(() => null),
    getLatestPreviewPlan(tenantId).catch(() => null),
    listActiveReservations(tenantId).catch(() => []),
    loadProofLedgerCached(tenantId).catch(() => []),
    loadCalibrationRecords(tenantId).catch(() => []),
  ]);
  const measuringCountCanonical = ledgerRows.filter((r) => r.verdict === "measuring").length;
  const plan = accepted ?? preview;
  const moves = (wl.moves ?? []) as TodayMove[];

  // D7 - the tenant's own bias-correction factor + per-actionFamily empirical capture band, the
  // SAME machinery build-today-preview.ts already resolves for the nightly plan (forecast-
  // calibration.ts). A fresh tenant with no settled history yet gets factor 1.0 and the static
  // 25/75 band - byte-identical to the pre-D7 forecastRange defaults.
  const calibrationSummary = summarizeForecastCalibration(calibrationRecords);
  const captureDistribution = captureDistributionFromCalibrationRecords(calibrationRecords);

  const moveInputs: CanonicalMoveInput[] = moves.map((m) => {
    const tq = [...(m.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0];
    const band = blendCaptureBand(captureDistribution.get(canonicalMoveType(m.action)));
    return {
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
      // D7 (honest opportunity math) - the raw position/impressions/clicks signal, so
      // build-canonical-changes.ts can call opportunity-math.ts's full composer (CTR curve +
      // plain-English position clause) instead of the legacy pre-computed-gap fallback.
      topQueryPosition: tq && tq.impressions > 0 ? tq.position : null,
      topQueryImpressions90d: tq?.impressions ?? null,
      topQueryClicks90d: tq?.clicks ?? null,
      correctionFactor: calibrationSummary.correctionFactor,
      captureBand: { low: band.low, high: band.high, n: band.n, isEmpirical: band.isEmpirical },
      settledResultsCount: calibrationSummary.settledCount,
      proofStatus: m.proofStatus ?? null,
      alreadyMeasuring: m.alreadyMeasuring,
      pageMeasuring: m.pageMeasuring,
      preparedReady: m.preparedChecklist?.readyToReview,
      preparedDraftText: m.preparedDraftText ?? null,
      alternateOpportunities: (m.also ?? []).slice(0, 4),
      proofMaturity: m.proofMaturity ?? null,
      proofDirection: m.proofDirection ?? null,
      proofLabel: m.proofLabel ?? null,
      proofNextCheckpoint: m.proofNextCheckpoint ?? null,
    };
  });

  const worklistChanges = buildCanonicalChanges({ tenantId, moves: moveInputs, plan: plan ?? null, reservations });

  // D4/N1 (unified allocator) - fuse in the lanes buildCanonicalChanges cannot see: D2's AEO gap
  // verdicts, D3's SERP steal briefs, and undercovered keyword-library demand, into ONE ranked
  // CanonicalChange[]. Fail-soft as a whole (fuseUnifiedList never throws); on any unexpected
  // failure fall back to the worklist-only list rather than blanking the page.
  const { changes } = await fuseUnifiedList(tenantId, worklistChanges).catch(() => ({ changes: worklistChanges }));

  // D7 (hypothesis capture) - every forecast actually rendered to the operator on this list is
  // logged as a falsifiable hypothesis, so the day-28 settle can grade it later. Fire-and-forget,
  // best-effort (captureHypothesis is itself fail-soft): a logging hiccup must never slow or break
  // the Changes list render. Bounded to rows the operator can actually act on right now (todo/
  // ready) - a blocked/measuring/result row's forecast was already logged when it first became
  // actionable, so re-logging it here would just be a duplicate keyed by the same hypothesisId.
  const actionableWithForecast = changes.filter(
    (c) => (c.status === "suggested" || c.status === "ready" || c.status === "apply") && c.hypothesisId,
  );
  void Promise.allSettled(
    actionableWithForecast.map((c) =>
      captureHypothesis(tenantId, c.pagePath, c.changeType, {
        lowPerMonth: c.expectedOutcomeLow ?? null,
        highPerMonth: c.expectedOutcomeHigh ?? null,
        days: c.expectedOutcomeDays ?? 28,
        basis: c.expectedOutcome ?? "",
        hypothesisId: c.hypothesisId!,
      }),
    ),
  );

  const movesById: Record<string, TodayMove> = {};
  for (const m of moves) movesById[m.id] = m;

  const summary = { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 };
  for (const c of changes) {
    if (c.status === "skipped") continue;
    summary[statusView(c.status)] += 1;
    if (c.selectedForToday) summary.selectedForToday += 1;
    if (c.protectedControl) summary.protectedPages += 1;
  }

  // B7 - "Ready 0" with no reason reads as broken. Only compute this when it's actually 0
  // (no cost otherwise); fail-soft so a canary-store outage never blocks the list.
  let readyZeroHint: string | null = null;
  if (summary.ready === 0) {
    const health = await readPublishHealth(tenantId).catch(() => null);
    readyZeroHint =
      health && health.urlMapOk === false
        ? "0 ready to publish until your Wix pages are mapped."
        : "0 ready right now.";
  }

  return { changes, movesById, summary, hasPlan: !!plan, planAccepted: !!accepted, readyZeroHint, measuringCountCanonical };
}
