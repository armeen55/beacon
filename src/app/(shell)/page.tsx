export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";

import { PageHeader } from "@/components/data/page-header";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { DataSourcesStrip } from "@/components/today/data-sources-strip";
import { loadTodayV2GateData } from "./today-v2-data";
import { loadTodayCockpit, type TodayCockpit } from "@/domains/action-pack/load-today-cockpit";
import { MoveCard } from "./today-moves-card";
import { TodayNewPagesSection } from "./today-newpages-section";
import {
  TodayV2ExperimentsMeasuringSection,
  TodayV2ProvenResultsSection,
} from "./today-v2-sections";

/**
 * Today `/` — the ActionPack cockpit (2026-06-27 rebuild).
 *
 * Collapsed from the 20+-section "research museum" into one simple surface driven
 * by the canonical ActionPack brain: the 3 things to do now (rich cards), the
 * bigger-list headline (→ /moves), the New Pages board, source + proof status.
 * No visibility-score hero, no brand-SoV, no per-lens dashboard sprawl, no flags.
 * Read-only; ActionPack reads cached/durable data (no live Profound/DataForSEO).
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const notice = (await searchParams).notice;
  return (
    <div className="max-w-5xl space-y-6">
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
      <p className="font-medium text-foreground">You&apos;ve already finished setup — here&apos;s your workspace.</p>
      <p className="mt-1 text-muted-foreground">
        Setup is a one-time step. To change your business details, service area, or competitors, head to{" "}
        <Link href="/settings/config" className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

function CockpitSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-20 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />
        ))}
      </div>
    </div>
  );
}

function StatTile({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
      <span className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

async function Cockpit() {
  const gate = await loadTodayV2GateData();

  if (gate.isDemoMode) {
    return (
      <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
          Connect your data sources to see your command center
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Connect Google Search Console (plus GA4, Profound, or Clarity) and refresh to see your ranked moves.
          Three steps: 1. Connect your sources → 2. Refresh → 3. Review your moves.
        </p>
        <Link
          href="/settings/connectors"
          className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          Connect data sources →
        </Link>
      </div>
    );
  }

  if (gate.firstReading.isFirstReading) {
    return <FirstReadingWaiting context={gate.firstReading.context} />;
  }

  let c: TodayCockpit;
  try {
    c = await loadTodayCockpit();
  } catch {
    c = {
      topThree: [], biggestOpportunities: { totalMoves: 0, demandAtStake: 0, citationsContested: 0 },
      newPagesCount: 0, preparedMovesCount: 0, aiValidatedCount: 0,
      sourceCoverage: { rank_revenue: 0, profound: 0, dataforseo: 0, gsc: 0, ga4: 0, clarity: 0, competitor_teardown: 0 },
      proofStatus: { measuring: 0, won: 0, lost: 0, headline: null }, warnings: ["Cockpit failed to load — retry or check connectors."],
    };
  }

  const opp = c.biggestOpportunities;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description="The 3 things to do now — ranked across your Google + AI demand by the one ranked brain. The full list lives on Moves."
      />

      {c.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <ul className="ml-4 list-disc">{c.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={String(opp.totalMoves)} label="Moves ranked" accent="text-gray-900" />
        <StatTile value={fmtNum(opp.demandAtStake)} label="Monthly demand at stake" accent="text-sky-600" />
        <StatTile value={String(opp.citationsContested)} label="AI citations to win" accent="text-violet-600" />
        {c.preparedMovesCount > 0 ? (
          <StatTile value={String(c.preparedMovesCount)} label="Drafts ready" accent="text-emerald-600" />
        ) : (
          <StatTile value={String(c.aiValidatedCount)} label="AI-validated" accent="text-emerald-600" />
        )}
      </div>

      {c.proofStatus.headline ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {c.proofStatus.headline}
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Do these first</h2>
        {c.topThree.length > 0 ? (
          <div className="grid gap-3">
            {c.topThree.map((m, i) => <MoveCard key={m.id} m={m} rank={i + 1} />)}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            No ranked moves yet. Connect + refresh your sources and they&apos;ll appear here.
          </p>
        )}
        {opp.totalMoves > 3 ? (
          <Link
            href="/moves"
            className="inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            See all {opp.totalMoves} moves →
          </Link>
        ) : null}
      </section>

      {/* New Pages to build (create/coverage half of the brain) — AI-validated badges
          + Draft AEO brief live here. */}
      <Suspense fallback={null}>
        <TodayNewPagesSection enableAeoBrief />
      </Suspense>

      {/* Proof status — what's measuring + what's proven. */}
      <Suspense fallback={null}>
        <TodayV2ExperimentsMeasuringSection />
      </Suspense>
      <Suspense fallback={null}>
        <TodayV2ProvenResultsSection />
      </Suspense>

      {/* Data source / connect status (self-hides when all sources connect). */}
      <Suspense fallback={null}>
        <DataSourcesStrip />
      </Suspense>
    </div>
  );
}
