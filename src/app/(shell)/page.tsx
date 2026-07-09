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
import { EVIDENCE_LABEL } from "@/domains/changes/canonical-change";
import { currentTenantId } from "@/lib/tenant-context";
import { FrictionFixesSection, DemandOpportunitiesSection, WarRoomQuietLine } from "./war-room-sections";
import { ScoreboardSection } from "./scoreboard-section";
import { CumulativeOutcomeSection } from "./cumulative-outcome-strip";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { buildWeeklyRecap, shippedInLastDays, shippedToday, stillDoubleCheckingCount, weeklyRecapSentence } from "@/domains/proof-gsc/weekly-recap";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";
import { loadLatestStrategyMix } from "@/domains/strategy-review/strategy-mix-store";
import { strategyMemoLine } from "@/domains/strategy-review/surface";
import { CircuitBreakerSection } from "./circuit-breaker-section";
import { TodayNewPagesSummaryLine } from "./today-newpages-section";
import { loadLifecycleCounts } from "./lifecycle-counts-data";
import { OpsPipelineSection } from "./ops-pipeline-section";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { InvestigationSection } from "./investigation-section";
import type { TodayView } from "@/domains/changes/today-view";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { moveHeadline } from "./daily-experiments-copy";
// P14 (Today dashboard pack) - the four top-of-Today briefing blocks. Pure selectors +
// token-only cards live in my owned src/components/today/**; page.tsx just feeds them data it
// already loaded for its other sections and renders them (each self-hides when its selector
// returns null), so no raw-palette class is added under (shell).
import { buildTodayLeadHeadline, adaptProofRecordForLead } from "@/components/today/today-lead-headline";
import { buildTodaySmokeAlarm } from "@/components/today/today-smoke-alarm";
import { buildTodayGoalPace } from "@/components/today/today-goal-pace";
import { TodayLeadHeadlineCard, TodaySmokeAlarmCard, TodayGoalPaceCard } from "@/components/today/today-briefing";
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
      <div className="h-28 rounded-2xl border border-gray-100 bg-gray-50" />
      <div className="grid gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-gray-100 bg-gray-50" />)}</div>
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

  // UX4 item 6 - the one-click "Update data" control now lives in the page header, not the
  // bottom of the page. Reads the same count the data-sources strip below computes for itself,
  // so the header button and the strip's own affordances never disagree.
  const connectedSourceCount = await valueWithDeadline(
    countConnectedDataSources(tenantId).catch(() => 0),
    0,
  );

  // A1 (operator-experience fix batch, 2026-07-02) - read the pipeline health check once here
  // so both the top-of-page alert AND the hero stat can react to a broken/stale data pipe. $0
  // persisted read, fails soft to null (treated as healthy - never blocks the page).
  const pipelineHealth = await valueWithDeadline(
    readPipelineHealth(tenantId).catch(() => null),
    null,
  );
  const pipelineDegraded = Boolean(pipelineHealth && pipelineHealth.violations.length > 0);
  const pipelineCheckedAt = pipelineHealth?.checked_at ?? null;

  // Items 7 + 8 - the ledger speaks in the header: the 14-day shipping streak, and on Mondays
  // a one-line recap of last week's outcomes. One cached ledger read; fail-soft to silence.
  const ledgerRows = await valueWithDeadline(
    loadProofLedgerCached(tenantId).catch(() => [] as Awaited<ReturnType<typeof loadProofLedgerCached>>),
    [],
  );
  const streak = shippedInLastDays(ledgerRows, Date.now());
  // FP3 (2026-07-02, supersedes A2's verdict-field count) - THE ONE-COUNT RULE: every
  // lifecycle count on this page (the standup chip, the tiles, the measuring strip, the
  // results-ready alert) comes from the shared lifecycle loader, which classifies the
  // SAME request-cached ledger rows with the SAME rule Results uses for its bands. So
  // "16 measuring" here lands on exactly 16 "In flight" rows on Results, and the
  // Results tile equals the decided (Wins + What we learned) total there - never three
  // contradicting answers on three surfaces. Fail-soft to zeros, never blocks the page.
  const lifecycle = await valueWithDeadline(
    loadLifecycleCounts().catch(() => ({ toDo: 0, tonightPicked: 0, tonightApplied: 0, measuring: 0, decided: 0, won: 0 })),
    { toDo: 0, tonightPicked: 0, tonightApplied: 0, measuring: 0, decided: 0, won: 0 },
    // Matches the hero deadline: the ledger inside is request-cache-shared with the
    // reads above (instant), and the loader bounds its own backlog read at 3.5s, so
    // this only bites when things are genuinely wedged.
    TODAY_HERO_DEADLINE_MS,
  );
  const measuringCount = lifecycle.measuring;
  // D6 (daily ritual loop) - the daily counter strip's two real numbers, both read from the
  // SAME ledger rows the streak above already loaded. Server truth, never localStorage: the
  // per-session "shipped N today" the worklist keeps client-side is a today-only nice-to-have,
  // this is the number that survives a refresh or a different device.
  const shippedTodayCount = shippedToday(ledgerRows, Date.now());
  const doubleCheckingTodayCount = stillDoubleCheckingCount(ledgerRows, Date.now());

  // FP3 - the SWR snapshot's "N mature results ready" alert carries a list-derived count
  // computed at snapshot time; rewrite it from the canonical decided count so the alert,
  // the Results tile below, and the Results page it links to always say the same number.
  // Self-drops when nothing is decided.
  const attentionItems = today.attention
    .map((a) =>
      a.kind === "results_ready"
        ? lifecycle.decided > 0
          ? { ...a, title: `${lifecycle.decided} result${lifecycle.decided === 1 ? "" : "s"} ready to review` }
          : null
        : a,
    )
    .filter((a): a is TodayView["attention"][number] => a !== null);

  // Item 42: the assistant sets the scene like a person would.
  const nowPacific = new Date();
  const dayLine = nowPacific.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  const hour = Number(nowPacific.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const activePlan = daily?.dashboard.acceptedPlan ?? daily?.dashboard.previewPlan;
  const picks = activePlan?.selected.length ?? 0;
  const minutes = activePlan?.estimatedMinutes ?? 0;
  const streakLine = streak > 0 ? ` ${streak} change${streak === 1 ? "" : "s"} shipped in the last 14 days${streak >= 10 ? ", you are on a roll" : ""}.` : "";
  // Operator spec 2026-07-09 B-14: no "team" framing - purely functional.
  const brief =
    (picks > 0
      ? `${dayLine}. ${picks} change${picks === 1 ? "" : "s"} ready, about ${Math.max(minutes, picks)} minutes.`
      : `${dayLine}. ${today.headerSentence}`) + streakLine;
  // Item 7 - Monday recap band: last week's outcomes in one sentence, from the ledger.
  const isMonday = nowPacific.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }) === "Monday";
  const recapSentence = isMonday
    ? weeklyRecapSentence(buildWeeklyRecap(ledgerRows.map((r) => ({ shippedAt: r.shippedAt, verdict: r.verdict, path: r.path })), Date.now()))
    : null;
  // Item 27 - the same Monday band gets one honest sentence on forecast accuracy, once at least
  // MIN_SETTLED_FOR_CALIBRATION picks have settled at their 28-day window. Fail-soft: any error
  // here just omits the sentence, never breaks the page.
  const calibrationSentence = isMonday
    ? await valueWithDeadline(
        loadCalibrationRecords(tenantId)
          .then((rows) => {
            const s = summarizeForecastCalibration(rows);
            return s.settledCount >= MIN_SETTLED_FOR_CALIBRATION ? s.sentence : null;
          })
          .catch(() => null),
        null,
      )
    : null;
  // Item 51 - the weekly strategy review's signed memo, Mondays only, self-hides when no
  // fresh (this-or-next-week) mix exists. Fail-soft: any error just omits the line.
  const strategySentence = isMonday
    ? await valueWithDeadline(
        loadLatestStrategyMix(tenantId)
          .then((record) => strategyMemoLine(record, new Date()))
          .catch(() => null),
        null,
      )
    : null;

  // P14 item 1 (v1 459/461) - THE lead headline: the single most important thing today, told as
  // ONE plain line - the biggest win this week PLUS the next move - built ONLY from data already
  // loaded above (the re-measured ledger, today.attention, tonight's plan) plus the same 84-day
  // click series the scoreboard reads (react.cache-shared, so this costs nothing extra). Every
  // clause reuses a number another surface owns; the win-lift comes from each won record's own
  // closed measurement window (adaptProofRecordForLead), so a hard lift number never shows off an
  // open window. Self-hides when both clauses are empty. This is the ONE lead block on Today - it
  // subsumes the earlier single-signal lead card so there are never two "what matters most" widgets.
  const tonightFirstPick = activePlan?.selected[0] ?? null;
  const leadStoryDays = await valueWithDeadline(
    loadDailyTotalsForTenant(tenantId, 84).catch(() => [] as Awaited<ReturnType<typeof loadDailyTotalsForTenant>>),
    [],
  );
  const nowMs = Date.now();
  const leadHeadline = buildTodayLeadHeadline({
    ledger: ledgerRows.map((r) =>
      adaptProofRecordForLead({ path: r.path, pageLabel: null, shippedAt: r.shippedAt, verdict: r.verdict, windows: r.windows }),
    ),
    moverDays: leadStoryDays.map((d) => ({ date: d.date, clicks: d.clicks })),
    nextPick: tonightFirstPick
      ? { pageLabel: tonightFirstPick.pageLabel, headline: moveHeadline(tonightFirstPick) }
      : null,
    topAlert: attentionItems[0] ? { title: attentionItems[0].title, href: attentionItems[0].href } : null,
    nowMs,
  });

  // P14 item 2 (v1 324) - the smoke alarm with page blame: ONE honest line naming the exact page
  // bleeding clicks and the number, from the SAME per-page GSC decay signal the war-room friction
  // band + the GSC scoreboard card read. It deliberately does NOT re-raise the data-pipe alarm
  // (OpsPipelineSection above owns that) - this is the page-blame lane the pipe alert can't fill.
  // pagesWithFixReady = the pages tonight's plan already has a queued change for, so "I have a fix
  // ready" is only said when it is true. Self-hides when no drop clears the floor. $0-ish read,
  // fail-soft to null (no alarm), deadline-bounded like the other page reads.
  const decaySignals = await valueWithDeadline(
    loadGscDecaySignalsForTenant(tenantId, new Date()).catch(() => new Map()),
    new Map(),
    TODAY_HERO_DEADLINE_MS,
  );
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
  const lastSeen = await valueWithDeadline(
    readTodayLastSeen().catch(() => null),
    null,
    TODAY_HERO_DEADLINE_MS,
  );
  const newWonMonthlyClickLift = lastSeen
    ? (() => {
        const seenMs = Date.parse(lastSeen.seenAt);
        if (!Number.isFinite(seenMs)) return null;
        let sum = 0;
        for (const r of ledgerRows) {
          if (r.verdict !== "won") continue;
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
    // At most one green win-with-a-number card per load: if the lead headline already shows the
    // win's clicks-a-month figure, the while-away card says "N won" without a second number.
    suppressWinFigure: Boolean(leadHeadline?.celebratesWinWithFigure),
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
      {/* A1 (operator-experience fix batch, 2026-07-02) - the data-pipe alert moves to the very
          TOP of the page when the pipeline is degraded or stale, above the hero and Tonight's
          card, so a broken sync is never buried below numbers that look confident but aren't.
          Self-hides when the pipe is healthy (readPipelineHealth returns null/no violations). */}
      <Suspense fallback={null}><OpsPipelineSection tenantId={tenantId} /></Suspense>
      {/* P14 item 2 (v1 324) - the smoke alarm with page blame sits right under any broken-pipe
          alert: a specific page bleeding clicks is the next-most-urgent thing after a broken sync.
          Self-hides when no page's real drop clears the floor. */}
      {smokeAlarm ? <TodaySmokeAlarmCard alarm={smokeAlarm} /> : null}
      {/* P14 item 1 (v1 459/461) - THE lead headline: the biggest win this week plus the next
          move, in one plain line, right after the alarms and before the greeting, so "what
          matters most" is the very first content block on a healthy day. */}
      {leadHeadline ? <TodayLeadHeadlineCard headline={leadHeadline} /> : null}
      {/* P21 item 1 (v1 238) - "while you were away": the one honest catch-up line for a
          returning operator, right under the lead headline. Self-hides on a first visit, a
          quick refresh, or a quiet return. Numbers are the SAME canonical counts as the
          tiles and Results, so this can never contradict them. */}
      {whileAway ? <TodayWhileAwayCard summary={whileAway} checkedLine={whileAwayReceipt} /> : null}
      {/* FP8 - THE cumulative outcome strip (same component Results renders): all-time
          shipped/wins, the measured monthly click lift the wins are adding, the honest
          first-verdict date when nothing has settled, and the clearly-labeled dollar
          estimate only when GA4-backed rates exist. Ledger read is request-cache shared. */}
      <Suspense fallback={null}><CumulativeOutcomeSection /></Suspense>
      <PageHeader title={greeting} description={brief}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} />
      </PageHeader>
      <DailyCounterStrip shipped={shippedTodayCount} doubleChecking={doubleCheckingTodayCount} />
      {/* P14 item 3 (v1 329/331) - goal pace + start-my-day: the honest weekly pace read plus the
          20-minute ritual step, right under the day's greeting/counter so "start my day" is the
          first thing after the brief. Self-hides on a fresh empty tenant. */}
      {goalPace ? <TodayGoalPaceCard pace={goalPace} checkedLine={goalPaceReceipt} /> : null}
      {recapSentence ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-2.5 text-[13px] leading-relaxed text-emerald-900 tabular-nums">
          {recapSentence}
        </div>
      ) : null}
      {/* Item 27 - the promise ledger, one sentence, Mondays only, self-hides under 3 settled. */}
      {calibrationSentence ? (
        <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-2.5 text-[13px] leading-relaxed text-sky-900 tabular-nums">
          {calibrationSentence}
        </div>
      ) : null}
      {/* Item 51 - the weekly strategy review's signed memo: what changed in the coming
          week's plan posture and why, Mondays only, self-hides with no fresh mix. */}
      {strategySentence ? (
        <div className="rounded-xl border border-violet-100 bg-violet-50/70 px-4 py-2.5 text-[13px] leading-relaxed text-violet-900 tabular-nums">
          {strategySentence}
        </div>
      ) : null}
      {/* Item 80 - the portfolio circuit breaker: self-hides unless autopilot paused
          itself after consecutive losing batches or too many rollbacks. Mounted high
          so a paused autopilot is the first thing seen. */}
      <Suspense fallback={null}><CircuitBreakerSection /></Suspense>
      {/* Operator spec 2026-07-09 B-9: the team-standup line is KILLED ("corny") until it
          can be rebuilt as the specific evidence chain (B-14). No fake-teammate framing. */}
      <TodayCounts
        readyToday={today.counts.readyToday}
        needsAttention={attentionItems.length}
        measuring={lifecycle.measuring}
        results={lifecycle.decided}
      />

      {/* Item 1-3: THE SCOREBOARD - the line you are trying to move, with your changes on it.
          A1 - when the pipe is degraded, the citations stat below carries an honest
          "numbers last updated <date>" suffix instead of reading as fresh. */}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}>
        <ScoreboardSection tenantId={tenantId} stale={pipelineDegraded} staleCheckedAt={pipelineCheckedAt} />
      </Suspense>

      {/* Item 53 - overnight forensic investigation: when a page family's clicks
          collapsed hard, or a sitewide shift hit, last night's pass diagnosed the
          most likely cause. $0 persisted read, self-hides when nothing fired. */}
      <Suspense fallback={null}><InvestigationSection tenantId={tenantId} /></Suspense>

      {attentionItems.length > 0 ? <AttentionSection items={attentionItems} /> : null}

      {/* 2026-07-08 (operator #1 ask): "Today should show what to DO next, ranked, not what I
          did." The ranked next-moves list is promoted ABOVE tonight's applied recap so the very
          next action is always in view - especially once tonight's batch is applied and only
          measuring (it used to vanish then; see today-view.ts showOpportunities). */}
      {today.nextOpportunities.length > 0 ? <OpportunitiesSection today={today} /> : null}

      {/* Operator spec 2026-07-09 B-7: the "Tonight's plan" batch panel is OFF Today. The
          batch keeps running quietly for measurement; its apply/rollback panel now lives on
          /changes (its one home, next to the backlog). */}

      {/* FP3 - render on the canonical count, not the snapshot's capped list, so the
          strip can never hide while the tiles say changes are measuring. */}
      {measuringCount > 0 ? <MeasuringSection today={today} measuringCount={measuringCount} /> : null}

      {/* Operator spec 2026-07-09 B-9/B-14: no fake-teammate framing; first person. The AI
          crawlers band is KILLED ("don't do shit") and the coverage map is KILLED (rebuild
          from scratch later). Friction + demand stay because they carry real signals. */}
      <section aria-label="What I found today" className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">What I found today</h2>
        {/* Item 22 - each band streams in behind a skeleton sized like a real war-room
            card, so the section never flashes blank while a band is still loading. */}
        <Suspense fallback={<WarRoomCardSkeleton />}><FrictionFixesSection tenantId={tenantId} /></Suspense>
        <Suspense fallback={<WarRoomCardSkeleton />}><DemandOpportunitiesSection tenantId={tenantId} /></Suspense>
        {/* FP5b - the New Pages board's ONE home is /changes; Today gets one honest
            sentence with the same count the board shows, plus the link there. */}
        <Suspense fallback={null}><TodayNewPagesSummaryLine /></Suspense>
        {/* Item 49 - when every band above stays silent, the section says so in one quiet
            line instead of leaving a heading over nothing. The presence checks re-call the
            same loaders the sections use; those are react.cache request-memoized (or $0
            cache-only reads), so this re-check costs nothing extra in the same request. */}
        <Suspense fallback={null}><WarRoomQuietLine tenantId={tenantId} /></Suspense>
      </section>

      <Suspense fallback={null}><DataSourcesStrip /></Suspense>
    </div>
  );
}

