import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId, runWithTenant } from "@/lib/tenant-context";
import { runSingleFlight } from "@/lib/single-flight";
import type { ChangesView } from "./changes-data";
import type { TodayComposite } from "./today-view-data";

/**
 * surface-release (CORE 100K cutover, 2026-07-22) - the atomic Today+Changes
 * customer release and THE one rebuild body. The rebuild now PRODUCES this
 * tenant's ChangeProposals (decision kernel, cold gated drafter) then reads them
 * back into the ranked Changes + Today views. This release is the ONLY persisted
 * snapshot both routes read.
 */

const STORE = "customer-surface";
const CUSTOMER_SURFACE_FRESH_MS = 15 * 60 * 1000;
/** How many judged-but-declined pages one release carries a verdict for. */
const DECLINE_NOTE_LIMIT = 20;

/** One decaying page as the release carries it: the two 28-day windows, six numbers, nothing derived. */
type ReleaseDecayRow = {
  page: string;
  clicksNow: number;
  clicksPrior: number;
  impressionsNow: number;
  impressionsPrior: number;
  positionNow: number;
  positionPrior: number;
};

/** One atomic customer-visible release. Engineering producers may update their
 * own caches independently, but Today and Changes only adopt a new release when
 * every core section below was assembled successfully. */
export type CustomerSurface = {
  schemaVersion: 2;
  releaseId: string;
  computedAt: string;
  tenantId: string;
  changes: ChangesView;
  today: TodayComposite;
  /** The two open-lane counts as of this publish (lane-counts.ts arithmetic), so a Changes visit whose live
   *  evidence read fails can show last-known counts with their age instead of a blank strip. Absent when the
   *  publish-time decay read itself failed: a count nobody computed is not stamped. */
  laneCounts?: { researching: number; watching: number };
  /** THE DECAYING PAGES THIS RELEASE WAS PUBLISHED AGAINST. The publish already computed them, counted them
   *  and threw them away, so every lane visit paid for the same split-window aggregate again to name pages
   *  the release already knew. Carried here CAPPED AT THE WATCHED SET (the only rows a lane serves), so the
   *  lanes read from the release and a live read becomes a refresh rather than the price of admission.
   *  Absent when the publish-time read itself failed: rows nobody could compute are not stamped. */
  laneDecay?: { windowNowEnd: string; rows: ReleaseDecayRow[] };
};

export async function readCustomerSurface(tenantId: string): Promise<CustomerSurface | null> {
  // A READ THAT FAILED IS NOT AN ABSENT RELEASE. Swallowing it here made every caller see "no release yet",
  // which Today and Changes both paint as a cold start. It THROWS now; each caller decides what that means.
  const rows = await readStore<CustomerSurface>(STORE, [], { tenantId });
  const row = rows[0];
  if (!row || row.schemaVersion !== 2 || row.tenantId !== tenantId || !row.changes || !row.today) return null;
  return row;
}

async function writeCustomerSurface(surface: CustomerSurface): Promise<void> {
  await writeStore<CustomerSurface>(STORE, [surface], { tenantId: surface.tenantId });
}

/** Soft invalidation: keep the complete prior release visible while the next
 * request rebuilds a replacement. */
async function invalidateCustomerSurface(tenantId?: string): Promise<void> {
  const id = tenantId ?? await currentTenantId().catch(() => "");
  if (!id) return;
  const existing = await readCustomerSurface(id).catch(() => null);
  if (!existing) return;
  await writeStore<CustomerSurface>(
    STORE,
    [{ ...existing, computedAt: new Date(0).toISOString() }],
    { tenantId: id },
  ).catch(() => {});
}

/**
 * THE one invalidation entry for operator mutations that change what Today or
 * Changes should show (ship / teardown-refresh / accept / settle). Age-stamps
 * both core surface caches - the worklist intermediate and the customer
 * release - so the very next navigation serves the previous ranking instantly
 * and one background rebuild replaces it. Never hard-empties anything; a
 * rebuilding screen after a click is a bug, not a refresh. Fail-soft per store
 * (the dynamic import keeps this module cycle-free at init time).
 */
export async function invalidateCoreSurfaces(tenantId?: string): Promise<void> {
  await invalidateCustomerSurface(tenantId).catch(() => {});
}

export function isCustomerSurfaceStale(computedAt: string, nowMs: number): boolean {
  const t = Date.parse(computedAt);
  return !Number.isFinite(t) || nowMs - t > CUSTOMER_SURFACE_FRESH_MS;
}

