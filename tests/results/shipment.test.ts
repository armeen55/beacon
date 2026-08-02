/** THE CANONICAL SHIPMENT (V1 Truth Convergence Phase 6). Protected here: ONE Shipment per
 *  (proposal, version applied) and a retry that heals instead of duplicating; a partial bundle
 *  stored as one; the stamp and the starting numbers written exactly once; pre-Phase-6 rows
 *  still decoding; a check naming another account's Shipment landing nothing; and the 28-day
 *  ranking window read from the stamp. Fixtures only: the fake Postgres below holds the rows. */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  /** `offline` = no Supabase configured at all (local dev). `upsertError`/`updateError` = the
   *  pre-migration window, where the table is there and the Shipment columns are not. `file` is the
   *  per-tenant ledger file both fallbacks write to. */
  const state = {
    rows: [] as Row[], file: [] as Row[], offline: false,
    upsertError: null as Row | null, updateError: null as Row | null,
  };
  const client = {
    from() {
      const eqs: Array<[string, unknown]> = [], gtes: Array<[string, string]> = [];
      let op: "select" | "update" | "upsert" = "select", patch: Row = {}, sent: Row = {};
      const hit = (r: Row) => eqs.every(([c, v]) => (r[c] ?? null) === v)
        && gtes.every(([c, v]) => typeof r[c] === "string" && (r[c] as string) >= v);
      const run = () => {
        if (op === "select") return { data: state.rows.filter(hit).map((r) => ({ ...r })), error: null };
        if (op === "update") {
          if (state.updateError) return { data: null, error: state.updateError };
          const affected = state.rows.filter(hit);
          for (const r of affected) Object.assign(r, patch);
          return { data: affected.map((r) => ({ id: r.id })), error: null };
        }
        if (state.upsertError) return { data: null, error: state.upsertError };
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

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => { if (db.state.offline) throw new Error("no Supabase configured"); return db.client; },
}));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a" }));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => db.state.file,
  writeStore: async (_store: string, rows: Row[]) => { db.state.file = rows; },
}));
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
vi.mock("@/domains/evidence/ai-visibility/ai-observations", async (orig) => ({
  ...((await orig()) as object), readAiObservationViews: ai.views,
}));

