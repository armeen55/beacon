/** THE CANONICAL SHIPMENT (V1 Truth Convergence Phase 6). Protected here: ONE Shipment per
 *  (proposal, version applied) and a retry that heals instead of duplicating; a partial bundle
 *  stored as one; the stamp and the starting numbers written exactly once; pre-Phase-6 rows
 *  still decoding; a check naming another account's Shipment landing nothing; and the 28-day
 *  ranking window read from the stamp. Fixtures only: the fake Postgres below holds the rows. */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  const state = { rows: [] as Row[] };
  const client = {
    from() {
      const eqs: Array<[string, unknown]> = [], gtes: Array<[string, string]> = [];
      let op: "select" | "update" | "upsert" = "select", patch: Row = {}, sent: Row = {};
      const hit = (r: Row) => eqs.every(([c, v]) => (r[c] ?? null) === v)
        && gtes.every(([c, v]) => typeof r[c] === "string" && (r[c] as string) >= v);
      const run = () => {
        if (op === "select") return { data: state.rows.filter(hit).map((r) => ({ ...r })), error: null };
        if (op === "update") {
          const affected = state.rows.filter(hit);
          for (const r of affected) Object.assign(r, patch);
          return { data: affected.map((r) => ({ id: r.id })), error: null };
        }
        const at = state.rows.findIndex((r) => r.tenant_id === sent.tenant_id && r.id === sent.id);
        if (at >= 0) state.rows[at] = { ...state.rows[at], ...sent }; else state.rows.push({ ...sent });
        return { data: [{ id: sent.id }], error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q, limit: () => q,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
        gte: (c: string, v: string) => { gtes.push([c, v]); return q; },
        update: (p: Row) => { op = "update"; patch = p; return q; },
        upsert: (r: Row) => { op = "upsert"; sent = r; return q; },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return q;
    },
  };
  return { state, client };
});
const gsc = vi.hoisted(() => ({ window: vi.fn(), lastFinal: vi.fn() }));
const ai = vi.hoisted(() => ({ views: vi.fn() }));

vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a" }));
vi.mock("@/lib/persistence/json-store", () => ({ readStore: async () => [], writeStore: async () => {} }));
vi.mock("@/lib/tenant", () => ({ getDataDir: () => "/tmp/beacon-fixture" }));
vi.mock("@/domains/account/tenants/store", () => ({ getTenant: async () => null }));
vi.mock("@/app/(shell)/results/results-surface-store", () => ({ invalidateResultsSurface: async () => {} }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {} }));
vi.mock("@/domains/measurement/proof-gsc/gsc-window", () => ({
  readWindowForPages: gsc.window, readLastFinalizedDate: gsc.lastFinal, readCumulativeSince: async () => new Map(),
}));
vi.mock("@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() }),
  assemblePacketForUrl: () => ({ gsc: null }),
}));
vi.mock("@/domains/evidence/ai-visibility/ai-observations", () => ({ readAiObservationViews: ai.views }));

import { recordShippedChange } from "@/domains/measurement/proof-gsc/measure-pass";
import {
  loadShippedChangesForTenant, pagesUnderMeasurementFromShipments, recordVerification,
  upsertShippedChange, type ShipmentVerification,
} from "@/domains/measurement/proof-gsc/shipped-change-store";

const T = "acct-a", NOW = new Date("2026-07-31T12:00:00.000Z");
const PAGE = "https://www.fixture-outdoors.example/nowruz-guide";
const COMPONENTS = [{ kind: "title", label: "Page title" }, { kind: "opening_answer", label: "Opening answer" }];

const origin = (over: Record<string, unknown> = {}) => ({
  proposalId: `${T}::/nowruz-guide::existing_edit::bundle`, proposalVersion: "v-abc123",
  basis: "basis_today::d6", caseId: null,
  bundleHypothesis: "Say what the searcher asked for in the line Google shows.",
  componentsApplied: COMPONENTS, implementedAt: NOW.toISOString(), preChangeContentHash: "hash-before", ...over,
});
const ship = (over: Record<string, unknown> = {}) => recordShippedChange({
  tenantId: T, page: PAGE, path: "/nowruz-guide", actionType: "title-family", before: "Nowruz",
  after: "Nowruz Traditions and the Haft-Seen Table", targetQueries: ["nowruz traditions"], controlPages: [],
  shippedAt: NOW.toISOString(), now: NOW, shipment: origin() as never, ...over });
/** A pre-Phase-6 row: the manual "Record shipped change" path, no Shipment columns at all. */
const legacyRow = (): Row => ({
  tenant_id: T, id: "/cities::2026-06-20", page: "https://www.fixture-outdoors.example/cities", path: "/cities",
  action_type: "meta", before_text: "old", after_text: "new", shipped_at: "2026-06-20T00:00:00.000Z",
  baseline: { clicks: 5, impressions: 400, ctr: 0.0125, position: 12, windowDays: 28 },
  target_queries: [], control_pages: [], windows: [], verdict: "measuring", confidence: "low", measured_at: null,
  notes: null, verified_live: false, live_source_url: null, recrawl_requested_at: null,
  created_at: "2026-06-20T00:00:00.000Z", updated_at: "2026-06-20T00:00:00.000Z",
});
const verification = (status: ShipmentVerification["status"]): ShipmentVerification =>
  ({ status, checkedAt: "2026-08-02T00:00:00.000Z", components: [{ kind: "title", state: "verified", note: null }] });

