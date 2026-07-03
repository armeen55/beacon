export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { DataSourcesStrip, countConnectedDataSources } from "@/components/today/data-sources-strip";
import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";
import { loadTodayV2GateData } from "./today-v2-data";
import { loadTodayView } from "./today-view-data";
import { DailyExperimentsSection } from "./daily-experiments-section";
import { EVIDENCE_LABEL } from "@/domains/changes/canonical-change";
import { currentTenantId } from "@/lib/tenant-context";
import { FrictionFixesSection, AiCrawlerSection, DemandOpportunitiesSection, WarRoomQuietLine } from "./war-room-sections";
import { ScoreboardSection } from "./scoreboard-section";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { buildWeeklyRecap, shippedInLastDays, shippedToday, stillDoubleCheckingCount, weeklyRecapSentence } from "@/domains/proof-gsc/weekly-recap";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";
import { loadLatestStrategyMix } from "@/domains/strategy-review/strategy-mix-store";
import { strategyMemoLine } from "@/domains/strategy-review/surface";
import { TeamStandup } from "./team-standup";
import { CircuitBreakerSection } from "./circuit-breaker-section";
import { TodayNewPagesSection } from "./today-newpages-section";
import { CoverageMapSection } from "./coverage-map-section";
import { OpsPipelineSection } from "./ops-pipeline-section";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { InvestigationSection } from "./investigation-section";
import type { TodayView } from "@/domains/changes/today-view";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
import { selectLeadStory, type LeadStory } from "@/domains/changes/lead-story";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { moveHeadline } from "./daily-experiments-copy";

