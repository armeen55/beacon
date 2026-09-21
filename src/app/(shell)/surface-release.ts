import { createHash } from "node:crypto";
import "server-only";

import { readStore } from "@/lib/persistence/json-store";
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
  /** WHAT THIS RELEASE ACTUALLY SAYS, with every clock stripped: the ranked order plus the rendered content.
   *  A rebuild that lands on the same material republishes nothing, so a queue nobody has new evidence for
   *  stops moving under the operator while they are reading it. Absent on releases published before this. */
  material?: string;
  tenantId: string;
  /** Complete ranked membership committed from this JSON by the release RPC. Optional only for historical releases. */
  manifest?: ReadonlyArray<{ id: string; lane: "ready" | "todo" | "research" }>;
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
  if (process.env.DATA_SOURCE === "file" && process.env.VERCEL !== "1") return;
  const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
  const { data, error } = await getSupabaseAdmin().rpc("set_customer_surface_freshness", {
    p_tenant_id: surface.tenantId,
    p_expected_release: surface.releaseId,
    p_computed_at: new Date(surface.computedAt).toISOString(),
  });
  if (error) throw new Error(`the customer release freshness could not be saved: ${error.message}`);
  if (data !== true) throw new Error("the customer release changed before its freshness could be saved");
  await readStore<CustomerSurface>(STORE, [], { tenantId: surface.tenantId, forceRefresh: true });
}

/** Soft invalidation: keep the complete prior release visible while the next
 * request rebuilds a replacement. */
async function invalidateCustomerSurface(tenantId?: string): Promise<void> {
  const id = tenantId ?? await currentTenantId().catch(() => "");
  if (!id) return;
  const existing = await readCustomerSurface(id).catch(() => null);
  if (!existing) return;
  await writeCustomerSurface({ ...existing, computedAt: new Date(0).toISOString() }).catch(() => {});
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
/** WHAT A RELEASE SAYS, WITHOUT ANY CLOCK IN IT. The ranked order is the first thing an operator reads, so it
 *  is first here; the rendered content follows. Anything that moves on its own every second (the release id,
 *  the computed instant, the "ranked N minutes ago" line) is dropped, because none of it is a thing anybody
 *  learned. Cheap and total: a real change to any card, count or position lands in this string. */
function materialOf(rows: ReadonlyArray<{ id: string; lane: string }>, changes: unknown, today: unknown): string {
  // `createdAt` and `decidedAt` are on this list because the STORE's own identity already excludes them: a
  // producer re-derives both on every pass for work nobody changed, so they mark the clock and never the work.
  const clocks = /^(surfaceVersion|surfaceComputedAt|receiptLine|computedAt|releaseId|checkedAt|rankedAt|createdAt|decidedAt)$/;
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !clocks.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)]))
      : v;
  return createHash("sha256").update(JSON.stringify([rows.map((r) => `${r.id}:${r.lane}`), stable(changes), stable(today)])).digest("hex").slice(0, 32);
}

