/** THE CANONICAL SHIPMENT (V1 Truth Convergence Phase 6). Protected here: ONE Shipment per (proposal, version applied) and a retry that heals instead of duplicating; a partial bundle stored as one; the stamp and the starting numbers written exactly once; pre-Phase-6 rows still decoding; a check naming another account's Shipment landing nothing; and the 28-day ranking window read from the stamp. Fixtures only: the fake Postgres below holds the rows. */
import { describe, it, expect, beforeEach, vi } from "vitest";
const db = vi.hoisted(() => ({ state: { rows: [] as Row[], file: [] as Row[], offline: false, upsertError: null as Row | null, updateError: null as Row | null }, client: {} as Record<string, unknown> }));
const gsc = vi.hoisted(() => ({ window: vi.fn(), lastFinal: vi.fn() }));
const ai = vi.hoisted(() => ({ views: vi.fn(), records: vi.fn() }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { if (db.state.offline) throw new Error("no Supabase configured"); return db.client; } }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "acct-a" }));
vi.mock("@/lib/persistence/json-store", () => ({ readStore: async () => db.state.file, writeStore: async (_store: string, rows: Row[]) => { db.state.file = rows; } }));
vi.mock("@/lib/tenant", () => ({ getDataDir: () => "/tmp/beacon-fixture" }));
vi.mock("@/domains/account/tenants/store", () => ({ getTenant: async () => null }));
const invalidations = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/app/(shell)/results/results-surface-store", () => ({ invalidateResultsSurface: async () => { invalidations.n += 1; } }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {} }));
const storeReads = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => { storeReads.n += 1; return new Map(); } }));
vi.mock("@/domains/measurement/proof-gsc/gsc-window", () => ({ readWindowForPages: async (...args: unknown[]) => { const read = await gsc.window(...args); return read?.status ? read : { status: "available", data: read }; }, readLastFinalizedDate: gsc.lastFinal, readCumulativeSince: async () => ({ status: "available", data: new Map() }) }));
const ctl = vi.hoisted(() => ({ pages: [] as string[] }));
vi.mock("@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() }), assemblePacketForUrl: () => ({ gsc: null }), topPagesByDemand: () => ctl.pages,}));
vi.mock("@/domains/evidence/ai-visibility/ai-observations", async (orig) => ({ ...((await orig()) as object), readAiObservationViews: ai.views, readAiObservations: ai.records }));
const settle = vi.hoisted(() => ({ pass: vi.fn(), rebuilt: [] as string[], harvested: [] as string[] }));
vi.mock("@/domains/measurement/proof-gsc/auto-measure-pass", () => ({ autoMeasureDuePass: settle.pass }));
vi.mock("@/app/(shell)/results/results-ledger-data", () => ({ rebuildResultsSurface: async (t: string) => void settle.rebuilt.push(t) }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ harvestWinners: async (t: string) => void settle.harvested.push(t) }));
import { settleDueMeasurements } from "@/domains/measurement/proof-gsc/auto-measure-on-use";
import { measureRecord, recordShippedChange } from "@/domains/measurement/proof-gsc/measure-pass";
import { recordRepairShipment, recordShipment } from "@/domains/measurement/proof-gsc/record-shipment";
import { isDueForMeasure } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import { loadShippedChangesForTenant, pagesUnderMeasurementFromShipments, recordVerification, upsertShippedChange, type ShipmentVerification, type ShippedChangeRecord } from "@/domains/measurement/proof-gsc/shipped-change-store";
import { SHIPMENT_PROOF } from "@/domains/measurement/proof-gsc/shipment-proof";
import { learningFromShipments, treatmentLearning } from "@/domains/measurement/treatment-learning";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
Object.assign(db.client, supabaseFake({ rows: () => db.state.rows, same: (stored, sent) => stored.tenant_id === sent.tenant_id && stored.id === sent.id,
  error: (_t, op) => (op === "update" ? db.state.updateError : op === "upsert" ? db.state.upsertError : null) as { message: string } | null }));
const T = "acct-a", NOW = new Date("2026-07-31T12:00:00.000Z");
const PAGE = "https://www.fixture-outdoors.example/nowruz-guide";
const COMPONENTS = [{ kind: "title", label: "Page title" }, { kind: "opening_answer", label: "Opening answer" }];
const origin = (over: Record<string, unknown> = {}) => ({
  proposalId: `${T}::/nowruz-guide::existing_edit::bundle`, proposalVersion: "v-abc123", basis: "basis_today::d6", caseId: null,
  bundleHypothesis: "Say what the searcher asked for in the line Google shows.", componentsApplied: COMPONENTS, implementedAt: NOW.toISOString(), preChangeContentHash: "hash-before", ...over,});
const ship = (over: Record<string, unknown> = {}) => recordShippedChange({
  tenantId: T, page: PAGE, path: "/nowruz-guide", actionType: "title-family", before: "Nowruz", shippedAt: NOW.toISOString(), now: NOW, shipment: origin() as never,
  after: "Nowruz Traditions and the Haft-Seen Table", targetQueries: ["nowruz traditions"], controlPages: ["https://x.test/a", "https://x.test/b"], ...over });
const legacyRow = (): Row => ({
  tenant_id: T, id: "/cities::2026-06-20", page: "https://www.fixture-outdoors.example/cities", path: "/cities", action_type: "meta", before_text: "old", after_text: "new",
  shipped_at: "2026-06-20T00:00:00.000Z", baseline: { clicks: 5, impressions: 400, ctr: 0.0125, position: 12, windowDays: 28 }, target_queries: [], control_pages: [], windows: [],
  verdict: "measuring", confidence: "low", measured_at: null, notes: null, verified_live: false, live_source_url: null, recrawl_requested_at: null, created_at: "2026-06-20T00:00:00.000Z", updated_at: "2026-06-20T00:00:00.000Z",});
