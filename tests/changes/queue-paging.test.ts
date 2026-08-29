/** THE RANKED QUEUE IS UNLIMITED AND IT PAGES IN THE DATABASE (blocker 3). 501 current changes are seeded as the store's own rows and stamped by the real ranking writer; the list then hands over every one exactly once, each request reads ONE bounded page and never the queue or the release blob, a ranking replaced underneath the operator restarts honestly, a retired or already-implemented row never reaches a pre-ship lane, the canonical current read is no longer capped at 500, and Today still takes only three. the lane riding beside each id, and lands the surface blob. An error leaves EVERY half untouched. The database's side of the release: one transaction that validates the expected prior (null means "no release on file", exactly like the live plpgsql), clears this account, stamps ONE global ordinality with */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
const db = vi.hoisted(() => ({ rows: [] as Row[], legacy: [] as Row[], reads: [] as number[], basis: "b1" as string | null, stampFails: false }));
const client: Record<string, unknown> = {
  rpc(name: string, a: { p_tenant_id: string; p_release: string; p_ids: string[]; p_lanes: string[]; p_expected_prior?: string | null; p_content?: unknown[] }) {
    if (db.stampFails) return Promise.resolve({ data: null, error: { message: "the ranking did not stamp" } });
    if (name === "publish_customer_release") {
      const prior = (blob.stored as { releaseId?: string } | null)?.releaseId ?? null;
      if ((a.p_expected_prior ?? null) !== prior) return Promise.resolve({ data: null, error: { message: `release conflict: expected prior ${a.p_expected_prior}, found ${prior}` } });}
    for (const r of db.rows) if (r.tenant_id === a.p_tenant_id) { r.queue_lane = null; r.queue_rank = null; }
    a.p_ids.forEach((id, i) => { const r = db.rows.find((x) => x.tenant_id === a.p_tenant_id && x.id === id);
      if (r) { r.queue_lane = `${a.p_release}::${a.p_lanes[i]}`; r.queue_rank = i + 1; } });
    if (name === "publish_customer_release") blob.stored = (a.p_content ?? [null])[0];
    return Promise.resolve({ data: a.p_release ?? null, error: null });},};
Object.assign(client, supabaseFake({ rows: (t) => (t === "change_proposals" ? db.rows : db.legacy),
  onSelect: (t, r) => { if (t === "change_proposals" && !r.head) db.reads.push(r.max); } }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/changes", useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a", runWithTenant: async (_t: string, f: () => unknown) => f() }));
const releaseFails = vi.hoisted(() => ({ value: false }));
vi.mock("@/app/(shell)/surface-release", () => ({
  invalidateCoreSurfaces: async () => {}, refreshCustomerSurface: async () => {}, isCustomerSurfaceStale: () => false,
  readCustomerSurface: async () => { if (releaseFails.value) throw new Error("the release did not read"); // a read that FAILED, not an absent release
    return ({ releaseId: "blob-1", computedAt: "2026-08-02T00:00:00.000Z",
    today: { today: { headerSentence: "stale", nextOpportunities: [] }, hasChanges: false },
    changes: { proposals: [], ready: [], toDo: [], measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
      readyZeroHint: null, receiptLine: null, summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 } } }); },}));
const budget = vi.hoisted(() => ({ allowed: true, throws: false }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  resolveCurrentBasis: async () => db.basis, produceProposalsForTenant: async () => ({ outcome: "proposals_persisted", candidates: [] }), checkBudget: async () => { if (budget.throws) throw new Error("unreadable"); return budget.allowed ? { allowed: true, remaining: 1 } : { allowed: false, reason: "cap" }; } }));
vi.mock("@/domains/runtime", async () => ({ ...(await vi.importActual<typeof import("@/domains/runtime")>("@/domains/runtime")),
  countTrackedQuestions: async () => 30 }));
const blob = vi.hoisted(() => ({ stored: null as unknown, writeFails: false }));
vi.mock("@/lib/persistence/json-store", async () => ({ ...(await vi.importActual<typeof import("@/lib/persistence/json-store")>("@/lib/persistence/json-store")),
  readStore: async (name: string) => (name === "customer-surface" && blob.stored ? [blob.stored] : []),
  writeStore: async () => { if (blob.writeFails) throw new Error("the release blob did not land"); } }));
