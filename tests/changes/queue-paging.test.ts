/** THE RANKED QUEUE IS UNLIMITED AND IT PAGES IN THE DATABASE (blocker 3). 501 current changes are seeded as
 *  the store's own rows and stamped by the real ranking writer; the list then hands over every one of them
 *  exactly once, each request reads ONE bounded page and never the queue or the release blob, a ranking
 *  replaced underneath the operator restarts honestly, a retired or already-implemented row never reaches a
 *  pre-ship lane, the canonical current read is no longer capped at 500, and Today still takes only three. */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";

const db = vi.hoisted(() => ({ rows: [] as Row[], legacy: [] as Row[], reads: [] as number[], basis: "b1" as string | null }));
const client: Record<string, unknown> = {
  // The one production statement that stamps a ranking: clear this account, then number each lane in order.
  rpc(_name: string, a: { p_tenant_id: string; p_release: string; p_ready: string[]; p_todo: string[] }) {
    for (const r of db.rows) if (r.tenant_id === a.p_tenant_id) { r.queue_lane = null; r.queue_rank = null; }
    for (const [lane, ids] of [["ready", a.p_ready], ["todo", a.p_todo]] as const) {
      ids.forEach((id, i) => { const r = db.rows.find((x) => x.tenant_id === a.p_tenant_id && x.id === id);
        if (r) { r.queue_lane = `${a.p_release}::${lane}`; r.queue_rank = i + 1; } });
    }
    return Promise.resolve({ data: null, error: null });
  },
};
Object.assign(client, supabaseFake({ rows: (t) => (t === "change_proposals" ? db.rows : db.legacy),
  onSelect: (t, r) => { if (t === "change_proposals" && !r.head) db.reads.push(r.max); } }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a", runWithTenant: async (_t: string, f: () => unknown) => f() }));
vi.mock("@/app/(shell)/surface-release", () => ({
  invalidateCoreSurfaces: async () => {}, refreshCustomerSurface: async () => {}, isCustomerSurfaceStale: () => false,
  readCustomerSurface: async () => ({ releaseId: "blob-1", computedAt: "2026-08-02T00:00:00.000Z",
    changes: { proposals: [], ready: [], toDo: [], measuringCountCanonical: 0, demotedStaleBasis: 0, decidedCountCanonical: 0,
      readyZeroHint: null, receiptLine: null, summary: { todo: 0, ready: 0, implemented: 0, measuring: 0, results: 0 } } }),
}));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  resolveCurrentBasis: async () => db.basis }));

import { readChangesPage, loadChangesView } from "@/app/(shell)/changes-data";
import { buildTodayViewFromChanges } from "@/app/(shell)/today-view-data";
import { readQueuePage, stampQueueRanking, loadChangeProposals } from "@/domains/decision/proposal-store";
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
  impactScore: 1000 - i, upsidePerMonth: null, basis: "b1", publish: "manual", createdAt: "2026-07-30T00:00:00.000Z", ...over,
} as unknown as ChangeProposal);
const seed = (p: ChangeProposal, over: Row = {}): Row => ({ id: p.id, tenant_id: T, basis: p.basis ?? null,
  status: p.status, terminal_disposition: null, superseded_by: null, proposal_version: 1,
  payload: JSON.parse(serializeChangeProposal(p)) as unknown, updated_at: `2026-07-30T00:00:${String(p.impactScore).padStart(4, "0")}Z`, ...over });

const ALL = Array.from({ length: N }, (_, i) => proposal(i));
async function stamp(release: string, ready = ALL) { await stampQueueRanking(T, release, ready.map((p) => p.id), []); }
beforeEach(async () => {
  db.rows = ALL.map((p) => seed(p)); db.legacy = []; db.reads = []; db.basis = "b1";
  await stamp("rel-1");
});

describe("the ranked queue pages in the database", () => {
  it("hands over all 501 changes exactly once, and every request reads one bounded page", async () => {
    const view = await loadChangesView();
    const seen = view.ready.map((p) => p.id);
    let cursor = view.queueCursor!.ready; // the RANK the screen reached, which is what the client sends back
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
    await stamp("rel-2");
    const page = await readChangesPage(T, "ready", 100, "rel-1");
    expect(page.releaseId).toBe("rel-2");
    expect(page.rows.map((p) => p.id)).toEqual(ALL.slice(0, CHANGES_PAGE_SIZE).map((p) => p.id));
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
    db.basis = "b2"; expect((await readQueuePage(T, "ready", "b2", 0, CHANGES_PAGE_SIZE)).total).toBe(0);
  });
  it("no longer caps the canonical current queue at 500, and Today still takes only three", async () => {
    expect((await loadChangeProposals(T)).size).toBe(N);
    const view = await loadChangesView(); // the count is the count, and the screen is one page
    expect([view.summary.ready, view.ready.length]).toEqual([N, CHANGES_PAGE_SIZE]);
    expect(buildTodayViewFromChanges(view).nextOpportunities.map((o) => o.changeId)).toEqual(ALL.slice(0, 3).map((p) => p.id));
  });
});
