export const dynamic = "force-dynamic";
// The "Update data" refresh (refreshAllConnectedDataNow) is a Server Action
// hosted by this route: it pulls every connected source AND warms the shared
// surfaces so the repaint is instant. That is deliberately long-running work the
// operator explicitly waits on, so give the action headroom above the ~15s
// default (well under the plan's 300s ceiling). Normal fast renders are
// unaffected - this only raises the ceiling.
export const maxDuration = 60;

import { Suspense } from "react";
import { after } from "next/server";
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { DataSourcesStrip, countConnectedDataSources } from "@/components/today/data-sources-strip";
import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";
import { loadTodayV2GateData } from "./today-v2-data";
import { loadTodayView } from "./today-view-data";
import { currentTenantId } from "@/lib/tenant-context";
import { FrictionFixesSection, DemandOpportunitiesSection, WarRoomQuietLine } from "./war-room-sections";
import { ScoreboardSection } from "./scoreboard-section";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { buildWeeklyRecap, shippedInLastDays, shippedToday, stillDoubleCheckingCount, weeklyRecapSentence } from "@/domains/proof-gsc/weekly-recap";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";
import { loadLatestStrategyMix } from "@/domains/strategy-review/strategy-mix-store";
import { strategyMemoLine } from "@/domains/strategy-review/surface";
import { CircuitBreakerSection } from "./circuit-breaker-section";
import { MonthlyNorthStar } from "./monthly-north-star";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { TodayNewPagesSummaryLine } from "./today-newpages-section";
import { loadLifecycleCounts } from "./lifecycle-counts-data";
import { OpsPipelineSection, DEADMAN_DEADLINE_MS } from "./ops-pipeline-section";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { loadDeadmanVerdict } from "@/domains/ops/deadman-view";
import { loadErrorSpikeLine } from "@/domains/ops/error-spike";
import { deriveDefectSignal } from "@/domains/ops/defect-signal";
import { InvestigationSection } from "./investigation-section";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
// Wave 3B (2026-07-10) - Today becomes MISSION CONTROL: ONE command answers "what is the single
// best thing I should do now?". The command model is a pure selector (domains/today); its card +
// the consolidated proof strip are token-only (src/components/today, outside the (shell) ratchet).
import { buildTodayCommand, commandAllowsCelebration } from "@/domains/today/today-command";
import { TodayCommandCard } from "@/components/today/today-command-card";
import { AutonomousResearchStatus } from "./autonomous-research-status";
import { TodayProofStrip } from "@/components/today/today-proof-strip";
import { verdictSchedule } from "@/domains/proof-gsc/verdict-schedule";
import { buildScoreboard } from "@/domains/scoreboard/scoreboard";
// P14 (Today dashboard pack) - the supporting briefing blocks that now live behind the ONE
// "More on today" drill-down (slot 6). Pure selectors + token-only cards in src/components/today/**.
import { adaptProofRecordForLead } from "@/components/today/today-lead-headline";
import { displayProofOutcome } from "@/domains/proof-gsc/verdict-calibration";
import { buildTodaySmokeAlarm } from "@/components/today/today-smoke-alarm";
import { buildTodayGoalPace } from "@/components/today/today-goal-pace";
import { TodayGoalPaceCard } from "@/components/today/today-briefing";
import { loadGscDecaySignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { buildReceiptLine } from "@/components/data/receipt-line";
import { buildWhileAwaySummary } from "@/components/today/today-while-away";
import { TodayWhileAwayCard } from "@/components/today/today-while-away-card";
import { readTodayLastSeen, writeTodayLastSeen } from "./today-last-seen-store";

/**
 * Today `/` - the focused daily slice of the ONE canonical model (2026-07-01, Move 5).
 *
 * Today is no longer a second "what should I do?" surface: it derives from the same
 * CanonicalChange[] that powers /changes (Changes). Four operational sections - what
 * needs attention, today's changes (the daily plan), what's measuring, what's next if
 * today is empty. No research-heavy MoveCards, no giant New Pages board, no duplicate
 * recommendation engine. Changes is the complete backlog; Today is the operational slice.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const notice = (await searchParams).notice;
  return (
    <div className="max-w-3xl space-y-6">
      <AlreadyLaunchedNotice notice={notice} />
      <Suspense fallback={<CockpitSkeleton />}>
        <Cockpit />
      </Suspense>
    </div>
  );
}

function AlreadyLaunchedNotice({ notice }: { notice: string | string[] | undefined }) {
  if (notice !== "already_launched") return null;
  return (
    <div className="mb-6 rounded-md border border-border/60 bg-surface-inset/40 px-4 py-3 text-[13px]">
      <p className="font-medium text-foreground">You&apos;ve already finished setup. Here&apos;s your workspace.</p>
      <p className="mt-1 text-muted-foreground">
        Setup is a one-time step. To change your business details, service area, or competitors, head to{" "}
        <Link href="/settings/config" className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Settings</Link>.
      </p>
    </div>
  );
}

function CockpitSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading today">
      <div className="space-y-2">
        <div className="h-7 w-28 rounded-md bg-muted/40" />
        <div className="h-4 w-2/3 max-w-md rounded-md bg-muted/25" />
      </div>
      <div className="h-28 rounded-2xl border border-border bg-surface-inset" />
      <div className="grid gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-border bg-surface-inset" />)}</div>
    </div>
  );
}

async function Cockpit() {
  // Perf trace (disabled by default via BEACON_PERF_TRACE) - the trace lives in
  // this nested async component, not the top-level page export, so the Suspense
  // shell still streams instantly. Times the two real loaders + flushes on every
  // exit path (demo / first-reading / error / success) via finally.
  const trace = createPerfTrace("loader:/", {
    traceId: await readPerfTraceIdFromHeaders(),
    route: "/",
  });
  try {
    return await renderCockpit(trace);
  } finally {
    trace.flush();
  }
}

/** FP1 - the two hero loaders get a little more room than a section band (a
 *  timeout here replaces the whole page with the honest one-liner, so it should
 *  only fire when things are genuinely wedged, not on a cold lambda). */
const TODAY_HERO_DEADLINE_MS = 8000;

async function renderCockpit(trace: ReturnType<typeof createPerfTrace>) {
  // FP1 (2026-07-02) - the gate read is deadline-bounded so the CockpitSkeleton
  // pulse can never strand. Past the deadline, say so honestly; the abandoned
  // loader keeps running and warms the cache for the next visit.
  const gateRaced = await trace.time("loadTodayV2GateData", () =>
    loadWithDeadline(loadTodayV2GateData(), TODAY_HERO_DEADLINE_MS),
  );
  if (gateRaced.timedOut) return <HonestDelay />;
  const gate = gateRaced.data;

  if (gate.isDemoMode) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Connect your data sources to see your command center</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Connect Google Search Console (plus GA4, Profound, or Clarity) and refresh to see your ranked changes.
          Three steps: 1. Connect your sources → 2. Refresh → 3. Review your changes.
        </p>
        <Link href="/settings/connectors" className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Connect data sources →</Link>
      </div>
    );
  }
  if (gate.firstReading.isFirstReading) return <FirstReadingWaiting context={gate.firstReading.context} />;

  let composite: Awaited<ReturnType<typeof loadTodayView>>;
  try {
    // FP1 - loadTodayView serves the SWR snapshot instantly when one exists; the
    // deadline only bites on the cold no-snapshot compute, which keeps running in
    // the background and persists its snapshot, so the next visit is instant.
    const viewRaced = await trace.time("loadTodayView", () =>
      loadWithDeadline(loadTodayView(), TODAY_HERO_DEADLINE_MS),
    );
    if (viewRaced.timedOut) return <HonestDelay />;
    composite = viewRaced.data;
  } catch {
    return (
      <div role="alert" className="rounded-lg border border-border/60 bg-surface-inset/30 p-6 text-center">
        <p className="text-sm font-medium text-foreground">Couldn’t load Today just now.</p>
        <p className="mt-1 text-xs text-muted-foreground">Your data is safe. Refresh in a moment, or open <Link href="/changes" className="underline">Changes</Link>.</p>
      </div>
    );
  }
  const { today, daily } = composite;
  const tenantId = await currentTenantId();
  const nowPacific = new Date();
  const activePlan = daily?.dashboard.acceptedPlan ?? daily?.dashboard.previewPlan;
  const isMonday = nowPacific.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }) === "Monday";

  // Today context parallelization (2026-07-12): these eleven reads are mutually
  // independent once tenant + cached composite are known. They used to run in
  // several sequential waves, making their bounded deadlines additive. Start
  // each exactly once and wait for the slowest, never the sum. Ranking/copy use
  // the identical values and fallbacks as before.
  const tLedger = perfMark();
  const [
    connectedSourceCount,
    pipelineHealth,
    ledgerRows,
    lifecycle,
    calibrationSentence,
    strategySentence,
    leadStoryDays,
    decaySignals,
    deadmanVerdict,
    errorSpikeLine,
    lastSeen,
  ] = await Promise.all([
    valueWithDeadline(countConnectedDataSources(tenantId).catch(() => 0), 0),
    valueWithDeadline(readPipelineHealth(tenantId).catch(() => null), null),
    valueWithDeadline(
      loadProofLedgerCached(tenantId).catch(() => [] as Awaited<ReturnType<typeof loadProofLedgerCached>>),
      [],
    ),
    valueWithDeadline(
      loadLifecycleCounts().catch(() => ({ toDo: 0, tonightPicked: 0, tonightApplied: 0, measuring: 0, decided: 0, won: 0 })),
      { toDo: 0, tonightPicked: 0, tonightApplied: 0, measuring: 0, decided: 0, won: 0 },
      TODAY_HERO_DEADLINE_MS,
    ),
    isMonday
      ? valueWithDeadline(
          loadCalibrationRecords(tenantId)
            .then((rows) => {
              const s = summarizeForecastCalibration(rows);
              return s.settledCount >= MIN_SETTLED_FOR_CALIBRATION ? s.sentence : null;
            })
            .catch(() => null),
          null,
        )
      : Promise.resolve(null),
    isMonday
      ? valueWithDeadline(
          loadLatestStrategyMix(tenantId).then((record) => strategyMemoLine(record, new Date())).catch(() => null),
          null,
        )
      : Promise.resolve(null),
    valueWithDeadline(
      loadDailyTotalsForTenant(tenantId, 84).catch(() => [] as Awaited<ReturnType<typeof loadDailyTotalsForTenant>>),
      [],
    ),
    valueWithDeadline(loadGscDecaySignalsForTenant(tenantId, new Date()).catch(() => new Map()), new Map(), TODAY_HERO_DEADLINE_MS),
    valueWithDeadline(loadDeadmanVerdict(tenantId).catch(() => null), null, DEADMAN_DEADLINE_MS),
    valueWithDeadline(loadErrorSpikeLine(tenantId).catch(() => null), null, DEADMAN_DEADLINE_MS),
    valueWithDeadline(readTodayLastSeen().catch(() => null), null, TODAY_HERO_DEADLINE_MS),
  ]);
  perfStage("today-parallel-context", tLedger, { rows: ledgerRows.length });

  const pipelineDegraded = Boolean(pipelineHealth && pipelineHealth.violations.length > 0);
  const pipelineCheckedAt = pipelineHealth?.checked_at ?? null;
  const streak = shippedInLastDays(ledgerRows, Date.now());
  // FP3 (2026-07-02, supersedes A2's verdict-field count) - THE ONE-COUNT RULE: every
  // lifecycle count on this page (the standup chip, the tiles, the measuring strip, the
  // results-ready alert) comes from the shared lifecycle loader, which classifies the
  // SAME request-cached ledger rows with the SAME rule Results uses for its bands. So
  // "16 measuring" here lands on exactly 16 "In flight" rows on Results, and the
  // Results tile equals the decided (Wins + What we learned) total there - never three
  // contradicting answers on three surfaces. Fail-soft to zeros, never blocks the page.
  const measuringCount = lifecycle.measuring;
  // D6 (daily ritual loop) - the daily counter strip's two real numbers, both read from the
  // SAME ledger rows the streak above already loaded. Server truth, never localStorage: the
  // per-session "shipped N today" the worklist keeps client-side is a today-only nice-to-have,
  // this is the number that survives a refresh or a different device.
  const shippedTodayCount = shippedToday(ledgerRows, Date.now());
  const doubleCheckingTodayCount = stillDoubleCheckingCount(ledgerRows, Date.now());

  // Item 42: the assistant sets the scene like a person would.
  const dayLine = nowPacific.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  const hour = Number(nowPacific.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const picks = activePlan?.selected.length ?? 0;
  const minutes = activePlan?.estimatedMinutes ?? 0;
  // P1-5 (2026-07-10, visual audit) - the streak's celebratory clause ("you are on a roll")
  // and the `brief` sentence it lives in are built further below, AFTER the one command exists,
  // so they can be gated on command.kind (see the comment there for why).
  // Item 7 - Monday recap band: last week's outcomes in one sentence, from the ledger.
  const recapSentence = isMonday
    ? weeklyRecapSentence(buildWeeklyRecap(ledgerRows.map((r) => ({ shippedAt: r.shippedAt, verdict: r.verdict, calibrationVersion: r.calibrationVersion, path: r.path })), Date.now()))
    : null;
  // The same 84-day click series the scoreboard reads (react.cache-shared, so this costs nothing
  // extra). Feeds the command's week-over-week loss check and the while-away catch-up card.
  const tonightFirstPick = activePlan?.selected[0] ?? null;
  const nowMs = Date.now();

  // P14 item 2 (v1 324) - the smoke alarm with page blame: ONE honest line naming the exact page
  // bleeding clicks and the number, from the SAME per-page GSC decay signal the war-room friction
  // band + the GSC scoreboard card read. It deliberately does NOT re-raise the data-pipe alarm
  // (OpsPipelineSection above owns that) - this is the page-blame lane the pipe alert can't fill.
  // pagesWithFixReady = the pages tonight's plan already has a queued change for, so "I have a fix
  // ready" is only said when it is true. Self-hides when no drop clears the floor. $0-ish read,
  // fail-soft to null (no alarm), deadline-bounded like the other page reads.
  const pagesWithFixReady = new Set<string>(
    (activePlan?.selected ?? []).map((s) => {
      const p = (s.pageLabel || "").replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "");
      return p || "/";
    }),
  );
  const smokeAlarm = buildTodaySmokeAlarm({
    decay: Array.from((decaySignals as Map<string, { page: string; clicksNow: number; clicksPrior: number }>).values())
      .map((d) => ({ page: d.page, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior })),
    pagesWithFixReady,
  });

  // Wave 3B - THE ONE COMMAND (slot 2). Every input reuses a number another surface owns, and the
  // priority (defect > material loss > top move > observe) picks exactly one directive so two "do
  // this" cards can never shout at once. The week-over-week delta comes from the SAME buildScoreboard
  // the hero chart reads (the loaders are react.cache-shared, so this is not a second heavy read),
  // and the next-read date comes from the ONE verdictSchedule the proof strip + Results share.
  // P2-a (2026-07-10, visual audit) - the command's defect signal must fire on EVERY signal that
  // turns OpsPipelineSection's banner red in slot 1, not pipeline violations alone. Without this,
  // a stalled overnight job or a run of failures could paint the banner red while the command
  // still said "Do this next" or "Nothing needs a decision" right below it. deriveDefectSignal
  // (domains/ops/defect-signal.ts) is the ONE pure read both this command and that banner use, so
  // they can never disagree again. loadDeadmanVerdict is react.cache-shared (free here);
  // loadErrorSpikeLine is a light per-tenant read, deadline-bound like the banner's.
  const pipelineAlarms = deriveDefectSignal({
    violations: pipelineHealth?.violations ?? [],
    deadman: deadmanVerdict,
    errorSpikeLine,
  }).sentences;
  const scoreboardDeltaPct =
    buildScoreboard(
      leadStoryDays.map((d) => ({ date: d.date, clicks: d.clicks, impressions: 0 })),
      ledgerRows,
      new Date(nowMs),
    )?.deltaPct ?? null;
  // P2-1 (2026-07-10, visual audit) - the ONE schedule read, reused for both the checkpoint
  // (Today's own proof strip) and the settled-read date (named alongside it there, and echoed
  // by the Results cumulative-outcome strip's "Next checkpoint" clause), so the two surfaces
  // never show unrelated dates for what is really one schedule.
  const schedule = verdictSchedule(ledgerRows, new Date(nowMs));
  const firstReadOn = schedule.firstReadOn;
  const command = buildTodayCommand({
    pipelineAlarms,
    smokeAlarm,
    scoreboardDeltaPct,
    topOpportunity: today.nextOpportunities[0] ?? null,
    firstReadOn,
    measuringCount,
  });

  // P1-5 (2026-07-10, visual audit) - the greeting's streak clause must never celebrate ("you
  // are on a roll") directly above the ONE command naming today's biggest problem. The audit's
  // exact live contradiction: "16 changes shipped in the last 14 days, you are on a roll." sat
  // right above "Your biggest problem today: ... lost 163 clicks." commandAllowsCelebration
  // (today-command.ts) suppresses the celebratory clause whenever the command itself is a
  // problem (fix_defect or respond_to_loss) - the streak COUNT still renders (it is real and
  // true), just without the celebratory clause.
  const streakLine =
    streak > 0
      ? ` ${streak} change${streak === 1 ? "" : "s"} shipped in the last 14 days${
          streak >= 10 && commandAllowsCelebration(command.kind) ? ", you are on a roll" : ""
        }.`
      : "";
  // Operator spec 2026-07-09 B-14: no "team" framing - purely functional.
  const brief =
    (picks > 0
      ? `${dayLine}. ${picks} change${picks === 1 ? "" : "s"} ready, about ${Math.max(minutes, picks)} minutes.`
      : `${dayLine}. ${today.headerSentence}`) + streakLine;

  // P14 item 3 (v1 329/331) - goal pace + start-my-day: the honest weekly pace read plus the
  // concrete 20-minute ritual step. Every number reuses an existing count - shippedThisWeek is the
  // same trailing-7d ledger tally the recap band reads, `ready` is picks minus applied (the same
  // tonight-chip number), `measuring` is the shared FP3 lifecycle count. The weekly goal, with no
  // separate store, is everything committed to this week: shipped plus still-ready. Self-hides on a
  // fresh empty tenant.
  const shippedThisWeek = shippedInLastDays(ledgerRows, nowMs, 7);
  const readyCount = Math.max(0, lifecycle.tonightPicked - lifecycle.tonightApplied);
  const goalPace = buildTodayGoalPace({
    shippedThisWeek,
    weeklyGoal: shippedThisWeek + readyCount,
    ready: readyCount,
    measuring: lifecycle.measuring,
    topReadyPage: tonightFirstPick?.pageLabel ?? null,
    nowMs,
  });
  const goalPaceReceipt = buildReceiptLine({
    source: "your shipped-change ledger",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "counted",
    nowMs,
  });

  // P21 item 1 (v1 238) - "while you were away": ONE honest block summarizing what changed
  // since the operator's previous Today visit. It reads the per-tenant last-seen mark
  // (today-last-seen-store), diffs it against the SAME canonical lifecycle counts every
  // other surface on this page uses (so "2 changes finished measuring" lands on exactly the
  // same decided total Results shows), and self-hides on a first visit / a quick refresh /
  // a quiet return. The won-clicks-a-month figure is the summed measured monthly lift of
  // ONLY the changes that won since the last visit, computed with the SAME per-record window
  // math the lead headline uses (adaptProofRecordForLead), so it never shows a hard number
  // off an open window. Fail-soft: any store outage just hides the block, never breaks Today.
  const newWonMonthlyClickLift = lastSeen
    ? (() => {
        const seenMs = Date.parse(lastSeen.seenAt);
        if (!Number.isFinite(seenMs)) return null;
        let sum = 0;
        for (const r of ledgerRows) {
          // Fail-closed calibration quarantine (2026-07-11): only a calibrated win
          // contributes to the "won since you were away" click figure; an
          // uncalibrated won reads as no clear effect (never a summed win number).
          if (displayProofOutcome(r).kind !== "won") continue;
          const settledMs = Date.parse(r.measuredAt ?? "");
          if (!Number.isFinite(settledMs) || settledMs <= seenMs) continue;
          const lift = adaptProofRecordForLead({
            path: r.path,
            pageLabel: null,
            shippedAt: r.shippedAt,
            verdict: r.verdict,
            windows: r.windows,
          }).monthlyClickLift;
          if (typeof lift === "number" && lift > 0) sum += lift;
        }
        return sum > 0 ? sum : null;
      })()
    : null;
  const whileAway = buildWhileAwaySummary({
    then: lastSeen?.counts ?? null,
    seenAt: lastSeen?.seenAt ?? null,
    now: { decided: lifecycle.decided, won: lifecycle.won, toDo: lifecycle.toDo },
    newWonMonthlyClickLift,
    // Wave 3B: the lead headline card that used to carry the win figure is gone (subsumed by the
    // ONE command, which never celebrates a win with a number), so the while-away card is now the
    // single place a won-clicks-a-month figure appears - never suppressed.
    suppressWinFigure: false,
    nowMs,
  });
  const whileAwayReceipt = buildReceiptLine({
    source: "your results and open changes",
    checkedAt: new Date(nowMs).toISOString(),
    verb: "counted",
    nowMs,
  });
  // Stamp this visit as the new last-seen mark, in the background, so the same news never
  // shows twice and the next return diffs against these numbers. Fire-and-forget: it must
  // never delay or fail the render (writeTodayLastSeen is itself fail-soft).
  after(async () => {
    await writeTodayLastSeen(
      { decided: lifecycle.decided, won: lifecycle.won, toDo: lifecycle.toDo },
      new Date(nowMs).toISOString(),
    );
  });

  return (
    <div className="space-y-6">
      {/* ── SLOT 1: critical truth warnings, self-hiding ──────────────────────────────────
          A broken data pipe or a paused autopilot are the only things that outrank the one
          command. Both self-hide when everything is healthy, so a normal day starts clean. */}
      <Suspense fallback={null}><OpsPipelineSection tenantId={tenantId} /></Suspense>
      {/* Item 80 - the portfolio circuit breaker: self-hides unless autopilot paused itself
          after consecutive losing batches or too many rollbacks. */}
      <Suspense fallback={null}><CircuitBreakerSection /></Suspense>

      {/* The greeting + the one refresh control (page chrome, not a command). */}
      <PageHeader title={greeting} description={brief}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} />
      </PageHeader>
      <Suspense fallback={null}><AutonomousResearchStatus tenantId={tenantId} /></Suspense>

      {/* ── SLOT 2-4: THE ONE COMMAND ─────────────────────────────────────────────────────
          The single best thing to do now, its evidence, one exact action, and the ONE accent
          CTA above the fold. Subsumes and KILLS the old smoke-alarm card, lead-headline card,
          and the lead of the "What to do next" list, so two "do this" cards never shout at once. */}
      <TodayCommandCard command={command} />

      {/* ── SLOT 5: measuring / results status ────────────────────────────────────────────
          The monthly clicks north star, the scoreboard chart (the ONE other place a clicks
          delta is stated, in its own week-over-week window), and the ONE consolidated proof
          strip (canonical measuring count + next-read date + Search Console freshness). */}
      <Suspense fallback={null}><MonthlyNorthStarSection tenantId={tenantId} /></Suspense>
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-border bg-surface-inset" />}>
        <ScoreboardSection tenantId={tenantId} stale={pipelineDegraded} staleCheckedAt={pipelineCheckedAt} />
      </Suspense>
      <TodayProofStrip
        measuringCount={measuringCount}
        firstReadOn={firstReadOn}
        firstSettledReadOn={schedule.finalVerdictOn}
        gscThrough={leadStoryDays[leadStoryDays.length - 1]?.date ?? null}
        nowMs={nowMs}
      />

      {/* ── SLOT 6: everything else, behind ONE deliberate drill-down ─────────────────────
          The full daily context lives here so the top of Today stays a single command. Native
          <details> keeps every band in the DOM (Suspense still resolves), just collapsed. */}
      <details className="group" data-more-on-today="true">
        <summary className="cursor-pointer select-none list-none text-body font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
          More on today
        </summary>
        <div className="mt-4 space-y-6">
          <DailyCounterStrip shipped={shippedTodayCount} doubleChecking={doubleCheckingTodayCount} />
          {/* P14 item 3 - goal pace + the 20-minute ritual step. Self-hides on a fresh tenant. */}
          {goalPace ? <TodayGoalPaceCard pace={goalPace} checkedLine={goalPaceReceipt} /> : null}
          {/* P21 item 1 - "while you were away": the one honest catch-up for a returning operator. */}
          {whileAway ? <TodayWhileAwayCard summary={whileAway} checkedLine={whileAwayReceipt} /> : null}
          {/* Item 7 - Monday recap band: last week's outcomes in one sentence, from the ledger. */}
          {recapSentence ? (
            <div className="rounded-xl border border-status-success/30 bg-status-success-bg px-4 py-2.5 text-body leading-relaxed text-foreground tabular-nums">
              {recapSentence}
            </div>
          ) : null}
          {/* Item 27 - the promise ledger, one sentence, Mondays only, self-hides under 3 settled. */}
          {calibrationSentence ? (
            <div className="rounded-xl border border-status-info/30 bg-status-info-bg px-4 py-2.5 text-body leading-relaxed text-foreground tabular-nums">
              {calibrationSentence}
            </div>
          ) : null}
          {/* Item 51 - the weekly strategy review's signed memo, Mondays only, self-hides with no mix. */}
          {strategySentence ? (
            <div className="rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-body leading-relaxed text-foreground tabular-nums">
              {strategySentence}
            </div>
          ) : null}
          <TodayCounts
            readyToday={today.counts.readyToday}
            needsAttention={today.counts.needsAttention}
            measuring={lifecycle.measuring}
            results={lifecycle.decided}
          />
          {/* Item 53 - overnight forensic investigation, self-hides when nothing fired. */}
          <Suspense fallback={null}><InvestigationSection tenantId={tenantId} /></Suspense>

          {/* Friction + demand bands carry real signals. */}
          <section aria-label="What I found today" className="space-y-3">
            <h2 className="text-sub font-semibold text-foreground">What I found today</h2>
            <Suspense fallback={<WarRoomCardSkeleton />}><FrictionFixesSection tenantId={tenantId} /></Suspense>
            <Suspense fallback={<WarRoomCardSkeleton />}><DemandOpportunitiesSection tenantId={tenantId} /></Suspense>
            {/* FP5b - the New Pages board's ONE home is /changes; Today gets one honest sentence. */}
            <Suspense fallback={null}><TodayNewPagesSummaryLine /></Suspense>
            {/* Item 49 - one quiet line when every band above stays silent. */}
            <Suspense fallback={null}><WarRoomQuietLine tenantId={tenantId} /></Suspense>
          </section>

          <Suspense fallback={null}><DataSourcesStrip /></Suspense>
        </div>
      </details>
    </div>
  );
}

