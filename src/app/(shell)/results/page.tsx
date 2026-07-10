import { Suspense, type ReactNode } from "react";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, CornerUpLeft } from "lucide-react";
import { dossierHref } from "@/lib/page-dossier-link";

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
import { loadConnectionHealth } from "@/domains/insight/connection-health";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import { gscLagStatus, isDueForMeasure } from "@/domains/proof-gsc/measure-lifecycle";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  isMatureOutcome,
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
import { Sparkline, type SparkPoint } from "@/components/data/sparkline";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { linkProofRowsToActionPacks, type ProofLink } from "@/domains/action-pack/proof-linker";
import { ProofSummarySection } from "./proof-summary-section";
import { ForecastCalibrationSection } from "./forecast-calibration-section";
import { PooledVerdictSection } from "./pooled-verdict-section";
import { loadCalibrationRecords, type CalibrationRecord } from "@/domains/experiments/forecast-calibration-store";
import { buildForecastReceiptLine, shouldShowForecastReceipt } from "@/domains/experiments/forecast-receipts";
import { computeOutcomePriorDiagnostics } from "@/domains/recommendation-intelligence/outcome-prior";
import {
  pickProofMetric,
  proofOutcomeSentence,
  formatWindowLift,
  addDays,
  type GscProofVerdict,
  type ProofMetric,
} from "@/domains/proof-gsc/measure";
import { citationLineFor } from "@/domains/proof-gsc/citation-outcome";
import { shouldShowChangeDollarLine } from "@/domains/proof-gsc/change-dollar-value";
import { getOwnedAnswerAlignmentsBatch, type OwnedAlignmentRequest, type PersistedAnswerAlignment } from "@/domains/ai-visibility/answer-alignment-store";
import { permutationSentenceFromCounts } from "@/domains/proof-gsc/permutation-null";
import { selectHeadlineSentence } from "@/domains/proof-gsc/bayesian-read";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { proofBadgeLabel, proofBadgeLabelFromVerdict, proofBadgeMaturesOn } from "./proof-badge";
import { plainSearchHeadline } from "./proof-plain-search-line";
import { searchAndTrafficDisagree, reconciliationSentence } from "./proof-reconciliation";
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
  RollbackCopyButton,
  RecrawlButton,
  ExcludeFromLearningButton,
  RestoreOldVersionButton,
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
import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { HonestDelay } from "@/components/honest-delay";
// R14a (2026-07-03) - trust receipts: the append-only verdict revision trail on the
// card expand, and the "We got this wrong" recap below the bands (misses owned plainly).
import { buildVerdictRevisionLines } from "@/domains/proof-gsc/verdict-revisions";
import { buildRecapItems, WeGotThisWrongSection } from "./results-recap";
// R14b (P1 trust receipts): named comparison pages on the card chart (dashed series +
// legend), the prep-spend join on the card expand, the section-level one-line receipt,
// and the spreadsheet download of the same ledger the page renders.
import { controlsLegendLine, prepSpendLine, verifyGaveUpLine } from "./trust-receipts";
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
// N4 + N17 (2026-07-03) - the "How visitors behaved" block on the card expand:
// engagement, frustration, and the did-they-find-their-answer read, on the
// live_at clock, self-hiding below its sample floors.
import { behaviorHasContent } from "@/domains/proof-gsc/behavior-outcome";

/**
 * Proof / Learning - operator-OS rebuild, surface (6). Every REVIEWED change
 * with its 7/14/28-day measurement windows, the GSC metrics to re-check (with
 * today's baseline), and the control pages for a diff-in-diff. Read-only; this
 * promotes loadProofPlan out of /diagnostics into the product nav.
 */
export const dynamic = "force-dynamic";


/** Move 2 / FP8 - the badge is a Pill primitive colored by MATURITY tone, never by
 *  the raw verdict. Red/green appear only at a mature result; an early signal reads
 *  as the blue "measuring" intent, waiting-for-data as amber "waiting". */
const TONE_PILL_INTENT: Record<MeasurementPresentation["tone"], PillIntent> = {
  positive: "won",
  negative: "attention",
  neutral: "neutral",
  progress: "measuring",
  waiting: "waiting",
};
/** Legacy fallback (no presentation available): same maturity-honest posture -
 *  a pre-28-day won/lost never earns the final red/green treatment. */
function verdictPillIntent(verdict: GscProofVerdict, basisDay: number | null): PillIntent {
  if (verdict === "won") return basisDay === 28 ? "won" : "measuring";
  if (verdict === "lost") return basisDay === 28 ? "attention" : "measuring";
  if (verdict === "measuring" || verdict === "insufficient_data") return "waiting";
  return "neutral";
}

/** N32 (R21b) - the render dedupe rule for the external-event caveat: show it ONLY when the
 *  ledger produced a caveat AND that caveat is not the SAME sentence the weather guard already
 *  renders on this row. eventCaveatForWindow reuses weatherCaveatSentence verbatim for a shock, so
 *  when a window overlaps a shock this returns false (the weather line already said it) and a
 *  connector-outage / own-site-cluster caveat (a distinct sentence) returns true. Null self-hides.
 *  PURE; exported for a direct test pin. */
export function shouldRenderEventCaveat(
  eventCaveat: string | null | undefined,
  weatherCaveat: string | null | undefined,
): boolean {
  return !!eventCaveat && eventCaveat !== (weatherCaveat ?? null);
}

/** One verdict-reliability grade (master plan N10): a neutral gray scale, never
 *  red/green, so it never competes with the badge's own maturity color above -
 *  this chip answers "how much should I trust this specific read", not "did it
 *  win", and those two questions should never fight for the same color. */
const GRADE_STYLE: Record<VerdictReliabilityResult["grade"], string> = {
  solid: "border-emerald-200 bg-emerald-50/60 text-emerald-700/90",
  decent: "border-border bg-muted/30 text-muted-foreground",
  shaky: "border-amber-200 bg-amber-50/60 text-amber-700/90",
  "too early": "border-border bg-muted/20 text-muted-foreground/80",
};

function toPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