const withSiteHistory = (clicks = 9, matched: Array<[string, unknown]> = []) => gsc.window.mockImplementation(async (a: { siteTotal?: { key: string } }) => new Map<string, unknown>([[PAGE, { clicks, impressions: 1200, ctr: clicks / 1200, position: 14 }], ...matched, ...(a.siteTotal ? [[a.siteTotal.key, { clicks: 900, impressions: 120000, ctr: 0.0075, position: 14 }] as [string, unknown]] : [])]));
const verification = (status: ShipmentVerification["status"]): ShipmentVerification => ({ status, checkedAt: "2026-08-02T00:00:00.000Z", components: [{ kind: "title", state: "verified", note: null }] });
const ranWindow = (day: number, adjustedLift: number, controlsUsed = 3) => ({ day, checkOn: "2026-09-25", ran: true, treatedDelta: 0, controlDelta: 0, adjustedLift, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0.02, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0, controlsUsed, treatedPostImpressions: 5000,});
beforeEach(() => {
  Object.assign(db.state, { rows: [], file: [], offline: false, upsertError: null, updateError: null });
  [gsc.window, gsc.lastFinal, ai.views, ai.records].forEach((m) => m.mockReset()); ai.records.mockResolvedValue([]);
  gsc.window.mockResolvedValue(new Map([[PAGE, { clicks: 9, impressions: 1200, ctr: 0.0075, position: 14 }]])); gsc.lastFinal.mockResolvedValue("2026-07-30");
  const seen = (slot: number, day: string, mentioned: boolean) => ({ slot, day, status: "observed", analysis: { ownedBrandMention: { mentioned } }, analysisHash: "x", answerHash: "x" }); // Three answers on the latest day, two of them naming this site, and one older day nothing may count: the starting number is the LATEST day's, and it is the whole of that day.
  ai.views.mockResolvedValue([seen(0, "2026-07-30", true), seen(0, "2026-07-30", false), seen(1, "2026-07-30", true), seen(0, "2026-06-01", true)]);});
describe("the canonical Shipment", () => {
  it("a measure loop invalidates the release once, never once per record", async () => {
    const { upsertShippedChange, invalidateResultsSurfaceSafe } = await import("@/domains/measurement/proof-gsc/shipped-change-store"); invalidations.n = 0;
    for (let i = 0; i < 3; i += 1) await upsertShippedChange(await ship({ path: `/loop-${i}` }), T, { invalidate: false });
    expect(invalidations.n, "silent per-record writes").toBe(0); await invalidateResultsSurfaceSafe();
    expect(invalidations.n, "one invalidation for the whole pass").toBe(1); await upsertShippedChange(await ship({ path: "/single" }), T);
    expect(invalidations.n, "a lone upsert still tells the surface").toBe(2); });
  it("records ONE shipment with the stamp, the components and both starting numbers", async () => {
    await upsertShippedChange(await ship()); expect(db.state.rows).toHaveLength(1); const [stored] = await loadShippedChangesForTenant(T);
    expect(stored.proposalId).toBe(`${T}::/nowruz-guide::existing_edit::bundle`);
    expect(stored.proposalVersion).toBe("v-abc123"); expect(stored.basis).toBe("basis_today::d6");
    expect(stored.bundleHypothesis).toMatch(/line Google shows/); expect(stored.implementedAt).toBe(NOW.toISOString());
    expect(stored.preChangeContentHash).toBe("hash-before"); expect(stored.componentsApplied).toEqual(COMPONENTS); expect(stored.shipmentBaseline?.search?.clicks).toBe(9);
    expect(stored.shipmentBaseline?.ai).toEqual({ day: "2026-07-30", checked: 2, analyzed: 2, mentioning: 1 });
    expect(stored.verification).toBeNull(); db.state.rows = []; db.state.file = []; // nobody has checked it, and that null makes it due; and their own account of it is a NOTE, never an answer: it rides along and the live check is still owed
    await upsertShippedChange(await ship({ shipment: origin({ operatorNote: "I pasted it into my site myself." }) as never }));
    const [noted] = await loadShippedChangesForTenant(T);
    expect([noted.operatorNote, noted.verification]).toEqual(["I pasted it into my site myself.", null]); });
  it("counts the AI starting number over the WHOLE day, and writes down how many of it were read closely", async () => {
    const DAY = "2026-07-30";
    const day = (analysed: number) => Array.from({ length: 140 }, (_, i) => ({ slot: 0, status: "observed", day: DAY, analysis: i < analysed ? { ownedBrandMention: { mentioned: i < analysed * 0.6 } } : null, analysisHash: i < analysed ? "x" : null, answerHash: "x" }));
    const serve = (rows: Record<string, unknown>[]) => ai.views.mockImplementation(async (_t: string, o: { day?: string; limit?: number }) => (o?.day === DAY ? rows : rows.slice(0, o?.limit ?? 60)));
    serve(day(140)); await upsertShippedChange(await ship()); expect((await loadShippedChangesForTenant(T))[0].shipmentBaseline?.ai).toEqual({ day: DAY, checked: 140, analyzed: 140, mentioning: 84 });
    db.state.rows = []; db.state.file = []; serve(day(100));
    await upsertShippedChange(await ship()); expect((await loadShippedChangesForTenant(T))[0].shipmentBaseline?.ai).toEqual({ day: DAY, checked: 140, analyzed: 100, mentioning: 60 });});
  it("heals a retried press instead of recording the change twice", async () => {
    const first = await ship(); await upsertShippedChange(first); const retry = await ship(); await upsertShippedChange(retry);
    expect(retry.id).toBe(first.id); expect(db.state.rows).toHaveLength(1);});
  it("stores a partial bundle as a partial bundle, and keeps the exact copy each piece carried", async () => {
    await upsertShippedChange(await ship({ shipment: origin({ componentsApplied: [COMPONENTS[0]] }) as never })); expect((await loadShippedChangesForTenant(T))[0].componentsApplied).toEqual([COMPONENTS[0]]);
    const withCopy = [{ kind: "title", label: "Page title", after: "Nowruz Traditions and the Haft-Seen Table" }];
    db.state.rows = []; db.state.file = [];
    await upsertShippedChange(await ship({ shipment: origin({ componentsApplied: withCopy }) as never })); expect((await loadShippedChangesForTenant(T))[0].componentsApplied).toEqual(withCopy);});
  it("writes the stamp and the starting numbers once: a later writer keeps what is on file", async () => {
    await upsertShippedChange(await ship()); const first = (await loadShippedChangesForTenant(T))[0];
    await upsertShippedChange({ ...first, implementedAt: "2026-08-07T00:00:00.000Z", shipmentBaseline: { search: { clicks: 400, impressions: 9000, ctr: 0.044, position: 3, windowDays: 28 }, ai: null, capturedAt: "2026-08-07T00:00:00.000Z" } });
    const [after] = await loadShippedChangesForTenant(T); expect([after.implementedAt, after.shipmentBaseline?.search?.clicks]).toEqual([NOW.toISOString(), 9]);});
  it("still decodes a record written before there were Shipments", async () => {
    db.state.rows.push(legacyRow()); const [stored] = await loadShippedChangesForTenant(T); expect(stored.path).toBe("/cities"); expect(stored.baseline.clicks).toBe(5);
    expect([stored.proposalId, stored.implementedAt, stored.shipmentBaseline, stored.verification]) .toEqual([null, null, null, null]);
    const at = new Date("2026-10-01T00:00:00.000Z"), measure = (r: ShippedChangeRecord) => measureRecord(T, r, at, "2026-09-05", new Set());
    const fixed = await measure(stored); expect([fixed.primaryWindowDays, fixed.judgedMetric, fixed.notes]).toEqual([28, "clicks", "Stamped the reading plan and the yardstick this change is judged on, where they were missing: a change without them can never resolve."]);
    const again = await measure({ ...stored, primaryWindowDays: 14, judgedMetric: "ai_citation", notes: "kept" });
    expect([again.primaryWindowDays, again.judgedMetric, again.notes], "a stamped plan is never overwritten and the note is never written twice").toEqual([14, "ai_citation", "kept"]);
    const closesOn = async (over: Partial<ShippedChangeRecord>) => (await measure({ ...stored, ...over })).windows.find((w) => w.day === 7)?.checkOn;
    expect([await closesOn({}), await closesOn({ lastCrawlAt: "2026-07-03T09:00:00.000Z" })]).toEqual(["2026-06-27", "2026-07-10"]);
    db.state.rows = [{ ...legacyRow(), recrawl_requested_at: "2026-06-22T00:00:00.000Z" }, { ...legacyRow(), id: "/fresh::2026-06-20", path: "/fresh", recrawl_requested_at: "2026-09-03T10:00:00.000Z" }];
    const [old, fresh] = (await loadShippedChangesForTenant(T)).sort((a, b) => a.path.localeCompare(b.path));
    expect([old!.lastCrawlAt, fresh!.lastCrawlAt]).toEqual([null, "2026-09-03T10:00:00.000Z"]);
    expect(await closesOn({ lastCrawlAt: old!.lastCrawlAt }), "the June row counts from its ship date exactly as it always did").toBe("2026-06-27");});});
