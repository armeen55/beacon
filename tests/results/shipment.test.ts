/** THE CANONICAL SHIPMENT (V1 Truth Convergence Phase 6). Protected here: ONE Shipment per (proposal, version applied) and a retry that heals instead of duplicating; a partial bundle stored as one; the stamp and the starting numbers written exactly once; pre-Phase-6 rows still decoding; a check naming another account's Shipment landing nothing; and the 28-day ranking window read from the stamp. Fixtures only: the fake Postgres below holds the rows. */
import { describe, it, expect, beforeEach, vi } from "vitest";
type Row = Record<string, unknown>;
const db = vi.hoisted(() => {
  /** `offline` = no Supabase configured at all (local dev). `upsertError`/`updateError` = the pre-migration window, where the table is there and the Shipment columns are not. `file` is the per-tenant ledger file both fallbacks write to. */
  const state = {
    rows: [] as Row[], file: [] as Row[], offline: false,
    upsertError: null as Row | null, updateError: null as Row | null,
  };
  return { state, client: {} as Record<string, unknown> };
});
const gsc = vi.hoisted(() => ({ window: vi.fn(), lastFinal: vi.fn() }));
const ai = vi.hoisted(() => ({ views: vi.fn(), records: vi.fn() }));
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
/** The comparison set this account's site can offer, which the recording seam asks for and never depends on. */
const ctl = vi.hoisted(() => ({ pages: [] as string[] }));
vi.mock("@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() }),
  assemblePacketForUrl: () => ({ gsc: null }), topPagesByDemand: () => ctl.pages,
}));
vi.mock("@/domains/evidence/ai-visibility/ai-observations", async (orig) => ({
  ...((await orig()) as object), readAiObservationViews: ai.views, readAiObservations: ai.records,
}));
/** The settle pass's own three seams: what it measured, and the two things a fresh verdict is worthless without. */
const settle = vi.hoisted(() => ({ pass: vi.fn(), rebuilt: [] as string[], harvested: [] as string[] }));
vi.mock("@/domains/measurement/proof-gsc/auto-measure-pass", () => ({ autoMeasureDuePass: settle.pass }));
vi.mock("@/app/(shell)/results/results-ledger-data", () => ({ rebuildResultsSurface: async (t: string) => void settle.rebuilt.push(t) }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ harvestWinners: async (t: string) => void settle.harvested.push(t) }));
import { settleDueMeasurements } from "@/domains/measurement/proof-gsc/auto-measure-on-use";
import { measureRecord, recordShippedChange } from "@/domains/measurement/proof-gsc/measure-pass";
import { recordRepairShipment, recordShipment } from "@/domains/measurement/proof-gsc/record-shipment";
import { isDueForMeasure } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import {
  loadShippedChangesForTenant, pagesUnderMeasurementFromShipments, recordVerification,
  upsertShippedChange, type ShipmentVerification,
} from "@/domains/measurement/proof-gsc/shipped-change-store";
import { supabaseFake } from "../helpers/supabase-fake";
Object.assign(db.client, supabaseFake({ rows: () => db.state.rows,
  error: (_t, op) => (op === "update" ? db.state.updateError : op === "upsert" ? db.state.upsertError : null) as { message: string } | null,
  same: (stored, sent) => stored.tenant_id === sent.tenant_id && stored.id === sent.id }));
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
  // A record needs its comparison pages to be worth writing at all, so the writer itself refuses fewer than two.
  after: "Nowruz Traditions and the Haft-Seen Table", targetQueries: ["nowruz traditions"], controlPages: ["https://x.test/a", "https://x.test/b"],
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
  [gsc.window, gsc.lastFinal, ai.views, ai.records].forEach((m) => m.mockReset());
  ai.records.mockResolvedValue([]);
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
    expect(stored.shipmentBaseline?.search?.clicks).toBe(9);
    // The first reading of each question on the latest day it was asked, and nothing else.
    expect(stored.shipmentBaseline?.ai).toEqual({ day: "2026-07-30", checked: 2, analyzed: 2, mentioning: 1 });
    expect(stored.verification).toBeNull(); // nobody has checked it, and that null makes it due
  });
  // The baseline used to be read off the newest 60 rows, so a 140 answer day was compared against a sample of itself for 28 days, and it counted mentions over every answer that came back, so an answer nobody had read yet was an implicit miss while the after side divides by the answers actually read. The day is found off a small probe, READ BY NAME, and the denominator is written down.
  it("counts the AI starting number over the WHOLE day, and writes down how many of it were read closely", async () => {
    const DAY = "2026-07-30";
    const day = (analysed: number) => Array.from({ length: 140 }, (_, i) => ({ slot: 0, status: "observed", day: DAY,
      analysis: i < analysed ? { ownedBrandMention: { mentioned: i < analysed * 0.6 } } : null,
      analysisHash: i < analysed ? "x" : null, answerHash: "x" }));
    const serve = (rows: Record<string, unknown>[]) => ai.views.mockImplementation(
      async (_t: string, o: { day?: string; limit?: number }) => (o?.day === DAY ? rows : rows.slice(0, o?.limit ?? 60)));
    serve(day(140));
    await upsertShippedChange(await ship());
    expect((await loadShippedChangesForTenant(T))[0].shipmentBaseline?.ai).toEqual({ day: DAY, checked: 140, analyzed: 140, mentioning: 84 });
    db.state.rows = []; db.state.file = []; serve(day(100));
    await upsertShippedChange(await ship());
    expect((await loadShippedChangesForTenant(T))[0].shipmentBaseline?.ai).toEqual({ day: DAY, checked: 140, analyzed: 100, mentioning: 60 });
  });
  it("heals a retried press instead of recording the change twice", async () => {
    const first = await ship();
    await upsertShippedChange(first);
    const retry = await ship();
    await upsertShippedChange(retry);
    expect(retry.id).toBe(first.id);
    expect(db.state.rows).toHaveLength(1);
  });
  it("stores a partial bundle as a partial bundle, and keeps the exact copy each piece carried", async () => {
    await upsertShippedChange(await ship({ shipment: origin({ componentsApplied: [COMPONENTS[0]] }) as never }));
    expect((await loadShippedChangesForTenant(T))[0].componentsApplied).toEqual([COMPONENTS[0]]);
    const withCopy = [{ kind: "title", label: "Page title", after: "Nowruz Traditions and the Haft-Seen Table" }];
    db.state.rows = []; db.state.file = [];
    await upsertShippedChange(await ship({ shipment: origin({ componentsApplied: withCopy }) as never }));
    expect((await loadShippedChangesForTenant(T))[0].componentsApplied).toEqual(withCopy);
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
    expect(after.shipmentBaseline?.search?.clicks).toBe(9);
  });
  // PIN (B): the operator's words are kept as a NOTE, and the reading is still owed.
  it("keeps what the operator says they did as a note, and still owes the live check", async () => {
    await upsertShippedChange(await ship({
      shipment: origin({ operatorNote: "I pasted it into my site myself." }) as never }));
    const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.verification).toBeNull();
    expect(stored.operatorNote).toBe("I pasted it into my site myself.");
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
/** THE FOURTH CHECKPOINT IS BOUGHT ONCE. A recompute rebuilds 7/14/28 from scratch, so a day-56 reading already taken and already judged on must be carried through it untouched. */
describe("a day-56 reading already taken", () => {
  const LATER = new Date("2026-10-01T00:00:00.000Z"), BEHIND_56 = "2026-09-05";
  // The record ships as "title-family", which is judged on CLICK RATE, so the reading that has to survive carries its lift on the metric this change is actually graded on.
  const ranWindow = (day: number, adjustedLift: number) => ({
    day, checkOn: "2026-09-25", ran: true, treatedDelta: 0, controlDelta: 0, adjustedLift,
    treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0.02, treatedPosDelta: 0,
    controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 3, treatedPostImpressions: 5000,
  });
  it("survives a recompute that could not ask for it again, and is never re-bought", async () => {
    const held = { ...(await ship()), verdict: "inconclusive" as const, windows: [ranWindow(56, 400)] as never };
    const measured = await measureRecord(T, held, LATER, BEHIND_56, new Set());
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
  it("writes the verdict without touching the stamp, and fails closed on a shipment that is not this account's", async () => {
    const record = await ship();
    await upsertShippedChange(record);
    expect(await recordVerification("acct-b", record.id, verification("verified"))).toBe(false);
    expect(await recordVerification(T, "shp_nothing", verification("not_found"))).toBe(false);
    expect((await loadShippedChangesForTenant(T))[0].verification).toBeNull();
    expect(await recordVerification(T, record.id, verification("verified"))).toBe(true);
    const [stored] = await loadShippedChangesForTenant(T);
    expect([stored.verification?.status, stored.implementedAt, stored.shipmentBaseline?.search?.clicks])
      .toEqual(["verified", NOW.toISOString(), 9]);
  });
});
/** THE PRE-MIGRATION WINDOW. The columns are not there yet, the table is, and production reads the table: a write that quietly lands in a file is a write nobody will ever read back. */
describe("when the Shipment columns are not there yet", () => {
  const MISSING_COLUMN = { code: "PGRST204", message: "Could not find the 'implemented_at' column of 'shipped_change_proof' in the schema cache" };
  it("refuses a Shipment it cannot store durably, but still files a pre-Shipment row nothing reads from the table", async () => {
    db.state.upsertError = MISSING_COLUMN;
    await expect(upsertShippedChange(await ship())).rejects.toThrow(/migration/i);
    expect([db.state.rows.length, db.state.file.length]).toEqual([0, 0]);
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
/** PRODUCT TRUTH: start measurement only after implementation is VERIFIED on the live page. Measuring a change I never found there would credit search movement to work that may never have landed. */
describe("measurement waits for the change to be found on the page", () => {
  const LATER = new Date("2026-08-20T12:00:00.000Z"), FINAL = "2026-08-19";
  const due = async (v: ShipmentVerification | null) => isDueForMeasure({ ...(await ship()), verification: v }, FINAL, LATER);
  it("measures a verified or partly verified change, and nothing else", async () => {
    expect(await due(verification("verified"))).toBe(true);
    expect(await due(verification("partially_verified"))).toBe(true);
    // PIN (B): a historical row carrying the retired override label was never actually checked, so it buys no measurement; verification owes it the one real reading it never got.
    expect(await due(verification("operator_confirmed"))).toBe(false);
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
      row("s3", "2026-07-28T00:00:00.000Z", "/shiraz", verification("not_found")), // I looked and nothing is there, so the page is free
      row("s4", "2026-07-29T00:00:00.000Z", "/isfahan", verification("blocked")),  // I could not look, which is when I am least sure: it HOLDS
      row("s5", "2026-05-01T00:00:00.000Z", "/kish", verification("verified")),    // past the window
      { ...legacyRow(), id: "s6", path: "/never-shipped" },                        // no stamp at all
    ];
  });
  it("windows on the stamp, keeps only what is really being measured, and belongs to one account", async () => {
    expect(await pagesUnderMeasurementFromShipments(T, NOW)).toEqual(["/nowruz-guide", "/tehran", "/isfahan"]);
    expect(await pagesUnderMeasurementFromShipments("acct-b", NOW)).toEqual([]);
  });
});

/** MEASUREMENT USED TO NEED A VISITOR: the engine fired only from a Results render, so a verdict waited on somebody opening the page and production sat on sixteen measurable shipments. The scheduled run drives this now, and a reading is only true on screen once Results is rebuilt and only reaches ranking once winner memory re-harvests. */
describe("the measurement pass settles itself, all the way to the screen", () => {
  const result = (over: Record<string, number>) => ({ considered: 16, due: 16, measured: 0, changed: 0, settled: 0, failed: 0, outcomes: [], ...over });
  beforeEach(() => { settle.rebuilt.length = 0; settle.harvested.length = 0; settle.pass.mockReset(); });
  it("rebuilds Results the moment a reading lands, harvests only once a verdict settled, and never throws into the run", async () => {
    settle.pass.mockResolvedValue(result({ measured: 16, changed: 3 }));
    expect([await settleDueMeasurements(T), settle.rebuilt, settle.harvested]).toEqual([16, [T], []]); // the first view serves the fresh truth, and nothing settled yet
    settle.pass.mockResolvedValue(result({ due: 0 }));
    expect([await settleDueMeasurements(T), settle.rebuilt]).toEqual([0, [T]]); // nothing read, so nothing is rebuilt a second time
    settle.pass.mockResolvedValue(result({ due: 1, measured: 1, changed: 1, settled: 1 }));
    await settleDueMeasurements(T); expect(settle.harvested).toEqual([T]); // a won or lost verdict reaches ranking
    settle.pass.mockRejectedValue(new Error("the ledger did not answer"));
    expect(await settleDueMeasurements(T)).toBe(0); // fail-soft: a reading I could not take never pauses the pass that asked for it
  });
});

/** RECORDING IS NOT MEASURING. What the operator applied is a fact and is written down whatever the data says; whether it can be fairly compared is a SEPARATE fact, recorded beside it and never used to refuse the write. The path used to refuse below two comparison pages, so a true implementation left no record at all and the queue offered it back. */
describe("the recording seam", () => {
  const facts = (over: Record<string, unknown> = {}) => ({ ...origin(), tenantId: T, page: PAGE, path: "/nowruz-guide",
    actionType: "title-family", before: "Nowruz", after: "Nowruz Traditions", targetQueries: ["nowruz traditions"], now: NOW, ...over });
  const LIVE_ON = "2026-07-10T00:00:00.000Z", WORDING = "Nowruz Traditions and the Haft-Seen Table";
  const repair = (over: Record<string, unknown> = {}) => recordRepairShipment({ tenantId: T, proposalId: origin().proposalId,
    implementedAt: LIVE_ON, finalWording: WORDING, placement: "the page title", source: "pasted in the CMS", page: PAGE,
    path: "/nowruz-guide", actionType: "title-family", componentsApplied: [{ kind: "title", label: "Page title" }], now: NOW, ...over } as never);
  const stored = async () => (await loadShippedChangesForTenant(T))[0]!;
  beforeEach(() => { ctl.pages = ["https://x.test/a", "https://x.test/b", "https://x.test/c"]; });
  it("records a change with NO comparison pages at all, and names what is missing instead of refusing", async () => {
    ctl.pages = [];
    expect((await recordShipment(facts())).measurement).toBe("insufficient_comparison");
    expect(db.state.rows).toHaveLength(1); // the implementation landed anyway, stamp and all
    expect([(await stored()).measurementState, (await stored()).implementedAt]).toEqual(["insufficient_comparison", NOW.toISOString()]);
  });
  it("records it when Google has nothing finalized, and when this page has no history to count from", async () => {
    gsc.lastFinal.mockResolvedValue(null);
    expect((await recordShipment(facts())).measurement).toBe("measurement_unavailable");
    db.state.rows = []; gsc.lastFinal.mockResolvedValue("2026-07-30"); gsc.window.mockResolvedValue(new Map());
    expect([(await recordShipment(facts())).measurement, db.state.rows.length]).toEqual(["measurement_unavailable", 1]);
    expect((await stored()).shipmentBaseline).toBeNull(); // nothing on file is not zero: no starting point rather than a row of zeros
  });
  it("measures when the comparison is really there, and a second press rewrites nothing", async () => {
    const first = await recordShipment(facts());
    expect([first.measurement, (await stored()).measurementState]).toEqual(["measuring", "measuring"]);
    await recordVerification(T, first.shipmentId, verification("verified"));
    const again = await recordShipment(facts());
    expect([again.shipmentId, again.measurement, db.state.rows.length]).toEqual([first.shipmentId, "measuring", 1]);
    expect((await stored()).verification?.status).toBe("verified"); // the check was not erased back to due
  });
  // THE REPAIR DOOR: a change that went live before anything wrote it down, from what the operator supplies and nothing else.
  it("records a change that was already live, claims no before-state, and still owes the live check", async () => {
    expect((await repair()).measurement).toBe("verification_needed");
    const row = await stored();
    expect([row.preChangeHashUnavailable, row.preChangeContentHash, row.before, row.verification]).toEqual([true, null, null, null]);
    expect([row.implementedAt, row.componentsApplied?.[0]?.after]).toEqual([LIVE_ON, WORDING]); // windows count from the day it went live; the check looks for this
    expect(row.operatorNote).toMatch(/Placement: the page title\. Source: pasted in the CMS\./);
    expect(gsc.window.mock.calls.some((c) => (c[0] as { start?: string }).start === "2026-06-12")).toBe(true); // the 28 days BEFORE it went live
  });
  it("repairs idempotently on the same account of it, and stays honest when there is nothing to compare", async () => {
    const first = await repair();
    expect([(await repair()).shipmentId, db.state.rows.length]).toEqual([first.shipmentId, 1]);
    db.state.rows = []; ctl.pages = [];
    expect((await repair()).measurement).toBe("insufficient_comparison");
  });
});

/** THE STARTING NUMBERS ARE FROZEN OVER THIS CHANGE'S OWN SEARCHES, at mark time, once: the account-wide
 *  day compared an account-wide before against a scope-filtered after, two different measures. */
describe("the AI baseline is frozen over the change's own scope (AEO reconstruction, 2026-08-19)", () => {
  const SITE = "https://www.fixture-outdoors.example", DAY = "2026-07-30";
  const link = (domain: string) => ({ url: `https://${domain}/page`, domain, title: null });
  const journey = (over: Record<string, unknown> = {}) =>
    ({ fan_outs: null, brand_mentions: null, web_search_reported: null, retrieved_results: null, cited_sources: null, ...over });
  const answer = (over: Record<string, unknown> = {}) => ({
    id: "obs-1", tenant_id: T, site: SITE, prompt_id: "p1", prompt_version: 1, prompt_text: "where should I go",
    engine: "chatgpt", model_requested: null, model_served: "gpt-5", observation_mode: "api", reporting_day: DAY,
    sample_slot: 0, language: "en", location: 2840, requested_at: `${DAY}T09:00:00.000Z`, completed_at: null,
    capability_version: "v1", cache_key: null, cost_usd: 0, status: "observed", failure_reason: null,
    answer_text: "an answer", answer_hash: "abc", journey: journey(),
    analysis: { ownedBrandMention: { mentioned: true } }, analysis_hash: "abc", ...over });
  const SCOPE = { promptIds: ["p1"], engines: [], fanouts: [], stage: "owned_retrieved_not_cited" };
  it("counts sources, instrument and objective over the scope's own answers, and nobody else's", async () => {
    const rows = [
      answer({ id: "o1", journey: journey({ cited_sources: [link("www.fixture-outdoors.example")] }) }),
      answer({ id: "o2", journey: journey({ cited_sources: [link("rival.example")], retrieved_results: [link("fixture-outdoors.example")] }) }),
      answer({ id: "o3", prompt_id: "p9", prompt_text: "best rugs to buy" }),  // another change's search, on the same day
      answer({ id: "o4", reporting_day: "2026-06-01" }),                       // in scope, but an older day
    ];
    ai.records.mockImplementation(async (_t: string, o: { day?: string }) => rows.filter((r) => o.day == null || r.reporting_day === o.day));
    await upsertShippedChange(await ship({ shipment: origin({ aiScope: SCOPE }) as never }));
    const held = (await loadShippedChangesForTenant(T))[0].shipmentBaseline?.ai;
    expect(held).toMatchObject({
      day: DAY, checked: 2, analyzed: 2, mentioning: 2,          // o3 asks another search and o4 is another day
      citationSample: 2, ownedCiting: 1, rankSum: 1, rankCount: 1,
      retrievalSample: 1, ownedRetrieved: 1, retrievedNotCited: 1, // read the page and credited a rival
      engines: ["chatgpt"], models: ["gpt-5"], modes: ["api"],
      // THE YARDSTICK RIDES THE STARTING NUMBERS, so no later read may pick its own.
      objective: "ai_citation_conversion",
    });
    expect(held?.scopeFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
  it("records the implementation with no AI starting numbers when the scope's answers are not on file", async () => {
    ai.records.mockResolvedValue([]);
    await upsertShippedChange(await ship({ shipment: origin({ aiScope: SCOPE }) as never }));
    const [stored] = await loadShippedChangesForTenant(T);
    // The change is on file, stamp and all; the AI half is honestly absent and is never rebuilt later.
    expect([stored.implementedAt, stored.shipmentBaseline?.ai]).toEqual([NOW.toISOString(), null]);
    expect(stored.shipmentBaseline?.search?.clicks).toBe(9);
  });
});

describe("the typed AI scope survives the press whole (AEO reconstruction, 2026-08-19)", () => {
  it("stores prompt ids, assistants and the fan-out cluster typed, never flattened into targetQueries", async () => {
    const scope = { promptIds: ["p1"], engines: ["chatgpt", "gemini"], fanouts: ["haft seen table items list"], stage: "owned_retrieved_not_cited" };
    await recordShipment({ ...origin(), tenantId: T, page: PAGE, path: "/nowruz-guide", actionType: "title-family",
      before: "Nowruz", after: "Nowruz Traditions", targetQueries: ["nowruz traditions"], basis: null, caseId: null,
      judgedMetric: "ai_mentions", aiScope: scope, now: new Date("2026-07-15T00:00:00.000Z") } as Parameters<typeof recordShipment>[0]);
    const row = (await loadShippedChangesForTenant(T))[0]!;
    expect(row.aiScope).toEqual(scope); // exactly what the card claimed, remeasurable
    expect(row.targetQueries).toEqual(["nowruz traditions"]); // and the Google scope is untouched by it
  });
});

/** THE TWO BASELINES FREEZE INDEPENDENTLY, AND ONE DECLARATION DRIVES BOTH (reviewer, 2026-08-19): the AI
 *  numbers were captured only where Google already had something to say, so a new or quiet page lost the
 *  baseline of exactly the change it existed for. */
describe("an AI change on a page Google cannot see yet still measures", () => {
  it("derives the judged metric from the scope the baseline is frozen over, not from the impact block", async () => {
    const { objectiveOfStage } = await import("@/domains/measurement/shipment-ai-outcome");
    // The card carries a stage on its scope. That is the one the press reads, so the metric and the
    // baseline can never name two different things.
    expect(objectiveOfStage("rivals_cited_own_not_retrieved")).toBe("ai_retrieval");
    expect(objectiveOfStage("owned_retrieved_not_cited")).toBe("ai_citation_conversion");
    expect(objectiveOfStage("owned_mentioned_not_cited")).toBe("ai_citation");
    expect(objectiveOfStage("citations_unreported")).toBe("ai_citation"); // a reporting gap is never a mention problem
    expect(objectiveOfStage(null)).toBe("ai_mentions");
  });
});
