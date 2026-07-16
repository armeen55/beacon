export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { PageHeader } from "@/components/data/page-header";
import { loadChangesView, toClientView } from "../changes-data";
import { ChangesListClient } from "../changes-list-client";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { checkedAgoLabel } from "@/components/data/receipt-line";
import { HonestDelay } from "@/components/honest-delay";

/**
 * /changes → the canonical CHANGES list (2026-07-01 consolidation). One object, a CHANGE, across
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
// a Suspense fallback or hold the HTTP stream open forever. The main list only reads a
// durable snapshot now, so it gets a short ceiling; research and rebuilding are never
// permitted to turn navigation into a wait. Self-hiding side sections keep their
// existing fail-soft posture.
const MAIN_LIST_DEADLINE_MS = 5_000;

// Exported for the render pin in changes-empty-vs-building.test.tsx (both empty-state
// copies must stay distinct); the router only consumes the default export below.
export async function ChangesSection() {
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
    // W2-B - distinguish a COLD first-ever render (the SWR snapshot is building in
    // the background) from a genuinely empty list. Never claim "no changes" while
    // the rebuild is still running.
    if (view.surfaceBuilding) {
      return (
        <div className="space-y-2 rounded-2xl border border-border bg-surface-raised p-6">
          <p className="text-body text-foreground-secondary">
            I&apos;m putting your ranked changes together for the first time. This takes a few
            seconds. Refresh in a moment and they&apos;ll be here.
          </p>
          <div className="h-9 animate-pulse rounded-lg bg-surface-inset/50" />
          <div className="h-9 animate-pulse rounded-lg bg-surface-inset/50" />
        </div>
      );
    }
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No changes yet. Once your Google + AI demand data syncs, Beacon&apos;s ranked changes appear here.
      </p>
    );
  }
  // W2-B - honest staleness from the SWR snapshot's real build time (not a frozen
  // "just now" baked into the snapshot). Self-hides on a synchronous/unknown build.
  const rankedAgo = view.surfaceComputedAt ? checkedAgoLabel(view.surfaceComputedAt, Date.now()) : null;
  return (
    <div className="space-y-4">
      {rankedAgo ? (
        <p className="text-meta text-muted-foreground tabular-nums">
          I ranked these {rankedAgo}. I refresh them in the background.
        </p>
      ) : null}
      {/* W2-B PAYLOAD - the client board gets SLIM move summaries only (the full
          dossiers stay server-side in the SWR snapshot; a row's detail loads its
          full TodayMove on demand via loadMoveDetailAction). */}
      <ChangesListClient view={toClientView(view)} />
    </div>
  );
}

/** Content-shaped fallback for the main list: honest copy + row-shaped
 * placeholders instead of one mute gray pulse box. Paired with the 5s deadline
 * above, so it can never strand. */
function ChangesListFallback() {
  return (
    <div className="space-y-2 rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-[12px] text-gray-400">
        Opening your saved ranking.
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
        description="Your ranked execution queue. Beacon keeps the strongest five copy-ready while you work."
      />
      <Suspense fallback={<ChangesListFallback />}>
        <ChangesSection />
      </Suspense>
    </div>
  );
}
