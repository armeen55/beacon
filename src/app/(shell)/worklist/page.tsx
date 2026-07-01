export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { TodayNewPagesSection } from "../today-newpages-section";
import { PrepareTopMovesButton, RegenerateFromTeardownButton, EnrichResearchButton } from "../today-moves-prepare";
import { loadDailyExperimentsView } from "../daily-experiments-data";
import { DailyExperimentsSection } from "../daily-experiments-section";
import { loadChangesView } from "../changes-data";
import { ChangesListClient } from "../changes-list-client";

/**
 * /worklist → the canonical CHANGES list (2026-07-01 consolidation). One object — a CHANGE — across
 * one lifecycle (suggested → ready → apply → verify → measuring → result), shown as one compact
 * list with a strategy control + status views + goal filter. Today's selected batch (the Daily
 * experiments panel) is the "Ready/Today" slice of this same list, not a competing surface; New Pages
 * board below. The old per-move rich card is reused on demand (expand a row), not the default view.
 */

async function ChangesSection() {
  let view;
  try {
    view = await loadChangesView();
  } catch {
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Couldn&apos;t load your changes just now. Refresh in a moment.
      </p>
    );
  }
  if (view.changes.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No changes yet. Once your Google + AI demand data syncs, Beacon&apos;s ranked changes appear here.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">Everything to do, ranked. Pick a strategy and work top-down, and Beacon measures each change after you ship it.</p>
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-start">
          <RegenerateFromTeardownButton />
          <EnrichResearchButton />
          <PrepareTopMovesButton readyCount={view.summary.ready} total={view.changes.length} />
        </div>
      </div>
      <ChangesListClient view={view} />
    </div>
  );
}

async function DailyExperiments() {
  try {
    const view = await loadDailyExperimentsView();
    return <DailyExperimentsSection view={view} />;
  } catch {
    return null; // fail-soft: never block the page on the Today panel
  }
}

export default function WorklistPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Changes"
        description="One list of every change Beacon recommends, across your Google and AI demand, from suggested to measured. Pick a strategy, do the top few, ship."
      />
      <Suspense fallback={null}>
        <DailyExperiments />
      </Suspense>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />}>
        <ChangesSection />
      </Suspense>
      <Suspense fallback={null}>
        <TodayNewPagesSection enableAeoBrief />
      </Suspense>
    </div>
  );
}