/** Build all core customer state first, publish the one versioned release last.
 *  THE one rebuild body for Today + Changes (single-flight key
 *  "customer-surface:{tenantId}"): every stale/cold reader and every warm pass
 *  converges here, so one tenant can never run two concurrent worklist/fuse
 *  builds. Build-then-publish: a failed build throws and the previous release
 *  stays in place. (Builders are imported at call time - this module is a leaf
 *  at init, so the loaders that read the release can import it statically.) */
export async function refreshCustomerSurface(tenantId: string): Promise<CustomerSurface> {
  return runSingleFlight(`customer-surface:${tenantId}`, async () => runWithTenant(tenantId, async () => {
    const [{ produceProposalsForTenant, reconcileImplementedWithoutShipment }, { buildChangesViewUncached }, { buildTodayCompositeFromChanges }] =
      await Promise.all([
        import("@/domains/decision"),
        import("./changes-data"),
        import("./today-view-data"),
      ]);
    // PRODUCE first: the cold, gated, budgeted drafter turns cached evidence into
    // persisted ChangeProposals, so a newly drafted move is Ready in the release we
    // are about to publish. A FAILURE HERE PROPAGATES on purpose. Swallowing it
    // republished yesterday's proposals behind today's timestamp, so the operator
    // read stale work as fresh. Now the throw aborts the publish, the previous
    // release stays exactly as it was, and the phase fails where a human can see it.
    // A clean run that finds NO actionable candidate resolves normally and publishes
    // with zero new proposals: nothing to do is an answer, not an outage.
    //
    // PARTIAL FAILURE IS STILL FAILURE. When every write of this pass failed, the
    // proposals exist only in memory: publishing would stamp a fresh timestamp on a
    // release nobody can load back. That aborts here, so the previous release stays
    // byte-identical and the phase pauses where a human can see it.
    // THE RELEASE THIS ONE REPLACES, held from before the build. The queue stamp lands inside the build and
    // the blob lands at the end, so a blob write that fails left the NEW order stamped in the database beside
    // the OLD release: "show more" paged a ranking the screen above it did not belong to. Read now, used only
    // on that failure path, so the happy path costs one extra read and nothing else.
    const previous = await readCustomerSurface(tenantId).catch(() => null);
    const produced = await produceProposalsForTenant(tenantId);
    if (produced?.outcome === "persistence_failed") {
      throw new Error("This pass produced changes but could not save a single one, so your last release was kept instead of stamping a new time on work that cannot be loaded back.");
    }
    // AND A PASS THAT RAN BLIND PUBLISHES NOTHING. The kernel ends early when a core evidence read did not
    // answer, because judging every page against search data I could not fetch empties the queue rather than
    // updating it. The previous release stays exactly as it was and the phase fails where a human can see it.
    if (produced?.outcome === "evidence_unreadable") {
      throw new Error("Your Google Search Console data could not be read just now, so your last release was kept instead of publishing a list built without it.");
    }
    // ONE RELEASE IDENTITY, minted once and threaded through the ranking stamp, the Changes view and Today.
    // Two ids were minted here and inside the build, so a "show more" could page one ranking while the screen
    // above it named another, and the queue stamp could fail while the publish carried on regardless.
    // THE TRIPWIRE, RUN BEFORE THE LIST IS CUT. A change reads "done" only because a record was written for it
    // first, so a row marked done that no record points at is a change nobody is measuring. It is never left
    // silently done and no record is ever invented for it: it goes back to the queue carrying the one sentence
    // that says what happened, in the very release being built here, so the operator can close it for real. A
    // LEDGER THAT WOULD NOT READ REVERTS NOTHING, because a list nobody could read is not proof of absence.
    // UNCACHED AND TENANT-EXPLICIT: the request-scoped memo was seeded at the START of drafting, so the
    // snapshot here could be minutes stale and a press landing mid-rebuild read as an orphan. And an EMPTY
    // ledger is refused outright: a schema-cache blip falls back to an empty mirror without throwing, and
    // absence of proof is not proof of absence.
    const { loadShippedChangesForTenant } = await import("@/domains/measurement");
    const ledger = await loadShippedChangesForTenant(tenantId).catch(() => null);
    if (ledger && ledger.length > 0) {
      await reconcileImplementedWithoutShipment(tenantId,
        new Set(ledger.map((r) => r.proposalId).filter((id): id is string => !!id))).catch(() => []);
    }
    const computedAt = new Date().toISOString();
    const releaseId = `${tenantId}:${computedAt}`;
    const changes = await buildChangesViewUncached(tenantId, releaseId);
    // The verdicts for pages this pass JUDGED and declined to change, carried into the
    // release so Today can quote the decision for the page it blames instead of a
    // generic "still checking". Biggest measured gap first, bounded: Today quotes at
    // most one, and a release is a blob, not a log.
    const { normalizedFixKey } = await import("@/components/today/today-smoke-alarm");
    const declineNotes = (produced?.candidates ?? [])
      .filter((c) => c.action !== "act_existing_page" && !!c.pageUrl)
      .sort((a, b) => b.recoverableClicks - a.recoverableClicks)
      .slice(0, DECLINE_NOTE_LIMIT)
      .map((c) => ({ page: normalizedFixKey(c.pageUrl as string), note: c.reason }));
    const today = await buildTodayCompositeFromChanges(changes, {
      outcome: produced?.outcome, investigating: produced?.investigating, waitingUntil: produced?.waitingUntil,
      // A draft the store refused because that page already carries a change I am measuring. The
      // store has always answered this; carrying it here is what lets Today say so out loud.
      heldForMeasurement: produced?.heldForMeasurement, declineNotes });
    // The open-lane counts this release can vouch for, off the SAME arithmetic the live strip uses. Fail-soft:
    // a publish never aborts over a fallback count; a failed decay read stamps nothing, never stale-and-wrong.
    const { isWatchedDecay, distinctTopicCount } = await import("./changes/lane-counts");
    const { loadGscDecaySignalsForTenant } = await import("@/domains/evidence");
    const decayRows = await loadGscDecaySignalsForTenant(tenantId, new Date())
      .then((m) => [...m.values()]).catch(() => null);
    const setAsideRow = (changes.basisUnreadable ? 0 : changes.demotedStaleBasis ?? 0) > 0 ? 1 : 0;
    const heldRow = (produced?.heldForMeasurement ?? 0) > 0 ? 1 : 0;
    const watched = (decayRows ?? []).filter(isWatchedDecay);
    const laneCounts = decayRows === null ? {} : { laneCounts: {
      researching: distinctTopicCount((produced?.investigations ?? []).map((i) => i.label)),
      watching: watched.length + setAsideRow + heldRow,
    } };
    // The same rows the count was taken over, biggest fall first, carried instead of discarded.
    const laneDecay = decayRows === null ? {} : { laneDecay: {
      windowNowEnd: watched[0]?.windowNowEnd ?? "",
      rows: [...watched]
        .sort((a, b) => (b.clicksPrior - b.clicksNow) - (a.clicksPrior - a.clicksNow))
        .map((d): ReleaseDecayRow => ({ page: d.page, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior,
          impressionsNow: d.impressionsNow, impressionsPrior: d.impressionsPrior,
          positionNow: d.positionNow, positionPrior: d.positionPrior })),
    } };
    const surface: CustomerSurface = {
      schemaVersion: 2,
      releaseId,
      computedAt,
      tenantId,
      changes,
      today: { ...today, surfaceVersion: releaseId, surfaceComputedAt: computedAt },
      ...laneCounts,
      ...laneDecay,
    };
    // Publish the one shared release consumed by Today + Changes. THE TWO WRITES END TOGETHER OR NOT AT ALL:
    // if the blob does not land, the order stamped a moment ago is rolled back onto the release still serving,
    // so the list always pages the ranking the screen it sits on was published with. The previous release
    // carries one page per lane, so this restores exactly what that release could ever serve; with no previous
    // release the stamp is cleared, and the reader falls back to the release's own page. A restamp that
    // itself fails is swallowed: the publish failure below is the news, and it must not be replaced.
    try { await writeCustomerSurface(surface); }
    catch (publishFailure) {
      const { stampQueueRanking } = await import("@/domains/decision");
      const prior = previous?.changes ?? null;
      await stampQueueRanking(tenantId, prior?.surfaceVersion ?? `${tenantId}:rolled-back`,
        (prior?.ready ?? []).map((p) => p.id), (prior?.toDo ?? []).map((p) => p.id)).catch(() => false);
      throw publishFailure;
    }
    return surface;
  }));
}
