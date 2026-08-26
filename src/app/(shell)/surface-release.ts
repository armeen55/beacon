import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId, runWithTenant } from "@/lib/tenant-context";
import { runSingleFlight } from "@/lib/single-flight";
import { log } from "@/lib/logger";
import { runWithoutSpending } from "@/lib/spend-scope";
import { claimScope, releaseScope } from "@/lib/persistence/json-store";
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
/** THE one page-key rule, so a page written two ways is still one page on both sides of a lookup: host prefix
 *  and one trailing slash removed, percent-encoding decoded (Search Console reports encoded paths where the
 *  account's own records hold the readable form), lowercased, and no length cap. */
const normalizedFixKey = (u: string): string => {
  const path = u.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "") || "/";
  try { return decodeURIComponent(path).toLowerCase(); } catch { return path.toLowerCase(); } };

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
/** One search row the release carries for the Visibility drilldown: the grain Google reports. */
type ReleaseQueryRow = { page: string; query: string; clicks: number; impressions: number; position: number };
/** Bounded projections: enough for the whole Google tab, never the whole store. */
const VISIBILITY_PAGE_CAP = 200, VISIBILITY_QUERIES_PER_PAGE = 5;

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
  /** THE COMPACT SAVED VISIBILITY PROJECTION (Product Truth, operator 2026-08-21). The default Google tab
   *  render reads THIS instead of re-running the split-window aggregates on the request path, which is what
   *  kept timing out: page movement, average-position inputs and the strongest searches, bounded, published
   *  when research or a rebuild already holds the reads warm. Absent when the publish-time read itself
   *  failed: rows nobody could compute are not stamped, and the tab then falls back to one live read. */
  visibility?: { google: { windowNowEnd: string; pages: ReleaseDecayRow[]; queries: ReleaseQueryRow[] } };
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

/** The pass runs inside the no-spend scope, or exactly as it always did. One expression, so the paid and the
 *  free path can never drift apart. */
const runWithoutSpendingIf = <T>(closed: boolean, fn: () => Promise<T>): Promise<T> => (closed ? runWithoutSpending(fn) : fn());
/** Longer than a rebuild takes, short enough that a dispatcher killed mid-build never wedges the account
 *  past the next tick; a finished build releases the hold itself. */
