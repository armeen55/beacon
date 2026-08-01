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
import { requireReadyAccount } from "@/domains/account";
import { researchRunStatus, researchStatusLine, type ResearchRunStatusView } from "@/domains/runtime";
import { ScoreboardSection } from "./scoreboard-section";
import { loadProofLedgerCached } from "@/domains/measurement";
import { perfMark, perfStage } from "@/lib/obs/perf-log";
import { shippedInLastDays } from "@/domains/measurement";
import { loadLifecycleCounts } from "./lifecycle-counts-data";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { loadDailyTotalsForTenant } from "@/domains/decision";
// Wave 3B (2026-07-10) - Today is MISSION CONTROL: ONE command answers "what is the single
// best thing I should do now?". The command model is a pure selector (domains/today); its card +
// the consolidated proof strip are token-only (src/components/today, outside the (shell) ratchet).
import { buildTodayCommand, commandAllowsCelebration } from "@/domains/measurement";
import { TodayCommandCard } from "@/components/today/today-command-card";
import { TodayProofStrip } from "@/components/today/today-proof-strip";
import { verdictSchedule } from "@/domains/measurement";
import { buildScoreboard } from "@/domains/measurement";
import { buildTodaySmokeAlarm } from "@/components/today/today-smoke-alarm";
import { loadGscDecaySignalsForTenant } from "@/domains/evidence";

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
  // The ONE lifecycle gate: pending resumes onboarding, a failed read renders the
  // bounded retry boundary, and a paused or cancelled account gets one honest
  // notice here instead of a silently normal dashboard.
  const { access } = await requireReadyAccount(await currentTenantId());
  if (access.kind === "suspended") {
    return (
      <div className="max-w-3xl rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
        <p className="text-[13px] font-semibold text-foreground">
          {access.reason === "paused"
            ? "Your account is paused, so I am not researching or drafting changes right now."
            : "This account is closed, so I am not researching or drafting changes."}
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Reply to your welcome email and I will {access.reason === "paused" ? "turn it back on" : "help from there"}.
        </p>
      </div>
    );
  }
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

/** Fail-soft fallback: no run to show. */
const RESEARCH_NONE: ResearchRunStatusView = {
  state: "none",
  phaseLabel: "",
  stepsDone: 0,
  stepsTotal: 7,
  counters: {},
  updatedAt: null,
  completedAt: null,
  pauseReason: null,
};

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
    research,
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
    // The durable Research Run status line (Slice 4). Bounded tight + fail-soft to
    // "none" so it NEVER delays the saved Today snapshot; renders nothing on none.
    valueWithDeadline(researchRunStatus(tenantId).catch(() => RESEARCH_NONE), RESEARCH_NONE, 1500),
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
  // scoreboard card reads. readyFixes comes from the SAME customer release the rest of Today
  // and all of Changes read, so "I have a fix ready" is said only when that release really
  // holds a ready change for that page, and the CTA opens that exact change. It used to be an
  // empty set, so the claim could never be true and the CTA pointed at a dead route. $0-ish
  // read, fail-soft to null (no alarm). It feeds the command; it is not its own card.
  const readyFixes = new Map((today.readyFixes ?? []).map((f) => [f.page, f.proposalId] as const));
  const decayRows = Array.from(
    (decaySignals as Map<string, { page: string; clicksNow: number; clicksPrior: number; windowNowEnd?: string }>).values(),
  );
  const smokeAlarm = buildTodaySmokeAlarm({
    decay: decayRows.map((d) => ({ page: d.page, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior })),
    readyFixes,
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
  // The decision's OWN verdict for the blamed page, when this release judged it and
  // declined to change it. Quoting it beats a generic "still checking": the operator
  // reads why that page is not work today, in the same words Changes would use.
  const declineVerdict = smokeAlarm
    ? (today.declineNotes ?? []).find((n) => n.page === smokeAlarm.pageKey)?.note ?? null
    : null;
  // THE GENUINE BLOCKERS, and nothing else. A blocker is a thing that must be fixed before the
  // numbers on this screen can be trusted; a stale-but-connected source is not one, and neither is
  // a research pass that simply has not finished. Tracked questions at zero is the one state that
  // stops my research outright, and a run that paused with a reason it recorded is the other.
  const blockers = [
    ...(composite.needsTrackedQuestions
      ? ["I am not tracking any questions for you yet, so my research cannot start."]
      : []),
    ...(research.state === "paused" && research.pauseReason ? [research.pauseReason] : []),
  ];
  const command = buildTodayCommand({
    blockers,
    blockerHref: composite.needsTrackedQuestions ? composite.trackedQuestionsHref : undefined,
    smokeAlarm,
    scoreboardDeltaPct,
    // ONE ready change is the act-now state, and the top three ride the card with the ranker's own
    // reason for the order, from the SAME release Changes renders.
    readyChanges: today.nextOpportunities,
    declineVerdict,
    firstReadOn,
    // The same waiting truth the header sentence carries, from the SAME release, so the two can never
    // say "checking" and "waiting until the 4th" on one screen.
    waitingUntil: today.waitingUntil ?? null,
    measuringCount,
    // Straight off the persisted Research Run row: no lease, no cache, no recomputation.
    research: {
      running: research.state === "running",
      phaseLabel: research.phaseLabel,
      ...(typeof research.counters.aiChecksDone === "number" ? { checksDone: research.counters.aiChecksDone } : {}),
      ...(typeof research.counters.aiChecksIntended === "number" ? { checksTotal: research.counters.aiChecksIntended } : {}),
      ...(typeof research.cases?.active === "number" ? { casesActive: research.cases.active } : {}),
      nextDueAt: research.nextDueAt ?? null,
    },
    investigating: today.investigating ?? 0,
    heldForMeasurement: today.heldForMeasurement ?? 0,
  });

  // The greeting's streak clause must never celebrate ("you are on a roll") on a screen that
  // also names a blocker or a page losing clicks. commandAllowsCelebration (today-command.ts)
  // suppresses the clause in both cases; the streak COUNT still renders, because it is true.
  const streakLine =
    streak > 0
      ? ` ${streak} change${streak === 1 ? "" : "s"} shipped in the last 14 days${
          streak >= 10 && commandAllowsCelebration(command) ? ", you are on a roll" : ""
        }.`
      : "";
  // Operator spec 2026-07-09 B-14: no "team" framing - purely functional.
  // The daily-plan picks/minutes brief was removed with the experiments domain
  // (CORE 100K); the header sentence carries the day's summary.
  void picks;
  void minutes;
  const brief = `${dayLine}. ${today.headerSentence}` + streakLine;
  const researchLine = researchStatusLine(research, nowPacific);

  return (
    <div className="space-y-6">
      {/* ── SLOT 1: critical truth warnings, self-hiding ──────────────────────────────────
          A fresh background investigation is the only thing that outranks the one command.
          It self-hides when there is nothing to say, so a normal day starts clean. */}
      {/* The greeting + the one refresh control (page chrome, not a command). */}
      <PageHeader title={greeting} description={brief}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} />
      </PageHeader>
      {/* The durable Research Run status, one honest line under the greeting. Self-hiding:
          nothing to show, nothing rendered. SUPPRESSED WHENEVER A BLOCKER EXISTS, because the
          command below now owns that sentence and its one control, and printing it twice on one
          screen is how two copies of the same claim drift apart. */}
      {researchLine && blockers.length === 0 ? (
        <p className="-mt-2 text-[13px] text-muted-foreground">{researchLine}</p>
      ) : null}

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