describe("recording what the live check found", () => {
  it("carries a day-56 reading through a recompute that could not ask for it again, and never re-buys it", async () => {
    const held = { ...(await ship()), verdict: "inconclusive" as const, windows: [ranWindow(56, 400)] as never };
    const measured = await measureRecord(T, held, new Date("2026-10-01T00:00:00.000Z"), "2026-09-05", new Set());
    expect(measured.windows.map((w) => w.day)).toEqual([7, 14, 28, 56]); expect(measured.windows.find((w) => w.day === 56)?.adjustedLift).toBe(400);
    expect(gsc.window.mock.calls.some((c) => (c[0] as { end?: string }).end === "2026-09-25")).toBe(false);
    expect(measured.verdict).toBe("won");});
  it("writes the verdict without touching the stamp, and fails closed on a shipment that is not this account's", async () => {
    const record = await ship(); await upsertShippedChange(record); expect(await recordVerification("acct-b", record.id, verification("verified"))).toBe(false);
    expect(await recordVerification(T, "shp_nothing", verification("not_found"))).toBe(false);
    expect((await loadShippedChangesForTenant(T))[0].verification).toBeNull(); expect(await recordVerification(T, record.id, verification("verified"))).toBe(true);
    expect([(await loadShippedChangesForTenant(T)).length, ...[(await loadShippedChangesForTenant(T))[0]].map((s) => [s.verification?.status, s.implementedAt, s.shipmentBaseline?.search?.clicks, s.after])], "A FAILED CHECK CANNOT ERASE, DUPLICATE OR ROLL BACK AN APPLIED CHANGE: two refusals and one write later the shipment is there exactly once, with the stamp, the starting numbers and the applied copy it was recorded with").toEqual([1, ["verified", NOW.toISOString(), 9, record.after]]);});});
