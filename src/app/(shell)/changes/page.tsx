export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireReadyAccount } from "@/domains/account";
import { currentTenantId } from "@/lib/tenant-context";
import { PageHeader } from "@/components/data/page-header";
import { loadChangesView, setAsideHint, type ChangesView } from "../changes-data";
import { ChangesListClient } from "../changes-list-client";
import { ChangesFeed } from "./changes-feed";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { checkedAgoLabel } from "@/components/data/receipt-line";
import { HonestDelay } from "@/components/honest-delay";
import { serverNowMs } from "@/lib/server-clock";
import { buildTopicInvestigations, loadEvidenceSnapshot, loadGscDecaySignalsForTenant, type TopicInvestigation } from "@/domains/evidence";
import { loadProofLedgerCached } from "@/domains/measurement";
import { researchPermission } from "@/domains/runtime";
import { splitLedgerLifecycle } from "@/domains/decision";
import { readCustomerSurface } from "../surface-release";
import { runSingleFlight } from "@/lib/single-flight";

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

/** ONE READ, ONE RETRY, THEN THE HONEST STATE, AND NEVER TWO AT ONCE. A first cold attempt at a GSC-backed read
 *  loses often enough that "your Google search data could not be read" was being printed over a source that
 *  answered fine one second later; the second attempt is warm and usually wins. Two rules keep that retry from
 *  becoming the outage: the retry only fires once the first attempt has actually COMPLETED with a failure, and
 *  the whole thing runs single-flight per loader per account, so a deadline that abandons one request can never
 *  leave two copies of the same read holding two connections. Whoever is waiting joins the run already going.
 *  A read either LANDED or it did not, and the verdict travels with the rows so a lane can say which happened. */
function twice<T>(key: string, tenantId: string, read: () => Promise<T>, empty: T) {
  const attempt = () => read().then((v) => ({ v, read: true }));
  return valueWithDeadline(
    runSingleFlight(`changes-lane:${key}:${tenantId}`, async () => {
      try { return await attempt(); } catch { /* completed, and it failed: now the warm second try is owed */ }
      await new Promise((r) => setTimeout(r, 1_000));
      return attempt().catch(() => ({ v: empty, read: false }));
    }) as Promise<{ v: T; read: boolean }>,
    { v: empty, read: false }, MAIN_LIST_DEADLINE_MS,
  );
}

/** EVERY LANE'S OWN EVIDENCE, loaded once, $0, deadline bounded and fail soft. The research packets come off the
 *  same cached snapshot the producers read, the declining pages off the same decay read Today uses, and the
 *  measuring and results rows off the SAME ledger split the counts come from. */
async function loadLanes(tenantId: string) {
  const [investigations, decayMap, ledger, release, permission] = await Promise.all([
    twice("evidence", tenantId, () => loadEvidenceSnapshot(tenantId).then(buildTopicInvestigations), [] as TopicInvestigation[]),
    twice("decay", tenantId, () => loadGscDecaySignalsForTenant(tenantId, new Date()), new Map()),
    twice("ledger", tenantId, () => loadProofLedgerCached(tenantId), [] as Awaited<ReturnType<typeof loadProofLedgerCached>>),
    valueWithDeadline(
      runSingleFlight(`changes-lane:release:${tenantId}`, () => readCustomerSurface(tenantId)).catch(() => null),
      null, MAIN_LIST_DEADLINE_MS),
    // THE ACCOUNT'S REAL PAUSE SWITCH, read here rather than off the release: no screen may promise a nightly round or work behind the scenes while research is off. Unreadable claims neither way.
    valueWithDeadline(researchPermission(tenantId).catch(() => "unreadable" as const), "unreadable" as const, MAIN_LIST_DEADLINE_MS),
  ]);
  const bands = splitLedgerLifecycle(ledger.v, new Date());
  const today = release?.today?.today;
  return {
    ledgerRead: ledger.read,
    researchPaused: permission === "paused",
    evidenceRead: investigations.read && decayMap.read,
    // Last-known open-lane counts off the release stamp, with their age, for the strip's failed-read fallback.
    staleCounts: release?.laneCounts
      ? { ...release.laneCounts, ago: checkedAgoLabel(release.computedAt, serverNowMs()) }
      : null,
    investigations: investigations.v,
    decay: Array.from((decayMap.v as Map<string, Parameters<typeof ChangesFeed>[0]["decay"][number]>).values()),
    declineNotes: today?.declineNotes ?? [],
    heldForMeasurement: today?.heldForMeasurement ?? 0,
    // A pre 28 day improvement is still in flight, exactly as countLedgerLifecycle counts it.
    measuring: [...bands.measuring, ...bands.promising],
    results: [...bands.won, ...bands.learned],
  };
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
  const lanes = await loadLanes(await currentTenantId()).catch(() => null);
  return (
    <ChangesFeed
      view={view}
      queue={<QueueSlot view={view} researchPaused={lanes?.researchPaused ?? false} />}
      investigations={lanes?.investigations ?? []}
      decay={lanes?.decay ?? []}
      declineNotes={lanes?.declineNotes ?? []}
      measuring={lanes?.measuring ?? []}
      results={lanes?.results ?? []}
      heldForMeasurement={lanes?.heldForMeasurement ?? 0}
      evidenceRead={lanes?.evidenceRead ?? false}
      ledgerRead={lanes?.ledgerRead ?? false}
      researchPaused={lanes?.researchPaused ?? false}
      staleCounts={lanes?.staleCounts ?? null}
    />
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
        description="Every change here carries the exact work to make, ranked by payoff. Make one, mark it done, and the page is measured against pages that were not changed."
      />
      <Suspense fallback={<ChangesListFallback />}>
        <ChangesSection />
      </Suspense>
    </div>
  );
}