export async function refreshCustomerSurface(tenantId: string, opts: { maxDrafts?: number } = {}): Promise<CustomerSurface> {
  return runSingleFlight(`customer-surface:${tenantId}`, async () => runWithTenant(tenantId, async () => {
    // The database claim prevents cross-instance rebuilds; single flight covers this process.
    const hold = await claimScope("surface-claims", tenantId, SURFACE_CLAIM_SECONDS);
    if (hold == null) {
      const held = await readCustomerSurface(tenantId).catch(() => null);
      if (held) return held;
      throw new Error("Another instance is rebuilding this account's surfaces right now. The next visit reads the fresh release.");
    }
    try {
    // A pause or unreadable switch outranks every caller budget.
    const { researchPermission } = await import("@/domains/runtime");
    const permission = await researchPermission(tenantId).catch(() => "unreadable" as const);
    const paused = permission !== "running";
    if (paused) log.info("[surface-release] research is paused, so this release is rebuilt from stored evidence and buys nothing", { tenantId, permission });
    const rebuildOnly = paused || opts.maxDrafts === 0;
    const build = async (): Promise<CustomerSurface> => {
    const [{ produceProposalsForTenant, reconcileImplementedWithoutShipment }, { buildChangesViewUncached }, { buildTodayCompositeFromChanges }] =
      await Promise.all([
        import("@/domains/decision"),
        import("./changes-data"),
        import("./today-view-data"),
      ]);
    // Hold the prior release so a failed or unchanged build cannot stamp over it.
    const previous = await readCustomerSurface(tenantId).catch(() => null);
    // A stored-only release does not enter the producer at all. Calling it with a zero budget still re-minted
    // deterministic candidates, so clearing old rows could recreate the same retired work while "paused".
    const produced = rebuildOnly ? null : await produceProposalsForTenant(tenantId,
      opts.maxDrafts === undefined ? { deliveryScope: "existing_page_edits" } : { maxDrafts: opts.maxDrafts, deliveryScope: "existing_page_edits" });
    if (produced?.outcome === "persistence_failed") {
      throw new Error("This pass produced changes but could not save a single one, so your last release was kept instead of stamping a new time on work that cannot be loaded back.");
    }
    if (produced?.outcome === "evidence_unreadable") {
      throw new Error("Your Google Search Console data could not be read just now, so your last release was kept instead of publishing a list built without it.");
    }
    const { loadShippedChangesForTenant } = await import("@/domains/measurement");
    const ledger = await loadShippedChangesForTenant(tenantId).catch(() => null);
    if (ledger && ledger.length > 0) {
      await reconcileImplementedWithoutShipment(tenantId,
        new Set(ledger.map((r) => r.proposalId).filter((id): id is string => !!id)), 200,
        new Map(ledger.filter((r) => r.proposalId != null && (r.verdict === "won" || r.verdict === "lost" || r.verdict === "inconclusive"))
          .map((r) => [r.proposalId as string, r.verdict]))).catch(() => []);
    }
    const computedAt = new Date().toISOString();
    const releaseId = `${tenantId}:${computedAt}`;
    const built = await buildChangesViewUncached(tenantId, releaseId);
    const { stampRows, ...changes } = built;
    if (!stampRows) throw new Error("the build handed over no ranking, so nothing was published and the previous release keeps serving");
    const today = await buildTodayCompositeFromChanges(changes, { waitingUntil: produced?.waitingUntil });
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
      material: materialOf(stampRows, changes, today),
      tenantId,
      manifest: stampRows,
      changes,
      today: { ...today, surfaceVersion: releaseId, surfaceComputedAt: computedAt },
      ...visibility,
    };
    // ONE ATOMIC COMMIT (Codex, 2026-08-23). Ranking stamp and surface blob land in ONE database transaction, or
    // neither does: the old stamp-then-write shape had a rollback that never fired, because the blob writer
    // suppressed its own hosted failures, so a failed build could un-rank live rows while the old surface survived.
    // The expected prior release is validated inside the same transaction, and a conflict aborts before any write.
    // A REBUILD THAT LEARNED NOTHING PUBLISHES NOTHING. Every visit used to restamp the whole ranking and mint a
    // new release id, so three presses in three minutes wrote 13 proposal rows each and produced three
    // releases while no evidence had moved. That is the operator's queue shifting under them as they read it,
    // and writes the database is asked for that teach nobody anything. The clocks are stripped, because a
    // timestamp is not something the operator learned.
    if (previous?.material && previous.material === surface.material) {
      // THE CLOCK STILL MOVES, EVEN THOUGH NOTHING ELSE DOES. Returning the stored blob untouched froze
      // `computedAt` at the last release that differed, and staleness is measured off exactly that field, so
      // `isCustomerSurfaceStale` became permanently true: every visit scheduled another full rebuild (produce,
      // build, both GSC reads) only to discard it here, while Changes told the operator "Ranked 3 days ago"
      // about a queue being re-derived on every page load. The ranking stamp, the release id and every
      // proposal row are left exactly as they are; only the instant this was last confirmed moves.
      const confirmed: CustomerSurface = { ...previous, computedAt, today: { ...previous.today, surfaceComputedAt: computedAt } };
      await writeCustomerSurface(confirmed);
      log.info("[surface-release] nothing this release would say has changed, so the ranking and the blob are left as they are", { tenantId, release: previous.releaseId });
      return confirmed;
    }
    const { publishCustomerRelease } = await import("@/domains/decision");
    const { slugForTenantId } = await import("@/lib/tenant-context");
    const slug = await slugForTenantId(tenantId);
    await publishCustomerRelease({ tenantId, expectedPrior: previous?.releaseId ?? null, release: releaseId,
      scopeKey: `customer-surface::tenant:${slug}`, storeName: "customer-surface", content: surface });
    // Replace any warm pre-publication copy with the row the transaction just committed. Local file-mode reads
    // remain supported by readStore, but no generic blob writer can mutate this release.
    await readStore<CustomerSurface>(STORE, [], { tenantId, forceRefresh: true }).catch(() => undefined);
    return surface;
    };
    return rebuildOnly ? runWithoutSpending(build) : build();
    } finally {
      // Released with this build's own token: a rebuild that outlived its TTL comes back to somebody else's
      // live hold, and its late release must change nothing.
      await releaseScope("surface-claims", tenantId, hold).catch(() => {});
    }
  }));
}