describe("when the Shipment columns are not there yet", () => {
  const MISSING_COLUMN = { code: "PGRST204", message: "Could not find the 'implemented_at' column of 'shipped_change_proof' in the schema cache" };
  it("refuses a Shipment it cannot store durably, but still files a pre-Shipment row nothing reads from the table", async () => {
    db.state.upsertError = MISSING_COLUMN; await expect(upsertShippedChange(await ship())).rejects.toThrow(/migration/i); expect([db.state.rows.length, db.state.file.length]).toEqual([0, 0]);
    await upsertShippedChange(await ship({ shipment: undefined })); expect(db.state.file).toHaveLength(1);});
  it("keeps working with no database at all: the record and its answer both land in the local ledger", async () => {
    db.state.offline = true; const record = await ship(); await upsertShippedChange(record); expect(db.state.file).toHaveLength(1);
    expect(await recordVerification(T, record.id, verification("verified"))).toBe(true); expect((db.state.file[0] as { verification?: ShipmentVerification }).verification?.status).toBe("verified");
    expect(await recordVerification(T, "shp_nobody-holds-this", verification("verified"))).toBe(false);});
  it("saves what the check found to the file when the column is missing, rather than re-owing the check forever", async () => {
    const record = await ship(); await upsertShippedChange(record); // the table takes the row, and the file mirrors it
    db.state.updateError = { code: "PGRST204", message: "Could not find the 'verification' column of 'shipped_change_proof' in the schema cache" };
    expect(await recordVerification(T, record.id, verification("verified"))).toBe(true); expect((db.state.file[0] as { verification?: ShipmentVerification }).verification?.status).toBe("verified");});});
describe("measurement waits for the change to be found on the page", () => {
  const LATER = new Date("2026-08-20T12:00:00.000Z"), FINAL = "2026-08-19";
  const due = async (v: ShipmentVerification | null) => isDueForMeasure({ ...(await ship()), verification: v }, FINAL, LATER);
  it("measures a verified or partly verified change, and nothing else", async () => {
    expect(await due(verification("verified"))).toBe(true); expect(await due(verification("partially_verified"))).toBe(true);
    expect(await due(null)).toBe(false);            // never checked: there is nothing honest to measure yet
    expect(await due(verification("not_found"))).toBe(false); expect(await due(verification("blocked"))).toBe(false); expect(await due(verification("differs"))).toBe(false);
    const state = async (over: Partial<ShippedChangeRecord>) => isDueForMeasure({ ...(await ship()), verification: verification("verified"), updatedAt: "2026-08-19T00:00:00.000Z", ...over }, FINAL, LATER);
    expect([await state({ measurementState: "insufficient_comparison" }), await state({ measurementState: "measurement_unavailable" }), await state({ measurementState: "insufficient_comparison", updatedAt: "2026-08-20T01:00:00.000Z" }), await state({ measurementState: "insufficient_comparison", lastCrawlAt: "2026-07-01T00:00:00.000Z" })]).toEqual([true, true, false, false]);});
  it("keeps measuring a record written before there were Shipments, which has no answer to wait for", async () => {
    const legacy = { ...(await ship()), implementedAt: null, verification: null }; expect(isDueForMeasure(legacy, FINAL, LATER)).toBe(true);});});
describe("what is still under measurement", () => {
  const row = (id: string, implementedAt: string, path: string, v: ShipmentVerification | null): Row => ({ ...legacyRow(), id, path, page: `https://www.fixture-outdoors.example${path}`, implemented_at: implementedAt, verification: v, proposal_id: `p-${id}` });
  beforeEach(() => {
    db.state.rows = [row("s1", "2026-07-25T00:00:00.000Z", "/nowruz-guide", null), row("s2", "2026-07-20T00:00:00.000Z", "/tehran", verification("verified")),
      row("s3", "2026-07-28T00:00:00.000Z", "/shiraz", verification("not_found")), row("s4", "2026-07-29T00:00:00.000Z", "/isfahan", verification("blocked")),
      row("s5", "2026-05-01T00:00:00.000Z", "/kish", verification("verified")), { ...legacyRow(), id: "s6", path: "/never-shipped" }];});
  it("windows on the stamp, keeps only what is really being measured, and belongs to one account", async () => {
    expect(await pagesUnderMeasurementFromShipments(T, NOW), "named by the spelling that carries a host: a bare path is matched downstream by a suffix test, so /isfahan claimed every address ending in it").toEqual(["https://www.fixture-outdoors.example/nowruz-guide", "https://www.fixture-outdoors.example/tehran", "https://www.fixture-outdoors.example/isfahan"]); expect(await pagesUnderMeasurementFromShipments("acct-b", NOW)).toEqual([]);});});
describe("the measurement pass settles itself, all the way to the screen", () => {
  const result = (over: Record<string, number>) => ({ considered: 16, due: 16, measured: 0, changed: 0, settled: 0, revived: 0, reopened: 0, crawlStamped: 0, failed: 0, outcomes: [], ...over });
  beforeEach(() => { settle.rebuilt.length = 0; settle.harvested.length = 0; settle.pass.mockReset(); });
  it("rebuilds Results the moment a reading lands, harvests only once a verdict settled, and never throws into the run", async () => {
    settle.pass.mockResolvedValue(result({ measured: 16, changed: 3 })); // the first view serves the fresh truth
    expect([await settleDueMeasurements(T), settle.rebuilt, settle.harvested]).toEqual([16, [T], []]); settle.pass.mockResolvedValue(result({ due: 0 })); // and nothing settled yet
    expect([await settleDueMeasurements(T), settle.rebuilt]).toEqual([0, [T]]); // nothing read, so nothing is rebuilt a second time
    settle.pass.mockResolvedValue(result({ due: 1, measured: 1, changed: 1, settled: 1 })); await settleDueMeasurements(T); expect(settle.harvested).toEqual([T]); // a won or lost verdict reaches ranking
    settle.pass.mockRejectedValue(new Error("the ledger did not answer"));
    expect(await settleDueMeasurements(T)).toBe(0); // fail-soft: a reading I could not take never pauses the pass that asked for it
  });});