const ledgerFails = vi.hoisted(() => ({ value: false }));
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  loadProofLedgerCached: async () => { if (ledgerFails.value) throw new Error("the ledger did not read"); return []; } }));
import { renderToStaticMarkup } from "react-dom/server"; import { createElement } from "react";
import { readChangesPage, loadChangesView, buildChangesViewUncached } from "@/app/(shell)/changes-data";
import { buildTodayViewFromChanges, loadTodayView } from "@/app/(shell)/today-view-data";
import { readQueuePage, loadChangeProposals, publishCustomerRelease } from "@/domains/decision/proposal-store";
import { serializeChangeProposal, type ChangeProposal } from "@/domains/decision/contracts";
import { CHANGES_PAGE_SIZE } from "@/app/(shell)/changes/types";
const T = "acct-a", N = 501;
const proposal = (i: number, over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${T}::/p${i}::existing_edit::title`, tenantId: T, kind: "existing_edit", pagePath: `/p${i}`,
  pageUrl: `https://www.fixture.example/p${i}`, pageLabel: `/p${i}`, primaryQuery: `q${i}`,
  opportunityType: "Capture clicks", changeFamily: "title", status: "ready",
  recommendedChange: { kind: "existing_edit", field: "title", before: "a", after: `Title ${i}` },
  whyItMatters: "The line Google shows misses the words people search for.", estimatedEffortMinutes: 1,
  riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: `q${i}`, hints: [], evidenceRefCount: 1 },
  impactScore: 1000 - i, upsidePerMonth: null, basis: "b1", publish: "manual", createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), diagnosisCause: "ctr_snippet", ...over,
} as unknown as ChangeProposal);
const seed = (p: ChangeProposal, over: Row = {}): Row => ({ id: p.id, tenant_id: T, basis: p.basis ?? null,
  status: p.status, terminal_disposition: null, superseded_by: null, proposal_version: 1,
  payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: `2026-07-30T00:00:${String(p.impactScore).padStart(4, "0")}Z`, ...over });
const ALL = Array.from({ length: N }, (_, i) => proposal(i));
/** The fixture ranking, written straight onto the fake rows: production stamps ONLY through the atomic release now. FAILURE DIRECTION TWO: a prior this build never read is a conflict, not a licence. A null expectation over a live release (the failed-read shape) and a stale expectation both abort BEFORE any write. FAILURE DIRECTION ONE: the transaction refuses, and NEITHER the ranking nor the surface moves. THE COMMIT: one call, both halves land, and the committed id is the one every surface pages under. out on `stampRows` for the ONE transaction that commits ranking and surface together. THE BUILD IS PURE (Codex, 2026-08-23): the old shape stamped the ranking mid-build, so a build that later failed had already replaced the live order. The release on file is still rel-1, and the whole order rides ONE id and ONE ready count reach both surfaces: a navigation can never answer this twice. A RELEASE I COULD NOT READ IS NOT A COLD START AND IS NOT A CLEAR DAY, and once this process has read one it is not an outage either: the release read is retried on its own short deadline and then falls back to the last one that landed, so neither screen paints "putting your ranked changes together for the first time", "nothing needs a decision today", or an outage over a list it is holding. The genuinely memory-free case (nothing to fall back to) is pinned in tests/changes/read-resilience. A LEDGER I COULD NOT READ IS NOT AN EMPTY LEDGER: swallowing the error printed "Measuring 0 · Results 0" on Changes and "Nothing is measuring yet" on Today, the one claim a shipped change disproves. And a count that includes changes I will refuse to hand over is a promise the next press cannot keep, wherever the refusals sit: the number the operator reads may only FALL as I learn, never climb back. The release blob has no way to say "put aside", so Today counted a dismissed row while Changes (reading the database) had already dropped it. Both surfaces read the SAME database-gated lane now, so a dismissal lands on both on the very next render, under ONE release id and ONE count, with no operator action. */
async function stamp(release: string, rows: Array<{ id: string; lane: string }> = ALL.map((p) => ({ id: p.id, lane: "ready" }))) {
  for (const r of db.rows) if (r.tenant_id === T) { r.queue_lane = null; r.queue_rank = null; }
  rows.forEach((x, i) => { const r = db.rows.find((y) => y.tenant_id === T && y.id === x.id); if (r) { r.queue_lane = `${release}::${x.lane}`; r.queue_rank = i + 1; } });}
