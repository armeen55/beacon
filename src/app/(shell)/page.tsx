export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { DataSourcesStrip } from "@/components/today/data-sources-strip";
import { loadTodayV2GateData } from "./today-v2-data";
import { loadTodayView } from "./today-view-data";
import { DailyExperimentsSection } from "./daily-experiments-section";
import { EVIDENCE_LABEL } from "@/domains/changes/canonical-change";
import { currentTenantId } from "@/lib/tenant-context";
import { FrictionFixesSection, AiCrawlerSection, DemandOpportunitiesSection, WarRoomQuietLine } from "./war-room-sections";
import { ScoreboardSection } from "./scoreboard-section";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { buildWeeklyRecap, shippedInLastDays, weeklyRecapSentence } from "@/domains/proof-gsc/weekly-recap";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";
import { loadLatestStrategyMix } from "@/domains/strategy-review/strategy-mix-store";
import { strategyMemoLine } from "@/domains/strategy-review/surface";
import { TeamStandup } from "./team-standup";
import { TodayNewPagesSection } from "./today-newpages-section";
import { CoverageMapSection } from "./coverage-map-section";
import { OpsPipelineSection } from "./ops-pipeline-section";
import type { TodayView } from "@/domains/changes/today-view";
import { createPerfTrace, readPerfTraceIdFromHeaders } from "@/lib/perf-trace";

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

async function renderCockpit(trace: ReturnType<typeof createPerfTrace>) {
  const gate = await trace.time("loadTodayV2GateData", () => loadTodayV2GateData());

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
    composite = await trace.time("loadTodayView", () => loadTodayView());
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

  // Items 7 + 8 - the ledger speaks in the header: the 14-day shipping streak, and on Mondays
  // a one-line recap of last week's outcomes. One cached ledger read; fail-soft to silence.
  const ledgerRows = await loadProofLedgerCached(tenantId).catch(() => []);
  const streak = shippedInLastDays(ledgerRows, Date.now());

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
    ? await loadCalibrationRecords(tenantId)
        .then((rows) => {
          const s = summarizeForecastCalibration(rows);
          return s.settledCount >= MIN_SETTLED_FOR_CALIBRATION ? s.sentence : null;
        })
        .catch(() => null)
    : null;
  // Item 51 - the weekly strategy review's signed memo, Mondays only, self-hides when no
  // fresh (this-or-next-week) mix exists. Fail-soft: any error just omits the line.
  const strategySentence = isMonday
    ? await loadLatestStrategyMix(tenantId)
        .then((record) => strategyMemoLine(record, new Date()))
        .catch(() => null)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader title={greeting} description={brief} />
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
      {/* Item 43: the team, at a glance - each teammate's one-line daily report. */}
      <Suspense fallback={null}><TeamStandup tenantId={tenantId} picksTonight={picks} /></Suspense>
      <TodayCounts counts={today.counts} />

      {/* Item 1-3: THE SCOREBOARD - the line you are trying to move, with your changes on it. */}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}>
        <ScoreboardSection tenantId={tenantId} />
      </Suspense>

      {/* Item 10 - the Ops pipeline watchdog: red items naming the exact broken data-pipe
          stage from last night's invariant check. $0 persisted read, self-hides when clean. */}
      <Suspense fallback={null}><OpsPipelineSection tenantId={tenantId} /></Suspense>

      {today.attention.length > 0 ? <AttentionSection items={today.attention} /> : null}

      {/* Tonight: the team's picks (the daily plan panel). */}
      {daily ? <DailyExperimentsSection view={daily} /> : null}

      {today.measuring.length > 0 ? <MeasuringSection today={today} /> : null}

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

function TodayCounts({ counts }: { counts: TodayView["counts"] }) {
  const tiles: { label: string; value: number; cls: string; show: boolean }[] = [
    { label: "Ready today", value: counts.readyToday, cls: "text-sky-700", show: counts.readyToday > 0 },
    { label: "Needs attention", value: counts.needsAttention, cls: "text-amber-700", show: counts.needsAttention > 0 },
    { label: "Measuring", value: counts.measuring, cls: "text-emerald-700", show: counts.measuring > 0 },
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

function MeasuringSection({ today }: { today: TodayView }) {
  return (
    <section className="space-y-1.5" aria-label="Measuring">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Measuring</h2>
        <Link href="/proof" className="text-xs font-medium text-gray-500 underline underline-offset-2 hover:text-gray-700">View all in Results →</Link>
      </div>
      <div className="space-y-1.5">
        {today.measuring.map((m) => (
          <div key={m.changeId} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 break-words text-sm font-medium text-gray-800">{m.pageLabel}</span>
              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Measuring</span>
            </div>
            <div className="mt-0.5 break-words text-xs text-gray-500">
              {m.headline}
              {m.nextCheckpoint ? <span className="text-gray-400"> · next read {m.nextCheckpoint}</span> : null}
              {m.attributionLimited ? <span className="text-amber-600"> · overlapping edit</span> : null}
            </div>
          </div>
        ))}
      </div>
      {today.counts.measuring > today.measuring.length ? (
        <p className="text-[11px] text-gray-400">Showing {today.measuring.length} of {today.counts.measuring} measuring.</p>
      ) : null}
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