describe("the recording seam", () => {
  const facts = (over: Record<string, unknown> = {}) => ({ ...origin(), tenantId: T, page: PAGE, path: "/nowruz-guide", actionType: "title-family", before: "Nowruz", after: "Nowruz Traditions", targetQueries: ["nowruz traditions"], now: NOW, ...over });
  const LIVE_ON = "2026-07-10T00:00:00.000Z", WORDING = "Nowruz Traditions and the Haft-Seen Table";
  const repair = (over: Record<string, unknown> = {}) => recordRepairShipment({ tenantId: T, proposalId: origin().proposalId, implementedAt: LIVE_ON, finalWording: WORDING,
    placement: "the page title", source: "pasted in the CMS", page: PAGE, path: "/nowruz-guide", actionType: "title-family", componentsApplied: [{ kind: "title", label: "Page title" }], now: NOW, ...over } as never);
  const stored = async () => (await loadShippedChangesForTenant(T))[0]!;
  beforeEach(() => { ctl.pages = ["https://x.test/a", "https://x.test/b", "https://x.test/c"]; });
  it("makes no second record when a change is processed again unchanged, keeps its stamp and the live check already on it, and gives each account its own one record", async () => {
    withSiteHistory();
    for (const tenant of ["acct-one", "acct-two"]) {
      db.state.rows = []; db.state.file = [];
      const first = await recordShipment(facts({ tenantId: tenant }) as never);
      await recordVerification(tenant, first.shipmentId, verification("verified"));
      const again = await recordShipment(facts({ tenantId: tenant }) as never); // the same change, reprocessed with nothing about it changed
      const [row] = await loadShippedChangesForTenant(tenant);
      expect([again.shipmentId === first.shipmentId, db.state.rows.length, row!.implementedAt, row!.verification?.status], "the same record, one row for this account, the day it was applied unmoved, and the reading it already has left exactly as it stands").toEqual([true, 1, NOW.toISOString(), "verified"]);
    }
    db.state.rows = []; db.state.file = []; // and two accounts applying the same-shaped change keep one record each, never one shared row
    await recordShipment(facts({ tenantId: "acct-one" }) as never); await recordShipment(facts({ tenantId: "acct-two" }) as never);
    expect([(await loadShippedChangesForTenant("acct-one")).length, (await loadShippedChangesForTenant("acct-two")).length, db.state.rows.length]).toEqual([1, 1, 2]); });
  it("a batch of ten records ten Shipments off one ledger read and one open-changes read, invalidates nothing per row, and a retry adds none", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => facts({ proposalId: `${T}::/p${i}::existing_edit::missing_description`, page: `https://www.fixture-outdoors.example/p${i}`, path: `/p${i}` }));
    storeReads.n = 0; invalidations.n = 0; const ledger = await loadShippedChangesForTenant(T);
    for (const f of ten) await recordShipment(f as never, { preloadedLedger: ledger, openPaths: ["/elsewhere"], invalidate: false });
    expect([db.state.rows.length, storeReads.n, invalidations.n], "ten rows, no store read, no per-row invalidation").toEqual([10, 0, 0]);
    for (const f of ten) await recordShipment(f as never, { preloadedLedger: await loadShippedChangesForTenant(T), openPaths: ["/elsewhere"], invalidate: false });
    expect(db.state.rows.length, "a retry of the same ten writes nothing").toBe(10); });
  it("records a change with NO comparison pages at all, and names what is missing instead of refusing", async () => {
    ctl.pages = []; // NOTHING MATCHED IS NOT NOTHING TO MEASURE (operator, 2026-09-03): whole families ship on one day, so the site's own movement stands in and the row stays measurable instead of being stamped dead at record time with nothing ever asking again.
    withSiteHistory();
    expect((await recordShipment(facts())).measurement).toBe("measuring"); expect(db.state.rows).toHaveLength(1); // the implementation landed anyway, stamp and all
    expect([(await stored()).measurementState, (await stored()).implementedAt]).toEqual(["measuring", NOW.toISOString()]);
    const measured = await measureRecord(T, await stored(), new Date("2026-10-01T00:00:00.000Z"), "2026-09-05", new Set()); const { readLedger } = await import("@/domains/measurement/proof-gsc/kernel");
    expect(measured.windows.find((w) => w.day === 28)?.comparedToSite).toBe(true);
    expect(readLedger([measured], new Date("2026-10-01T00:00:00.000Z"), "2026-09-05")[0].headline).toContain("Measured against the site's own movement, because too few untouched pages matched this one. That is a weaker comparison than matched pages, and a rise the whole site shared shows up here as no change.");
    await upsertShippedChange(measured, T); expect((await stored()).windows.find((w) => w.day === 28)?.comparedToSite, "the basis survives the store, so a reader downstream can tell a site reading from a matched one").toBe(true);
    withSiteHistory(5);
    const thin = readLedger([await measureRecord(T, await stored(), new Date("2026-10-01T00:00:00.000Z"), "2026-09-05", new Set())], new Date("2026-10-01T00:00:00.000Z"), "2026-09-05")[0];
    expect([thin.comparison, thin.headline]).toEqual(["insufficient", "The change is recorded. Its effect cannot be separated from the rest of the site yet."]);});
  it("records it when Google has nothing finalized, and when this page has no history to count from", async () => {
    gsc.lastFinal.mockResolvedValue(null); expect((await recordShipment(facts())).measurement).toBe("measurement_unavailable");
    db.state.rows = []; gsc.lastFinal.mockResolvedValue("2026-07-30"); gsc.window.mockResolvedValue(new Map());
    expect([(await recordShipment(facts())).measurement, db.state.rows.length]).toEqual(["measurement_unavailable", 1]);
    expect((await stored()).shipmentBaseline).toBeNull(); // nothing on file is not zero: no starting point rather than a row of zeros
    const noHistory = await measureRecord(T, await stored(), new Date("2026-08-30T12:00:00Z"), "2026-08-30", new Set()); expect([noHistory.windows.some((w) => w.ran), noHistory.measuredAt]).toEqual([false, null]);
    withSiteHistory();
    const revive = async (state: string, final: string | null = "2026-09-05", controls: string[] = []) => (await measureRecord(T, { ...(await ship({ controlPages: controls })), measurementState: state as never }, new Date("2026-10-01T00:00:00.000Z"), final, new Set())).measurementState;
    expect([await revive("insufficient_comparison"), await revive("measurement_unavailable"), await revive("verification_needed"), await revive("measuring"), await revive("insufficient_comparison", null)]).toEqual(["measuring", "measuring", "verification_needed", "measuring", "insufficient_comparison"]);
    gsc.window.mockResolvedValue(new Map([[PAGE, { clicks: 9, impressions: 1200, ctr: 0.0075, position: 14 }]])); // three comparison pages stored, none of them carrying search data, and no site history either
    expect(await revive("insufficient_comparison", "2026-09-05", ["https://x.test/a", "https://x.test/b", "https://x.test/c"]), "stored is not usable: with no basis at all nothing is promoted over a reading that says so").toBe("insufficient_comparison");
    withSiteHistory(); const { autoMeasureDuePass } = await vi.importActual<typeof import("@/domains/measurement/proof-gsc/auto-measure-pass")>("@/domains/measurement/proof-gsc/auto-measure-pass");
    db.state.rows = []; db.state.file = []; const NEXT_DAY = new Date("2026-10-01T12:00:00.000Z");
    await upsertShippedChange({ ...(await ship({ path: "/dead" })), measurementState: "insufficient_comparison", verification: verification("verified"), updatedAt: "2026-09-30T00:00:00.000Z" }, T);
    await upsertShippedChange({ ...(await ship({ path: "/stuck" })), id: "shp_stuck", verification: { status: "blocked", checkedAt: "2026-08-02T00:00:00.000Z", components: [], checks: 1 } }, T);
    await upsertShippedChange({ ...(await ship({ path: "/names-nothing" })), id: "shp_names_nothing", verification: { status: "blocked", checkedAt: "2026-08-02T00:00:00.000Z", components: [], checks: 1, reason: "applied_wording_missing" } }, T); // A RECORD RECONCILED FROM ITSELF IS NOT A STUCK ROW: it closes with no next date under the limit, so this repair rescheduled it, the reading closed it from the record again at zero cost, and the two wrote each other a row every pass for ever
    const pass = await autoMeasureDuePass(T, { now: NEXT_DAY });
    expect([pass.due, pass.measured, pass.revived, pass.reopened], "one dead row read and revived, one stopped check put back on its schedule, and the record that names nothing to look for left alone: when THAT one comes back is the due door's own question").toEqual([1, 1, 1, 1]);
    expect((await loadShippedChangesForTenant(T)).map((r) => [r.path, r.measurementState, r.verification?.recheckAfter ?? null]).sort())
      .toEqual([["/dead", "measuring", null], ["/names-nothing", null, null], ["/stuck", null, "2026-10-01"]]); });
  it("records implementation without inventing a failed baseline, then leaves an existing outcome untouched until source reads recover", async () => {
    gsc.window.mockResolvedValue({ status: "unavailable", reason: "source unavailable" });
    const written = await recordShipment(facts()), failed = await stored();
    expect([written.measurement, failed.implementedAt, failed.shipmentBaseline?.search ?? null, failed.windows.length, failed.measuredAt]).toEqual(["measurement_unavailable", NOW.toISOString(), null, 0, null]);
    withSiteHistory(); const held = { ...(await ship()), verification: verification("verified"), lastCrawlAt: "2026-08-01T12:00:00Z" };
    db.state.rows = []; await upsertShippedChange(held, T); const before = await stored();
    const { autoMeasureDuePass } = await vi.importActual<typeof import("@/domains/measurement/proof-gsc/auto-measure-pass")>("@/domains/measurement/proof-gsc/auto-measure-pass");
    const next = new Date("2026-08-30T12:00:00Z"); gsc.lastFinal.mockResolvedValue("2026-08-30"); withSiteHistory(); const available = gsc.window.getMockImplementation()!;
    gsc.window.mockImplementation(async (a: { start: string; end: string }) => a.start === "2026-07-31" && a.end === "2026-08-28" ? { status: "unavailable", reason: "source unavailable" } : available(a));
    const stopped = await autoMeasureDuePass(T, { now: next });
    expect([stopped.due, stopped.measured, stopped.failed, stopped.settled, stopped.outcomes.length]).toEqual([1, 0, 1, 0, 0]); expect(await stored()).toEqual(before);
    withSiteHistory(); const resumed = await autoMeasureDuePass(T, { now: next });
    expect([resumed.due, resumed.measured, resumed.failed, (await stored()).windows.some((w) => w.day === 28 && w.ran)]).toEqual([1, 1, 0, true]);
  });
  it("measures when the comparison is really there, and a second press rewrites nothing", async () => {
    const first = await recordShipment(facts()); expect([first.measurement, (await stored()).measurementState]).toEqual(["measuring", "measuring"]);
    await recordVerification(T, first.shipmentId, verification("verified")); const again = await recordShipment(facts());
    expect([again.shipmentId, again.measurement, db.state.rows.length]).toEqual([first.shipmentId, "measuring", 1]);
    expect((await stored()).verification?.status).toBe("verified"); // the check was not erased back to due
    withSiteHistory(9, [["https://x.test/a", { clicks: 20, impressions: 4000, ctr: 0.005, position: 11 }], ["https://x.test/b", { clicks: 30, impressions: 5000, ctr: 0.006, position: 9 }]]);
    const w28 = (await measureRecord(T, await stored(), new Date("2026-10-01T00:00:00.000Z"), "2026-09-05", new Set())).windows.find((w) => w.day === 28)!;
    expect([w28.controlsUsed, w28.comparedToSite]).toEqual([2, undefined]); });
  it("records a change that was already live, claims no before-state, and still owes the live check", async () => {
    expect((await repair()).measurement).toBe("verification_needed"); const row = await stored();
    expect([row.preChangeHashUnavailable, row.preChangeContentHash, row.before, row.verification]).toEqual([true, null, null, null]); // no before-state is held or claimed
    expect([row.implementedAt, row.componentsApplied?.[0]?.after]).toEqual([LIVE_ON, WORDING]); // windows count from the day it went live; the check looks for this
    expect(row.operatorNote).toMatch(/Placement: the page title\. Source: pasted in the CMS\./);
    expect(gsc.window.mock.calls.some((c) => (c[0] as { start?: string }).start === "2026-06-12")).toBe(true); }); // the 28 days BEFORE it went live
  it("repairs idempotently on the same account of it, and stays honest when there is nothing to compare", async () => {
    const first = await repair(); expect([(await repair()).shipmentId, db.state.rows.length]).toEqual([first.shipmentId, 1]);
    db.state.rows = []; ctl.pages = [];
    expect((await repair()).measurement).toBe("verification_needed");});}); // no page matched it, so the site's own movement is the comparison, and the live check is owed before any of it
