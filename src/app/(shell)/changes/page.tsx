export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { PageHeader } from "@/components/data/page-header";
import { loadChangesView, setAsideHint } from "../changes-data";
import { ChangesListClient } from "../changes-list-client";
import { loadWithDeadline } from "@/lib/load-with-deadline";
import { checkedAgoLabel } from "@/components/data/receipt-line";
import { HonestDelay } from "@/components/honest-delay";
import { serverNowMs } from "@/lib/server-clock";

/** /changes -> the canonical CHANGES list. One object, a CHANGE, across one lifecycle (suggested -> ready ->
 *  apply -> verify -> measuring -> result), shown as one compact list with two lanes. The queue is unlimited
 *  and this screen opens with one page of it; the rest pages in from the database on demand. */

// FP1 always-paint floor: every async section body is deadline-bounded, so a wedged Supabase read can
// never strand a Suspense fallback or hold the HTTP stream open. Rebuilding never turns navigation into a wait.
const MAIN_LIST_DEADLINE_MS = 5_000;

// Exported for the render pin in changes-empty-vs-building.test.tsx (both empty-state
// copies must stay distinct); the router only consumes the default export below.
export async function ChangesSection() {
  const raced = await loadWithDeadline(loadChangesView(), MAIN_LIST_DEADLINE_MS).catch(() => null);
  if (raced == null) {
    return <HonestDelay message="Couldn’t load your saved changes just now. Beacon is retrying automatically." />;
  }
  if (raced.timedOut) return <HonestDelay />;
  const view = raced.data;
  if (view.proposals.length === 0) {
    // W2-B - distinguish a COLD first-ever render (the SWR snapshot is building in
    // the background) from a genuinely empty list. Never claim "no changes" while
    // the rebuild is still running.
    if (view.surfaceBuilding) {
      return (
        <div className="space-y-2 rounded-2xl border border-border bg-surface-raised p-6">
          <HonestDelay message={"I'm putting your ranked changes together for the first time. Beacon is checking again automatically."} />
          <div className="h-9 animate-pulse rounded-lg bg-surface-inset/50" />
          <div className="h-9 animate-pulse rounded-lg bg-surface-inset/50" />
        </div>
      );
    }
    // A queue I emptied MYSELF is a decision, not an empty screen: name the count. A bar
    // I could not READ is not a bar I raised, so that case says what actually happened.
    if (view.demotedStaleBasis > 0) {
      return view.basisUnreadable ? (
        <HonestDelay message="I could not confirm which of your saved ideas still hold just now. Beacon is checking again automatically." />
      ) : (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
          {setAsideHint(view.demotedStaleBasis)}
        </p>
      );
    }
    return (
      <p className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        No changes yet. I am still researching your site, and your ranked changes land here as I finish.{" "}
        <Link href="/settings/connectors" className="underline underline-offset-2">Connecting Google Search Console</Link>{" "}
        gets me there faster.
      </p>
    );
  }
  // W2-B - honest staleness from the SWR snapshot's real build time (not a frozen
  // "just now" baked into the snapshot). Self-hides on a synchronous/unknown build.
  const rankedAgo = view.surfaceComputedAt ? checkedAgoLabel(view.surfaceComputedAt, serverNowMs()) : null;
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
      <ChangesListClient view={view} />
    </div>
  );
}

/** Content-shaped fallback for the main list: honest copy + row-shaped placeholders instead of one mute
 *  pulse box. Paired with the 5s deadline above, so it can never strand. */
function ChangesListFallback() {
  return (
    <div className="space-y-2 rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-[12px] text-gray-400">Opening your saved ranking.</p>
      {[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-50" />)}
    </div>
  );
}

export default async function WorklistPage() {
  const { access } = await requireReadyAccount(await currentTenantId());
  if (access.kind === "suspended") redirect("/");
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Changes"
        description="Your ranked execution queue. An idea moves to Ready only after its exact edit passes evidence and safety checks."
      />
      <Suspense fallback={<ChangesListFallback />}>
        <ChangesSection />
      </Suspense>
    </div>
  );
}