beforeEach(async () => {
  db.rows = ALL.map((p) => seed(p)); db.legacy = []; db.reads = []; db.basis = "b1"; db.stampFails = false; blob.stored = null; blob.writeFails = false;
  await stamp("rel-1"); });
describe("Today and Changes answer one question once", () => {
  it("drops a dismissed change from Today's count on the next render, naming the same release as Changes", async () => {
    expect((await loadTodayView()).today.readyTotal).toBe(N);
    // A SPENT BUDGET MUST NOT LOOK LIKE A QUIET DAY: it stops every paid door at once while this screen carries on looking normal. Asked of the same gate the work asks, and an unreadable answer claims nothing, like the research permission beside it.
    budget.allowed = false; const refused = (await loadTodayView()).paidWorkStopped; budget.throws = true;
    const unread = (await loadTodayView()).paidWorkStopped; budget.throws = false; budget.allowed = true;
    expect([refused, unread, (await loadTodayView()).paidWorkStopped], "refused says so, unreadable and allowed say nothing").toEqual([true, undefined, undefined]);

    db.rows.find((r) => r.id === ALL[0]!.id)!.terminal_disposition = "dismissed";
    const after = await loadTodayView(), changes = await loadChangesView(); expect([after.today.readyTotal, after.surfaceVersion]).toEqual([N - 1, changes.surfaceVersion]);
    expect(changes.summary.ready).toBe(N - 1); });
  it("withholds a count it could not read, and never counts a lane higher than it can hand over", async () => {
    ledgerFails.value = true;
    const view = await buildChangesViewUncached(T, "rel-8"), today = buildTodayViewFromChanges(view); expect([view.countsUnavailable, view.summary.measuring, today.countsUnavailable, today.measuringCount]).toEqual([true, 0, true, undefined]);
    expect(today.headerSentence).not.toMatch(/measuring/i); // no clause I cannot stand behind
    const { ChangesListClient } = await import("@/app/(shell)/changes-list-client");
    expect(renderToStaticMarkup(createElement(ChangesListClient, { view }))) .toContain("What is measuring could not be read just now");
    ledgerFails.value = false;
    expect((await buildChangesViewUncached(T, "rel-8")).countsUnavailable).toBeUndefined();
    await stamp("rel-1"); // back to the ranking the paging half of this promise reads
    const cold = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const expired = (i: number) => proposal(i, { bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] },
      confidenceReasons: [], alternatives: [], risks: [], components: [{ kind: "title", label: "T", risk: "safe", before: "a", after: "b", evidenceKeys: ["k1"] }],
      receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "f", observedAt: cold }], missing: [], freshestObservedAt: cold } } } as Partial<ChangeProposal>);
    for (const i of [1, 2, 30]) db.rows.find((r) => r.id === ALL[i]!.id)!.payload = JSON.parse(serializeChangeProposal(expired(i)));
    const first = await readChangesPage(T, "ready", 0, "rel-1"), second = await readChangesPage(T, "ready", first.cursor, "rel-1");
    expect([first.total, first.rows.length, first.dropped, second.dropped, first.total - second.dropped]).toEqual([N - 2, CHANGES_PAGE_SIZE - 2, 2, 1, N - 3]); });
  it("falls back to the last release that landed rather than claiming a cold start or an outage, on Changes and on Today", async () => {
    releaseFails.value = true; db.rows = [];
    const view = await loadChangesView(), { ChangesSection } = await import("@/app/(shell)/changes/page");
    expect([view.releaseUnreadable ?? false, view.releaseFromMemory, view.surfaceBuilding, view.proposals.length,
      renderToStaticMarkup(await ChangesSection()).includes("Your saved changes could not be read just now"),
      (await loadTodayView()).today.headerSentence.includes("Your changes could not be read just now")]).toEqual([false, true, false, 0, false, false]);
    releaseFails.value = false; }); });
