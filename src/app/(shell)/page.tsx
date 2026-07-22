export const dynamic = "force-dynamic";
// No page-level maxDuration override: this route INHERITS the (shell) layout's
// 300s ceiling. A 60s page cap used to kill the lambda before the layout's
// post-response autonomous cycle (AUTONOMOUS_RUN_DEADLINE_MS = 210s) could write
// its terminal receipt, leaving the status UI stuck on "working" forever. The
// 300s ceiling also covers this route's long "Update data" Server Action
// (refreshAllConnectedDataNow), which pulls every connected source and warms the
// shared surfaces - it has more headroom now, not less.

import { Suspense } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { countConnectedDataSources } from "@/components/today/data-sources-strip";
import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";
import { loadTodayV2GateData } from "./today-gate-data";
import { loadTodayView } from "./today-view-data";
import { currentTenantId } from "@/lib/tenant-context";
import { ScoreboardSection } from "./scoreboard-section";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { shippedInLastDays } from "@/domains/proof-gsc/weekly-recap";
import { loadLifecycleCounts } from "./lifecycle-counts-data";
import { InvestigationAlertLine } from "./investigation-alert";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
// Wave 3B (2026-07-10) - Today is MISSION CONTROL: ONE command answers "what is the single
// best thing I should do now?". The command model is a pure selector (domains/today); its card +
// the consolidated proof strip are token-only (src/components/today, outside the (shell) ratchet).
import { buildTodayCommand, commandAllowsCelebration } from "@/domains/today/today-command";
import { TodayCommandCard } from "@/components/today/today-command-card";
import { TodayProofStrip } from "@/components/today/today-proof-strip";
import { verdictSchedule } from "@/domains/proof-gsc/verdict-schedule";
import { buildScoreboard } from "@/domains/scoreboard/scoreboard";
import { buildTodaySmokeAlarm } from "@/components/today/today-smoke-alarm";
import { loadGscDecaySignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";

/**
 * Today `/` - the focused daily slice of the ONE canonical model (2026-07-01, Move 5).
 *
 * Phase 4D (2026-07-21) - Today is stripped to its load-bearing spine: a self-hiding
 * alert lane (circuit breaker + the one investigation conclusion), the greeting and the
 * one refresh control, THE ONE COMMAND, ONE performance view (the scoreboard), and ONE
 * measurement pointer (the proof strip). The war-room bands, the "More on today" drawer,
 * the north-star line, the ops banner, and the research-status line are gone; their
 * producers survive as ranking inputs for the command and for Changes/Results.
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
          Connect Google Search Console (plus GA4 or Clarity) and refresh to see your ranked changes.
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
    return <HonestDelay message="Couldn’t load Today just now. Your data is safe, and Beacon is retrying automatically." />;
  }
  const { today } = composite;
  const tenantId = await currentTenantId();
  const nowPacific = new Date();
  // The daily-experiment plan was removed with the experiments domain (CORE 100K);
  // Today's picks/minutes and "fix ready" set now come from the ranked changes.

  // Today context parallelization (2026-07-12): these reads are mutually
  // independent once tenant + cached composite are known. Start each exactly
  // once and wait for the slowest, never the sum. Every one feeds either the
  // one command, the scoreboard, or the proof strip.
  const tLedger = perfMark();
  const [
    connectedSourceCount,
    ledgerRows,
    lifecycle,
    leadStoryDays,
    decaySignals,
  ] = await Promise.all([
    valueWithDeadline(countConnectedDataSources(tenantId).catch(() => 0), 0),
    valueWithDeadline(
      loadProofLedgerCached(tenantId).catch(() => [] as Awaited<ReturnType<typeof loadProofLedgerCached>>),
      [],
    ),
    valueWithDeadline(
      loadLifecycleCounts().catch(() => ({ toDo: 0, tonightPicked: 0, tonightApplied: 0, measuring: 0, decided: 0, won: 0 })),
      { toDo: 0, tonightPicked: 0, tonightApplied: 0, measuring: 0, decided: 0, won: 0 },
      TODAY_HERO_DEADLINE_MS,
    ),
    valueWithDeadline(
      loadDailyTotalsForTenant(tenantId, 84).catch(() => [] as Awaited<ReturnType<typeof loadDailyTotalsForTenant>>),
      [],
    ),
    valueWithDeadline(loadGscDecaySignalsForTenant(tenantId, new Date()).catch(() => new Map()), new Map(), TODAY_HERO_DEADLINE_MS),
  ]);
  perfStage("today-parallel-context", tLedger, { rows: ledgerRows.length });

  const streak = shippedInLastDays(ledgerRows, Date.now());
  // FP3 (2026-07-02, supersedes A2's verdict-field count) - THE ONE-COUNT RULE: every
  // lifecycle count on this page (the measuring strip) comes from the shared lifecycle
  // loader, which classifies the SAME request-cached ledger rows with the SAME rule
  // Results uses for its bands. So "16 measuring" here lands on exactly 16 "In flight"
  // rows on Results - never contradicting answers. Fail-soft to zeros, never blocks.
  const measuringCount = lifecycle.measuring;

  // Item 42: the assistant sets the scene like a person would.
  const dayLine = nowPacific.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  const hour = Number(nowPacific.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const picks = 0;
  const minutes = 0;
  // The same 84-day click series the scoreboard reads (react.cache-shared, so this costs
  // nothing extra). Feeds the command's week-over-week loss check.
  const nowMs = Date.now();

  // P14 item 2 (v1 324) - the smoke alarm with page blame: ONE honest line naming the exact
  // page bleeding clicks and the number, from the SAME per-page GSC decay signal the GSC
  // scoreboard card reads. pagesWithFixReady = the pages tonight's plan already has a queued
  // change for, so "I have a fix ready" is only said when it is true. $0-ish read, fail-soft
  // to null (no alarm). It feeds the command; it is not rendered as its own card.
  const pagesWithFixReady = new Set<string>();
  const decayRows = Array.from(
    (decaySignals as Map<string, { page: string; clicksNow: number; clicksPrior: number; windowNowEnd?: string }>).values(),
  );
  const smokeAlarm = buildTodaySmokeAlarm({
    decay: decayRows.map((d) => ({ page: d.page, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior })),
    pagesWithFixReady,
    // The finalized day the decay "now" window ends on (same for every row in one
    // read), so the alarm names its exact reproducible window instead of an undated
    // "last 4 weeks".
    windowEnd: decayRows[0]?.windowNowEnd ?? null,
  });

  // Wave 3B - THE ONE COMMAND. Every input reuses a number another surface owns, and the
  // priority (material loss > top move > observe) picks exactly one directive so two
  // "do this" cards can never shout at once. The week-over-week delta comes from the SAME
  // buildScoreboard the hero chart reads (react.cache-shared), and the next-read date comes from
  // the ONE verdictSchedule the proof strip + Results share.
  const scoreboardDeltaPct =
    buildScoreboard(
      leadStoryDays.map((d) => ({ date: d.date, clicks: d.clicks, impressions: 0 })),
      ledgerRows,
      new Date(nowMs),
    )?.deltaPct ?? null;
  // P2-1 (2026-07-10, visual audit) - the ONE schedule read, reused for both the checkpoint
  // (Today's own proof strip) and the settled-read date, so the two surfaces never show
  // unrelated dates for what is really one schedule.
  const schedule = verdictSchedule(ledgerRows, new Date(nowMs));
  const firstReadOn = schedule.firstReadOn;
  const command = buildTodayCommand({
    pipelineAlarms: [],
    smokeAlarm,
    scoreboardDeltaPct,
    topOpportunity: today.nextOpportunities[0] ?? null,
    firstReadOn,
    measuringCount,
  });

  // P1-5 (2026-07-10, visual audit) - the greeting's streak clause must never celebrate ("you
  // are on a roll") directly above the ONE command naming today's biggest problem.
  // commandAllowsCelebration (today-command.ts) suppresses the celebratory clause whenever the
  // command itself is a problem (fix_defect or respond_to_loss) - the streak COUNT still renders
  // (it is real and true), just without the celebratory clause.
  const streakLine =
    streak > 0
      ? ` ${streak} change${streak === 1 ? "" : "s"} shipped in the last 14 days${
          streak >= 10 && commandAllowsCelebration(command.kind) ? ", you are on a roll" : ""
        }.`
      : "";
  // Operator spec 2026-07-09 B-14: no "team" framing - purely functional.
  // The daily-plan picks/minutes brief was removed with the experiments domain
  // (CORE 100K); the header sentence carries the day's summary.
  void picks;
  void minutes;
  const brief = `${dayLine}. ${today.headerSentence}` + streakLine;

  return (
    <div className="space-y-6">
      {/* ── SLOT 1: critical truth warnings, self-hiding ──────────────────────────────────
          A fresh background investigation is the only thing that outranks the one command.
          It self-hides when there is nothing to say, so a normal day starts clean. */}
      {/* Item 53 (Phase 4D fold) - the overnight forensic investigation's ONE headline
          conclusion, folded from its old drawer card into a single compact alert line. */}
      <Suspense fallback={null}><InvestigationAlertLine tenantId={tenantId} /></Suspense>

      {/* The greeting + the one refresh control (page chrome, not a command). */}
      <PageHeader title={greeting} description={brief}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} />
      </PageHeader>

      {/* ── SLOT 2: THE ONE COMMAND ────────────────────────────────────────────────────────
          The single best thing to do now, its evidence, one exact action, and the ONE accent
          CTA above the fold. Subsumes and KILLS the old smoke-alarm card, lead-headline card,
          and the lead of the "What to do next" list, so two "do this" cards never shout at once. */}
      <TodayCommandCard command={command} />

      {/* ── SLOT 3: measuring / results status ─────────────────────────────────────────────
          The scoreboard chart (the ONE place a clicks delta is stated, in its own
          week-over-week window) and the ONE consolidated proof strip (canonical measuring
          count + next-read date + Search Console freshness). */}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-border bg-surface-inset" />}>
        <ScoreboardSection tenantId={tenantId} />
      </Suspense>
      <TodayProofStrip
        measuringCount={measuringCount}
        firstReadOn={firstReadOn}
        firstSettledReadOn={schedule.finalVerdictOn}
        gscThrough={leadStoryDays[leadStoryDays.length - 1]?.date ?? null}
        nowMs={nowMs}
      />
    </div>
  );
}