/** Item 22 - a war-room band while it streams: one card-shaped placeholder (rounded-2xl,
 *  ~h-24 like the real cards) so the section holds its shape instead of flashing blank. */
function WarRoomCardSkeleton() {
  return <div aria-hidden className="block h-24 animate-pulse rounded-2xl border border-border bg-surface-inset" />;
}

/** D6 (daily ritual loop) - "Today you shipped N changes. The app is double-checking M of them."
 *  Server truth: both numbers come from the shipped-change ledger (the same rows the header
 *  streak reads), not the per-session client counter on /changes. Self-hides on a day with
 *  nothing shipped yet - a bare "0 shipped" strip every morning would just be noise. */
function DailyCounterStrip({ shipped, doubleChecking }: { shipped: number; doubleChecking: number }) {
  if (shipped === 0) return null;
  const checking = doubleChecking > 0 ? ` I am double-checking ${doubleChecking} of them.` : "";
  return (
    <div className="rounded-xl border border-border bg-surface-inset px-4 py-2.5 text-body leading-relaxed text-muted-foreground tabular-nums">
      Today you shipped {shipped} change{shipped === 1 ? "" : "s"}.{checking}
    </div>
  );
}

function TodayCounts({
  readyToday,
  needsAttention,
  measuring,
  results,
}: {
  readyToday: number;
  needsAttention: number;
  measuring: number;
  results: number;
}) {
  // FP3 - every tile value arrives from the shared lifecycle loader, never a second
  // CanonicalChange-derived count, so these tiles, the proof strip, and Results always agree.
  // Wave 3B: token-only, so this slot-6 recap adds nothing to the raw-palette ratchet.
  const tiles: { label: string; value: number; show: boolean }[] = [
    { label: "Ready today", value: readyToday, show: readyToday > 0 },
    { label: "Needs attention", value: needsAttention, show: needsAttention > 0 },
    { label: "Measuring", value: measuring, show: measuring > 0 },
    { label: "Results", value: results, show: results > 0 },
  ].filter((t) => t.show);
  if (tiles.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-meta text-muted-foreground tabular-nums">
        {tiles.map((t) => (
          <span key={t.label}><span className="font-semibold text-foreground">{t.value}</span> {t.label}</span>
        ))}
      </div>
      {/* R14b (receipts everywhere) - where these counts come from: the SAME live
          change ledger Results reads (THE ONE-COUNT RULE), counted this visit. */}
      <p data-receipt-line="true" className="mt-0.5 text-meta text-muted-foreground">
        From the same live change ledger Results reads, counted just now.
      </p>
    </div>
  );
}

/** A-3/B-6 - loads the tenant's configured monthly-visit goal (per-tenant DATA) and renders
 *  the north-star strip. Fail-soft: a config read error just means no goal line. */
async function MonthlyNorthStarSection({ tenantId }: { tenantId: string }) {
  let goal: number | null = null;
  try {
    const business = await getBusinessConfigForCurrentTenant();
    goal = business.monthlyVisitGoal ?? null;
  } catch {
    goal = null;
  }
  return <MonthlyNorthStar tenantId={tenantId} monthlyVisitGoal={goal} />;
}