describe("one release identity, or no release at all", () => {
  it("serves the reasoning the rules that stand today produce, never the one banked when the row was saved", async () => {
    // THE ORDER is recomputed at every release and stamped on the row; the RECEIPT beside it rode in the
    const one = ALL[0]!;
    db.rows = [seed(one)];
    // The stale receipt lives in the STORED JSON, exactly as it does on the account: a row saved under the old
    const payload = db.rows[0]!.payload as { proposal: Record<string, unknown> };
    payload.proposal.rankingReceipt = { score: -15.57, directional: true, basis: "banked under rules that no longer decide anything",
      factors: [{ name: "treatment", max: 45, input: "rewriting a line of metadata is the kind of change that has lost here at high confidence", contribution: -45 }] };
    payload.proposal.whyRankedAboveNext = "ranked here by a rule that is gone";
    await stamp("rel-1", [{ id: one.id, lane: "ready" }]);
    const got = (await readQueuePage(T, "ready", "b1", 0, CHANGES_PAGE_SIZE)).rows[0] as unknown as { rankingReceipt?: { factors?: { name: string }[]; score?: number } };
    expect(got.rankingReceipt?.factors?.some((f) => f.name === "treatment"), "a deleted factor may not explain a live rank").toBe(false);
    expect(got.rankingReceipt?.score).not.toBe(-15.57); });

  it("builds the one order without touching the live ranking, commits ranking and surface together or not at all, and pages no change whose receipt stopped resolving", async () => {
    const view = await buildChangesViewUncached(T, "rel-9");
    expect([view.surfaceVersion, view.summary.ready, buildTodayViewFromChanges(view).readyTotal]).toEqual(["rel-9", N, N]);
    expect([(await readQueuePage(T, "ready", "b1", 0, 1)).release, view.stampRows?.length]).toEqual(["rel-1", N]);
    const broken = proposal(0, { bundle: { objective: "o", metric: "m", measurementPlan: "p", scope: { queries: [], prompts: [] },
      confidenceReasons: [], alternatives: [], risks: [], receipt: { items: [], missing: [], freshestObservedAt: null },
      components: [{ kind: "title", label: "Title", risk: "safe", before: "a", after: "b", evidenceKeys: ["nothing-holds-this"] }] } } as Partial<ChangeProposal>);
    db.rows[0]!.payload = JSON.parse(serializeChangeProposal(broken));
    expect((await readQueuePage(T, "ready", "b1", 0, CHANGES_PAGE_SIZE)).rows.map((p) => p.id)).not.toContain(broken.id);
    const args = (release: string, expectedPrior: string | null) => ({ tenantId: T, expectedPrior, release,
      rows: view.stampRows!, scopeKey: "customer-surface::tenant:fixture", storeName: "customer-surface", content: { releaseId: release } });
    expect(await publishCustomerRelease(args("rel-9", null))).toBe("rel-9");
    const committed = async () => [(await readQueuePage(T, "ready", "b1", 0, 1)).release, (blob.stored as { releaseId?: string } | null)?.releaseId ?? null];
    expect(await committed()).toEqual(["rel-9", "rel-9"]);
    db.stampFails = true;
    await expect(publishCustomerRelease(args("rel-10", "rel-9"))).rejects.toThrow("could not commit");
    expect(await committed()).toEqual(["rel-9", "rel-9"]);
    db.stampFails = false;
    await expect(publishCustomerRelease(args("rel-10", null))).rejects.toThrow("release conflict");
    await expect(publishCustomerRelease(args("rel-10", "rel-7"))).rejects.toThrow("release conflict");
    expect(await committed()).toEqual(["rel-9", "rel-9"]);
  }); });
describe("one global rank across every lane", () => {
  it("interleaves research and drafts with ready work by worth, and the stamped lane rides each row", async () => {
    await stamp("rel-mixed", [{ id: ALL[0]!.id, lane: "research" }, { id: ALL[1]!.id, lane: "ready" }, { id: ALL[2]!.id, lane: "todo" }, { id: ALL[3]!.id, lane: "ready" }]); const page = await readQueuePage(T, "all", "b1", 0, 10);
    expect(page.rows.map((p) => p.id)).toEqual([ALL[0]!.id, ALL[1]!.id, ALL[2]!.id, ALL[3]!.id]); expect(page.rows.map((p) => page.laneById[p.id])).toEqual(["research", "ready", "todo", "ready"]);
    await stamp("rel-1"); // restore the fixture ranking for the suites below
  });});
