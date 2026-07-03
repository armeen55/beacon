export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { TodayNewPagesSection } from "../today-newpages-section";
import { PrepareTonightButton, PrepareOverflowMenu } from "../today-moves-prepare";
import { loadChangesView } from "../changes-data";
import { ChangesListClient } from "../changes-list-client";
import { loadFactoryBatchCardData } from "../page-factory-batch-data";
import { PageFactoryBatchCard } from "../page-factory-batch-card";
import { loadLifecycleCounts } from "../lifecycle-counts-data";
import { TonightSummaryChip } from "../tonight-summary-chip";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";

/**
 * /worklist → the canonical CHANGES list (2026-07-01 consolidation). One object, a CHANGE, across
 * one lifecycle (suggested → ready → apply → verify → measuring → result), shown as one compact
 * list with a strategy control + status views + goal filter. The old per-move rich card is reused
 * on demand (expand a row), not the default view.
 *
 * FP5a (2026-07-02) - tonight's picked-changes cards (DailyExperimentsSection) render ONLY on
 * Today now; this page shows the one-line TonightSummaryChip instead (same FP3 counts, one home
 * per job). FP5b - the New Pages board's single home is HERE; Today shows a one-line summary.
 */

// W2-A (2026-07-02) - FP1 always-paint floor extended to this page: every async section
// body is deadline-bounded so a wedged Supabase read (each 522 is ~30s) can never strand
// a Suspense fallback or hold the HTTP stream open forever. The main list gets a generous
// window (it has an SWR snapshot that normally answers in seconds; a cold rebuild is the
// slow path); the self-hiding side sections time out to null, same as their existing
// fail-soft posture.
const MAIN_LIST_DEADLINE_MS = 25_000;
const SIDE_SECTION_DEADLINE_MS = 15_000;

async function ChangesSection() {
  let view;
  try {
    const raced = await loadWithDeadline(loadChangesView(), MAIN_LIST_DEADLINE_MS);
    if (raced.timedOut) return <HonestDelay />;
    view = raced.data;
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
      {/* B6 (worklist fix batch) - the page header already says what this list is; a second,
          near-identical subtitle here was redundant. Keep just the action row. */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-start">
          <PrepareOverflowMenu readyCount={view.summary.ready} total={view.changes.length} />
          <PrepareTonightButton readyCount={view.summary.ready} total={view.changes.length} />
        </div>
      </div>
      <ChangesListClient view={view} />
    </div>
  );
}

/**
 * FP5a - the ONE line this page shows about tonight's batch. The full panel (cards,
 * paste boxes, apply buttons) lives only on Today; its counts come from the shared FP3
 * lifecycle loader, so this line and Today's own progress bar always agree. Self-hides
 * when nothing is picked; fail-soft + deadline-bounded like every side section here.
 */
async function TonightChip() {
  try {
    const raced = await loadWithDeadline(loadLifecycleCounts(), SIDE_SECTION_DEADLINE_MS);
    if (raced.timedOut) return null;
    return <TonightSummaryChip picked={raced.data.tonightPicked} applied={raced.data.tonightApplied} />;
  } catch {
    return null;
  }
}

/**
 * W2-A - page-level bound for the New Pages board (its ONE home since FP5b), so this
 * page never depends on the shared file staying bounded. The section carries its own
 * inner deadline (FP1 put one on its loader), which normally answers first; this outer
 * race is the belt-and-suspenders floor and times out to null because the board is
 * self-hiding on this page. FP5b - topics already in this week's page-factory batch
 * (the card below, which is further along: drafted + approvable) are excluded so a
 * new-page idea never renders twice on this page.
 */
async function NewPagesBoard() {
  const factoryTopics = await loadWithDeadline(
    loadFactoryBatchCardData()
      .then((d) => (d ? d.items.map((i) => i.title) : []))
      .catch(() => [] as string[]),
    SIDE_SECTION_DEADLINE_MS,
  );
  const raced = await loadWithDeadline(
    TodayNewPagesSection({
      enableAeoBrief: true,
      excludeTopics: factoryTopics.timedOut ? [] : factoryTopics.data,
    }),
    SIDE_SECTION_DEADLINE_MS,
  );
  return raced.timedOut ? null : raced.data;
}

async function PageFactoryBatch() {
  try {
    const raced = await loadWithDeadline(loadFactoryBatchCardData(), SIDE_SECTION_DEADLINE_MS);
    if (raced.timedOut || !raced.data) return null;
    return <PageFactoryBatchCard data={raced.data} />;
  } catch {
    return null; // fail-soft: never block the page on the batch review card
  }
}

/** W2-A - content-shaped fallback for the main list: honest copy + row-shaped
 *  placeholders instead of one mute gray pulse box. Paired with the 25s deadline
 *  above, so it can never strand. */
function ChangesListFallback() {
  return (
    <div className="space-y-2 rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-[12px] text-gray-400">
        Pulling your ranked changes together. This usually takes a few seconds.
      </p>
      <div className="h-9 animate-pulse rounded-lg bg-gray-50" />
      <div className="h-9 animate-pulse rounded-lg bg-gray-50" />
      <div className="h-9 animate-pulse rounded-lg bg-gray-50" />
    </div>
  );
}

export default function WorklistPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Changes"
        description="One list of every change Beacon recommends, across your Google and AI demand, from suggested to measured. Pick a strategy, do the top few, ship."
      />
      <Suspense fallback={null}>
        <TonightChip />
      </Suspense>
      <Suspense fallback={<ChangesListFallback />}>
        <ChangesSection />
      </Suspense>
      <Suspense fallback={null}>
        <NewPagesBoard />
      </Suspense>
      <Suspense fallback={null}>
        <PageFactoryBatch />
      </Suspense>
    </div>
  );
}