describe("the AI baseline is frozen over the change's own scope (AEO reconstruction, 2026-08-19)", () => {
  const SITE = "https://www.fixture-outdoors.example", DAY = "2026-07-30";
  const link = (domain: string) => ({ url: `https://${domain}/page`, domain, title: null });
  const journey = (over: Record<string, unknown> = {}) => ({ fan_outs: null, brand_mentions: null, web_search_reported: null, retrieved_results: null, cited_sources: null, ...over });
  const answer = (over: Record<string, unknown> = {}) => ({
    id: "obs-1", tenant_id: T, site: SITE, prompt_id: "p1", prompt_version: 1, prompt_text: "where should I go", engine: "chatgpt", model_requested: null, model_served: "gpt-5",
    observation_mode: "api", reporting_day: DAY, sample_slot: 0, language: "en", location: 2840, requested_at: `${DAY}T09:00:00.000Z`, completed_at: null, capability_version: "v1",
    cache_key: null, cost_usd: 0, status: "observed", failure_reason: null, answer_text: "an answer", answer_hash: "abc", journey: journey(), analysis: { ownedBrandMention: { mentioned: true } }, analysis_hash: "abc", ...over });
  const SCOPE = { promptIds: ["p1"], engines: [], fanouts: [], stage: "owned_retrieved_not_cited" };
  it("counts sources, instrument and objective over the scope's own answers, and nobody else's", async () => {
    const rows = [
      answer({ id: "o1", journey: journey({ cited_sources: [link("www.fixture-outdoors.example")] }) }),
      answer({ id: "o2", journey: journey({ cited_sources: [link("rival.example")], retrieved_results: [link("fixture-outdoors.example")] }) }),
      answer({ id: "o3", prompt_id: "p9", prompt_text: "best rugs to buy" }),  // another change's search, on the same day
      answer({ id: "o4", reporting_day: "2026-06-01" }),                       // in scope, but an older day
    ];
    ai.records.mockImplementation(async (_t: string, o: { day?: string }) => rows.filter((r) => o.day == null || r.reporting_day === o.day));
    await upsertShippedChange(await ship({ shipment: origin({ aiScope: SCOPE }) as never })); const held = (await loadShippedChangesForTenant(T))[0].shipmentBaseline?.ai;
    expect(held).toMatchObject({
      day: DAY, checked: 2, analyzed: 2, mentioning: 2,          // o3 asks another search and o4 is another day
      citationSample: 2, ownedCiting: 1, rankSum: 1, rankCount: 1,
      retrievalSample: 1, ownedRetrieved: 1, retrievedNotCited: 1, // read the page and credited a rival
      engines: ["chatgpt"], models: ["gpt-5"], modes: ["api"],
      objective: "ai_citation_conversion",});
    expect(held?.scopeFingerprint).toMatch(/^[0-9a-f]{16}$/);});
  it("records the implementation with no AI starting numbers when the scope's answers are not on file", async () => {
    ai.records.mockResolvedValue([]);
    await upsertShippedChange(await ship({ shipment: origin({ aiScope: SCOPE }) as never })); const [stored] = await loadShippedChangesForTenant(T);
    expect([stored.implementedAt, stored.shipmentBaseline?.ai]).toEqual([NOW.toISOString(), null]); expect(stored.shipmentBaseline?.search?.clicks).toBe(9);});
  it("stores prompt ids, assistants and the fan-out cluster typed, never flattened into targetQueries", async () => {
    const scope = { promptIds: ["p1"], engines: ["chatgpt", "gemini"], fanouts: ["haft seen table items list"], stage: "owned_retrieved_not_cited" };
    await recordShipment({ ...origin(), tenantId: T, page: PAGE, path: "/nowruz-guide", actionType: "title-family", basis: null, caseId: null,
      before: "Nowruz", after: "Nowruz Traditions", targetQueries: ["nowruz traditions"],
      judgedMetric: "ai_mentions", aiScope: scope, now: new Date("2026-07-15T00:00:00.000Z") } as Parameters<typeof recordShipment>[0]);
    const row = (await loadShippedChangesForTenant(T))[0]!;
    expect(row.aiScope).toEqual(scope); // exactly what the card claimed, remeasurable
    expect(row.targetQueries).toEqual(["nowruz traditions"]); }); // and the Google scope is untouched by it
  it("derives the judged metric from the scope the baseline is frozen over, not from the impact block", async () => {
    const { objectiveOfStage } = await import("@/domains/measurement/shipment-ai-outcome");
    expect(["rivals_cited_own_not_retrieved", "owned_retrieved_not_cited", "owned_mentioned_not_cited", "citations_unreported", null].map(objectiveOfStage))
      .toEqual(["ai_retrieval", "ai_citation_conversion", "ai_citation", "ai_citation", "ai_mentions"]);});});