/** Item 22 - a war-room band while it streams: one card-shaped placeholder (rounded-2xl,
 *  ~h-24 like the real cards) so the section holds its shape instead of flashing blank. */
function WarRoomCardSkeleton() {
  return <div aria-hidden className="block h-24 animate-pulse rounded-2xl border border-gray-100 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900" />;
}

/** D6 (daily ritual loop) - "Today you shipped N changes. The app is double-checking M of them."
 *  Server truth: both numbers come from the shipped-change ledger (the same rows the header
 *  streak reads), not the per-session client counter on /changes. Self-hides on a day with
 *  nothing shipped yet - a bare "0 shipped" strip every morning would just be noise. */
function DailyCounterStrip({ shipped, doubleChecking }: { shipped: number; doubleChecking: number }) {
  if (shipped === 0) return null;
  const checking = doubleChecking > 0 ? ` I am double-checking ${doubleChecking} of them.` : "";
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-2.5 text-[13px] leading-relaxed text-gray-700 tabular-nums dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300">
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
  // FP3 - every tile value arrives from the shared lifecycle loader (or the remapped
  // attention list built from it), never a second CanonicalChange-derived count, so
  // these tiles, the standup chip, the measuring strip, and Results always agree.
  const tiles: { label: string; value: number; cls: string; show: boolean }[] = [
    { label: "Ready today", value: readyToday, cls: "text-sky-700", show: readyToday > 0 },
    { label: "Needs attention", value: needsAttention, cls: "text-amber-700", show: needsAttention > 0 },
    { label: "Measuring", value: measuring, cls: "text-emerald-700", show: measuring > 0 },
    { label: "Results", value: results, cls: "text-violet-700", show: results > 0 },
  ].filter((t) => t.show);
  if (tiles.length === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
        {tiles.map((t) => (
          <span key={t.label}><span className={`font-semibold ${t.cls}`}>{t.value}</span> {t.label}</span>
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

function AttentionSection({ items }: { items: TodayView["attention"] }) {
  return (
    <section className="space-y-1.5" aria-label="Needs attention">
      <h2 className="text-sm font-semibold text-gray-900">Needs your attention</h2>
      {items.map((a) => (
        <Link key={a.id} href={a.href} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
          <span className="min-w-0">
            <span className="block break-words text-sm font-medium text-amber-900">{a.title}</span>
            <span className="block break-words text-xs text-amber-800/80">{a.message}</span>
          </span>
          <span aria-hidden className="shrink-0 text-amber-700">→</span>
        </Link>
      ))}
    </section>
  );
}

function MeasuringSection({ today, measuringCount }: { today: TodayView; measuringCount: number }) {
  // A3 (2026-07-02) - collapse to one compact strip: count + next-verdicts date + link.
  // Compute the earliest nextCheckpoint across all visible measuring items to show
  // "Next verdicts around [date]". If all items lack a checkpoint, fall back to null.
  const nextCheckpoints = today.measuring
    .map((m) => m.nextCheckpoint)
    .filter((cp): cp is string => cp !== null && cp.length > 0);
  const earliestCheckpoint = nextCheckpoints.length > 0
    ? nextCheckpoints.sort()[0] // ISO dates sort lexicographically
    : null;
  let nextVerdictLine = "";
  if (earliestCheckpoint) {
    const [year, month, day] = earliestCheckpoint.split("-");
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    nextVerdictLine = ` Next verdicts around ${formatted}.`;
  }

  return (
    <section aria-label="Measuring">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2">
        <span className="text-sm text-gray-700">
          <span className="font-semibold text-gray-900">{measuringCount}</span> change{measuringCount === 1 ? "" : "s"} measuring.{nextVerdictLine}
        </span>
        <Link href="/results" className="shrink-0 text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700">View all in Results →</Link>
      </div>
    </section>
  );
}

function OpportunitiesSection({ today }: { today: TodayView }) {
  return (
    <section className="space-y-1.5" aria-label="Next opportunities">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">What to do next</h2>
        <Link href="/changes" className="text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700">View all in Changes →</Link>
      </div>
      <div className="space-y-1.5">
        {today.nextOpportunities.map((o) => (
          <Link key={o.changeId} href="/changes" className="block rounded-lg border border-gray-100 bg-white px-3 py-2 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
            <span className="block break-words text-sm font-semibold text-gray-900">{o.pageLabel}</span>
            <span className="block break-words text-xs text-gray-500">{o.recommendation}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-gray-400">
              <span>{o.opportunityType}</span>
              <span>~{o.estimatedEffortMinutes} min</span>
              <span className={o.evidenceStrength === "strong" ? "text-emerald-600" : o.evidenceStrength === "directional" ? "text-amber-600" : "text-gray-500"}>{EVIDENCE_LABEL[o.evidenceStrength]}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
