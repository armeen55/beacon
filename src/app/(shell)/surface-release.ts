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
export const CUSTOMER_SURFACE_FRESH_MS = 15 * 60 * 1000;
/** How many judged-but-declined pages one release carries a verdict for. */
const DECLINE_NOTE_LIMIT = 20;

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
};

export async function readCustomerSurface(tenantId: string): Promise<CustomerSurface | null> {
  // A READ THAT FAILED IS NOT AN ABSENT RELEASE. Swallowing it here made every caller see "no release yet",
  // which Today and Changes both paint as a cold start. It THROWS now; each caller decides what that means.
  const rows = await readStore<CustomerSurface>(STORE, [], { tenantId });
  const row = rows[0];
  if (!row || row.schemaVersion !== 2 || row.tenantId !== tenantId || !row.changes || !row.today) return null;
  return row;
}

export async function writeCustomerSurface(surface: CustomerSurface): Promise<void> {
  await writeStore<CustomerSurface>(STORE, [surface], { tenantId: surface.tenantId });
}

/** Soft invalidation: keep the complete prior release visible while the next
 * request rebuilds a replacement. */
export async function invalidateCustomerSurface(tenantId?: string): Promise<void> {
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
    const [{ produceProposalsForTenant }, { buildChangesViewUncached }, { buildTodayCompositeFromChanges }] =
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
    const produced = await produceProposalsForTenant(tenantId);
    if (produced?.outcome === "persistence_failed") {
      throw new Error("I produced changes this pass but could not save a single one, so I kept your last release instead of stamping a new time on work I cannot load back.");
    }
    // ONE RELEASE IDENTITY, minted once and threaded through the ranking stamp, the Changes view and Today.
    // Two ids were minted here and inside the build, so a "show more" could page one ranking while the screen
    // above it named another, and the queue stamp could fail while the publish carried on regardless.
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
    const surface: CustomerSurface = {
      schemaVersion: 2,
      releaseId,
      computedAt,
      tenantId,
      changes,
      today: { ...today, surfaceVersion: releaseId, surfaceComputedAt: computedAt },
    };
    // Atomically publish the one shared release consumed by Today + Changes.
    await writeCustomerSurface(surface);
    return surface;
  }));
}