/**
 * Today `/` - the focused daily slice of the ONE canonical model (2026-07-01, Move 5).
 *
 * Today is no longer a second "what should I do?" surface: it derives from the same
 * CanonicalChange[] that powers /worklist (Changes). Four operational sections - what
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
        <p className="mt-1 text-xs text-muted-foreground">Your data is safe. Refresh in a moment, or open <Link href="/worklist" className="underline">Changes</Link>.</p>
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
  // A2 (operator-experience fix batch, 2026-07-02) - THE canonical "measuring" count: the proof
  // ledger's own verdict field. The team standup chip, the counts tile, and the measuring list
  // heading all read this SAME number now instead of each computing their own (the standup used
  // the ledger, the counts tile used a separately-derived CanonicalChange status - the two could
  // disagree). The measuring list itself still shows its own capped rows, but says "showing N of
  // M" against this canonical M.
  const measuringCount = ledgerRows.filter((r) => r.verdict === "measuring").length;
  // D6 (daily ritual loop) - the daily counter strip's two real numbers, both read from the
  // SAME ledger rows the streak above already loaded. Server truth, never localStorage: the
  // per-session "shipped N today" the worklist keeps client-side is a today-only nice-to-have,
  // this is the number that survives a refresh or a different device.
  const shippedTodayCount = shippedToday(ledgerRows, Date.now());
  const doubleCheckingTodayCount = stillDoubleCheckingCount(ledgerRows, Date.now());

  // Item 42: the assistant sets the scene like a person would.
  const nowPacific = new Date();
  const dayLine = nowPacific.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  const hour = Number(nowPacific.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const activePlan = daily?.dashboard.acceptedPlan ?? daily?.dashboard.previewPlan;
  const picks = activePlan?.selected.length ?? 0;
  const minutes = activePlan?.estimatedMinutes ?? 0;
  const streakLine = streak > 0 ? ` ${streak} change${streak === 1 ? "" : "s"} shipped in the last 14 days${streak >= 10 ? ", you are on a roll" : ""}.` : "";
  const brief =
    (picks > 0
      ? `${dayLine}. The team picked ${picks} change${picks === 1 ? "" : "s"} worth about ${Math.max(minutes, picks)} minutes tonight.`
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

  // UX4 item 1 - the lead story: "what matters most right now" in ONE deterministic card, built
  // ONLY from data already loaded above (the ledger, today.attention, tonight's plan) plus the
  // same 84-day click series the scoreboard reads (react.cache-shared, so this costs nothing
  // extra in this request). Priority: a landed verdict > a fired alert > tonight's top pick > the
  // biggest mover. Any rule with nothing real to say is skipped; the whole card self-hides if
  // every rule comes up empty.
  const tonightFirstPick = activePlan?.selected[0] ?? null;
  const leadStoryDays = await valueWithDeadline(
    loadDailyTotalsForTenant(tenantId, 84).catch(() => [] as Awaited<ReturnType<typeof loadDailyTotalsForTenant>>),
    [],
  );
  const leadStory: LeadStory | null = selectLeadStory({
    ledger: ledgerRows.map((r) => ({ path: r.path, shippedAt: r.shippedAt, verdict: r.verdict, pageLabel: null })),
    attention: today.attention.map((a) => ({ title: a.title, message: a.message, href: a.href })),
    tonightTopPick: tonightFirstPick
      ? { pageLabel: tonightFirstPick.pageLabel, whyNow: tonightFirstPick.whyNow, headline: moveHeadline(tonightFirstPick) }
      : null,
    moverDays: leadStoryDays.map((d) => ({ date: d.date, clicks: d.clicks })),
  });

  return (
    <div className="space-y-6">
      {/* A1 (operator-experience fix batch, 2026-07-02) - the data-pipe alert moves to the very
          TOP of the page when the pipeline is degraded or stale, above the hero and Tonight's
          card, so a broken sync is never buried below numbers that look confident but aren't.
          Self-hides when the pipe is healthy (readPipelineHealth returns null/no violations). */}
      <Suspense fallback={null}><OpsPipelineSection tenantId={tenantId} /></Suspense>
      {/* UX4 item 1 - the lead story sits right after any broken-pipe alert and before the
          greeting, so "what matters most right now" is the very first content block on a
          healthy day. */}
      {leadStory ? <LeadStoryCard story={leadStory} /> : null}
      <PageHeader title={greeting} description={brief}>
        <RefreshMyDataButton connectedCount={connectedSourceCount} />
      </PageHeader>
      <DailyCounterStrip shipped={shippedTodayCount} doubleChecking={doubleCheckingTodayCount} />
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
          (before the team standup) so a paused autopilot is the first thing seen. */}
      <Suspense fallback={null}><CircuitBreakerSection /></Suspense>
      {/* Item 43: the team, at a glance - each teammate's one-line daily report.
          A2 - measuringCount is passed in so the Strategist chip agrees with the counts
          tile and the measuring list below, all reading the ledger's own verdict count. */}
      <Suspense fallback={null}><TeamStandup tenantId={tenantId} picksTonight={picks} measuringCount={measuringCount} /></Suspense>
      <TodayCounts counts={today.counts} measuringCount={measuringCount} />

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

      {today.attention.length > 0 ? <AttentionSection items={today.attention} /> : null}

      {/* Tonight: the team's picks (the daily plan panel). */}
      {daily ? <DailyExperimentsSection view={daily} /> : null}

      {today.measuring.length > 0 ? <MeasuringSection today={today} measuringCount={measuringCount} /> : null}

      {/* THE WAR ROOM (R3, 2026-07-01) - what the team found today, beyond tonight's picks.
          Each band is a live teammate's intelligence: visitor behavior (Clarity), AI crawlers +
          referrals (Profound), market demand you don't own (DataForSEO), and the new-pages board
          (competitor teardowns). All stream in under Suspense, self-hide when empty, fail soft. */}
      <section aria-label="What the team found" className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">What the team found today</h2>
        {/* Item 22 - each band streams in behind a skeleton sized like a real war-room
            card, so the section never flashes blank while a teammate is still loading. */}
        <Suspense fallback={<WarRoomCardSkeleton />}><FrictionFixesSection tenantId={tenantId} /></Suspense>
        <Suspense fallback={<WarRoomCardSkeleton />}><AiCrawlerSection tenantId={tenantId} /></Suspense>
        <Suspense fallback={<WarRoomCardSkeleton />}><DemandOpportunitiesSection tenantId={tenantId} /></Suspense>
        <Suspense fallback={<WarRoomCardSkeleton />}><TodayNewPagesSection limit={3} /></Suspense>
        {/* Item 49 - when every band above stays silent, the war room says so in one quiet
            line instead of leaving a heading over nothing. The presence checks re-call the
            same loaders the sections use; those are react.cache request-memoized (or $0
            cache-only reads), so this re-check costs nothing extra in the same request. */}
        <Suspense fallback={null}><WarRoomQuietLine tenantId={tenantId} /></Suspense>
      </section>

      {/* Item 9 - the topical coverage map: per-topic question coverage joined to AI
          citations. $0 cached reads, self-hides under 3 topics, fails soft to null. */}
      <Suspense fallback={null}><CoverageMapSection tenantId={tenantId} /></Suspense>

      {today.nextOpportunities.length > 0 ? <OpportunitiesSection today={today} /> : null}

      <Suspense fallback={null}><DataSourcesStrip /></Suspense>
    </div>
  );
}