describe("the treatment record", () => {
  /** WHAT THE PAGE WAS ALREADY EARNING over the same 28 days the reading covers, which is the only thing that turns plus ten clicks into a percent. */ const standing = (clicks: number) => ({ clicks, impressions: 0, ctr: 0, position: 0, windowDays: 28 }), row = (over: Record<string, unknown> = {}) => { const r = { page: PAGE, before: null, actionType: "edit_title", after: "Words really on the page", windows: [ranWindow(28, 10)], implementedAt: NOW.toISOString(), verification: verification("verified"), operatorVerdictOverride: null, pinnedRead: null, componentsApplied: null, treatmentStamp: { signature: { family: "edit_title", treatment: "title_or_h1", field: "title", cause: "ctr_snippet" }, overlapAtShip: 0 }, baseline: standing(100), controlsReceipt: [{ path: "/c1", reasons: [] }, { path: "/c2", reasons: [] }, { path: "/c3", reasons: [] }], ...over } as Parameters<typeof treatmentLearning>[0][number]; return { ...r, verification: { ...r.verification!, checkerContract: SHIPMENT_PROOF.contract, proof: SHIPMENT_PROOF.of(r, "Inspected page"), components: [{ kind: "edit_title", state: "verified" as const, note: null }] } }; };
  it("counts every shipment, and lets nothing muted, legacy, or zero teach the policy numbers (operator, 2026-08-30)", () => {
    const muted = () => row({ windows: [ranWindow(28, -20)], pinnedRead: { verdict: "confounded" } as never });
    const [g] = treatmentLearning([muted(), muted(), muted(), row({ windows: [ranWindow(28, 100)], operatorVerdictOverride: "inconclusive" }), row({ implementedAt: null, windows: [ranWindow(28, 100)] }), row({ windows: [ranWindow(28, 0)] }), row({ windows: [ranWindow(28, 10)] }), row({ windows: [ranWindow(28, -10)] })]); const fortnight = treatmentLearning([row({ windows: [ranWindow(14, 30)] }), row({ windows: [ranWindow(14, 10)] }), row({ windows: [ranWindow(7, 500)] })])[0]!, five = (day: number) => treatmentLearning(Array.from({ length: 5 }, () => row({ windows: [ranWindow(day, 30)] })))[0]!, siteRow = row({ windows: [{ ...ranWindow(28, 30), comparedToSite: true }] }), siteBasis = treatmentLearning([siteRow])[0]!, matched = treatmentLearning([row({ windows: [ranWindow(28, 30)] })])[0]!;
    expect([g.shipped, g.verified, g.legacy, g.inconclusive], "three confounded, one operator-excluded and one clean zero are history; the legacy row has its own labelled count and is never verified").toEqual([8, 7, 1, 5]);
    expect([g.sampleSize, g.netEffect, g.medianEffect, g.ahead, g.behind, fortnight.sampleSize, fortnight.netEffect, fortnight.medianEffect, fortnight.ahead, treatmentLearning([row({ windows: [ranWindow(28, 30, 1)] })])[0]!.sampleSize, treatmentLearning([row({ windows: [ranWindow(28, 30)], controlsReceipt: [] })])[0]!.sampleSize], "policy numbers come from the clean directional readings and symmetric readings net to zero; a window closed at 14 days is one of those readings and a 7 day peek is still not read at all (operator, 2026-09-03); A MEASURED ZERO IS EVIDENCE ABOUT A TREATMENT and is one of the three in the sample while naming no direction (operator, 2026-09-04); and the ONE eligibility verdict the measurement kernel files refuses a window with a single comparison page and one whose row cannot say which pages it was compared against").toEqual([3, 0, 0, 1, 1, 2, 40, 20, 2, 0, 0]);
    expect([learningFromShipments([muted()]).size, learningFromShipments([row({ implementedAt: null, windows: [ranWindow(28, 100)] })]).size, fortnight.early, five(14).sampleSize, five(14).early, five(28).early, siteBasis.verified, siteBasis.sampleSize, siteBasis.netEffect, siteBasis.medianEffect, matched.sampleSize, matched.netEffect, learningFromShipments([siteRow]).size], "neither a confounded negative nor a legacy row can train a family; a group standing on 14 day readings alone counts every one of them and stays early until five have run the full 28; and a mature reading taken against the site's own movement is live confirmed and still teaches nothing, where the identical matched reading teaches (reviewer, 2026-09-03)").toEqual([0, 0, true, 5, true, false, 1, 0, 0, null, 1, 30, 0]); });
  it("hands the ranking a record shrunk hard towards nothing while the sample is thin", () => {
    expect(learningFromShipments([row({ windows: [ranWindow(28, 120)] })]).get("title"), "one reading of 120 clicks hands over a sixth of itself").toEqual({ readings: 1, netLift: 20 }); expect(learningFromShipments(Array.from({ length: 5 }, () => row({ windows: [ranWindow(28, 120)] }))).get("title"), "five hand over half").toEqual({ readings: 5, netLift: 300 });
    expect(learningFromShipments([row({ verification: verification("differs") }), row({ windows: [] })]).size, "nothing verified and finished is no record at all").toBe(0);
    const pooled = (clicks: number, lifts: number[]) => treatmentLearning(lifts.map((l) => row({ baseline: standing(clicks), windows: [ranWindow(28, l)] })))[0]!.estimate; expect([pooled(100, [10, 20, 30]), pooled(100, [10, 20]), pooled(5, [1, 2, 3])], "three readings on pages already earning 100 clicks pool into one rate of plus 20 percent, because those pages differ by less than the noise in counting clicks already explains; two readings, and three readings on pages earning five clicks, are each no measurement at all").toEqual([{ percent: 20, low: 7, high: 33 }, null, null]);
    expect(treatmentLearning([...Array.from({ length: 20 }, () => row({ baseline: standing(10000), windows: [ranWindow(28, 1)] })), row({ baseline: standing(100), windows: [ranWindow(28, 200)] })])[0]!.estimate, "one page that really did triple is quieted to a tenth of the distance to the pooled rate and never erased: pulled the whole way this kind of work would read plus 2 percent").toEqual({ percent: 9, low: 9, high: 9 }); });});