const SURFACE_CLAIM_SECONDS = 300;

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
export async function refreshCustomerSurface(tenantId: string, opts: { maxDrafts?: number } = {}): Promise<CustomerSurface> {
  return runSingleFlight(`customer-surface:${tenantId}`, async () => runWithTenant(tenantId, async () => {
    // TWO DISPATCHERS MUST NOT BOTH REBUILD ONE ACCOUNT, and in-process single flight cannot see another
    // instance: the DATABASE decides who builds, held HERE at the one body every entrance shares, released
    // on the way out so the next legitimate rebuild does not wait out the TTL.
    const hold = await claimScope("surface-claims", tenantId, SURFACE_CLAIM_SECONDS);
    if (hold == null) {
      const held = await readCustomerSurface(tenantId).catch(() => null);
      if (held) return held;
      throw new Error("Another instance is rebuilding this account's surfaces right now. The next visit reads the fresh release.");
    }
    try {
    // THE PAUSE IS DECIDED HERE, ONCE, FOR EVERY DOOR: three of the four callers passed no budget at all, so
    // model spend landed on a paused day (operator, 2026-08-19). A fifth caller added later inherits it.
    // THE PAUSE OUTRANKS THE CALLER: whatever `maxDrafts` was asked for, a paused account drafts nothing.
    // AN UNREADABLE SWITCH COUNTS AS PAUSED, because the expensive assumption is never the safe one.
    const { researchPermission } = await import("@/domains/runtime");
    const permission = await researchPermission(tenantId).catch(() => "unreadable" as const);
    const paused = permission !== "running";
    if (paused) log.info("[surface-release] research is paused, so this release is rebuilt from stored evidence and buys nothing", { tenantId, permission });
    const [{ produceProposalsForTenant, reconcileImplementedWithoutShipment }, { buildChangesViewUncached }, { buildTodayCompositeFromChanges }] =
      await Promise.all([
        import("@/domains/decision"),
        import("./changes-data"),
        import("./today-view-data"),
      ]);
    // PRODUCE first, and A FAILURE HERE PROPAGATES on purpose: swallowing it republished yesterday's
    // proposals behind today's timestamp. No actionable candidate resolves normally (an answer, not an
    // outage); a pass whose every write failed aborts, so the previous release stays byte-identical.
    // THE RELEASE THIS ONE REPLACES, held from before the build. The queue stamp lands inside the build and
    // the blob lands at the end, so a blob write that fails left the NEW order stamped in the database beside
    // the OLD release: "show more" paged a ranking the screen above it did not belong to. Read now, used only
    // on that failure path, so the happy path costs one extra read and nothing else.
    const previous = await readCustomerSurface(tenantId).catch(() => null);
    // `maxDrafts` rides through so a pass can be asked to REGENERATE the queue from stored evidence alone: at 0 the
    // paid drafter never fires, which is how the queue is rebuilt and inspected without spending a cent. Omitted, the
    // producer keeps its own bounded default, so every ordinary visit and every scheduled pass is unchanged.
    // EVERY PAID DOOR CLOSED ON THE STACK, not just the two budgets: the model gateway and the provider call
    // each ask the ambient scope before a client is built, so a path this option never reached still refuses.
    const produced = await runWithoutSpendingIf(paused, () => produceProposalsForTenant(tenantId,
      paused ? { maxDrafts: 0, zeroSpend: true } : opts.maxDrafts === 0 ? { maxDrafts: 0, zeroSpend: true } : opts.maxDrafts === undefined ? {} : { maxDrafts: opts.maxDrafts })); // maxDrafts 0 means REPUBLISH STORED TRUTH: without zeroSpend the "free" rebuild could still buy sixty page readings
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
      // AND A FINISHED READING RETIRES ITS ROW: a settled verdict (won, lost, inconclusive; the lifecycle's own terminal rule) means the
      // change is no longer in flight, so its row stops counting as pending and its page opens for fresh work. Results keeps the verdict.
      await reconcileImplementedWithoutShipment(tenantId,
        new Set(ledger.map((r) => r.proposalId).filter((id): id is string => !!id)), 50,
        new Map(ledger.filter((r) => r.proposalId != null && (r.verdict === "won" || r.verdict === "lost" || r.verdict === "inconclusive"))
          .map((r) => [r.proposalId as string, r.verdict]))).catch(() => []);
    }
    const computedAt = new Date().toISOString();
    const releaseId = `${tenantId}:${computedAt}`;
    const built = await buildChangesViewUncached(tenantId, releaseId);
    // The order rides to the COMMIT, never into the blob: the release stores what renders, and the ranking
    // lives in the rows the same transaction stamps. A build that cannot say its order publishes nothing.
    const { stampRows, ...changes } = built;
    if (!stampRows) throw new Error("the build handed over no ranking, so nothing was published and the previous release keeps serving");
    // The verdicts for pages this pass JUDGED and declined to change, carried into the
    // release so Today can quote the decision for the page it blames instead of a
    // generic "still checking". Biggest measured gap first, bounded: Today quotes at
    // most one, and a release is a blob, not a log.
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
    // THE COMPACT VISIBILITY PROJECTION, published while the reads are already warm here, so the Google tab
    // costs one blob read at render time instead of the split-window aggregates that kept timing out.
    // Fail-soft: a failed read stamps nothing, never stale-and-wrong, and the tab falls back to a live read.
    const { loadGscDecaySignalsForTenant, loadGscPageSignalsForTenant } = await import("@/domains/evidence");
    const [decayRows, pageSignals] = await Promise.all([
      loadGscDecaySignalsForTenant(tenantId, new Date()).then((m) => [...m.values()]).catch(() => null),
      loadGscPageSignalsForTenant(tenantId).catch(() => null),
    ]);
    const visibility = decayRows === null ? {} : { visibility: { google: {
      windowNowEnd: decayRows[0]?.windowNowEnd ?? "",
      pages: [...decayRows]
        .sort((a, b) => b.clicksNow - a.clicksNow).slice(0, VISIBILITY_PAGE_CAP)
        .map((d): ReleaseDecayRow => ({ page: d.page, clicksNow: d.clicksNow, clicksPrior: d.clicksPrior,
          impressionsNow: d.impressionsNow, impressionsPrior: d.impressionsPrior,
          positionNow: d.positionNow, positionPrior: d.positionPrior })),
      queries: [...(pageSignals ? [...pageSignals.entries()] : [])]
        .flatMap(([page, sig]) => (sig.topQueries ?? []).slice(0, VISIBILITY_QUERIES_PER_PAGE)
          .map((q): ReleaseQueryRow => ({ page, query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position }))),
    } } };
    const surface: CustomerSurface = {
      schemaVersion: 2,
      releaseId,
      computedAt,
      tenantId,
      changes,
      today: { ...today, surfaceVersion: releaseId, surfaceComputedAt: computedAt },
      ...visibility,
    };
    // ONE ATOMIC COMMIT (Codex, 2026-08-23). Ranking stamp and surface blob land in ONE database transaction, or
    // neither does: the old stamp-then-write shape had a rollback that never fired, because the blob writer
    // suppressed its own hosted failures, so a failed build could un-rank live rows while the old surface survived.
    // The expected prior release is validated inside the same transaction, and a conflict aborts before any write.
    const { publishCustomerRelease } = await import("@/domains/decision");
    const { slugForTenantId } = await import("@/lib/tenant-context");
    const slug = await slugForTenantId(tenantId);
    await publishCustomerRelease({ tenantId, expectedPrior: previous?.releaseId ?? null, release: releaseId,
      rows: stampRows, scopeKey: `customer-surface::tenant:${slug}`, storeName: "customer-surface", content: surface });
    // The local file mirror is a cache behind the committed row, refreshed best-effort and never load-bearing.
    await writeCustomerSurface(surface).catch(() => undefined);
    return surface;
    } finally {
      // Released with this build's own token: a rebuild that outlived its TTL comes back to somebody else's
      // live hold, and its late release must change nothing.
      await releaseScope("surface-claims", tenantId, hold).catch(() => {});
    }
  }));
}