describe("the ranked queue pages in the database", () => {
  it("hands over all 501 changes exactly once, and every request reads one bounded page", async () => {
    const view = await loadChangesView(); const seen = view.ready.map((p) => p.id);
    let cursor = view.queueCursor!.all; // the RANK the screen reached, in the ONE global order
    for (let guard = 0; guard < 40 && seen.length < N; guard += 1) {
      const page = await readChangesPage(T, "ready", cursor, "rel-1");
      seen.push(...page.rows.map((p) => p.id));
      cursor = page.cursor;
      expect(page.total).toBe(N); // a COUNT, never the length of something loaded
    }
    expect([seen, new Set(seen).size]).toEqual([ALL.map((p) => p.id), N]); // every one, in the stamped order, and not one of them twice
    expect(Math.max(...db.reads)).toBeLessThanOrEqual(CHANGES_PAGE_SIZE); // never an unbounded read
  });
  it("restarts honestly when the ranking moved, and never serves a retired or implemented row", async () => {
    await stamp("rel-2"); const page = await readChangesPage(T, "ready", 100, "rel-1");
    expect(page.releaseId).toBe("rel-2"); expect(page.rows.map((p) => p.id)).toEqual(ALL.slice(0, CHANGES_PAGE_SIZE).map((p) => p.id));
    expect(page.refreshed).toBe("The list moved under you while you were reading it, so here is the fresh first page.");
    db.rows[1]!.terminal_disposition = "dismissed";              // put aside after the ranking was stamped
    db.rows[2]!.terminal_disposition = "withdrawn";
    db.rows[3]!.payload = JSON.parse(serializeChangeProposal(proposal(3, { status: "implemented_pending_verification" })));
    const after = await readChangesPage(T, "ready", 0, "rel-2"); const ids = after.rows.map((p) => p.id);
    for (const gone of [1, 2, 3]) expect(ids).not.toContain(ALL[gone]!.id);
    expect(after.cursor).toBeGreaterThan(after.rows.length); // the cursor is the RANK read, not a row count
  });
  it("withholds everything under a bar it cannot read, and everything drafted under an older one", async () => {
    db.basis = null; expect((await readChangesPage(T, "ready", 0, null)).rows).toEqual([]);
    db.basis = "b2"; expect((await readQueuePage(T, "ready", "b2", 0, CHANGES_PAGE_SIZE)).total).toBe(0); });
  it("no longer caps the canonical current queue at 500, and Today still takes only three", async () => {
    expect((await loadChangeProposals(T)).size).toBe(N);
    const view = await loadChangesView(); // the count is the count, and the screen is one page
    expect([view.summary.ready, view.ready.length]).toEqual([N, CHANGES_PAGE_SIZE]); // one page of the one order, all ready in this fixture
    expect(buildTodayViewFromChanges(view).nextOpportunities.map((o) => o.changeId)).toEqual(ALL.slice(0, 3).map((p) => p.id)); }); });
/** THE TWO WRITES END TOGETHER OR NOT AT ALL. The order is stamped inside the build and the release blob is written at the end, so a blob write that failed left the NEW ranking live in the database beside the OLD release: "show more" paged an order the screen above it was never published with. */
describe("a publish that half landed", () => {
  it("rolls the order back onto the release still serving when the blob does not land", async () => {
    const real = await vi.importActual<typeof import("@/app/(shell)/surface-release")>("@/app/(shell)/surface-release"); await stamp("rel-prev", ALL.slice(0, 3).map((p) => ({ id: p.id, lane: "ready" })));
    blob.stored = { schemaVersion: 2, releaseId: "rel-prev", computedAt: "2026-08-03T00:00:00.000Z", tenantId: T,
      changes: { surfaceVersion: "rel-prev", ready: ALL.slice(0, 3), toDo: [] }, today: {} };
    blob.writeFails = true;
    await expect(real.refreshCustomerSurface(T)).rejects.toThrow(); const page = await readQueuePage(T, "ready", "b1", 0, CHANGES_PAGE_SIZE);
    expect([page.release, page.rows.map((p) => p.id)]).toEqual(["rel-prev", ALL.slice(0, 3).map((p) => p.id)]); });});