import { measureRecord, recordShippedChange } from "@/domains/measurement/proof-gsc/measure-pass";
import { isDueForMeasure } from "@/domains/measurement/proof-gsc/measure-lifecycle";
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
  db.state.file = [];
  db.state.offline = false;
  db.state.upsertError = null;
  db.state.updateError = null;
  [gsc.window, gsc.lastFinal, ai.views].forEach((m) => m.mockReset());
  gsc.window.mockResolvedValue(new Map([[PAGE, { clicks: 9, impressions: 1200, ctr: 0.0075, position: 14 }]]));
  gsc.lastFinal.mockResolvedValue("2026-07-30");
  ai.views.mockResolvedValue([
    { slot: 0, status: "observed", day: "2026-07-30", analysis: { ownedBrandMention: { mentioned: true } }, analysisHash: "x", answerHash: "x" },
    { slot: 0, status: "observed", day: "2026-07-30", analysis: { ownedBrandMention: { mentioned: false } }, analysisHash: "x", answerHash: "x" },
    { slot: 1, status: "observed", day: "2026-07-30", analysis: { ownedBrandMention: { mentioned: true } }, analysisHash: "x", answerHash: "x" },
    { slot: 0, status: "observed", day: "2026-06-01", analysis: { ownedBrandMention: { mentioned: true } }, analysisHash: "x", answerHash: "x" },
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
    expect(stored.shipmentBaseline?.ai).toEqual({ day: "2026-07-30", checked: 2, analyzed: 2, mentioning: 1 });
    expect(stored.verification).toBeNull(); // nobody has checked it, and that null makes it due
  });
  it("counts the AI starting number over the WHOLE day, never the newest page of it", async () => {
    // The baseline used to be read off the newest 60 rows and frozen, so a 140 answer day was compared
    // against a sample of itself for the next 28 days: the before side was a fraction and the after side
    // was a day. The day is found off a small probe and then READ BY NAME, which returns all of it.
    const DAY = "2026-07-30";
    const whole = Array.from({ length: 140 }, (_, i) => ({ slot: 0, status: "observed", day: DAY,
      analysis: { ownedBrandMention: { mentioned: i % 2 === 0 } }, analysisHash: "x", answerHash: "x" }));
    ai.views.mockImplementation(async (_t: string, o: { day?: string; limit?: number }) =>
      (o?.day === DAY ? whole : whole.slice(0, o?.limit ?? 60)));
    await upsertShippedChange(await ship());
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.shipmentBaseline?.ai).toEqual({ day: DAY, checked: 140, analyzed: 140, mentioning: 70 });
  });
  it("writes down HOW MANY of that day's answers were read closely, which is the denominator the rate uses", async () => {
    // The starting number used to count mentions over every answer that came back, so an answer nobody had
    // read yet was an implicit miss, while the after side divides by the answers actually read. The change
    // was then judged by comparing one measure against a different one. 140 answers, 100 of them read
    // closely, 60 naming the account: the starting rate is 0.6, and it was 0.43.
    const DAY = "2026-07-30";
    const whole = Array.from({ length: 140 }, (_, i) => ({ slot: 0, status: "observed", day: DAY,
      analysis: i < 100 ? { ownedBrandMention: { mentioned: i < 60 } } : null, analysisHash: i < 100 ? "x" : null, answerHash: "x" }));
    ai.views.mockImplementation(async (_t: string, o: { day?: string; limit?: number }) =>
      (o?.day === DAY ? whole : whole.slice(0, o?.limit ?? 60)));
    await upsertShippedChange(await ship());
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.shipmentBaseline?.ai).toEqual({ day: DAY, checked: 140, analyzed: 100, mentioning: 60 });
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
  it("keeps the exact copy each component carried, which is what the live check compares the page against", async () => {
    const withCopy = [{ kind: "title", label: "Page title", after: "Nowruz Traditions and the Haft-Seen Table" },
      { kind: "opening_answer", label: "Opening answer", after: "A nowruz table is set with seven symbolic items." }];
    await upsertShippedChange(await ship({ shipment: origin({ componentsApplied: withCopy }) as never }));
    expect((await loadShippedChangesForTenant(T))[0].componentsApplied).toEqual(withCopy);
  });
  it("records the operator's own confirmation as the answer itself, so the live check is never owed", async () => {
    await upsertShippedChange(await ship({
      shipment: origin({ operatorConfirmed: true, operatorOverrideReason: "I pasted it into Wix myself." }) as never }));
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.verification?.status).toBe("operator_confirmed");
    expect(stored.verification?.components.every((c) => c.state === "unknown")).toBe(true);
    expect(stored.operatorOverrideReason).toBe("I pasted it into Wix myself.");
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

/** THE FOURTH CHECKPOINT IS BOUGHT ONCE. A recompute rebuilds 7/14/28 from scratch, so a day-56
 *  reading already taken and already judged on must be carried through it untouched. */
describe("a day-56 reading already taken", () => {
  const LATER = new Date("2026-10-01T00:00:00.000Z"), BEHIND_56 = "2026-09-05";
  const ranWindow = (day: number, adjustedLift: number) => ({
    day, checkOn: "2026-09-25", ran: true, treatedDelta: 0, controlDelta: 0, adjustedLift,
    treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0,
    controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 3, treatedPostImpressions: 5000,
  });
  it("survives a recompute that could not ask for it again, and is never re-bought", async () => {
    const held = { ...(await ship()), verdict: "inconclusive" as const, windows: [ranWindow(56, 400)] as never };
    const measured = await measureRecord(T, held, LATER, BEHIND_56);
    // The 7/14/28 windows are rebuilt; the reading Beacon already paid for rides through.
    expect(measured.windows.map((w) => w.day)).toEqual([7, 14, 28, 56]);
    expect(measured.windows.find((w) => w.day === 56)?.adjustedLift).toBe(400);
    // Google has no finalized data through the 56-day close, so that window was never re-read.
    expect(gsc.window.mock.calls.some((c) => (c[0] as { end?: string }).end === "2026-09-25")).toBe(false);
    // And the verdict is still read on it, rather than falling back to a thinner window.
    expect(measured.verdict).toBe("won");
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

/** THE PRE-MIGRATION WINDOW. The columns are not there yet, the table is, and production reads the
 *  table: a write that quietly lands in a file is a write nobody will ever read back. */
describe("when the Shipment columns are not there yet", () => {
  const MISSING_COLUMN = { code: "PGRST204", message: "Could not find the 'implemented_at' column of 'shipped_change_proof' in the schema cache" };
  it("refuses a Shipment it cannot store durably instead of pretending it landed", async () => {
    db.state.upsertError = MISSING_COLUMN;
    await expect(upsertShippedChange(await ship())).rejects.toThrow(/migration/i);
    expect([db.state.rows.length, db.state.file.length]).toEqual([0, 0]);
  });
  it("still records a pre-Shipment row to the file, because nothing downstream reads that one from the table", async () => {
    db.state.upsertError = MISSING_COLUMN;
    await upsertShippedChange(await ship({ shipment: undefined }));
    expect(db.state.file).toHaveLength(1);
  });
  it("keeps working with no database at all: the record and its answer both land in the local ledger", async () => {
    db.state.offline = true;
    const record = await ship();
    await upsertShippedChange(record);
    expect(db.state.file).toHaveLength(1);
    // The answer saves ONCE, so the verifier never goes back out to the customer's website for it again.
    expect(await recordVerification(T, record.id, verification("verified"))).toBe(true);
    expect((db.state.file[0] as { verification?: ShipmentVerification }).verification?.status).toBe("verified");
    expect(await recordVerification(T, "shp_nobody-holds-this", verification("verified"))).toBe(false);
  });
  it("saves what the check found to the file when the column is missing, rather than re-owing the check forever", async () => {
    const record = await ship();
    await upsertShippedChange(record); // the table takes the row, and the file mirrors it
    db.state.updateError = { code: "PGRST204", message: "Could not find the 'verification' column of 'shipped_change_proof' in the schema cache" };
    expect(await recordVerification(T, record.id, verification("verified"))).toBe(true);
    expect((db.state.file[0] as { verification?: ShipmentVerification }).verification?.status).toBe("verified");
  });
});

/** PRODUCT TRUTH: start measurement only after implementation is verified or explicitly
 *  operator-confirmed. Measuring a change I never found on the page would credit search movement
 *  to work that may never have landed. */
describe("measurement waits for the change to be found on the page", () => {
  const LATER = new Date("2026-08-20T12:00:00.000Z"), FINAL = "2026-08-19";
  const due = async (v: ShipmentVerification | null) => isDueForMeasure({ ...(await ship()), verification: v }, FINAL, LATER);
  it("measures a verified, partly verified or operator-confirmed change, and nothing else", async () => {
    expect(await due(verification("verified"))).toBe(true);
    expect(await due(verification("partially_verified"))).toBe(true);
    expect(await due(verification("operator_confirmed"))).toBe(true);
    expect(await due(null)).toBe(false);            // never checked: there is nothing honest to measure yet
    expect(await due(verification("not_found"))).toBe(false);
    expect(await due(verification("blocked"))).toBe(false);
    expect(await due(verification("differs"))).toBe(false);
  });
  it("keeps measuring a record written before there were Shipments, which has no answer to wait for", async () => {
    const legacy = { ...(await ship()), implementedAt: null, verification: null };
    expect(isDueForMeasure(legacy, FINAL, LATER)).toBe(true);
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