/** Item 22 - a war-room band while it streams: one card-shaped placeholder (rounded-2xl,
 *  ~h-24 like the real cards) so the section holds its shape instead of flashing blank. */
function WarRoomCardSkeleton() {
  return <div aria-hidden className="block h-24 animate-pulse rounded-2xl border border-gray-100 bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900" />;
}

/** UX4 item 1 - "what matters most right now" in ONE card, right after any broken-pipe alert
 *  and before the greeting. Tone maps to a small color language: a win reads green, a miss or
 *  a fired alert reads amber/red, a neutral pick or a rising mover reads the app's default ink. */
const LEAD_STORY_TONE: Record<LeadStory["tone"], string> = {
  good: "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200",
  bad: "border-gray-200 bg-gray-50 text-gray-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200",
  warning: "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200",
  neutral: "border-gray-200 bg-white text-gray-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200",
};
const LEAD_STORY_LINK_TONE: Record<LeadStory["tone"], string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  bad: "text-gray-600 dark:text-neutral-300",
  warning: "text-amber-700 dark:text-amber-300",
  neutral: "text-gray-600 dark:text-neutral-300",
};

function LeadStoryCard({ story }: { story: LeadStory }) {
  return (
    <section
      aria-label="What matters most right now"
      className={`rounded-2xl border px-4 py-3 ${LEAD_STORY_TONE[story.tone]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{story.label}</span>
          <p className="mt-0.5 break-words text-[14px] font-medium leading-relaxed">{story.sentence}</p>
        </div>
        <Link
          href={story.href}
          className={`shrink-0 text-[12px] font-semibold underline underline-offset-2 hover:opacity-80 ${LEAD_STORY_LINK_TONE[story.tone]}`}
        >
          {story.actionLabel} →
        </Link>
      </div>
    </section>
  );
}

/** D6 (daily ritual loop) - "Today you shipped N changes. The app is double-checking M of them."
 *  Server truth: both numbers come from the shipped-change ledger (the same rows the header
 *  streak reads), not the per-session client counter on /worklist. Self-hides on a day with
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

function TodayCounts({ counts, measuringCount }: { counts: TodayView["counts"]; measuringCount: number }) {
  // A2 - the Measuring tile reads the SAME canonical (proof ledger) count as the team
  // standup chip and the measuring list heading, instead of its own CanonicalChange-derived
  // number, so the three widgets never disagree on how many changes are measuring.
  const tiles: { label: string; value: number; cls: string; show: boolean }[] = [
    { label: "Ready today", value: counts.readyToday, cls: "text-sky-700", show: counts.readyToday > 0 },
    { label: "Needs attention", value: counts.needsAttention, cls: "text-amber-700", show: counts.needsAttention > 0 },
    { label: "Measuring", value: measuringCount, cls: "text-emerald-700", show: measuringCount > 0 },
    { label: "Results", value: counts.resultsAvailable, cls: "text-violet-700", show: counts.resultsAvailable > 0 },
  ].filter((t) => t.show);
  if (tiles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
      {tiles.map((t) => (
        <span key={t.label}><span className={`font-semibold ${t.cls}`}>{t.value}</span> {t.label}</span>
      ))}
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
        <Link href="/proof" className="shrink-0 text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700">View all in Results →</Link>
      </div>
    </section>
  );
}

function OpportunitiesSection({ today }: { today: TodayView }) {
  return (
    <section className="space-y-1.5" aria-label="Next opportunities">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">What to do next</h2>
        <Link href="/worklist" className="text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700">View all in Changes →</Link>
      </div>
      <div className="space-y-1.5">
        {today.nextOpportunities.map((o) => (
          <Link key={o.changeId} href="/worklist" className="block rounded-lg border border-gray-100 bg-white px-3 py-2 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
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