beforeEach(() => {
  db.state.rows = [];
  [gsc.window, gsc.lastFinal, ai.views].forEach((m) => m.mockReset());
  gsc.window.mockResolvedValue(new Map([[PAGE, { clicks: 9, impressions: 1200, ctr: 0.0075, position: 14 }]]));
  gsc.lastFinal.mockResolvedValue("2026-07-30");
  ai.views.mockResolvedValue([
    { slot: 0, status: "observed", day: "2026-07-30", analysis: { ownedBrandMention: { mentioned: true } } },
    { slot: 0, status: "observed", day: "2026-07-30", analysis: { ownedBrandMention: { mentioned: false } } },
    { slot: 1, status: "observed", day: "2026-07-30", analysis: { ownedBrandMention: { mentioned: true } } },
    { slot: 0, status: "observed", day: "2026-06-01", analysis: { ownedBrandMention: { mentioned: true } } },
  ]);
});

describe("the canonical Shipment", () => {
  it("records ONE shipment with the stamp, the components and both starting numbers", async () => {
    await upsertShippedChange(await ship());
    expect(db.state.rows).toHaveLength(1);
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.proposalId).toBe(`${T}::/nowruz-guide::existing_edit::bundle`);
    expect(stored.proposalVersion).toBe("v-abc123");
    expect(stored.basis).toBe("basis_today::d6");
    expect(stored.bundleHypothesis).toMatch(/line Google shows/);
    expect(stored.implementedAt).toBe(NOW.toISOString());
    expect(stored.preChangeContentHash).toBe("hash-before");
    expect(stored.componentsApplied).toEqual(COMPONENTS);
    expect(stored.shipmentBaseline?.search.clicks).toBe(9);
    // The first reading of each question on the latest day it was asked, and nothing else.
    expect(stored.shipmentBaseline?.ai).toEqual({ day: "2026-07-30", checked: 2, mentioning: 1 });
    expect(stored.verification).toBeNull(); // nobody has checked it, and that null makes it due
  });

  it("heals a retried press instead of recording the change twice", async () => {
    const first = await ship();
    await upsertShippedChange(first);
    const retry = await ship();
    await upsertShippedChange(retry);
    expect(retry.id).toBe(first.id);
    expect(db.state.rows).toHaveLength(1);
  });

  it("stores a partial bundle as a partial bundle", async () => {
    await upsertShippedChange(await ship({ shipment: origin({ componentsApplied: [COMPONENTS[0]] }) as never }));
    expect((await loadShippedChangesForTenant(T))[0].componentsApplied).toEqual([COMPONENTS[0]]);
  });

  it("writes the stamp and the starting numbers once: a later writer keeps what is on file", async () => {
    await upsertShippedChange(await ship());
    const first = (await loadShippedChangesForTenant(T))[0];
    // A recompute arriving a week later with a moved stamp and rewritten baseline.
    await upsertShippedChange({
      ...first, implementedAt: "2026-08-07T00:00:00.000Z",
      shipmentBaseline: { search: { clicks: 400, impressions: 9000, ctr: 0.044, position: 3, windowDays: 28 }, ai: null, capturedAt: "2026-08-07T00:00:00.000Z" },
    });
    const [after] = await loadShippedChangesForTenant(T);
    expect(after.implementedAt).toBe(NOW.toISOString());
    expect(after.shipmentBaseline?.search.clicks).toBe(9);
  });

  it("still decodes a record written before there were Shipments", async () => {
    db.state.rows.push(legacyRow());
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.path).toBe("/cities");
    expect(stored.baseline.clicks).toBe(5);
    expect([stored.proposalId, stored.implementedAt, stored.shipmentBaseline, stored.verification])
      .toEqual([null, null, null, null]);
  });
});

describe("recording what the live check found", () => {
  it("writes the verdict without touching the stamp or the starting numbers", async () => {
    const record = await ship();
    await upsertShippedChange(record);
    expect(await recordVerification(T, record.id, verification("verified"))).toBe(true);
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.verification?.status).toBe("verified");
    expect(stored.implementedAt).toBe(NOW.toISOString());
    expect(stored.shipmentBaseline?.search.clicks).toBe(9);
  });

  it("fails closed on another account's shipment, and on an id nobody holds", async () => {
    const record = await ship();
    await upsertShippedChange(record);
    expect(await recordVerification("acct-b", record.id, verification("verified"))).toBe(false);
    expect(await recordVerification(T, "shp_nothing", verification("not_found"))).toBe(false);
    expect((await loadShippedChangesForTenant(T))[0].verification).toBeNull();
  });
});

describe("what is still under measurement", () => {
  const row = (id: string, implementedAt: string, path: string, v: ShipmentVerification | null): Row =>
    ({ ...legacyRow(), id, path, implemented_at: implementedAt, verification: v, proposal_id: `p-${id}` });

  beforeEach(() => {
    db.state.rows = [
      row("s1", "2026-07-25T00:00:00.000Z", "/nowruz-guide", null),              // waiting on its first check
      row("s2", "2026-07-20T00:00:00.000Z", "/tehran", verification("verified")),
      row("s3", "2026-07-28T00:00:00.000Z", "/shiraz", verification("not_found")), // nothing shipped
      row("s4", "2026-07-29T00:00:00.000Z", "/isfahan", verification("blocked")),  // could not be checked
      row("s5", "2026-05-01T00:00:00.000Z", "/kish", verification("verified")),    // past the window
      { ...legacyRow(), id: "s6", path: "/never-shipped" },                        // no stamp at all
    ];
  });

  it("windows on the stamp, keeps only what is really being measured, and belongs to one account", async () => {
    expect(await pagesUnderMeasurementFromShipments(T, NOW)).toEqual(["/nowruz-guide", "/tehran"]);
    expect(await pagesUnderMeasurementFromShipments("acct-b", NOW)).toEqual([]);
  });
});
