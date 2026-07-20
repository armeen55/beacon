import { Suspense, type ReactNode } from "react";
import { after } from "next/server";
import { serverNowMs } from "@/lib/server-clock";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { ResultsTimeline } from "../changes/results-timeline";
import { currentTenantId } from "@/lib/tenant-context";
// R4 (2026-07-03, FP1's named follow-up) - the measured ledger now comes from the
// stale-while-revalidate snapshot (results-ledger-data.ts): the last persisted
// re-measure serves instantly with an honest "I last re-checked N ago" line, a
// stale snapshot refreshes in the background via after(), and only a true cold
// start (first visit, or right after a mutation invalidated it) pays the full
// synchronous re-measure. Measurement history itself is untouched.
import { ledgerCheckedAgoLine, loadResultsLedgerSurface } from "./results-ledger-data";
import { loadConnectionHealth, type ConnectionHealth } from "@/domains/insight/connection-health";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import { gscLagStatus, isDueForMeasure } from "@/domains/proof-gsc/measure-lifecycle";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  directionOf,
  measurementWindowOf,
  type MeasurementPresentation,
} from "@/domains/proof-gsc/measurement-maturity";
import { gradeFromPresentation, type VerdictReliabilityResult } from "@/domains/proof-gsc/verdict-reliability";
import { scheduleAutoMeasure, selectRowsToReverify } from "@/domains/proof-gsc/auto-measure-on-use";
import { loadDailyClicksByPathsForTenant } from "@/domains/proof-gsc/daily-series";
import { buildShockWindows, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
// N32 (R21b, 2026-07-03) - the external-event ledger read side: a measurement window overlapping a
// recorded connector outage or own-site change cluster gets the honest caveat, DEDUPED against the
// weather caveat this page already renders (eventCaveatForWindow reuses weatherCaveatSentence
// verbatim, so if both fire, only one sentence shows). Self-hides when the ledger is empty.
import { eventCaveatForWindow, eventReliabilityFlagsForWindow } from "@/domains/events/external-event-ledger";
import { loadExternalEvents } from "@/domains/events/external-event-store";
import { attachSeasonalInflectionForLedger } from "@/domains/seasonal/attach-seasonal-inflection";
import { attachRecrawlClockForLedger } from "@/domains/proof-gsc/attach-recrawl-clock";
import { attachControlContaminationForLedger } from "@/domains/proof-gsc/attach-control-contamination";
import type { SparkPoint } from "@/components/data/sparkline";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { linkProofRowsToActionPacks, type ProofLink } from "@/domains/action-pack/proof-linker";
import { ProofSummarySection } from "./proof-summary-section";
import { ForecastCalibrationSection } from "./forecast-calibration-section";
import { PooledVerdictSection } from "./pooled-verdict-section";
import { loadCalibrationRecords, type CalibrationRecord } from "@/domains/experiments/forecast-calibration-store";
import { computeOutcomePriorDiagnostics } from "@/domains/recommendation-intelligence/outcome-prior";
import { getOwnedAnswerAlignmentsBatch, type OwnedAlignmentRequest, type PersistedAnswerAlignment } from "@/domains/ai-visibility/answer-alignment-store";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { presentationVerdictFor } from "./proof-badge";
import {
  findExistingRevertRecord,
  hasRevertNote,
  isRevertRecord,
  liftLabelFor,
  resolveRevertSource,
} from "@/domains/autopilot/run-revert";
import { decideRevert, type RevertDecision } from "@/domains/autopilot/revert-policy";
import { getAutopilotConfig } from "@/domains/autopilot/autopilot-store";
import {
  RecomputeLedgerButton,
  RecordAnyPageForm,
} from "./proof-ledger-client";
// FP3 (2026-07-02) - THE ONE-COUNT RULE: band membership and the header strip both come
// from the shared lifecycle classifier (domains/changes/lifecycle-counts.ts), so the
// header, the band headings, and every cross-surface count (Today's tiles, the
// measuring strip's "View all in Results" link) name the same numbers.
import { splitLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
// FP8 (2026-07-02) - the header strip grew into THE cumulative outcome strip (shared
// with Today): the same counts sentence from the same lifecycle split, plus the
// measured monthly click lift the wins are adding (or the honest first-verdict date
// when nothing has settled) and the clearly-labeled dollar estimate when one exists.
import { CumulativeOutcomeSection } from "../cumulative-outcome-strip";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { HonestDelay } from "@/components/honest-delay";
// R14a (2026-07-03) - trust receipts: the append-only verdict revision trail on the
// card expand, and the "We got this wrong" recap below the bands (misses owned plainly).
import { buildRecapItems, WeGotThisWrongSection } from "./results-recap";
// R14b (P1 trust receipts): named comparison pages on the card chart (dashed series +
// legend), the prep-spend join on the card expand, the section-level one-line receipt,
// and the spreadsheet download of the same ledger the page renders.
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
// N4 + N17 (2026-07-03) - the "How visitors behaved" block on the card expand:
// engagement, frustration, and the did-they-find-their-answer read, on the
// live_at clock, self-hiding below its sample floors.
import { sortInFlightByNextRead } from "./in-flight-order";
import { compoundActionGroupsById } from "@/domains/proof-gsc/compound-actions";
import { LedgerRowGroup, plainAction } from "./results-ledger-card";

export { shouldRenderEventCaveat } from "./results-ledger-card";

/**
 * Proof / Learning - operator-OS rebuild, surface (6). Every REVIEWED change
 * with its 7/14/28-day measurement windows, the GSC metrics to re-check (with
 * today's baseline), and the control pages for a diff-in-diff. Read-only; this
 * promotes loadProofPlan out of /diagnostics into the product nav.
 */
export const dynamic = "force-dynamic";


// W2-A (2026-07-02) - FP1 always-paint floor extended to this page: every awaited read
// on the render path is deadline-bounded so one wedged Supabase read (each 522 is ~30s)
// can never hold the stream open forever. The ledger (the page's spine) gets the
// generous window and times out to an honest one-liner; every sibling read keeps its
// existing fail-soft fallback, just bounded. Section internals are untouched (FP8).
const LEDGER_DEADLINE_MS = 20_000;
const SIDE_READ_DEADLINE_MS = 15_000;
const IN_FLIGHT_VISIBLE_LIMIT = 5;

/**
 * W2-A - page-level deadline around a self-hiding streamed section. Races the section's
 * own render promise so its `fallback={null}` Suspense boundary can never strand the
 * stream when a read inside it wedges; a timeout renders nothing, matching the
 * section's own self-hiding posture. The section files themselves are untouched.
 */
async function BoundedSection({ render }: { render: () => Promise<ReactNode> }): Promise<ReactNode> {
  const raced = await loadWithDeadline(render(), SIDE_READ_DEADLINE_MS);
  return raced.timedOut ? null : raced.data;
}

export default async function ProofPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // IA consolidation (2026-06-23): available to everyone, no operator gate.
  const params = await (searchParams ??
    Promise.resolve<Record<string, string | string[] | undefined>>({}));
  const initialPage = typeof params.page === "string" ? params.page : "";
  const tResolve = perfMark();
  const tenantId = await currentTenantId();
  perfStage("tenant-resolve", tResolve);
  // The ledger is the ONE read needed to paint Results. Connection health,
  // action packs, GSC finalization, calibration, and operator mode feed later
  // banners/cards only. Start them in parallel but do not await them here, so a
  // 15-second side dependency can never delay the header or ledger shell.
  const initialContext = loadResultsInitialContext(tenantId);
  const tReads = perfMark();
  const ledgerRaced = await loadWithDeadline(
    loadResultsLedgerSurface().catch(() => ({
      ledger: [] as ShippedChangeRecord[],
      computedAt: new Date().toISOString(),
    })),
    LEDGER_DEADLINE_MS,
  );
  perfStage("results-ledger-read", tReads);
  // W2-A - a timed-out ledger must never render as a confident-looking empty page
  // (that would read as "no changes yet", a lie). Say so honestly and stop.
  if (ledgerRaced.timedOut) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Every change you have made and whether it helped. We compare each page
          to how it did before, and to similar pages you did not change.
        </p>
        <div className="mt-5">
          <HonestDelay />
        </div>
      </div>
    );
  }
  const ledger = ledgerRaced.data.ledger;
  // R4 - the honest snapshot-age line under the header ("updated N ago", Beacon voice).
  const checkedAgoLine = ledgerCheckedAgoLine(ledgerRaced.data.computedAt, new Date().getTime());

  // W2-B (2026-07-10) - the "AI quoted this line" owned-alignment requests, derived
  // once off the ledger with the SAME gate AiQuotedReceipt used to apply per card (a
  // real post-ship citation gain). Fed to ONE batched reader in the side-read batch
  // instead of three Supabase reads + a saveMoveDraft PER card during the render (the
  // GET-mutation + N+1 this fixes). The cache warm-up write is scheduled in after().
  const ownedAlignmentRequests: OwnedAlignmentRequest[] = ledger
    .filter((l) => {
      const o = l.citationOutcome;
      const prompts = o?.promptsNowCiting ?? [];
      return !!o && prompts.length > 0 && (o.verdict === "gained" || o.treatedPostCount > 0);
    })
    .map((l) => ({ recId: l.id, ownedUrl: l.page, citingPrompts: l.citationOutcome!.promptsNowCiting ?? [] }));

  // W2-B (2026-07-10) - THE SIDE-READ WATERFALL + STREAMING FIX. The seven heavy
  // page-level reads (spark, control spark, changepoints, external events, seasonal
  // inflection, recrawl clock, control contamination) plus the batched alignment are
  // mutually independent AND none of them is needed to paint the header. They are
  // STARTED here as one parallel batch (each with its own fail-soft catch + 15s
  // deadline; see loadResultsSideReads below) but NOT awaited: the header, honest
  // banners, and record form paint first, and the sections that need these reads
  // (the cumulative strip, the proof summary, and the measured-outcomes board with
  // its revert offers / alignment / contamination caveats) each await the SAME
  // promise inside their own Suspense boundary.
  const sideReads = loadResultsSideReads(tenantId, ledger, ownedAlignmentRequests);

  // W2-B (2026-07-10) - warm the alignment cache OFF the GET: schedule the same
  // batch with persist:true in after() so any freshly-computed alignment is
  // written back for the next visit. Fire-and-forget + fail-soft; a GET never
  // mutates on its own render path.
  if (ownedAlignmentRequests.length > 0) {
    after(async () => {
      await getOwnedAnswerAlignmentsBatch(tenantId, ownedAlignmentRequests, { persist: true }).catch(() => {});
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Every change you have made and whether it helped. We compare each page
            to how it did before, and to similar pages you did not change.
          </p>
          {/* R4 - honest staleness: these numbers come from the last persisted
              re-measure (served instantly), so say exactly how old they are and
              that they refresh in the background. */}
          {ledger.length > 0 && checkedAgoLine ? (
            <p className="mt-1 text-[11px] text-muted-foreground/80 tabular-nums">{checkedAgoLine}</p>
          ) : null}
          {/* FP3 + FP8 - the cumulative outcome strip: the same count numbers as the
              bands below (same shared classifier over the same snapshot-served ledger,
              passed down so the strip never re-triggers the measure path), extended
              with the measured value the wins are adding. Shock windows ride along for
              THE ONE DOLLAR RULE - W2-B: awaited off the shared side-read batch inside
              this boundary, so the header text above paints without waiting for it. */}
          <div className="mt-3">
            <Suspense fallback={null}>
              <CumulativeOutcomeStream ledger={ledger} sideReads={sideReads} />
            </Suspense>
          </div>
        </div>
        {ledger.length > 0 ? (
          <Suspense fallback={<RecomputeLedgerButton disabled disabledReason="Checking Search Console data." />}>
            <RecomputeControlStream ledger={ledger} initialContext={initialContext} />
          </Suspense>
        ) : null}
      </div>

      <Suspense fallback={null}>
        <ResultsStatusStream ledger={ledger} tenantId={tenantId} initialContext={initialContext} />
      </Suspense>

      {/* Premium "Proof at a glance" scoreboard (2026-06-25) - the Results act of
          the Move → Ship → Prove loop. Own Suspense / self-hides when nothing is
          shipped; W2-B: awaits the shared side-read batch for shockWindows inside
          its own boundary, keeping the header paint independent of it. */}
      <Suspense fallback={null}>
        <ProofSummaryStream ledger={ledger} sideReads={sideReads} />
      </Suspense>

      {/* Item 27 - the promise ledger: forecast vs delivered, reconciled monthly. Sibling to the
          summary above; self-hides until at least 3 picks have settled at their 28-day window. */}
      <Suspense fallback={null}>
        <BoundedSection render={() => ForecastCalibrationSection()} />
      </Suspense>

      {/* Item 34 - pooled batch verdict: when a same-plan same-lever batch of 3+ pages has
          measured reads, one confident "as a group" line above the per-page rows below.
          Self-hides otherwise. */}
      <Suspense fallback={null}>
        <BoundedSection render={() => PooledVerdictSection()} />
      </Suspense>

      {/* ── Measured outcomes (shipped changes being tracked vs controls) ──
          W2-B: the cards board (with its revert offers, alignment receipts, and
          contamination caveats) streams inside its own Suspense boundary so the
          header + summary above paint first. The fallback is row-shaped honest
          loading copy, so the settle does not shift the layout. */}
      {ledger.length > 0 ? (
        <Suspense fallback={<MeasuredOutcomesFallback rowCount={Math.min(ledger.length, 3)} />}>
          <MeasuredOutcomesContextStream
            sideReads={sideReads}
            ledger={ledger}
            tenantId={tenantId}
            initialContext={initialContext}
          />
        </Suspense>
      ) : null}

      {/* Manual recording is a fallback, not part of the normal Results journey.
          Keep it after the answer-first summary and measured rows so an average
          user never mistakes it for the next required step. */}
      <details className="mb-6 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
        <summary className="cursor-pointer text-body font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
          Record a change Beacon did not track
        </summary>
        <div className="mt-3">
          <RecordAnyPageForm initialPage={initialPage} />
        </div>
      </details>

      {/* ── R14a "We got this wrong" (P1 trust receipts): revised-downward verdicts +
          proven-did-nothing changes, owned plainly, max 5, each linking to its own
          card above. Self-hiding when there is nothing to own - most days it is
          absent, which is exactly the point. */}
      <WeGotThisWrongSection items={buildRecapItems(ledger, plainAction)} />

      {/* ── What Beacon has learned (operator-only): per-action_type prior that
          steers ranking, so a skew is visible and excludable. ── */}
      <Suspense fallback={null}>
        <LearningDiagnosticsStream ledger={ledger} initialContext={initialContext} />
      </Suspense>

      {/* ── FP5c (2026-07-02, killer finding "why is there a second list of changes
          under the first list of changes") ── The former "Your changes" timeline used
          to render as a second full stack directly under the measured-outcomes list,
          repeating the same changes in a second format. The measured list above IS the
          one list now; the raw change log (which also holds detected site edits from
          before measurement started) stays reachable behind one collapsed line instead
          of duplicating the page. The W2-A BoundedSection wrapper is kept intact. */}
      <details className="mb-6">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
          See the raw change log
        </summary>
        <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
          The same changes as the list above, in raw log form, plus site edits I detected
          from before measurement started. Nothing here is a second to-do list.
        </p>
        <Suspense fallback={null}>
          <BoundedSection render={() => ResultsTimeline()} />
        </Suspense>
      </details>

    </div>
  );
}

/** The nonessential context that used to block the entire Results response.
 * One shared promise feeds every streamed consumer, so moving it behind
 * Suspense adds no duplicate I/O. Every read keeps its existing deadline and
 * fail-soft fallback. */
async function loadResultsInitialContext(tenantId: string) {
  const tContext = perfMark();
  const [connHealth, worklist, latestGscDate, calibrationRecords, isOperator] = await Promise.all([
    valueWithDeadline(loadConnectionHealth(tenantId).catch(() => []), [], SIDE_READ_DEADLINE_MS),
    valueWithDeadline(loadActionPackWorklistForTenant(tenantId).catch(() => null), null, SIDE_READ_DEADLINE_MS),
    valueWithDeadline(readLastFinalizedDate(tenantId).catch(() => null), null, SIDE_READ_DEADLINE_MS),
    valueWithDeadline(loadCalibrationRecords(tenantId).catch(() => [] as CalibrationRecord[]), [] as CalibrationRecord[], SIDE_READ_DEADLINE_MS),
    valueWithDeadline(Promise.resolve().then(() => isOperatorModeServer()).catch(() => false), false, SIDE_READ_DEADLINE_MS),
  ]);
  perfStage("results-streamed-context", tContext);
  return { connHealth, worklist, latestGscDate, calibrationRecords, isOperator };
}

type ResultsInitialContext = Awaited<ReturnType<typeof loadResultsInitialContext>>;

function gscLagForLedger(ledger: ShippedChangeRecord[], latestGscDate: string | null) {
  const byRow = new Map(ledger.map((l) => [l.id, gscLagStatus(l, latestGscDate)] as const));
  const waiting = [...byRow.values()].filter(
    (s) => s.calendarWindowClosed && !s.gscWindowAvailable && s.nextWindowDay != null,
  );
  return { byRow, waiting };
}

async function RecomputeControlStream({
  ledger,
  initialContext,
}: {
  ledger: ShippedChangeRecord[];
  initialContext: Promise<ResultsInitialContext>;
}) {
  const { latestGscDate } = await initialContext;
  const { byRow, waiting } = gscLagForLedger(ledger, latestGscDate);
  const anyWindowReady = ledger.some((l) => l.windows.some((w) => w.ran));
  const lagReason =
    waiting[0]?.reasonCopy ??
    [...byRow.values()].find((s) => s.nextWindowDay != null && !s.gscWindowAvailable)?.reasonCopy ??
    undefined;
  return <RecomputeLedgerButton disabled={!anyWindowReady} disabledReason={anyWindowReady ? undefined : lagReason} />;
}

/** Days the finalized Search Console DATA watermark may lag before the amber
 * "data is N days old" banner is honest. Google reports 2-3 days behind by design
 * (the cockpit header treats <= 4 days as healthy, cockpit-bar.tsx:41), so only
 * past 5 days is the finalized proof data genuinely behind. */
export const RESULTS_STALE_DATA_DAYS = 5;
/** Days with no connector sync before we name the connection as the cause - but
 * only ever when the DATA is also behind. Fresh data means the pipeline is
 * working whatever a stale sync stamp claims, so we never cry "check the
 * connection" over a connector that is demonstrably delivering data. */
export const RESULTS_STALE_SYNC_DAYS = 5;

function daysBehind(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** The single honest Search Console freshness banner for /results. It reads the
 * finalized DATA watermark (latestGscDate) - the SAME source as the receipt line
 * lower on this page - not the connector sync stamp (daysStale). Reading the sync
 * stamp is the bug that once showed "18 days old" while the data was 3 days
 * fresh, self-contradicting on one page. */
export function resultsFreshnessNote(
  gsc: Pick<ConnectionHealth, "severity" | "daysStale"> | null,
  latestGscDate: string | null,
  now: Date,
): string | null {
  if (gsc == null || gsc.severity === "healthy") return null;
  if (gsc.severity === "disconnected")
    return "Google Search Console isn't connected. Proof verdicts can't update until it is.";
  if (gsc.severity === "needs_setup")
    return "Google Search Console is connected but hasn't synced yet. Verdicts will fill in after the first sync.";
  const dataDays = daysBehind(latestGscDate, now);
  // The finalized DATA watermark is the source of truth for "is my proof
  // current". Fresh data means the pipeline is working, so show nothing.
  if (dataDays == null || dataDays <= RESULTS_STALE_DATA_DAYS) return null;
  const syncDays = gsc.daysStale;
  if (syncDays != null && syncDays > RESULTS_STALE_SYNC_DAYS)
    return `I have not been able to sync Search Console for ${syncDays} days. Check the connection.`;
  return `Search Console data is ${dataDays} days old. Recent changes may not show a verdict yet. I am refreshing connected data in the background.`;
}

async function ResultsStatusStream({
  ledger,
  tenantId,
  initialContext,
}: {
  ledger: ShippedChangeRecord[];
  tenantId: string;
  initialContext: Promise<ResultsInitialContext>;
}) {
  const { connHealth, latestGscDate } = await initialContext;
  const { waiting } = gscLagForLedger(ledger, latestGscDate);
  const gsc = connHealth.find((c) => c.key === "google_gsc") ?? null;
  const freshnessNote = resultsFreshnessNote(gsc, latestGscDate, new Date());

  const dueNow = ledger.filter((l) => isDueForMeasure(l, latestGscDate, new Date()));
  const eligibleReverify = selectRowsToReverify(ledger).length > 0;
  if (dueNow.length > 0 || eligibleReverify) scheduleAutoMeasure(tenantId);

  return (
    <>
      {freshnessNote ? (
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {freshnessNote}
        </div>
      ) : waiting.length > 0 ? (
        <div className="mb-5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {waiting.length} change{waiting.length === 1 ? " is" : "s are"} waiting on Search Console data, not stalled. {waiting[0]?.reasonCopy ?? ""} Google Search data typically lags 2-3 days.
        </div>
      ) : null}
    </>
  );
}

async function MeasuredOutcomesContextStream({
  sideReads,
  ledger,
  tenantId,
  initialContext,
}: {
  sideReads: Promise<ResultsSideReads>;
  ledger: ShippedChangeRecord[];
  tenantId: string;
  initialContext: Promise<ResultsInitialContext>;
}) {
  const { latestGscDate, isOperator, worklist, calibrationRecords } = await initialContext;
  const calibrationByProofId = new Map(calibrationRecords.map((r) => [r.proofId, r] as const));
  return (
    <MeasuredOutcomesBoard
      sideReads={sideReads}
      ledger={ledger}
      latestGscDate={latestGscDate}
      tenantId={tenantId}
      isOperator={isOperator}
      worklist={worklist}
      calibrationByProofId={calibrationByProofId}
    />
  );
}

async function LearningDiagnosticsStream({
  ledger,
  initialContext,
}: {
  ledger: ShippedChangeRecord[];
  initialContext: Promise<ResultsInitialContext>;
}) {
  const { isOperator } = await initialContext;
  const learningDiag = isOperator
    ? computeOutcomePriorDiagnostics(ledger).filter((d) => d.prior !== null || d.excluded > 0)
    : [];
  if (learningDiag.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        What Beacon has learned
      </h2>
      <p className="mb-2 text-[11px] text-muted-foreground">
        How your past results nudge which fixes Beacon suggests first. If a result looks mis-measured, use &ldquo;Exclude from learning&rdquo; on it below.
      </p>
      <ul className="space-y-1">
        {learningDiag.map((d) => (
          <li key={d.actionType} className="text-[12px] text-foreground/80">
            <span className="font-medium">{d.actionType.replace(/_/g, " ")}</span>: {d.won} worked, {d.lost} did not
            {d.excluded > 0 ? `, ${d.excluded} excluded` : ""}
            {d.prior !== null ? (
              <span className="text-muted-foreground"> &rarr; Beacon now {d.prior > 0 ? `favors this (+${Math.round(d.prior * 100)}%)` : d.prior < 0 ? `is cautious here (${Math.round(d.prior * 100)}%)` : "is neutral"}</span>
            ) : (
              <span className="text-muted-foreground"> &rarr; not enough results yet to change ranking</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * W2-B (2026-07-10) - the parallel side-read batch, extracted so the page can START
 * it without awaiting (streaming) and every consumer awaits the SAME promise. Each
 * read keeps its OWN fail-soft `.catch` and its OWN 15s deadline, so one wedged read
 * times out to its fallback WITHOUT holding back the other seven:
 *   1) sparkByPath - Item 5 before/after daily clicks per measured row (first 16).
 *   2) controlSparkByPath - R14b comparison-page daily-clicks series (first 8 rows,
 *      max 2 comparison pages each, deduped, capped at the loader's 16-path limit).
 *   3) detectedChangepoints -> shockWindows - item 32 algorithm-weather shocks
 *      (no fresh CUSUM run here; that is the nightly cron's job).
 *   4) externalEvents - N32 (R21b) external-event ledger read side.
 *   5) seasonalInflectionById - item 69 seasonal-inflection flag (computed-only).
 *   6) recrawlClockById - N11 recrawl-gated SEARCH clock (computed-only, never a
 *      live-page fetch, gates only the Search verdict lane).
 *   7) contaminationById - N13 control-contamination guard (computed-only).
 *   8) ownedAlignmentByRecId - the batched, READ-ONLY "AI quoted this line"
 *      alignments (persist:false -> a GET never writes; the after() warm-up in the
 *      page body is the only writer).
 */
async function loadResultsSideReads(
  tenantId: string,
  ledger: ShippedChangeRecord[],
  ownedAlignmentRequests: OwnedAlignmentRequest[],
) {
  const controlSparkPaths = [
    ...new Set(ledger.slice(0, 8).flatMap((l) => (l.controlPages ?? []).slice(0, 2))),
  ].slice(0, 16);
  const tSide = perfMark();
  const [
    sparkByPath,
    controlSparkByPath,
    detectedChangepoints,
    externalEvents,
    seasonalInflectionById,
    recrawlClockById,
    contaminationById,
    ownedAlignmentByRecId,
  ] = await Promise.all([
    valueWithDeadline(
      loadDailyClicksByPathsForTenant(
        tenantId,
        ledger.slice(0, 16).map((l) => l.path),
      ).catch(() => new Map<string, SparkPoint[]>()),
      new Map<string, SparkPoint[]>(),
      SIDE_READ_DEADLINE_MS,
    ),
    valueWithDeadline(
      controlSparkPaths.length > 0
        ? loadDailyClicksByPathsForTenant(tenantId, controlSparkPaths).catch(
            () => new Map<string, SparkPoint[]>(),
          )
        : Promise.resolve(new Map<string, SparkPoint[]>()),
      new Map<string, SparkPoint[]>(),
      SIDE_READ_DEADLINE_MS,
    ),
    valueWithDeadline(loadDetectedChangepoints(tenantId).catch(() => []), [], SIDE_READ_DEADLINE_MS),
    valueWithDeadline(loadExternalEvents(tenantId).catch(() => []), [], SIDE_READ_DEADLINE_MS),
    valueWithDeadline(
      attachSeasonalInflectionForLedger(
        tenantId,
        ledger.map((l) => ({ id: l.id, path: l.path, shippedAt: l.shippedAt, windows: l.windows ?? [] })),
      ).catch(() => new Map()),
      new Map(),
      SIDE_READ_DEADLINE_MS,
    ),
    valueWithDeadline(
      attachRecrawlClockForLedger(
        tenantId,
        ledger.map((l) => ({ id: l.id, page: l.page, shippedAt: l.shippedAt, actionType: l.actionType, after: l.after })),
      ).catch(() => new Map()),
      new Map(),
      SIDE_READ_DEADLINE_MS,
    ),
    valueWithDeadline(
      attachControlContaminationForLedger(tenantId, ledger).catch(() => new Map()),
      new Map(),
      SIDE_READ_DEADLINE_MS,
    ),
    valueWithDeadline(
      getOwnedAnswerAlignmentsBatch(tenantId, ownedAlignmentRequests).catch(
        () => new Map<string, PersistedAnswerAlignment | null>(),
      ),
      new Map<string, PersistedAnswerAlignment | null>(),
      SIDE_READ_DEADLINE_MS,
    ),
  ]);
  perfStage("results-side-reads", tSide, { rows: ledger.length });
  const shockWindows: ShockWindow[] = buildShockWindows({ dailySeries: [], priorChangepoints: detectedChangepoints });
  return {
    sparkByPath,
    controlSparkByPath,
    shockWindows,
    externalEvents,
    seasonalInflectionById,
    recrawlClockById,
    contaminationById,
    ownedAlignmentByRecId,
  };
}

type ResultsSideReads = Awaited<ReturnType<typeof loadResultsSideReads>>;

/** W2-B - the cumulative outcome strip, streamed: awaits the shared side-read batch
 *  for shockWindows inside its own Suspense boundary so the header paints first. */
async function CumulativeOutcomeStream({
  ledger,
  sideReads,
}: {
  ledger: ShippedChangeRecord[];
  sideReads: Promise<ResultsSideReads>;
}) {
  const { shockWindows } = await sideReads;
  return <CumulativeOutcomeSection ledger={ledger} shockWindows={shockWindows} />;
}

/** W2-B - the "Proof at a glance" summary, streamed the same way; keeps its W2-A
 *  BoundedSection floor for the section's own render work. */
async function ProofSummaryStream({
  ledger,
  sideReads,
}: {
  ledger: ShippedChangeRecord[];
  sideReads: Promise<ResultsSideReads>;
}) {
  const { shockWindows } = await sideReads;
  return <BoundedSection render={() => ProofSummarySection({ ledger, shockWindows })} />;
}

/** W2-B - honest, row-shaped fallback for the streamed measured-outcomes board:
 *  the section header + copy render immediately (no layout jump on settle), the
 *  card slots pulse until the comparison data lands. Beacon voice, no lab words. */
function MeasuredOutcomesFallback({ rowCount }: { rowCount: number }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Measured outcomes
        </h2>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        I am pulling each change&apos;s daily clicks and comparison checks together. This
        usually takes a few seconds.
      </p>
      <div className="space-y-2.5">
        {Array.from({ length: Math.max(1, rowCount) }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-inset/50" />
        ))}
      </div>
    </div>
  );
}

/**
 * W2-B (2026-07-10) - the streamed measured-outcomes board: awaits the shared
 * side-read batch, then builds the per-row presentation (maturity, caveats,
 * grades), the operator revert offers, and the three lifecycle bands - everything
 * that used to block the whole page before the header could paint. Content and
 * behavior are unchanged; only WHERE the awaiting happens moved.
 */
async function MeasuredOutcomesBoard({
  sideReads,
  ledger,
  latestGscDate,
  tenantId,
  isOperator,
  worklist,
  calibrationByProofId,
}: {
  sideReads: Promise<ResultsSideReads>;
  ledger: ShippedChangeRecord[];
  latestGscDate: string | null;
  tenantId: string;
  isOperator: boolean;
  worklist: Awaited<ReturnType<typeof loadActionPackWorklistForTenant>> | null;
  calibrationByProofId: Map<string, CalibrationRecord>;
}) {
  const {
    sparkByPath,
    controlSparkByPath,
    shockWindows,
    externalEvents,
    seasonalInflectionById,
    recrawlClockById,
    contaminationById,
    ownedAlignmentByRecId,
  } = await sideReads;

  // Move 2 - the shared maturity presentation per row, so every card reads the same
  // honest measurement language (an early read is never a final verdict, never red/green).
  const overlapById = detectMeasurementOverlaps(ledger.map((l) => ({ id: l.id, path: l.path, shippedAt: l.shippedAt })));
  const compoundById = compoundActionGroupsById(ledger);
  const presById = new Map<string, MeasurementPresentation>(
    ledger.map((l) => {
      const basisWin = (l.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
      return [
        l.id,
        buildMeasurementPresentation({
          shippedAt: l.shippedAt,
          now: new Date(),
          latestGscDate,
          windows: (l.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
          // Fail-closed calibration quarantine, review fix 1 (2026-07-11): the
          // presentation is built from the CALIBRATION-AWARE verdict, so an
          // uncalibrated won/lost yields exactly the neutral presentation a
          // mature inconclusive row gets - headline, Search line, tone, and the
          // grade sentence all read neutral, never "This helped." or "Likely
          // helping (high confidence)". The stored verdict is untouched; the
          // revert-offer brake below reads the RAW verdict on purpose.
          verdict: presentationVerdictFor(l),
          controlsUsed: basisWin?.controlsUsed ?? 0,
          baselineImpressions: l.baseline?.impressions ?? 0,
          overlap: overlapById.get(l.id) ?? null,
          live: true,
          shockWindows,
          // Parallel-trends veto (master plan item 33): this row's comparison
          // pages were a fallback match (not moving like the treated page
          // before the ship) - additive, computed straight from the ledger
          // field the matcher wrote at selection time.
          weakComparison: l.controlMatchWeak === true,
          // Seasonality guard (master plan item 69): computed above from this
          // tenant's own family demand profile - additive, never mutates verdict.
          seasonalInflection: seasonalInflectionById.get(l.id)?.measuredAcrossSeasonalInflection === true,
          seasonalInflectionCaveat: seasonalInflectionById.get(l.id)?.caveat ?? null,
          // Recrawl-gated SEARCH clock (master plan N11): computed above from
          // this tenant's own gsc_url_inspections history - additive, never
          // mutates windows/verdict/shippedAt, and gates only the Search lane
          // (the GA4 traffic line below keeps its live_at clock). Only flags
          // "pending" when Beacon has actually inspected this URL at least
          // once and none of those index crawls post-date the ship; a page
          // NEVER inspected yet (hasInspectionHistory false - true for most
          // rows today, since the sweep is new) reads as unknown, not blind,
          // so wiring this in does not freeze the whole ledger to "Waiting"
          // on day one. Once confirmed, the search checkpoints count from
          // recrawlConfirmedAt instead of the ship date.
          recrawlPending:
            recrawlClockById.get(l.id)?.hasInspectionHistory === true &&
            recrawlClockById.get(l.id)?.recrawlConfirmedAt == null,
          recrawlDaysBlind: recrawlClockById.get(l.id)?.daysBlind ?? null,
          recrawlConfirmedAt: recrawlClockById.get(l.id)?.recrawlConfirmedAt ?? null,
          // Control-contamination guard (master plan N13): computed above from
          // the full ledger + snapshot history - additive, never mutates the
          // stored controlPages/verdict. The short card caveat is the LAST
          // note (buildContaminationNotes appends the one-line swap/caution
          // summary after the per-control reasons); the full per-control
          // detail still renders in "See the math" via controlContaminationNotes.
          controlContaminated: contaminationById.get(l.id)?.verdict.hasContamination === true,
          controlContaminationCaveat:
            contaminationById.get(l.id)?.notes.at(-1) ?? null,
          // Sustainable control pool (master plan N16): one plain pool-health
          // line for an open measurement ("2 of 4 comparison pages are still
          // clean."), rendered in "See the math". Null for settled rows.
          controlPoolHealthLine: contaminationById.get(l.id)?.poolHealthLine ?? null,
        }),
      ] as const;
    }),
  );

  // N32 (R21b) - per-row external-event caveat + reliability flag, DEDUPED against the weather
  // caveat. For each row we take its measurement window and ask the ledger adapter for the honest
  // caveat, passing this row's OWN weatherCaveat as `weatherSentence` so that when the window
  // overlaps a shock the adapter returns that EXACT weather sentence (dedupe): the render step
  // below only shows the event line when it differs from the weather line already on the card, so
  // a shock never renders twice. `machineryOrCompoundFlagged` is the non-shock reliability bit
  // (connector outage / own-site cluster) fed into N10 below. Empty ledger -> both maps carry
  // null/false for every row = byte-identical.
  const eventCaveatById = new Map<string, string | null>();
  const eventMachineryFlagById = new Map<string, boolean>();
  for (const l of ledger) {
    const win = measurementWindowOf(l.shippedAt, l.windows ?? []);
    if (!win || externalEvents.length === 0) {
      eventCaveatById.set(l.id, null);
      eventMachineryFlagById.set(l.id, false);
      continue;
    }
    eventCaveatById.set(
      l.id,
      eventCaveatForWindow({
        windowStart: win.start,
        windowEnd: win.end,
        events: externalEvents,
        shockWindows,
        weatherSentence: presById.get(l.id)?.weatherCaveat ?? null,
      }),
    );
    eventMachineryFlagById.set(
      l.id,
      eventReliabilityFlagsForWindow({ windowStart: win.start, windowEnd: win.end, events: externalEvents })
        .machineryOrCompoundFlagged,
    );
  }

  // One verdict-reliability grade (master plan N10): combines recrawl, window
  // completeness, contamination, weak comparisons, shock/seasonal overlap, and
  // sample strength into one label - COMPUTED-ONLY from the SAME presentation
  // + sufficiency numbers already built above, so it never disagrees with the
  // card's own caveats. Never mutates the stored ledger row.
  const gradeById = new Map<string, VerdictReliabilityResult>(
    ledger.map((l) => {
      const pres = presById.get(l.id);
      const basisWin = (l.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
      const grade = pres
        ? gradeFromPresentation(
            pres,
            {
              controlsUsed: basisWin?.controlsUsed ?? 0,
              baselineImpressions: l.baseline?.impressions ?? 0,
            },
            l.permutationRead && l.permutationRead.nTotal > 0
              ? { nGreater: l.permutationRead.nGreater, nTotal: l.permutationRead.nTotal }
              : null,
            // N32 (R21b) - the non-shock external-event reliability bit (a connector outage or an
            // own-site change cluster overlapping this window) OR'd into the interference slot: it
            // is the same class of integrity problem, demoting the grade the same way. The shock
            // kinds are NOT passed here - N10 already takes the shock via pres.weatherQuarantined,
            // and eventReliabilityFlagsForWindow deliberately returns machineryOrCompoundFlagged
            // false for shocks so this never double-counts one. False (empty ledger) is identical
            // to the prior `undefined`.
            eventMachineryFlagById.get(l.id) === true,
            // P4 R10a + R10b measurement-rigor extras, straight off the
            // record's own computed attachments: a target-panel/page direction
            // disagreement (v1 150) or a faded first-week jump (v1 378)
            // demotes to shaky; an unmistakable early direction (v1 288)
            // strengthens the decent sentence without ever upgrading the grade
            // past the 28-day clock; a proven-neutral equivalence read (v1
            // 289) grades a closed 28-day "did nothing" solid-for-learning;
            // and the many-measurements caution (v1 291) demotes a win too
            // close to the by-chance line from solid to decent.
            {
              panelDisagrees: l.panelOutcome?.disagreesWithPage === true,
              noveltyDecay: l.noveltyDecay?.noveltyDecay === true,
              earlyDecisive: l.earlySignal?.earlyDecisive === true,
              provenNeutral: l.equivalence?.provenNeutral === true,
              fdrCaution: l.fdrRead?.fdrCaution === true,
              fdrPoolSize: l.fdrRead?.poolSize,
              // N4 behavior corroboration: a Search win whose visitors behaved
              // worse on the page holds at decent (never solid) with the
              // reason named. Corroboration only - behavior never upgrades.
              behaviorContradictsWin:
                l.verdict === "won" && l.behaviorOutcome?.compositeVerdict === "worse",
            },
          )
        : { grade: "too early" as const, reasons: [], sentence: "I would call this too early to read: no measurement presentation is available yet." };
      return [l.id, grade] as const;
    }),
  );

  // Item 68 - three outcome bands instead of one flat list. A mature win is a Win;
  // a mature non-win is knowledge gained ("What we learned"); everything still
  // measuring or waiting on data is "In flight". Presentation-only; the measurement
  // math and stores are untouched.
  // FP3 (2026-07-02) - band membership now comes from the shared lifecycle classifier
  // (the same mature-result rule as before: 28-day window + sufficiency + won/lost +
  // no overlapping edit), so these band counts, the header strip above them, and every
  // count promised by a cross-link (Today's "N measuring") are ONE computation. The
  // full presentation (presById) still drives every badge and caveat on the cards.
  const bands = splitLedgerLifecycle(ledger);
  const winRows = bands.won;
  const learningRows = bands.learned;
  const inFlightRows = sortInFlightByNextRead(bands.measuring);
  const closestInFlightRows = inFlightRows.slice(0, IN_FLIGHT_VISIBLE_LIMIT);
  const laterInFlightRows = inFlightRows.slice(IN_FLIGHT_VISIBLE_LIMIT);

  // Item C7 - the seasonal-overlap caveat used to render its full paragraph on
  // every affected card (15 identical copies on a page with 15 seasonal
  // pages). Count them once and say it once at the section level; each card
  // below only gets a small "seasonal swing overlaps" chip.
  const seasonalCount = ledger.filter((l) => presById.get(l.id)?.seasonalInflectionFlagged).length;

  // Item 11 - one-click restore offers for rows that are measuring negative
  // (7/14/28 day reads). The shared revert policy only ever proposes (E-36:
  // never auto-revert, ask first); the snapshot lookup is bounded to the
  // first few negatives. Rows already restored are badged instead.
  // Operator-only (the action re-gates anyway).
  const revertById = new Map<string, RevertDecision>();
  const restoredIds = new Set(ledger.filter((l) => hasRevertNote(l)).map((l) => l.id));
  if (isOperator) {
    // Quarantine exception (review fix 1): the revert OFFER is a protective
    // brake, so its direction reads the RAW stored verdict (directionOf), not
    // the calibration-aware presentation above - the quarantine removes unearned
    // trust in wins, it must never remove caution on a possible loss.
    const negativeRows = ledger
      .filter((l) => {
        const p = presById.get(l.id);
        return (
          !!p &&
          directionOf(l.verdict) === "negative" &&
          (p.basisDay ?? 0) >= 7 &&
          !isRevertRecord(l) &&
          !hasRevertNote(l) &&
          findExistingRevertRecord(ledger, l) == null
        );
      })
      .slice(0, 6);
    if (negativeRows.length > 0) {
      // W2-A - up to 6 sequential snapshot lookups; bounded as ONE unit so a wedged
      // read costs at most one deadline, not one per row. On a timeout the restore
      // offers simply don't show this visit - the rows themselves still render.
      const offers = await valueWithDeadline(
        (async () => {
          // W2-B (2026-07-10) - the autopilot config + every row's snapshot lookup
          // are independent reads; run them as ONE parallel batch instead of the
          // old per-row sequential await chain (up to 6 snapshot reads back to
          // back). Each snapshot read keeps its own fail-soft `.catch(() => null)`.
          const [autopilotConfig, sources] = await Promise.all([
            getAutopilotConfig().catch(() => null),
            Promise.all(negativeRows.map((rec) => resolveRevertSource(tenantId, rec).catch(() => null))),
          ]);
          const out: Array<readonly [string, RevertDecision]> = [];
          negativeRows.forEach((rec, i) => {
            const p = presById.get(rec.id)!;
            const source = sources[i];
            const decision = decideRevert({
              tenantId,
              // Same brake rule as the filter above: raw stored direction.
              direction: directionOf(rec.verdict),
              windowDay: p.basisDay,
              attributionQuality: p.attributionQuality,
              lever: rec.actionType,
              config: autopilotConfig,
              snapshotAvailable: source != null,
              alreadyReverted: false,
              now: new Date(),
              liftLabel: liftLabelFor(rec),
            });
            if (decision.action !== "none") out.push([rec.id, decision] as const);
          });
          return out;
        })(),
        [],
        SIDE_READ_DEADLINE_MS,
      );
      for (const [id, decision] of offers) revertById.set(id, decision);
    }
  }

  // Phase 4 - deterministic ActionPack↔proof linker (pure, no migration). Each
  // shipped change is traced back to the Move that recommended it (or honestly
  // labelled manual/legacy). Measurement math is untouched.
  const proofLinks = linkProofRowsToActionPacks({
    proofRows: ledger.map((l) => ({ id: l.id, page: l.page, path: l.path, actionType: l.actionType, targetQueries: l.targetQueries })),
    actionPacks: worklist?.packs ?? [],
  });
  const linkByRowId = new Map(proofLinks.map((lk) => [lk.proofRow.id, lk as ProofLink]));

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Measured outcomes
        </h2>
        {/* R14b - the same rows, as a file: reads the snapshot the page reads. */}
        <a
          href="/results/export"
          className="text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          Download as spreadsheet
        </a>
      </div>
      {/* R14b (receipts everywhere) - what these verdicts are read FROM: Search
          Console data through its last finalized day. */}
      <ReceiptLine
        line={buildReceiptLine({
          source: "your Search Console data",
          through: latestGscDate,
          nowMs: serverNowMs(),
          note: "Google reports a few days behind.",
        })}
        className="mb-2"
      />
      {/* Dollar-ROI honesty (gap #1): show what proof CAN measure. Revenue is
          only claimed if GA4 actually returns it; this property has no revenue
          events, so we say so once rather than imply dollars per card. */}
      {!ledger.some((l) => l.trafficOutcome?.hasRevenue) ? (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Each change is measured on Search (clicks, rank, click rate) and GA4 traffic
          (sessions, conversions). No revenue events are configured in GA4, so
          proof shows traffic and conversions, not dollars.
        </p>
      ) : null}
      {/* Item C7 - the seasonal-overlap caveat used to repeat its full paragraph
          verbatim on every affected card. Say it once, here, for the whole page;
          each card below only shows a small chip. */}
      {seasonalCount > 0 ? (
        <p className="mb-2 text-[11px] text-amber-700">
          {seasonalCount} of these overlap the May-June demand swing for their topics, so I read {seasonalCount === 1 ? "it" : "them"} cautiously.
        </p>
      ) : null}
      <WhatHappensNext />

      {/* Item 68 band 1: mature wins, celebrated in one sentence, still factual. */}
      {winRows.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-emerald-700">
            Wins ({winRows.length})
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            These changes beat their comparison pages over the full window. Real lifts, measured.
          </p>
          <LedgerRowGroup rows={winRows} band="win" linkByRowId={linkByRowId} presById={presById} compoundById={compoundById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} calibrationByProofId={calibrationByProofId} ownedAlignmentByRecId={ownedAlignmentByRecId} />
        </div>
      ) : null}

      {/* Item 68 band 2: mature non-wins, framed as knowledge gained, never failure. */}
      {learningRows.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-foreground/70">
            What we learned ({learningRows.length})
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            These changes did not move the number, and that teaches us which lever to try next on pages like these.
          </p>
          <LedgerRowGroup rows={learningRows} band="learning" linkByRowId={linkByRowId} presById={presById} compoundById={compoundById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} calibrationByProofId={calibrationByProofId} ownedAlignmentByRecId={ownedAlignmentByRecId} />
        </div>
      ) : null}

      {/* Item 68 band 3: everything still measuring or waiting on data. */}
      {inFlightRows.length > 0 ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Closest results ({closestInFlightRows.length} of {inFlightRows.length})
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                The next changes likely to teach you something, ordered by their upcoming read.
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground">Nothing to do until a read lands</span>
          </div>
          <LedgerRowGroup rows={closestInFlightRows} band="inflight" linkByRowId={linkByRowId} presById={presById} compoundById={compoundById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} ownedAlignmentByRecId={ownedAlignmentByRecId} />
          {laterInFlightRows.length > 0 ? (
            <details className="mt-3 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5">
              <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                See all {laterInFlightRows.length} later reads
              </summary>
              <p className="mt-1 text-[10px] text-muted-foreground">
                These are healthy and still collecting data. They are hidden by default so the nearest decisions stay clear.
              </p>
              <LedgerRowGroup rows={laterInFlightRows} band="inflight" linkByRowId={linkByRowId} presById={presById} compoundById={compoundById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} ownedAlignmentByRecId={ownedAlignmentByRecId} />
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Plain-English explainer for the operator: what measuring means, when the first
 * verdict lands, and the honest limits of an observational comparison.
 */
function WhatHappensNext() {
  return (
    <div className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50/80 to-indigo-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-foreground">How a result becomes trustworthy</div>
          <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-foreground/65">
            Beacon compares each changed page with similar untouched pages. Google reports a few days behind, so these are evidence checkpoints, not a loading timer.
          </p>
        </div>
        <span className="rounded-full border border-sky-200 bg-white/80 px-2.5 py-1 text-[10px] font-medium text-sky-800">
          No action needed while measuring
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Result measurement checkpoints">
        {[
          ["7 days", "First signal"],
          ["14 days", "Direction firms up"],
          ["28 days", "Strongest read"],
        ].map(([day, label], index) => (
          <div key={day} className="relative rounded-xl border border-white/80 bg-white/70 px-3 py-2 shadow-sm">
            {index < 2 ? <span aria-hidden className="absolute -right-2 top-1/2 z-10 h-px w-2 bg-sky-300" /> : null}
            <div className="text-[12px] font-semibold tabular-nums text-foreground">{day}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