// W2-A (2026-07-02) - FP1 always-paint floor extended to this page: every awaited read
// on the render path is deadline-bounded so one wedged Supabase read (each 522 is ~30s)
// can never hold the stream open forever. The ledger (the page's spine) gets the
// generous window and times out to an honest one-liner; every sibling read keeps its
// existing fail-soft fallback, just bounded. Section internals are untouched (FP8).
const LEDGER_DEADLINE_MS = 20_000;
const SIDE_READ_DEADLINE_MS = 15_000;

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
  const tReads = perfMark();
  const [ledgerRaced, connHealth, worklist, latestGscDate, calibrationRecords] = await Promise.all([
    loadWithDeadline(
      loadResultsLedgerSurface().catch(() => ({
        ledger: [] as ShippedChangeRecord[],
        computedAt: new Date().toISOString(),
      })),
      LEDGER_DEADLINE_MS,
    ),
    valueWithDeadline(loadConnectionHealth(tenantId).catch(() => []), [], SIDE_READ_DEADLINE_MS),
    valueWithDeadline(loadActionPackWorklistForTenant(tenantId).catch(() => null), null, SIDE_READ_DEADLINE_MS),
    valueWithDeadline(readLastFinalizedDate(tenantId).catch(() => null), null, SIDE_READ_DEADLINE_MS),
    valueWithDeadline(loadCalibrationRecords(tenantId).catch(() => [] as CalibrationRecord[]), [] as CalibrationRecord[], SIDE_READ_DEADLINE_MS),
  ]);
  perfStage("results-initial-reads", tReads);
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
  const recordedPaths = new Set(ledger.map((l) => l.path));
  // Item 42 - per-row forecast receipts: a settled calibration record (item 28's day-28 writer)
  // is keyed by proofId, which IS the shipped-change ledger row's own id (see
  // run-measurement.ts's writeCalibrationIfDue). One record per pick, so a plain map is exact.
  const calibrationByProofId = new Map(calibrationRecords.map((r) => [r.proofId, r] as const));

  // R14b (named controls) - the comparison pages' own daily-clicks series, drawn as
  // dashed lines on the same chart so "beat its comparison pages" is visible, not
  // asserted. Bounded exactly like the treated read below: first 8 rows, max 2
  // comparison pages each, deduped, capped at the loader's own 16-path limit.
  // Fail-soft: a miss just renders the chart without dashed lines. (Path list is a
  // pure derivation off the already-loaded ledger, so it is computed before the
  // parallel read batch.)
  const controlSparkPaths = [
    ...new Set(ledger.slice(0, 8).flatMap((l) => (l.controlPages ?? []).slice(0, 2))),
  ].slice(0, 16);

  // W2-B (2026-07-10) - the "AI quoted this line" owned-alignment requests, derived
  // once off the ledger with the SAME gate AiQuotedReceipt used to apply per card (a
  // real post-ship citation gain). Fed to ONE batched reader below instead of three
  // Supabase reads + a saveMoveDraft PER card during the render (the GET-mutation +
  // N+1 this fixes). The cache warm-up write is scheduled in after(), off the GET.
  const ownedAlignmentRequests: OwnedAlignmentRequest[] = ledger
    .filter((l) => {
      const o = l.citationOutcome;
      const prompts = o?.promptsNowCiting ?? [];
      return !!o && prompts.length > 0 && (o.verdict === "gained" || o.treatedPostCount > 0);
    })
    .map((l) => ({ recId: l.id, ownedUrl: l.page, citingPrompts: l.citationOutcome!.promptsNowCiting ?? [] }));

  // W2-B (2026-07-10) - THE SIDE-READ WATERFALL FIX. These seven page-level reads
  // are mutually independent (each keyed off the already-loaded ledger, none feeds
  // another), yet they used to run one-await-after-another, so a slow Supabase read
  // serialized every read behind it (up to 7 x 15s worst case). Collapse them into
  // ONE Promise.all: each keeps its OWN fail-soft `.catch` and its OWN 15s deadline,
  // so one wedged read times out to its fallback WITHOUT holding back the other six.
  //   1) sparkByPath - Item 5 before/after daily clicks per measured row (first 16).
  //   2) controlSparkByPath - R14b comparison-page daily-clicks series.
  //   3) detectedChangepoints - master plan item 32 algorithm-weather shocks.
  //   4) externalEvents - N32 (R21b) external-event ledger read side.
  //   5) seasonalInflectionById - master plan item 69 seasonal-inflection flag.
  //   6) recrawlClockById - master plan N11 recrawl-gated SEARCH clock.
  //   7) contaminationById - master plan N13 control-contamination guard.
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
    // Algorithm-weather guard (master plan item 32): confirmed Google update ranges +
    // last night's detected sitewide changepoints, so a verdict whose window overlapped
    // one gets a visible caveat below. Fail-soft -> [] (no known shocks = no caveats,
    // never a crash). No fresh CUSUM run here (that is the nightly cron's job).
    valueWithDeadline(loadDetectedChangepoints(tenantId).catch(() => []), [], SIDE_READ_DEADLINE_MS),
    // N32 (R21b, 2026-07-03) - the EXTERNAL-EVENT LEDGER read side: last night's nightly pass
    // recorded the honest-context events (Google updates + traffic shocks + connector outages +
    // own-site change clusters). A measurement window that overlapped a NON-shock event (a connector
    // outage or a many-edits-in-one-day cluster) gets an honest caveat below and, like the weather
    // guard, additively demotes the N10 verdict-reliability grade - the shock kinds are already
    // covered by the weather caveat, so the ledger adapter (eventCaveatForWindow) DEDUPES against it
    // and never renders a second sentence for the same shock. Fail-soft + deadline-bound -> [] (an
    // empty or missing ledger self-hides: no events means no caveats, byte-identical to before).
    valueWithDeadline(loadExternalEvents(tenantId).catch(() => []), [], SIDE_READ_DEADLINE_MS),
    // Seasonality guard (master plan item 69): does this row's measurement window span a
    // detected demand inflection for its page family? Computed-only (never persisted),
    // same read-time posture as the weather guard above - a page shipped 3 weeks before a
    // seasonal peak (or a family that IS the seasonal topic) reads its verdict cautiously
    // instead of as a clean win/loss.
    valueWithDeadline(
      attachSeasonalInflectionForLedger(
        tenantId,
        ledger.map((l) => ({ id: l.id, path: l.path, shippedAt: l.shippedAt, windows: l.windows ?? [] })),
      ).catch(() => new Map()),
      new Map(),
      SIDE_READ_DEADLINE_MS,
    ),
    // Recrawl-gated SEARCH clock (master plan N11): does Google's index hold this
    // page's new content yet? Computed-only from gsc_url_inspections (an INDEXED-
    // version crawl timestamp, never a live-page fetch; never persisted, never
    // mutates windows/verdict). Gates ONLY the Search verdict lane - a row with no
    // confirmed index crawl reads its SEARCH badge as "Waiting" below regardless
    // of which calendar window has closed, while the GA4 traffic line and every
    // other live_at-clocked attachment on the card keeps rendering.
    valueWithDeadline(
      attachRecrawlClockForLedger(
        tenantId,
        ledger.map((l) => ({ id: l.id, page: l.page, shippedAt: l.shippedAt, actionType: l.actionType, after: l.after })),
      ).catch(() => new Map()),
      new Map(),
      SIDE_READ_DEADLINE_MS,
    ),
    // Control-contamination guard (master plan N13): did any of THIS row's
    // comparison pages change mid-measurement (we treated it ourselves, or its
    // own content edited between scans)? Computed-only from the full ledger +
    // page_snapshots history - when a clean substitute exists it is swapped in
    // and the swap is named on the card; when none exists the read still runs,
    // capped with an honest caution caveat. Never mutates the stored ship row.
    valueWithDeadline(
      attachControlContaminationForLedger(tenantId, ledger).catch(() => new Map()),
      new Map(),
      SIDE_READ_DEADLINE_MS,
    ),
    // W2-B (2026-07-10) - the batched, READ-ONLY "AI quoted this line" alignments
    // (persist:false -> a GET never writes). One Profound-excerpt read + one
    // move-draft-cache read across every cited card, plus one page-body read per
    // distinct URL, replacing 3 reads + a write PER card. Fail-soft -> empty map.
    valueWithDeadline(
      getOwnedAnswerAlignmentsBatch(tenantId, ownedAlignmentRequests).catch(
        () => new Map<string, PersistedAnswerAlignment | null>(),
      ),
      new Map<string, PersistedAnswerAlignment | null>(),
      SIDE_READ_DEADLINE_MS,
    ),
  ]);
  const shockWindows: ShockWindow[] = buildShockWindows({ dailySeries: [], priorChangepoints: detectedChangepoints });

  // W2-B (2026-07-10) - warm the alignment cache OFF the GET: schedule the same
  // batch with persist:true in after() so any freshly-computed alignment is
  // written back for the next visit. Fire-and-forget + fail-soft; a GET never
  // mutates on its own render path.
  if (ownedAlignmentRequests.length > 0) {
    after(async () => {
      await getOwnedAnswerAlignmentsBatch(tenantId, ownedAlignmentRequests, { persist: true }).catch(() => {});
    });
  }

  // GSC-LAG CLARITY: Google Search Console data lags wall-clock, so a 7-day window
  // whose calendar date has passed often can't be judged yet. Count the rows that are
  // calendar-open but GSC-waiting, and surface the honest reason (not just "waiting").
  // Pure derivation off the already-loaded ledger + latestGscDate; no I/O.
  const lagByRow = new Map(
    ledger.map((l) => [l.id, gscLagStatus(l, latestGscDate)] as const),
  );
  const waitingOnGsc = [...lagByRow.values()].filter(
    (s) => s.calendarWindowClosed && !s.gscWindowAvailable && s.nextWindowDay != null,
  );

  // Move 2 - the shared maturity presentation per row, so every card reads the same
  // honest measurement language (an early read is never a final verdict, never red/green).
  const overlapById = detectMeasurementOverlaps(ledger.map((l) => ({ id: l.id, path: l.path, shippedAt: l.shippedAt })));
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
          verdict: l.verdict,
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
  const inFlightRows = bands.measuring;

  // Item C7 - the seasonal-overlap caveat used to render its full paragraph on
  // every affected card (15 identical copies on a page with 15 seasonal
  // pages). Count them once and say it once at the section level; each card
  // below only gets a small "seasonal swing overlaps" chip.
  const seasonalCount = ledger.filter((l) => presById.get(l.id)?.seasonalInflectionFlagged).length;

  // Passive auto-measure (2026-06-29): when the operator opens Results, fire-and-forget a
  // due-row measurement pass AFTER the response (next/after → zero render latency) so
  // settled verdicts + the learned re-ranking activate WITHOUT a manual "Measure now"
  // click. Operator-only (it writes proof outcomes) + only when rows are actually due, so
  // a customer/anon view never mutates proof data. The settled rows show on the next visit.
  const dueNow = ledger.filter((l) => isDueForMeasure(l, latestGscDate, new Date()));
  const isOperator = await isOperatorModeServer();
  // W5 stop-ship F4 (2026-07-09): also schedule when nothing is due-for-measure
  // but rows are eligible for a re-verify (never-verified / transient-failed /
  // unresolved needs_review, past backoff). The after() re-verify loop already
  // runs unconditionally inside scheduleAutoMeasure; this just stops that loop
  // from being gated behind a measurement being due. No extra I/O -
  // selectRowsToReverify runs over the ledger already in memory.
  const eligibleReverify = selectRowsToReverify(ledger).length > 0;
  if (isOperator && (dueNow.length > 0 || eligibleReverify)) scheduleAutoMeasure(tenantId);

  // Item 11 - one-click restore offers for rows that are measuring negative
  // (7/14/28 day reads). The shared revert policy only ever proposes (E-36:
  // never auto-revert, ask first); the snapshot lookup is bounded to the
  // first few negatives. Rows already restored are badged instead.
  // Operator-only (the action re-gates anyway).
  const revertById = new Map<string, RevertDecision>();
  const restoredIds = new Set(ledger.filter((l) => hasRevertNote(l)).map((l) => l.id));
  if (isOperator) {
    const negativeRows = ledger
      .filter((l) => {
        const p = presById.get(l.id);
        return (
          !!p &&
          p.direction === "negative" &&
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
            const decision = decideRevert({
              tenantId,
              direction: p.direction,
              windowDay: p.basisDay,
              attributionQuality: p.attributionQuality,
              lever: rec.actionType,
              config: autopilotConfig,
              snapshotAvailable: sources[i] != null,
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

  // Proof compares each page to its Google Search Console history - so a stale or
  // disconnected GSC makes the verdicts unreliable. Surface that honestly (operator
  // brutal-audit: "if GSC/GA4 stale, say so") instead of showing confident-looking
  // results over old data.
  const gsc = connHealth.find((c) => c.key === "google_gsc") ?? null;
  const gscFreshnessNote =
    gsc == null || gsc.severity === "healthy"
      ? null
      : gsc.severity === "disconnected"
        ? "Google Search Console isn't connected. Proof verdicts can't update until it is."
        : gsc.severity === "needs_setup"
          ? "Google Search Console is connected but hasn't synced yet. Verdicts will fill in after the first sync."
          : `Search Console data is ${gsc.daysStale ?? "several"} days old. Recent changes may not show a verdict yet. Refresh to update.`;

  // Recompute only does something once a measurement window has closed AND GSC has the
  // data for it. Gate the button + give the honest reason (calendar vs GSC-lag).
  const anyWindowReady = ledger.some((l) => l.windows.some((w) => w.ran));
  // Prefer the soonest-actionable reason: a row whose calendar window is closed but is
  // waiting on GSC explains the "date passed yet still waiting" confusion best.
  const lagReason =
    waitingOnGsc[0]?.reasonCopy ??
    [...lagByRow.values()].find((s) => s.nextWindowDay != null && !s.gscWindowAvailable)?.reasonCopy ??
    undefined;

  // Operator-only: which action types past results are nudging Beacon toward /
  // away from (the prior that steers ranking). Lets the operator SEE a skew and
  // use "Exclude from learning" on a mis-measured result. Only types with a
  // trusted prior or an excluded result are worth showing.
  // W2-A drive-by fix: this used to call isOperatorModeServer() without awaiting it -
  // a Promise is always truthy, so the operator-only section leaked to everyone. Use
  // the already-awaited isOperator from above.
  const learningDiag = isOperator
    ? computeOutcomePriorDiagnostics(ledger).filter(
        (d) => d.prior !== null || d.excluded > 0,
      )
    : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
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
              with the measured value the wins are adding, so the header never
              promises a count the page does not show and the total value won is
              asserted, not buried. Shock windows ride along for THE ONE DOLLAR RULE. */}
          <div className="mt-3">
            <Suspense fallback={null}>
              <CumulativeOutcomeSection ledger={ledger} shockWindows={shockWindows} />
            </Suspense>
          </div>
        </div>
        {ledger.length > 0 ? (
          <RecomputeLedgerButton
            disabled={!anyWindowReady}
            disabledReason={anyWindowReady ? undefined : lagReason}
          />
        ) : null}
      </div>

      {gscFreshnessNote ? (
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {gscFreshnessNote}
        </div>
      ) : null}

      {/* GSC-lag clarity: when changes are calendar-due but Search Console hasn't caught
          up, say so plainly instead of an unexplained "waiting". */}
      {!gscFreshnessNote && waitingOnGsc.length > 0 ? (
        <div className="mb-5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          {waitingOnGsc.length} change{waitingOnGsc.length === 1 ? " is" : "s are"} waiting on Search Console
          data, not stalled. {waitingOnGsc[0]?.reasonCopy ?? ""} Google Search data typically lags 2-3 days.
        </div>
      ) : null}

      {/* Passive auto-measure (2026-06-29): due rows are being re-measured in the
          background (next/after) the moment Results opens - say so honestly. */}
      {isOperator && dueNow.length > 0 ? (
        <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Measuring {dueNow.length} due result{dueNow.length === 1 ? "" : "s"} now. Refresh in a moment to see the verdict.
        </div>
      ) : null}

      {/* Premium "Proof at a glance" scoreboard (2026-06-25) - the Results act of
          the Move → Ship → Prove loop. Own Suspense / self-hides when nothing is
          shipped; R4 - reads the SAME snapshot-served ledger as the bands above
          (passed down), so it never re-triggers the heavy measure path. */}
      <Suspense fallback={null}>
        <BoundedSection render={() => ProofSummarySection({ ledger, shockWindows })} />
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

      {/* Record a shipped change for ANY page (manual-ship companion). Prefills
          the page from a ?page= hand-off (e.g. the Workbench "Record this
          change" link) so recording doesn't mean re-typing the path. */}
      <div className="mb-6">
        <RecordAnyPageForm initialPage={initialPage} />
      </div>

      {/* ── Measured outcomes (shipped changes being tracked vs controls) ── */}
      {ledger.length > 0 ? (
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
              nowMs: Date.now(),
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
              <LedgerRowGroup rows={winRows} band="win" linkByRowId={linkByRowId} presById={presById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} calibrationByProofId={calibrationByProofId} ownedAlignmentByRecId={ownedAlignmentByRecId} />
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
              <LedgerRowGroup rows={learningRows} band="learning" linkByRowId={linkByRowId} presById={presById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} calibrationByProofId={calibrationByProofId} ownedAlignmentByRecId={ownedAlignmentByRecId} />
            </div>
          ) : null}

          {/* Item 68 band 3: everything still measuring or waiting on data. */}
          {inFlightRows.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                In flight ({inFlightRows.length})
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Still collecting data. Each one gets its verdict when its full window closes.
              </p>
              <LedgerRowGroup rows={inFlightRows} band="inflight" linkByRowId={linkByRowId} presById={presById} gradeById={gradeById} eventCaveatById={eventCaveatById} sparkByPath={sparkByPath} controlSparkByPath={controlSparkByPath} revertById={revertById} restoredIds={restoredIds} ownedAlignmentByRecId={ownedAlignmentByRecId} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── R14a "We got this wrong" (P1 trust receipts): revised-downward verdicts +
          proven-did-nothing changes, owned plainly, max 5, each linking to its own
          card above. Self-hiding when there is nothing to own - most days it is
          absent, which is exactly the point. */}
      <WeGotThisWrongSection items={buildRecapItems(ledger, plainAction)} />

      {/* ── What Beacon has learned (operator-only): per-action_type prior that
          steers ranking, so a skew is visible and excludable. ── */}
      {learningDiag.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            What Beacon has learned
          </h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            How your past results nudge which fixes Beacon suggests first. If a result
            looks mis-measured, use &ldquo;Exclude from learning&rdquo; on it below.
          </p>
          <ul className="space-y-1">
            {learningDiag.map((d) => (
              <li key={d.actionType} className="text-[12px] text-foreground/80">
                <span className="font-medium">{d.actionType.replace(/_/g, " ")}</span>:{" "}
                {d.won} worked, {d.lost} did not
                {d.excluded > 0 ? `, ${d.excluded} excluded` : ""}
                {d.prior !== null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    &rarr; Beacon now{" "}
                    {d.prior > 0
                      ? `favors this (+${Math.round(d.prior * 100)}%)`
                      : d.prior < 0
                        ? `is cautious here (${Math.round(d.prior * 100)}%)`
                        : "is neutral"}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {" "}
                    &rarr; not enough results yet to change ranking
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

/**
 * Plain-English explainer for the operator: what measuring means, when the first
 * verdict lands, and the honest limits of an observational comparison.
 */
function WhatHappensNext() {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5">
      <div className="text-[12px] font-semibold text-foreground">What happens next</div>
      <ul className="mt-1.5 space-y-1 text-[11px] text-foreground/75">
        <li>
          • Google takes time to recrawl and re-rank. The first check opens{" "}
          <span className="font-medium">7 days</span> after you shipped, then again at 14
          and 28 days.
        </li>
        <li>
          • At each check Beacon compares this page (visits, click rate, or Google
          rank, depending on the change) to similar pages you did not change, then
          tells you whether it{" "}
          <span className="font-medium">helped</span>,{" "}
          <span className="font-medium">did not help</span>, or showed{" "}
          <span className="font-medium">no clear change</span>.
        </li>
        <li>
          • This compares your page to similar pages, so it is a strong signal, not
          a lab-perfect guarantee. Google data is naturally a bit noisy.
        </li>
      </ul>
    </div>
  );
}

function metricsLine(rec: ShippedChangeRecord): string {
  // Per-field guards: a legacy record could carry an undefined metric, which would
  // render NaN/NaN% - coalesce each to 0 so the line is always well-formed.
  const raw = rec.baseline;
  const clicks = Number(raw?.clicks) || 0;
  const impressions = Number(raw?.impressions) || 0;
  const ctr = Number(raw?.ctr) || 0;
  const position = Number(raw?.position) || 0;
  // No impressions = no Search data in the baseline window; "pos 0.0" is an
  // impossible rank, so say so honestly instead of rendering zeros.
  if (impressions <= 0) return "No Google data yet for the period before this change.";
  return `${clicks.toLocaleString()} visits from Google, shown ${impressions.toLocaleString()} times, ${(ctr * 100).toFixed(2)}% click rate, ranked about #${position.toFixed(1)}`;
}

const LINK_LABEL: Record<string, string> = {
  exact: "from your changes",
  strong: "from your changes",
  weak: "likely from your changes",
  none: "manual or legacy change",
};
const SOURCE_LABEL: Record<string, string> = {
  gsc: "Google Search", ga4: "Analytics", clarity: "Clarity UX",
  profound: "AI citations", dataforseo: "Live Google check",
  competitor_teardown: "Competitor teardown", rank_revenue: "Demand graph",
};

/** Item 72 - plain-business words for the change type in the lesson line. */
const PLAIN_ACTION: Record<string, string> = {
  edit_meta: "description change",
  edit_title: "title change",
  add_answer_block: "direct answer",
  add_internal_link: "internal link",
  add_schema: "structured data",
};
function plainAction(actionType: string): string {
  return PLAIN_ACTION[actionType] ?? actionType.replace(/_/g, " ");
}
/** Item 72 - the judged metric in plain words. */
const PLAIN_METRIC: Record<ProofMetric, string> = {
  ctr: "the click rate",
  position: "the ranking",
  clicks: "clicks",
};

type LedgerBand = "win" | "learning" | "inflight";

/**
 * Item C8 - a ledger band (Wins / What we learned / In flight) used to render
 * every row in one flat list, so a "Manual or legacy change, not traced to a
 * ranked move" disclaimer sat directly under a Beacon-recommended card with
 * evidence chips, reading as if both were the same kind of thing. Split the
 * list visually instead: Beacon's own recommended changes first, then the
 * operator's own manual changes under their own header (Beacon is still
 * watching and measuring those, so it says so instead of just disclaiming).
 */
function LedgerRowGroup({
  rows,
  band,
  linkByRowId,
  presById,
  gradeById,
  eventCaveatById,
  sparkByPath,
  controlSparkByPath,
  revertById,
  restoredIds,
  calibrationByProofId,
  ownedAlignmentByRecId,
}: {
  rows: ShippedChangeRecord[];
  band: LedgerBand;
  linkByRowId: Map<string, ProofLink>;
  presById: Map<string, MeasurementPresentation>;
  gradeById?: Map<string, VerdictReliabilityResult>;
  /** N32 (R21b) - per-row external-event caveat (already deduped against the weather caveat). */
  eventCaveatById?: Map<string, string | null>;
  sparkByPath: Map<string, SparkPoint[]>;
  /** R14b (named controls) - comparison pages' own daily-clicks series. */
  controlSparkByPath?: Map<string, SparkPoint[]>;
  revertById: Map<string, RevertDecision>;
  restoredIds: Set<string>;
  calibrationByProofId?: Map<string, CalibrationRecord>;
  /** W2-B (2026-07-10) - batched "AI quoted this line" alignments, keyed by rec id,
   *  resolved once on the page (READ-ONLY on the GET) instead of per-card async reads. */
  ownedAlignmentByRecId?: Map<string, PersistedAnswerAlignment | null>;
}) {
  const recommended = rows.filter((rec) => linkByRowId.get(rec.id)?.actionPack);
  const manual = rows.filter((rec) => !linkByRowId.get(rec.id)?.actionPack);

  const card = (rec: ShippedChangeRecord) => {
    // R14b - up to 2 named comparison series for THIS row's chart (the same cap
    // the loader used). Only pages whose series actually loaded are named.
    const controlSparks = (rec.controlPages ?? [])
      .slice(0, 2)
      .map((p) => ({ path: p, points: controlSparkByPath?.get(p) ?? [] }))
      .filter((c) => c.points.length >= 5);
    return (
      <LedgerCard
        key={rec.id}
        rec={rec}
        band={band}
        link={linkByRowId.get(rec.id) ?? null}
        pres={presById.get(rec.id) ?? null}
        grade={gradeById?.get(rec.id) ?? null}
        eventCaveat={eventCaveatById?.get(rec.id) ?? null}
        spark={sparkByPath.get(rec.path)}
        controlSparks={controlSparks}
        revert={revertById.get(rec.id) ?? null}
        restored={restoredIds.has(rec.id)}
        calibration={calibrationByProofId?.get(rec.id) ?? null}
        ownedAlignment={ownedAlignmentByRecId?.get(rec.id) ?? null}
      />
    );
  };

  return (
    <>
      {recommended.length > 0 ? (
        <div className="mt-2">
          {manual.length > 0 ? (
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700/70">
              Changes Beacon recommended
            </div>
          ) : null}
          <div className="space-y-2.5">{recommended.map(card)}</div>
        </div>
      ) : null}
      {manual.length > 0 ? (
        <div className="mt-3">
          {recommended.length > 0 ? (
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Changes you made yourself (I am watching them too)
            </div>
          ) : null}
          <div className="space-y-2.5">{manual.map(card)}</div>
        </div>
      ) : null}
    </>
  );
}

function LedgerCard({ rec, link, pres, grade, eventCaveat, spark, controlSparks, band, revert, restored, calibration, ownedAlignment }: { rec: ShippedChangeRecord; link?: ProofLink | null; pres?: MeasurementPresentation | null; grade?: VerdictReliabilityResult | null; eventCaveat?: string | null; spark?: SparkPoint[]; controlSparks?: Array<{ path: string; points: SparkPoint[] }>; band?: LedgerBand; revert?: RevertDecision | null; restored?: boolean; calibration?: CalibrationRecord | null; ownedAlignment?: PersistedAnswerAlignment | null }) {
  // Judge a meta/title test on CTR, a content test on position, else clicks, so
  // every line on this card reads in the unit that actually moved.
  const metric = pickProofMetric(rec.actionType);
  const basis = rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const mature = pres ? isMatureOutcome(pres.maturity) : false;
  // Move 2 - the headline Search line: at a MATURE result, the lift-bearing sentence;
  // before that, the honest maturity language (no "Likely hurting (high confidence)"
  // off a 7-day read). Falls back to the legacy sentence when no presentation.
  const floorSentence =
    pres && !mature
      ? `${pres.headline}. ${pres.explanation}`
      : proofOutcomeSentence({ verdict: rec.verdict, confidence: pres?.confidence ?? rec.confidence, basis, metric });
  // Item 67 - the Bayesian read is an honest quantification layer, NOT a second
  // decision path: the stored verdict (floors + permutation) still decides
  // won/lost above. The headline sentence only upgrades to the Bayesian
  // "X percent sure, likely N to M extra clicks a month" wording when a read
  // exists AND agrees in direction with that same floor verdict - it can add
  // confidence to a floor call, never contradict or replace one.
  const sentence = selectHeadlineSentence(rec.verdict, rec.bayesianRead, floorSentence);
  // Item C2 - secondary "matures on X" text under the collapsed badge, for any
  // pre-verdict state. Null once a final verdict exists.
  const badgeMaturesOn = pres ? proofBadgeMaturesOn(pres) : null;
  // Item C4 - the PRIMARY Search line is a short plain call; the percent-sure
  // figure and click range (still real, still computed the same way) move one
  // click deeper into "See the math" below instead of leading the card.
  const plainHeadline = plainSearchHeadline(pres?.direction ?? "unknown", mature);
  // Report the controls actually used in the basis window; fall back to assigned
  // count only before any window has run (measuring state).
  const controlsCount = basis?.controlsUsed ?? rec.controlPages.length;
  // Item C3 - when the Search read and the site-visits read point opposite
  // ways, say so in one sentence instead of leaving the contradiction sitting
  // there. Both signs are already computed above/on the record; this never
  // recomputes either one, only compares the two signs.
  const trafficDisagrees =
    !!pres &&
    rec.trafficOutcome?.ran === true &&
    searchAndTrafficDisagree(pres.direction, rec.trafficOutcome?.adjustedSessionsPct);
  // FP8 - the collapsed summary's single most important number: the measured basis
  // window lift for a settled row (in the unit the verdict was judged on), the
  // countdown to the next read for an in-flight one. Never invented - a settled row
  // without a basis window shows no number at all.
  const keyNumber = (() => {
    if (band === "win" || band === "learning") {
      return basis ? `${formatWindowLift(metric, basis)} over ${basis.day} days` : null;
    }
    const next = rec.windows.filter((w) => !w.ran).sort((a, b) => a.day - b.day)[0];
    if (next) {
      const anyRead = rec.windows.some((w) => w.ran);
      const daysLeft = Math.ceil((Date.parse(addDays(rec.shippedAt, next.day)) - Date.now()) / 86_400_000);
      return daysLeft <= 0
        ? "verdict due any day now"
        : `${anyRead ? "next" : "first"} read in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    }
    return badgeMaturesOn;
  })();
  // W5 stop-ship F6: honest terminal copy when the crawl-verify pass gave up.
  const verifyGaveUp = verifyGaveUpLine(rec.verifyState, rec.verifiedLive);
  return (
    // R14a - the stable per-record anchor so the /activity stream and the
    // "We got this wrong" recap can deep-link straight to this card.
    <Card padding="md" id={`proof-${rec.id}`} className={band === "win" ? "beacon-win-glow" : undefined}>
      {/* FP8 - ONE scannable summary line per card: the page, what changed, the
          verdict-or-maturity word, and the single most important number. The full
          chip grid (evidence, caveats, math, comparison detail, actions) moves
          behind "Show the full read" below - all still reachable, none shouting.
          Item C2's six-word badge and Move 2's maturity-tone rule are unchanged:
          the Pill intent comes from pres.tone, so red/green still never appear
          before a mature result. */}
      <div className="flex flex-wrap items-center gap-2">
        {(() => {
          const href = dossierHref(rec.path);
          return href ? (
            <Link href={href} className="text-sub font-semibold text-foreground underline underline-offset-2 hover:text-foreground/80">{rec.path}</Link>
          ) : (
            <span className="text-sub font-semibold text-foreground">{rec.path}</span>
          );
        })()}
        <Pill intent={pres ? TONE_PILL_INTENT[pres.tone] : verdictPillIntent(rec.verdict, basis?.day ?? null)}>
          {pres ? proofBadgeLabel(pres) : proofBadgeLabelFromVerdict(rec.verdict, basis?.day ?? null)}
        </Pill>
        {keyNumber ? (
          <span
            className={
              band === "win"
                ? "text-meta font-semibold text-status-success tabular-nums"
                : "text-meta text-muted-foreground tabular-nums"
            }
          >
            {keyNumber}
          </span>
        ) : null}
        <span className="text-meta text-muted-foreground">
          {plainAction(rec.actionType)} · shipped {rec.shippedAt.slice(0, 10)}
        </span>
      </div>

      <details className="mt-2">
      <summary className="cursor-pointer text-meta text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
        Show the full read
      </summary>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {pres && badgeMaturesOn ? (
          <span className="text-[10px] text-muted-foreground">{badgeMaturesOn}</span>
        ) : null}
        {/* One verdict-reliability grade (master plan N10): a single word for how
            much to trust this specific read, combining recrawl, window
            completeness, contamination, comparison quality, shock/seasonal
            overlap, and sample strength. The full reasons render inside "See the
            math" below - this chip is just the scan-it-in-one-glance summary. */}
        {grade ? (
          <span
            className={
              "rounded-full border px-1.5 py-0.5 text-[10px] font-medium " + GRADE_STYLE[grade.grade]
            }
            title={grade.sentence}
          >
            {grade.grade}
          </span>
        ) : null}
        {rec.verifiedLive ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            verified live
          </span>
        ) : verifyGaveUp ? (
          // W5 stop-ship F6: the DS-token Pill (waiting = soft amber), never raw
          // palette classes, so the honest "gave up" state stays on-system.
          <Pill intent="waiting" title={verifyGaveUp}>
            not verified
          </Pill>
        ) : null}
      </div>

      {/* Item 5 - the before/after evidence itself: daily clicks with the ship date
          marked (dot) and the after-period tinted. A verdict you can SEE. When the change
          is newer than the last finalized Search day, say so instead of promising a dot. */}
      {spark && spark.length >= 5 ? (() => {
        const shipDay = rec.shippedAt.slice(0, 10);
        const lastDataDay = spark[spark.length - 1]!.date;
        const markerVisible = lastDataDay >= shipDay;
        // Item 70 - the chart is the centerpiece on a settled row (win/learning),
        // so it renders slightly larger there; numbers are supporting cast.
        const settled = band === "win" || band === "learning";
        // R14b (named controls) - the comparison pages ride the SAME chart as
        // dashed lines, named in the legend below, so "beat its comparison
        // pages" is something you can see, not a phrase you must trust.
        const namedControls = (controlSparks ?? []).slice(0, 2);
        const legend = controlsLegendLine(namedControls.map((c) => c.path));
        return (
          <div className="mt-1.5">
            <div className="flex items-center gap-2">
              <Sparkline
                points={spark}
                markerDate={shipDay}
                width={settled ? 240 : 200}
                height={settled ? 40 : 34}
                comparisons={namedControls.map((c) => ({ points: c.points }))}
              />
              <span className="text-[10px] text-muted-foreground">
                {markerVisible
                  ? `daily clicks, ${spark.length} days · dot = when this shipped, tinted = after`
                  : `daily clicks through ${lastDataDay} · this change is newer than the latest Search data (Google reports a few days behind)`}
              </span>
            </div>
            {legend && namedControls.length > 0 ? (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {legend} They are the dashed lines.
              </p>
            ) : null}
          </div>
        );
      })() : null}

      {/* Source move (Phase 4 - deterministic ActionPack↔proof linker, no migration).
          Closes the loop visibly: this shipped change traces back to the Move that
          recommended it. Item C8 - a card with no link sits in the "Changes you
          made yourself" group above (the group header already says this is a
          manual change), so it no longer repeats a disclaimer on every card. */}
      {link && link.actionPack ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 ring-1 ring-indigo-100">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {LINK_LABEL[link.confidence]}: {link.actionPack.label}
          </span>
          {link.actionPack.evidenceSources.map((s) => (
            <span key={s} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
              {SOURCE_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      ) : null}

      {/* R14b (spend-to-outcome) - what preparing this change cost in paid checks,
          from the linked move's own cached live-Google verdict spend. Absent at $0:
          a free change never grows a cost line. */}
      {(() => {
        const spend = prepSpendLine(link?.actionPack?.dataforseoValidation?.costUsd);
        return spend ? <p className="mt-1 text-[11px] text-muted-foreground">{spend}</p> : null;
      })()}

      {/* Item 71 - a win leads with the number: the lift, the page, the date. */}
      {band === "win" && basis ? (
        <p className="mt-1.5 text-[14px] font-semibold text-emerald-700">
          {`${formatWindowLift(metric, basis)} on ${rec.path} since ${rec.shippedAt.slice(0, 10)}`}
        </p>
      ) : null}

      {/* Distinct-query growth (P4 R10b, v1 151): name WHICH KIND of win this
          is - reach (more distinct searches ranking) or depth (the same
          searches clicking more). Win rows only; the raw before/after counts
          live in "See the math" for every row. */}
      {band === "win" && rec.queryBreadth?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.queryBreadth.sentence}</p>
      ) : null}

      {/* Many-measurements caution (P4 R10b, v1 291): this win cleared its own
          bar but sits too close to the line where one of many simultaneous
          measurements looks good by chance - hold the champagne. */}
      {rec.fdrRead?.sentence ? (
        <p className="mt-1 text-[12px] text-amber-700">{rec.fdrRead.sentence}</p>
      ) : null}

      {/* Item 72 - a settled non-win reads as a lesson: what we tried, what it did
          not move, and that the next pick on pages like this uses a different lever. */}
      {band === "learning" ? (
        <p className="mt-1.5 text-[12px] text-foreground/80">
          {`A ${plainAction(rec.actionType)} on this page did not move ${PLAIN_METRIC[metric]} in the full window. The team now tries a different lever on pages like this.`}
        </p>
      ) : null}

      {/* Equivalence read (P4 R10b, v1 289): the plausible effect range is
          proven too small to matter - "genuinely did nothing" is a reliable
          lesson, which is different from not knowing. Never renders on a win
          (the read is only computed for non-wins). */}
      {rec.equivalence?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.equivalence.sentence}</p>
      ) : null}

      {/* Item C4 - the PRIMARY line is a short plain call ("This probably hurt." /
          "This helped."), never the percent-sure statistics headline. The full
          sentence (with the percent and the click range) is one click away in
          "See the math" below - the honest numbers are not gone, just not shouting. */}
      <p className="mt-1.5 text-[12px] text-foreground/80">
        <span className="font-medium text-foreground/60">Search:</span> {plainHeadline}
      </p>

      {/* Item C3 - when the Search read and the site-visits read below disagree in
          direction, say so plainly instead of leaving two contradicting lines on
          the card with no reconciliation between them. */}
      {trafficDisagrees ? (
        <p className="mt-1 text-[12px] text-amber-700">{reconciliationSentence()}</p>
      ) : null}

      {/* R14a - the append-only verdict revision trail: when a later read changed an
          earlier call on THIS record, say so on the card instead of silently
          rewriting history ("I first called this a win; the 28-day read on
          2026-07-19 revised it to no clear effect."). Absent on the vast majority
          of rows - a verdict that never flipped renders nothing here. */}
      {rec.verdictRevisions && rec.verdictRevisions.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {buildVerdictRevisionLines(rec.verdictRevisions).map((line) => (
            <p key={line} className="text-[12px] text-foreground/80">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* Fixed query panel (P4 R10a, v1 150): the exact searches this change
          aimed at, measured as one panel, disagree in direction with the
          page-level read above - say so plainly instead of leaving the two
          numbers to quietly contradict each other. The always-available panel
          totals live in "See the math" below. */}
      {rec.panelOutcome?.sentence ? (
        <p className="mt-1 text-[12px] text-amber-700">{rec.panelOutcome.sentence}</p>
      ) : null}

      {/* Adaptive-window read (P4 R10a, v1 288): the movement is already
          unmistakable (or already clearly meaningless) before the full window.
          Presentation only - the 7/14/28 clock and the final verdict are
          untouched, and the sentence itself says the clock keeps running. */}
      {rec.earlySignal?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.earlySignal.sentence}</p>
      ) : null}

      {/* Novelty-decay flag (P4 R10a, v1 378): the first-week jump faded back
          toward baseline by week 4 - an honest caution so a novelty spike is
          never quietly read as a lasting win. */}
      {rec.noveltyDecay?.sentence ? (
        <p className="mt-1 text-[12px] text-amber-700">{rec.noveltyDecay.sentence}</p>
      ) : null}

      {/* Day-of-week baselines (P4 R10a, v1 285): when the weekday-aligned
          number and the raw day-sum number differ by more than 20 percent,
          lead with the aligned one and name why in one sentence. */}
      {rec.weekdayAdjustedLift?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.weekdayAdjustedLift.sentence}</p>
      ) : null}

      {/* Forecast receipt (master plan item 42): grade the numeric forecast this pick carried
          against what actually happened, straight from the persisted calibration record (item
          28's day-28 writer) - never recomputed here. Only a MATURE (settled) row can carry a
          receipt; a measuring row is never graded. Silent when this pick had no numeric forecast
          or hasn't reached its calibration write yet. */}
      {shouldShowForecastReceipt({ mature, calibration }) ? (
        <p className="mt-1 text-[12px] font-medium text-foreground/80">
          {buildForecastReceiptLine(calibration!)}
        </p>
      ) : null}

      {/* Item C5 - the untouched-pages comparison used to lead with the raw "Out of
          60, 60 moved as much" trap sentence, which reads like proof when it is
          actually the honest opposite (normal noise, not evidence). The plain line
          says that outright; the raw counts move into "See the math" below. */}
      {rec.permutationRead && rec.permutationRead.nTotal > 0 ? (
        <p className="mt-1 text-[12px] text-foreground/80">
          {rec.permutationRead.nGreater / rec.permutationRead.nTotal <= 0.05
            ? `Pages I did not touch rarely moved this much on their own, so this is a real signal.`
            : `Pages I did not touch moved this much on their own, so this is normal noise, not proof yet.`}
        </p>
      ) : null}

      {/* Item C4/C5 - "See the math": the exact percent-sure figure, click range,
          and untouched-page counts, one click away from the plain primary lines
          above. Nothing here is new data - it is the same sentence/counts the
          product already computed, just moved out of the headline position. */}
      {sentence !== plainHeadline || (rec.permutationRead && rec.permutationRead.nTotal > 0) || pres?.seasonalInflectionCaveat || pres?.controlContaminationCaveat || pres?.controlPoolHealthLine || rec.panelOutcome || rec.queryBreadth || grade ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
            See the math
          </summary>
          <div className="mt-1 space-y-1 rounded-md border border-border/40 bg-surface-inset/30 p-2 text-[11px] text-foreground/70">
            {/* One verdict-reliability grade (master plan N10): the one-sentence
                summary of how much to trust this read, first in the list since
                it frames everything else in this panel. */}
            {grade ? <p className="font-medium text-foreground/80">{grade.sentence}</p> : null}
            <p>{sentence}</p>
            {rec.permutationRead && rec.permutationRead.nTotal > 0 ? (
              <p>{permutationSentenceFromCounts(rec.permutationRead.nGreater, rec.permutationRead.nTotal)}</p>
            ) : null}
            {/* Fixed query panel (P4 R10a, v1 150): the frozen target-query
                panel's own before/after totals, always available here even
                when it agrees with the page-level read. */}
            {rec.panelOutcome ? <p>{rec.panelOutcome.panelLine}</p> : null}
            {/* Distinct-query growth (P4 R10b, v1 151): the raw before/after
                distinct-search counts behind the reach/depth call, always
                available here even when the headline stayed quiet. */}
            {rec.queryBreadth ? <p>{rec.queryBreadth.breadthLine}</p> : null}
            {pres?.seasonalInflectionCaveat ? <p>{pres.seasonalInflectionCaveat}</p> : null}
            {/* Control-contamination guard (master plan N13): the full receipt -
                which comparison page changed, when, and whether a clean
                substitute was swapped in. The short caution line already shows
                on the card itself below; this is the detailed "why". */}
            {pres?.controlContaminationCaveat ? <p>{pres.controlContaminationCaveat}</p> : null}
            {/* Sustainable control pool (master plan N16): how healthy this open
                measurement's comparison pool still is, including the spare bench
                from the pre-ship list. Self-hiding once the measurement settles. */}
            {pres?.controlPoolHealthLine ? <p>{pres.controlPoolHealthLine}</p> : null}
          </div>
        </details>
      ) : null}

      {/* Target-query read (master plan item 68): the page-level verdict above can
          be diluted by a page's whole query mix; this names the EXACT search the
          change aimed at, straight from gsc_daily_rows, honestly silent when the
          data is missing or thin (< 50 impressions either window). */}
      {rec.targetQueryRead && rec.targetQueryRead.length > 0
        ? rec.targetQueryRead
            .filter((tq) => tq.sentence)
            .slice(0, 2)
            .map((tq) => (
              <p key={tq.query} className="mt-1 text-[12px] text-foreground/80">
                {tq.sentence}
              </p>
            ))
        : null}

      {/* Recrawl-gated SEARCH clock (master plan N11): Google's index does not
          show the new version of this page yet, so the SEARCH clock has not
          started. Names the split honestly - the GA4 traffic line above/below
          keeps its live_at clock and keeps reading. Same visible-caveat seam
          as the weather guard directly below. */}
      {pres?.recrawlPendingCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.recrawlPendingCaveat}</p>
      ) : null}

      {/* Algorithm-weather guard (master plan item 32): this row's measurement window
          overlapped a confirmed Google update or a sitewide shift I detected, so I am
          flagging the read as cautious instead of quietly treating it as clean evidence. */}
      {pres?.weatherCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.weatherCaveat}</p>
      ) : null}

      {/* N32 (R21b, external-event ledger): this row's measurement window overlapped a recorded
          connector outage or a many-edits-in-one-day cluster, so the read carries an honest caveat.
          DEDUPE: eventCaveatForWindow returns the SAME weather sentence when the window overlaps a
          shock, so we render this line ONLY when it differs from the weather caveat already shown
          above - a shock never prints twice. Self-hides when the ledger is empty (eventCaveat null). */}
      {shouldRenderEventCaveat(eventCaveat, pres?.weatherCaveat) ? (
        <p className="mt-1 text-[12px] text-amber-700">{eventCaveat}</p>
      ) : null}

      {/* Clean-window salvage (P4 R10b, v1 152): the caveat above stays named,
          but when 10 or more clean days exist outside the shock this reads the
          change on those days alone, so a partially-muddied window is salvaged
          instead of written off wholesale. Verdict untouched. */}
      {pres?.weatherCaveat && rec.cleanWindowLift?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">{rec.cleanWindowLift.sentence}</p>
      ) : null}

      {/* Parallel-trends veto (master plan item 33): this row's comparison pages
          were not moving like this page before the change, so I am flagging the
          read as cautious the same way an algorithm-weather overlap is flagged above. */}
      {pres?.weakComparisonCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.weakComparisonCaveat}</p>
      ) : null}

      {/* Control-contamination guard (master plan N13): a comparison page changed
          mid-measurement (I treated it myself, or its content edited between
          scans). When a clean substitute was found this names the swap; when
          none existed this is the honest caution line. The full receipt with
          dates lives in "See the math" above. */}
      {pres?.controlContaminationCaveat ? (
        <p className="mt-1 text-[12px] text-amber-700">{pres.controlContaminationCaveat}</p>
      ) : null}

      {/* Item C7 - the seasonal-overlap caveat used to repeat its full paragraph on
          every affected card (the section-level line above already says it once
          for the whole page). Each card just gets a small chip; the full sentence
          still lives in "See the math" so it is one click away, not gone. */}
      {pres?.seasonalInflectionCaveat ? (
        <span
          className="mt-1 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
          title={pres.seasonalInflectionCaveat}
        >
          seasonal swing overlaps
        </span>
      ) : null}

      {/* Dollar-ROI proof (gap #1): the GA4 traffic + conversion outcome next to
          the Search verdict. Revenue is honestly absent for this property, so the
          label never implies money (see the header note). */}
      {rec.trafficOutcome ? (() => {
        const t = rec.trafficOutcome!;
        const searchSettled = mature; // only a 28-day mature result is "settled"
        // "−93% on 1 baseline visit" must not read like a verdict - caution on thin volume.
        const lowVolume = t.ran && t.treated.sessionsPre > 0 && t.treated.sessionsPre < 5;
        return (
          <div className="mt-1 space-y-0.5">
            <p className="text-[12px] text-foreground/80">
              {!searchSettled ? (
                <span className="font-medium text-sky-700">Early directional traffic (not the Search verdict yet): </span>
              ) : null}
              {t.label}
            </p>
            {lowVolume ? (
              <p className="text-[11px] text-amber-700">
                Low volume, only {t.treated.sessionsPre} prior visit{t.treated.sessionsPre === 1 ? "" : "s"}, so the
                percent change is not reliable yet.
              </p>
            ) : null}
          </div>
        );
      })() : null}

      {/* Behavior lane (N4 + N17, 2026-07-03) - how visitors behaved since the
          change, grouped right after the traffic line it extends: engagement,
          frustrated clicks, bounce-backs, and whether people appear to find
          what they came for. Runs on the live_at clock like the traffic line
          above (never gated on Google recrawl). Self-hiding when every metric
          sits below its sample floor - no verdict from 12 sessions, ever.
          Corroboration only: the Search verdict above is never moved by this
          block (N10 may hold a win at decent when behavior worsened; the
          grade sentence in "See the math" names that reason). */}
      {behaviorHasContent(rec.behaviorOutcome) ? (() => {
        const b = rec.behaviorOutcome!;
        return (
          <div className="mt-1.5 space-y-0.5 rounded-md border border-border/40 bg-surface-inset/30 p-2">
            <p className="text-[11px] font-medium text-foreground/60">How visitors behaved</p>
            {b.sentence ? <p className="text-[12px] text-foreground/80">{b.sentence}</p> : null}
            {b.taskCompletionLine ? (
              <p className="text-[12px] text-foreground/80">{b.taskCompletionLine}</p>
            ) : null}
            {b.answerDeltaLine ? (
              <p className="text-[12px] text-foreground/80">{b.answerDeltaLine}</p>
            ) : null}
            <ReceiptLine
              line={buildReceiptLine({
                source: "your site analytics and Clarity behavior data",
                through: b.dataThrough,
                nowMs: Date.now(),
              })}
            />
          </div>
        );
      })() : null}

      {/* Dollar attribution for THIS change (item 22): only on a mature Win, only
          when the operator has a revenue model set and the lift is positive - a
          measuring row never shows a projected dollar figure, and a rate-less
          tenant never sees a number it can't back with real settings. The
          sentence itself always names the basis (your rate x the extra visitors
          this change earned), never "measured".
          operator spec 2026-07-09 E-38: also gated on real GA4 revenue being
          connected (trafficOutcome.hasRevenue) - until that is wired for this
          tenant, a rate-based dollar figure reads like proof it isn't yet. */}
      {shouldShowChangeDollarLine({ band, dollarValue: rec.dollarValue, hasRevenue: rec.trafficOutcome?.hasRevenue }) ? (
        <p className="mt-1 text-[13px] font-semibold text-emerald-700">{rec.dollarValue!.basisSentence}</p>
      ) : null}

      {/* AI-citation lane (item 5): one line when AI answers moved on a change
          built to win them, silence when there is nothing solid to say. */}
      {(() => {
        const aiLine = citationLineFor(rec.citationOutcome);
        return aiLine ? (
          <p className="mt-1 text-[12px] text-foreground/80">
            <span className="font-medium text-foreground/60">AI answers:</span> {aiLine}
          </p>
        ) : null;
      })()}

      {/* BEACON 500 item 71: "AI quoted this line" - the literal words the citing
          answer shares with our own page, once we know AI actually cited it post-ship.
          Silent when the page was never cited or there's no usable overlap. W2-B: the
          alignment is resolved once on the page (batched, READ-ONLY on the GET) and
          passed in, so this is now a pure sync component - no per-card read or write. */}
      <AiQuotedReceipt alignment={ownedAlignment ?? null} />

      {/* Live-SERP rank re-check (item 19): the literal Google position at ship
          vs the freshest read, for whichever window last came due. Silence when
          there is nothing honest to say (no target query, no re-check has fired
          yet, or the page fell out of the tracked results). This is the strongest
          single trust line the product can produce, so it gets its own row. */}
      {rec.rankOutcome?.sentence ? (
        <p className="mt-1 text-[12px] text-foreground/80">
          <span className="font-medium text-foreground/60">Google rank:</span> {rec.rankOutcome.sentence}
        </p>
      ) : null}

      {/* What actually changed (before → after). */}
      {rec.before || rec.after ? (
        <div className="mt-2.5 space-y-1.5 rounded-md border border-border/40 bg-surface-inset/30 p-2.5">
          {rec.before ? (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/70">Before:</span> {rec.before}
            </p>
          ) : null}
          {rec.after ? (
            rec.after.trim().startsWith("{") || rec.after.includes('"@context"') ? (
              <div className="text-[11px] text-foreground/85">
                <span className="font-medium text-foreground/70">What changed:</span>{" "}
                Added structured data that helps Google and AI understand this page.
                <details className="mt-1">
                  <summary className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
                    View technical code
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-inset/50 p-2 text-[10px] leading-snug text-muted-foreground">
                    {rec.after}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-[11px] text-foreground/85">
                <span className="font-medium text-foreground/70">After:</span> {rec.after}
              </p>
            )
          ) : null}
        </div>
      ) : null}

      {/* Target queries we expect this to move. */}
      {rec.targetQueries.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Target queries
          </span>
          {rec.targetQueries.slice(0, 6).map((q) => (
            <span
              key={q}
              className="rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] text-foreground/70"
            >
              {q}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Before the change (28 days prior): {metricsLine(rec)}
      </p>

      {/* Per-window diff-in-diff vs controls, with the check-in dates. */}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {rec.windows.map((w) => (
          <span
            key={w.day}
            className={w.ran ? "text-foreground/80" : "text-muted-foreground/60"}
          >
            <span className="font-medium">{w.day}d</span>{" "}
            {w.ran ? (
              <>
                lift {formatWindowLift(metric, w)} ({w.controlsUsed} comparison page
                {w.controlsUsed === 1 ? "" : "s"})
              </>
            ) : (
              <>opens {w.checkOn}</>
            )}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {`Compared against ${controlsCount} similar page${controlsCount === 1 ? "" : "s"} you did not change on the same site.`}{" "}
        A strong directional read, not a lab-perfect test.
      </p>

      {rec.notes ? (
        <p className="mt-2 text-[11px] text-foreground/70">
          <span className="font-medium text-foreground/60">Notes:</span> {rec.notes}
        </p>
      ) : null}

      {/* Operator: mark a manual Search Console recrawl request (speeds re-indexing). */}
      <div className="mt-2.5">
        <RecrawlButton recordId={rec.id} requestedAt={rec.recrawlRequestedAt} />
      </div>

      {/* Operator: exclude a MATURE (settled) result from learning so a mis-attributed
          win/loss stops skewing future ranking. Early/interim reads don't train, so the
          control only appears once a result is mature (or already excluded). */}
      {mature || rec.operatorVerdictOverride === "inconclusive" ? (
        <div className="mt-1.5">
          <ExcludeFromLearningButton
            recordId={rec.id}
            excluded={rec.operatorVerdictOverride === "inconclusive"}
          />
        </div>
      ) : null}

      {/* Put the old version back (item 11; E-36: never auto-revert, ask
          first): a restored row says so; a row that is measuring negative
          with a saved snapshot gets the one-click restore offer plus the
          reason sentence, and nothing ships until the operator clicks it;
          everything else keeps the manual copy fallback. */}
      {restored ? (
        <p className="mt-3 border-t border-border/40 pt-2.5 text-[11px] text-emerald-700">
          The old version is back on this page. I recorded the restore as its own change and I am measuring it.
        </p>
      ) : revert ? (
        <div className="mt-3 border-t border-border/40 pt-2.5">
          <p className="text-[11px] text-foreground/75">{revert.reason}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <RestoreOldVersionButton recordId={rec.id} />
          </div>
        </div>
      ) : rec.before ? (
        <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5">
          <RollbackCopyButton before={rec.before} />
          <span className="text-[10px] text-muted-foreground">
            To roll back by hand, paste this into your CMS.
          </span>
        </div>
      ) : null}
      </details>
    </Card>
  );
}

/**
 * AiQuotedReceipt (BEACON 500 item 71) - "AI quoted this line." The literal shared
 * wording between a citing AI answer and the page's own body text, one compact line.
 * W2-B (2026-07-10): the alignment is now resolved ONCE for the whole ledger by the
 * batched, READ-ONLY getOwnedAnswerAlignmentsBatch on the page (persist deferred to
 * after()), so this is a pure synchronous component that just renders what it was
 * handed - no per-card DB read, no GET-path saveMoveDraft. Silent on a null
 * alignment (no citation gain, no cached answer excerpt, or no real overlap).
 */
function AiQuotedReceipt({ alignment }: { alignment: PersistedAnswerAlignment | null }) {
  const top = alignment?.passages[0];
  if (!top) return null;

  return (
    <p className="mt-1 rounded-md border border-border/40 bg-surface-inset/30 px-2.5 py-2 text-[12px] text-foreground/80">
      <span className="font-medium text-foreground/60">AI quoted this line: </span>
      &quot;{top.pageSentence}&quot;
      {alignment?.engine ? <span className="text-muted-foreground"> ({alignment.engine})</span> : null}
    </p>
  );
}
