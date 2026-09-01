export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { PageHeader } from "@/components/data/page-header";
import { loadChangesView, setAsideHint, type ChangesView } from "../changes-data";
import { ChangesListClient } from "../changes-list-client";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { checkedAgoLabel } from "@/components/data/receipt-line";
import { HonestDelay, HonestDelayReset } from "@/components/honest-delay";
import { serverNowMs } from "@/lib/server-clock";
import { researchPermission } from "@/domains/runtime";

/** /changes -> the canonical CHANGES list. One object, a CHANGE, across one lifecycle (suggested -> ready ->
 *  apply -> verify -> measuring -> result), shown as one compact list with two lanes. The queue is unlimited and
 *  this screen opens with one page of it; the rest pages in from the database on demand.
 *  FP1 always-paint floor: every async section body is deadline-bounded, so a wedged Supabase read can never
 *  strand a Suspense fallback or hold the HTTP stream open. */
const MAIN_LIST_DEADLINE_MS = 5_000;

/** THE PAUSE, SAID WHERE THE EMPTY QUEUE IS READ, never only as a drawer label at the bottom. "The next one is
 *  ranked here the moment Beacon has written the exact work" implies work in progress; while research is off
 *  nothing will be written, so the reader gets that fact at the top with the control that turns it back on. Today's
 *  own sentence and link, so the two surfaces cannot drift. */
const PausedLine = ({ paused }: { paused: boolean }) => (!paused ? null : (
  <span data-changes-paused="true"> Research is paused, so no new opportunity is being worked on and nothing new lands here until it is back on.{" "}
    <Link href="/settings" className="font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85">Turn research back on</Link></span>));

/** THE RANKED QUEUE SLOT: the queue, or the honest reason there is nothing in it. The ONLY part of the screen an
 *  empty queue may empty; everything under it renders regardless, because no finished change is never no account. */
function QueueSlot({ view, researchPaused = false }: { view: ChangesView; researchPaused?: boolean }) {
  if (view.proposals.length === 0) {
    // W2-B - a COLD first-ever render (the SWR snapshot is building in the background) is not a genuinely
    // empty list, and "no changes" may never be claimed while the rebuild is still running.
    if (view.surfaceBuilding) {
      return (
        <div className="space-y-2 rounded-2xl border border-border bg-surface-raised p-6">
          <HonestDelay message={"Your ranked changes are being put together for the first time. Beacon is checking again automatically."} />
          <div className="h-9 animate-pulse rounded-lg bg-surface-inset/50" />
          <div className="h-9 animate-pulse rounded-lg bg-surface-inset/50" />
        </div>
      );
    }
    // A bar I could not READ is not a bar I raised, so that case says what actually happened.
    if (view.demotedStaleBasis > 0) {
      return view.basisUnreadable ? (
        <HonestDelay message="Which of your saved ideas still hold could not be confirmed just now. Beacon is checking again automatically." />
      ) : (
        <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
          {setAsideHint()}<PausedLine paused={researchPaused} />
        </p>
      );
    }
    return (
      <p className="rounded-2xl border border-dashed border-border bg-surface-raised p-6 text-[13px] leading-relaxed text-muted-foreground">
        {setAsideHint()}{researchPaused ? <PausedLine paused /> : <>{" "}
          <Link href="/settings/connectors" className="underline underline-offset-2">Connecting Google Search Console</Link>{" "}
          gets you there faster.</>}
      </p>
    );
  }
  // W2-B - honest staleness from the SWR snapshot's real build time. Self-hides on an unknown build.
  const rankedAgo = view.surfaceComputedAt ? checkedAgoLabel(view.surfaceComputedAt, serverNowMs()) : null;
  return (
    <div className="space-y-4">
      {rankedAgo ? (
        <p className="text-meta text-muted-foreground tabular-nums">
          {/* A LIST ALREADY IN HAND BEATS A SPINNER, as long as it says how old it is. */}
          {view.releaseFromMemory
            ? `Showing the list from ${rankedAgo}. Your saved changes did not answer just now, and the fresh one lands as soon as it does.`
            : `Ranked ${rankedAgo}. Refreshes in the background.`}
        </p>
      ) : null}
      <ChangesListClient view={view} />
    </div>
  );
}

// Exported for the render pins in tests/changes (the empty-state copies must stay distinct);
// the router only consumes the default export below.
export async function ChangesSection() {
  const raced = await loadWithDeadline(loadChangesView(), MAIN_LIST_DEADLINE_MS).catch(() => null);
  if (raced == null) {
    return <HonestDelay message="Couldn’t load your saved changes just now. Beacon is retrying automatically." />;
  }
  if (raced.timedOut) return <HonestDelay />;
  const view = raced.data;
  // A RELEASE I COULD NOT READ IS NOT AN EMPTY QUEUE AND NOT A FIRST-EVER LOAD.
  if (view.proposals.length === 0 && view.releaseUnreadable) {
    return <HonestDelay message="Your saved changes could not be read just now, so no empty list is shown. Beacon is checking again automatically." />;
  }
  // ONE cheap read beside the release: the account's real pause switch, so no sentence here promises work
  // while research is off. The measurement ledger and the watched pages left this screen entirely (operator,
  // 2026-08-21): Results owns that information, and Changes points at it with one compact line.
  const permission = await valueWithDeadline(researchPermission(await currentTenantId()).catch(() => "unreadable" as const), "unreadable" as const, MAIN_LIST_DEADLINE_MS);
  const paused = permission === "paused";
  return (
    <div className="space-y-4">
      <HonestDelayReset />{/* a successful render forgives the path's past delays, so the next hiccup starts calm */}
      <QueueSlot view={view} researchPaused={paused} />
      {paused && view.proposals.length > 0 ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground"><PausedLine paused /></p>
      ) : null}
    </div>
  );
}

/** Content-shaped fallback for the main list, paired with the 5s deadline above so it can never strand. */
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
      {/* THE HEADING HAS TO BE TRUE OF EVERY ROW UNDER IT. "Every edit ready to make" was printed over cards telling the
          operator to go and write the edit, so it says what the queue now guarantees. Unfinished work is counted, never ranked. */}
      <PageHeader
        title="Changes"
        description="Finished changes first, each with the exact work to make. Drafts waiting on you and the research Beacon is still finishing are labeled below them. Make a change, mark it done, and the page is measured."
      />
      <Suspense fallback={<ChangesListFallback />}>
        <ChangesSection />
      </Suspense>
    </div>
  );
}
