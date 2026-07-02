import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Check, CornerUpLeft } from "lucide-react";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { ResultsTimeline } from "../changes/results-timeline";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { loadConnectionHealth } from "@/domains/insight/connection-health";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import { gscLagStatus, isDueForMeasure, proofMaturityLabel } from "@/domains/proof-gsc/measure-lifecycle";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  isMatureOutcome,
  type MeasurementPresentation,
} from "@/domains/proof-gsc/measurement-maturity";
import { scheduleAutoMeasure } from "@/domains/proof-gsc/auto-measure-on-use";
import { loadDailyClicksByPathsForTenant } from "@/domains/proof-gsc/daily-series";
import { Sparkline, type SparkPoint } from "@/components/data/sparkline";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { linkProofRowsToActionPacks, type ProofLink } from "@/domains/action-pack/proof-linker";
import { ProofSummarySection } from "./proof-summary-section";
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
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
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

/**
 * Proof / Learning - operator-OS rebuild, surface (6). Every REVIEWED change
 * with its 7/14/28-day measurement windows, the GSC metrics to re-check (with
 * today's baseline), and the control pages for a diff-in-diff. Read-only; this
 * promotes loadProofPlan out of /diagnostics into the product nav.
 */
export const dynamic = "force-dynamic";


const OUTCOME_STYLE: Record<GscProofVerdict, string> = {
  won: "border-emerald-300 bg-emerald-50 text-emerald-700",
  lost: "border-rose-300 bg-rose-50 text-rose-700",
  inconclusive: "border-border bg-muted/40 text-muted-foreground",
  measuring: "border-blue-300 bg-blue-50 text-blue-700",
  insufficient_data: "border-border bg-muted/40 text-muted-foreground",
};

/** Move 2 - color by MATURITY tone, never by the raw verdict. Red/green appear only
 *  at a mature result; an early signal is blue "progress", waiting-for-data is amber. */
const TONE_STYLE: Record<MeasurementPresentation["tone"], string> = {
  positive: "border-emerald-300 bg-emerald-50 text-emerald-700",
  negative: "border-rose-300 bg-rose-50 text-rose-700",
  neutral: "border-border bg-muted/40 text-muted-foreground",
  progress: "border-blue-300 bg-blue-50 text-blue-700",
  waiting: "border-amber-300 bg-amber-50 text-amber-700",
};

function toPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
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
  const tenantId = await currentTenantId();
  const [ledger, connHealth, worklist, latestGscDate] = await Promise.all([
    loadProofLedgerCached(tenantId).catch(() => [] as ShippedChangeRecord[]),
    loadConnectionHealth(tenantId).catch(() => []),
    loadActionPackWorklistForTenant(tenantId).catch(() => null),
    readLastFinalizedDate(tenantId).catch(() => null),
  ]);
  const recordedPaths = new Set(ledger.map((l) => l.path));

  // Item 5 - a before/after daily-clicks line on every measured row (ship date marked),
  // so "won/lost" is never a naked label. Bounded to the first 16 rows; fail-soft.
  const sparkByPath = await loadDailyClicksByPathsForTenant(
    tenantId,
    ledger.slice(0, 16).map((l) => l.path),
  ).catch(() => new Map<string, SparkPoint[]>());

  // GSC-LAG CLARITY: Google Search Console data lags wall-clock, so a 7-day window
  // whose calendar date has passed often can't be judged yet. Count the rows that are
  // calendar-open but GSC-waiting, and surface the honest reason (not just "waiting").
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
        }),
      ] as const;
    }),
  );

  // Item 68 - three outcome bands instead of one flat list. A mature win is a Win;
  // a mature non-win is knowledge gained ("What we learned"); everything still
  // measuring or waiting on data is "In flight". Presentation-only; the measurement
  // math and stores are untouched.
  const winRows = ledger.filter((l) => {
    const p = presById.get(l.id);
    return !!p && isMatureOutcome(p.maturity) && l.verdict === "won";
  });
  const learningRows = ledger.filter((l) => {
    const p = presById.get(l.id);
    return !!p && isMatureOutcome(p.maturity) && l.verdict !== "won";
  });
  const inFlightRows = ledger.filter((l) => {
    const p = presById.get(l.id);
    return !p || !isMatureOutcome(p.maturity);
  });

  // Passive auto-measure (2026-06-29): when the operator opens Results, fire-and-forget a
  // due-row measurement pass AFTER the response (next/after → zero render latency) so
  // settled verdicts + the learned re-ranking activate WITHOUT a manual "Measure now"
  // click. Operator-only (it writes proof outcomes) + only when rows are actually due, so
  // a customer/anon view never mutates proof data. The settled rows show on the next visit.
  const dueNow = ledger.filter((l) => isDueForMeasure(l, latestGscDate, new Date()));
  const isOperator = await isOperatorModeServer();
  if (isOperator && dueNow.length > 0) scheduleAutoMeasure(tenantId);

  // Item 11 - one-click restore offers for rows that are measuring negative
  // (7/14/28 day reads). The shared revert policy decides propose vs auto;
  // the snapshot lookup is bounded to the first few negatives. Rows already
  // restored are badged instead. Operator-only (the action re-gates anyway).
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
      const autopilotConfig = await getAutopilotConfig().catch(() => null);
      for (const rec of negativeRows) {
        const p = presById.get(rec.id)!;
        const source = await resolveRevertSource(tenantId, rec).catch(() => null);
        const decision = decideRevert({
          tenantId,
          direction: p.direction,
          windowDay: p.basisDay,
          attributionQuality: p.attributionQuality,
          lever: rec.actionType,
          config: autopilotConfig,
          snapshotAvailable: source != null,
          alreadyReverted: false,
          now: new Date(),
          liftLabel: liftLabelFor(rec),
        });
        if (decision.action !== "none") revertById.set(rec.id, decision);
      }
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
  const learningDiag = isOperatorModeServer()
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
          shipped; reads the request-cached re-measured ledger. */}
      <Suspense fallback={null}>
        <ProofSummarySection />
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
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Measured outcomes
          </h2>
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
              <div className="mt-2 space-y-2.5">
                {winRows.map((rec) => (
                  <LedgerCard key={rec.id} rec={rec} band="win" link={linkByRowId.get(rec.id) ?? null} pres={presById.get(rec.id) ?? null} spark={sparkByPath.get(rec.path)} revert={revertById.get(rec.id) ?? null} restored={restoredIds.has(rec.id)} />
                ))}
              </div>
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
              <div className="mt-2 space-y-2.5">
                {learningRows.map((rec) => (
                  <LedgerCard key={rec.id} rec={rec} band="learning" link={linkByRowId.get(rec.id) ?? null} pres={presById.get(rec.id) ?? null} spark={sparkByPath.get(rec.path)} revert={revertById.get(rec.id) ?? null} restored={restoredIds.has(rec.id)} />
                ))}
              </div>
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
              <div className="mt-2 space-y-2.5">
                {inFlightRows.map((rec) => (
                  <LedgerCard key={rec.id} rec={rec} band="inflight" link={linkByRowId.get(rec.id) ?? null} pres={presById.get(rec.id) ?? null} spark={sparkByPath.get(rec.path)} revert={revertById.get(rec.id) ?? null} restored={restoredIds.has(rec.id)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

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

      {/* ── Your changes timeline (IA consolidation 2026-06-23) ──
          The former /changes proof timeline, embedded here so Results is the
          ONE place for "what changed / is it measuring / did it work". Its own
          Suspense boundary (heavy changelog + scorecard + URL-history compute)
          so it never blocks the ledger above; header suppressed (this page's
          "Results" header already covers it). */}
      <div className="mb-6">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Your changes
        </h2>
        <Suspense fallback={null}>
          <ResultsTimeline />
        </Suspense>
      </div>

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
  exact: "from your worklist",
  strong: "from your worklist",
  weak: "likely from your worklist",
  none: "manual or legacy change",
};
const SOURCE_LABEL: Record<string, string> = {
  gsc: "Google Search", ga4: "Analytics", clarity: "Clarity UX",
  profound: "AI citations", dataforseo: "Live SERP",
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

function LedgerCard({ rec, link, pres, spark, band, revert, restored }: { rec: ShippedChangeRecord; link?: ProofLink | null; pres?: MeasurementPresentation | null; spark?: SparkPoint[]; band?: LedgerBand; revert?: RevertDecision | null; restored?: boolean }) {
  // Judge a meta/title test on CTR, a content test on position, else clicks, so
  // every line on this card reads in the unit that actually moved.
  const metric = pickProofMetric(rec.actionType);
  const basis = rec.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
  const mature = pres ? isMatureOutcome(pres.maturity) : false;
  // Move 2 - the headline Search line: at a MATURE result, the lift-bearing sentence;
  // before that, the honest maturity language (no "Likely hurting (high confidence)"
  // off a 7-day read). Falls back to the legacy sentence when no presentation.
  const sentence =
    pres && !mature
      ? `${pres.headline}. ${pres.explanation}`
      : proofOutcomeSentence({ verdict: rec.verdict, confidence: pres?.confidence ?? rec.confidence, basis, metric });
  // Report the controls actually used in the basis window; fall back to assigned
  // count only before any window has run (measuring state).
  const controlsCount = basis?.controlsUsed ?? rec.controlPages.length;
  return (
    <div className={`rounded-lg border border-border/60 bg-background p-4${band === "win" ? " beacon-win-glow" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-foreground">{rec.path}</span>
        <span
          className={
            "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
            (pres ? TONE_STYLE[pres.tone] : OUTCOME_STYLE[rec.verdict])
          }
        >
          {/* Move 2 - one shared maturity headline + maturity-toned color: a 7d read is an
              EARLY signal (blue), 14d is "strengthening", only the 28d window earns the
              plain Helped / Did not help (green/red). */}
          {pres ? pres.headline : proofMaturityLabel(rec.verdict, basis?.day ?? null)}
        </span>
        {/* Item 6 - in-flight countdown: when the next reading lands, from this row's
            own windows (smallest unread window vs today). "any day now" covers the
            Google data lag once the calendar date has passed. */}
        {band === "inflight" ? (() => {
          const next = rec.windows.filter((w) => !w.ran).sort((a, b) => a.day - b.day)[0];
          if (!next) return null;
          const anyRead = rec.windows.some((w) => w.ran);
          const dueOn = addDays(rec.shippedAt, next.day);
          const daysLeft = Math.ceil((Date.parse(dueOn) - Date.now()) / 86_400_000);
          return (
            <span className="rounded-full border border-border/50 bg-muted/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {daysLeft <= 0
                ? "any day now"
                : `${anyRead ? "next" : "first"} read in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
            </span>
          );
        })() : null}
        <span className="text-[11px] text-muted-foreground">
          {rec.actionType.replace(/_/g, " ")} · shipped {rec.shippedAt.slice(0, 10)}
        </span>
        {rec.verifiedLive ? (
          <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            verified live
          </span>
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
        return (
          <div className="mt-1.5 flex items-center gap-2">
            <Sparkline points={spark} markerDate={shipDay} width={settled ? 240 : 200} height={settled ? 40 : 34} />
            <span className="text-[10px] text-muted-foreground">
              {markerVisible
                ? `daily clicks, ${spark.length} days · dot = when this shipped, tinted = after`
                : `daily clicks through ${lastDataDay} · this change is newer than the latest Search data (Google reports a few days behind)`}
            </span>
          </div>
        );
      })() : null}

      {/* Source move (Phase 4 - deterministic ActionPack↔proof linker, no migration).
          Closes the loop visibly: this shipped change traces back to the Move that
          recommended it, or is honestly labelled manual/legacy. */}
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
      ) : (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400">
          <CornerUpLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Manual or legacy change, not traced to a ranked move.
        </p>
      )}

      {/* Item 71 - a win leads with the number: the lift, the page, the date. */}
      {band === "win" && basis ? (
        <p className="mt-1.5 text-[14px] font-semibold text-emerald-700">
          {`${formatWindowLift(metric, basis)} on ${rec.path} since ${rec.shippedAt.slice(0, 10)}`}
        </p>
      ) : null}

      {/* Item 72 - a settled non-win reads as a lesson: what we tried, what it did
          not move, and that the next pick on pages like this uses a different lever. */}
      {band === "learning" ? (
        <p className="mt-1.5 text-[12px] text-foreground/80">
          {`A ${plainAction(rec.actionType)} on this page did not move ${PLAIN_METRIC[metric]} in the full window. The team now tries a different lever on pages like this.`}
        </p>
      ) : null}

      <p className="mt-1.5 text-[12px] text-foreground/80">
        <span className="font-medium text-foreground/60">Search:</span> {sentence}
      </p>

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
                  <summary className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1">
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

      {/* Put the old version back (item 11): a restored row says so; a row that
          is measuring negative with a saved snapshot gets the one-click restore
          plus the lesson sentence; everything else keeps the manual copy fallback. */}
      {restored ? (
        <p className="mt-3 border-t border-border/40 pt-2.5 text-[11px] text-emerald-700">
          The old version is back on this page. I recorded the restore as its own change and I am measuring it.
        </p>
      ) : revert ? (
        <div className="mt-3 border-t border-border/40 pt-2.5">
          <p className="text-[11px] text-foreground/75">{revert.reason}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <RestoreOldVersionButton recordId={rec.id} />
            {revert.action === "auto_revert" ? (
              <span className="text-[10px] text-muted-foreground">
                Covered by your autopilot budget: I will put the old version back tonight if you do not.
              </span>
            ) : null}
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
    </div>
  );
}
