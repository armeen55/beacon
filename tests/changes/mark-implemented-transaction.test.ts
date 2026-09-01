/** THE MARK-IMPLEMENTED TRANSACTION. There is no bare status flip on the decision facade: the record is written FIRST and the change is flipped SECOND, carrying that record's own id, so a crash between the two leaves a record the next press heals where the reverse would leave a change marked done that nothing on earth is measuring. A piece is named by its exact copy too, so a redraft is genuinely new work while pressing the SAME version twice stays one record. AN UNFINISHED DELIVERABLE IS NOT WORK SOMEBODY CAN HAVE DONE. The server asks the ONE completeness boundary, never the prose, so no stale tab opens a 28 day reading on work nobody wrote. THE BOUNDARY IS THE TYPED FACT: a producer that writes a brief instead of copy stamps it as it mints the card, and a blank nobody filled in is still a blank, whoever wrote it. THE ONE DOOR, standing in for the real one: it always writes and always answers with the row's id, it is idempotent on (proposal, version), and the row is durable the moment it lands, which is exactly what a retry after a crash finds. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChangeProposal } from "@/domains/decision";
type Rec = { id: string; proposalId: string; proposalVersion: string; componentsApplied: Array<{ id: string }>; path: string; page: string; implementedAt: string | null; treatmentStamp: { signature: Record<string, string | null>; overlapAtShip: number } | null };
const led = vi.hoisted(() => ({ verified: [] as string[], records: [] as Rec[], breakWrite: false, flip: vi.fn(async (..._a: unknown[]) => true) }));
const stored = vi.hoisted(() => ({ proposal: null as unknown, disposition: null as string | null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => "t" }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: () => ({}) }) }));
const surf = vi.hoisted(() => ({ rebuilds: 0 }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => { surf.rebuilds += 1; } }));
vi.mock("@/domains/account", () => ({ getTenant: async () => ({ id: "t", domain: "site.example" }) }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  loadChangeProposal: async () => stored.proposal, proposalDisposition: async () => stored.disposition, resolveCurrentBasis: async () => "basis_now::d4", transitionProposalToImplemented: led.flip }));
vi.mock("next/server", async () => ({ ...(await vi.importActual<Record<string, unknown>>("next/server")), after: (fn: () => unknown) => { void fn(); } })); // production runs in a request scope; here after() executes inline so the exact scheduled shipment is observable
vi.mock("@/domains/measurement", async () => ({ ...(await vi.importActual<typeof import("@/domains/measurement")>("@/domains/measurement")),
  verifyShipmentNow: async (_t: string, id: string) => { led.verified.push(id); return 1; },
  loadShippedChanges: async () => led.records, captureChangeMeta: async () => null,
  recordShipment: async (f: Omit<Rec, "id"> & { path: string }) => {
    if (led.breakWrite) throw new Error("relation shipped_change_proof does not exist");
    const held = led.records.find((r) => r.proposalVersion === f.proposalVersion);
    if (held) return { shipmentId: held.id, measurement: "measuring" };
    led.records.push({ ...f, id: `rec-${led.records.length + 1}`, implementedAt: new Date().toISOString() }); // THE REAL STORE STAMPS `implementedAt` AT THE PRESS, so the fixture does too: the next press reads this ledger back to count what is already being measured on the same page.
    return { shipmentId: led.records[led.records.length - 1]!.id, measurement: "measuring" }; } }));
const SEEN = new Date(Date.now() - 2 * 86_400_000).toISOString();
const AFTER = "Iranian comedians: the 12 names people actually search for";
const change = (after = AFTER): ChangeProposal => ({
  id: "t::/famous-iranian-comedians::existing_edit::bundle", tenantId: "t", kind: "existing_edit", pagePath: "/famous-iranian-comedians",
  pageUrl: "https://site.example/famous-iranian-comedians", pageLabel: "Famous Iranian comedians", primaryQuery: "iranian comedians", changeFamily: "title",
  opportunityType: "Answer the exact search", status: "ready", basis: "basis_now::d4", limitations: [], createdAt: SEEN, riskLevel: "low", confidence: "high",
  estimatedEffortMinutes: 6, whyItMatters: "This page lost 163 clicks last month.", modeledOn: "the stored results page for this search, whose top titles share this shape", recommendedChange: { kind: "existing_edit", field: "title", before: "Comedians", after },
  bundle: { objective: "Answer the exact question people search", metric: "clicks from that search", measurementPlan: "The next 28 days are compared with the last 28.",
    scope: { queries: ["iranian comedians"], prompts: [] }, confidenceReasons: ["163 clicks lost in 4 weeks"], alternatives: [], risks: [],
    components: [{ kind: "title", label: "Title", risk: "safe", before: "Comedians", after, evidenceKeys: ["k1"] }],
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "163 clicks lost in 4 weeks.", observedAt: SEEN }], missing: [], freshestObservedAt: SEEN } },
} as unknown as ChangeProposal);
const press = async (p: ChangeProposal) => { stored.proposal = p;
  return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id }); };
beforeEach(() => { led.records = []; led.breakWrite = false; stored.disposition = null; led.flip.mockReset(); led.flip.mockResolvedValue(true); });
describe("many at once is one trip, and still one shipment each", () => {
  it("records twenty changes on one press and rebuilds the surfaces once, not twenty times", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t::/p-${i}::existing_edit::bundle`);
    stored.proposal = change(); surf.rebuilds = 0;
    const mark = (await import("@/app/(shell)/changes/actions")).markManyImplementedAction; const out = await mark({ proposalIds: ids }); expect(surf.rebuilds, "one rebuild for the whole batch").toBe(1);
    expect(out.done + out.already, "and every id is answered").toBe(20);
    expect(led.flip).toHaveBeenCalledTimes(20); // still one atomic transition each
    surf.rebuilds = 0; led.flip.mockClear();
    const again = await mark({ proposalIds: ids }); expect(again.done, "nothing is recorded twice").toBe(0);
    expect(again.already).toBe(20); });});
describe("nothing is marked done that no record stands behind", () => {
  it("schedules the exact shipment it just wrote, on the full press and on a partial bundle alike", async () => {
    led.verified = [];
    const whole = change("Whole-press verification target");
    await press(whole);
    expect(led.verified, "the full press schedules its own shipment").toEqual([led.records[led.records.length - 1]!.id]);
    led.verified = [];
    const two = change("Partial-press verification target");
    (two.bundle as { components: unknown[] }).components = [
      { kind: "title", label: "Title", risk: "safe", before: "Comedians", after: "A", evidenceKeys: ["k1"] },
      { kind: "meta", label: "Meta", risk: "safe", before: null, after: "B", evidenceKeys: ["k1"] }];
    stored.proposal = two;
    const r = await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: two.id, componentIds: ["0:title"] }); expect([r.success, r.note ?? ""], "and it really was the partial branch").toEqual([true, expect.stringContaining("still on your list")]);
    expect(led.verified, "the partial press schedules the same shipment").toEqual([led.records[led.records.length - 1]!.id]); });
  it("stamps what kind of work it was, and how much of theirs was already being measured on that page", async () => {
    const first = { ...change(), treatment: "title_or_h1", diagnosisCause: "ctr_snippet" } as ChangeProposal; // THE PRESS IS THE LAST MOMENT THE CARD EXISTS: the treatment and the diagnosed cause live nowhere on a shipment, so a Results screen asking which of this account's bets pay would have nothing but the coarse action word to group by.
    expect((await press(first)).success).toBe(true);
    expect(led.records[0]!.treatmentStamp).toEqual({ signature: { family: "title", treatment: "title_or_h1", field: "title", cause: "ctr_snippet" }, overlapAtShip: 0 });
    const second = { ...change("A second change to the very same page"), id: "t::/famous-iranian-comedians::existing_edit::meta" } as ChangeProposal; expect((await press(second)).success).toBe(true);
    expect(led.records[1]!.treatmentStamp, "a different change of theirs is already being read on this page, and the card carried neither of the other two facts").toEqual({ signature: { family: "title", treatment: null, field: "title", cause: null }, overlapAtShip: 1 });
    await press(change("Redrafted words for that very same change"));
    expect(led.records[2]!.treatmentStamp!.overlapAtShip, "a redraft of their own change is not a second change crowding the page").toBe(1); });
  it("has no bare flip on the facade at all: the one door demands the record that is measuring the change", async () => {
    const facade = await vi.importActual<Record<string, unknown>>("@/domains/decision"); expect(Object.keys(facade)).not.toContain("markProposalImplemented"); expect([typeof facade.transitionProposalToImplemented, typeof facade.reconcileImplementedWithoutShipment]).toEqual(["function", "function"]); });
  it("refuses to record unfinished work as done, whatever a stale screen sends", async () => {
    const research = await press({ ...change(), researchOnly: true } as ChangeProposal); // full copy on the row, so only the typed fact can be refusing it
    const errand = await press({ ...change(), researchOnly: true, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Write a description of about 150 characters that names this page's subject." } } as ChangeProposal);
    expect([research.success, errand.success, led.records.length, led.flip.mock.calls.length, research.error, errand.error])
      .toEqual([false, false, 0, 0, expect.stringContaining("nothing has been written for it yet"), expect.stringContaining("nothing has been written for it yet")]);
    expect([(await press({ ...change(), limitations: ["Nothing here is ready to paste: this card is research, not an edit."] } as ChangeProposal)).success, led.records.length]).toEqual([true, 1]); }); // that sentence on finished copy stops nothing
  it("the press outvotes a reconciliation withdrawal, and never a dismissal", async () => {
    stored.disposition = "withdrawn"; // THE LIVE RACE (2026-08-29): Noor's row was withdrawn by the producer seconds before the press loaded it, and "could not be found" recorded NOTHING the operator did. A reconciliation-withdrawn row is still theirs to finish; a DISMISSAL was the operator's own decision, asked BEFORE any shipment is written so a stale tab can neither undo it nor orphan a record (Mahsa's orphan was a shipment written before a doomed flip).
    const res = await press(change()); expect([res.success, led.records.length, led.flip.mock.calls.length]).toEqual([true, 1, 1]);
    stored.disposition = "dismissed"; led.records = []; led.flip.mockReset();
    const no = await press(change("Different words for the dismissed row")); expect([no.success, led.records.length, led.flip.mock.calls.length], "no shipment and no flip on a dismissed row").toEqual([false, 0, 0]); });
  it("a crash BEFORE the record lands flips nothing, so the change is still theirs to do", async () => {
    led.breakWrite = true;
    const res = await press(change()); expect([res.success, led.records.length, led.flip.mock.calls.length]).toEqual([false, 0, 0]);
    expect(res.error).not.toMatch(/relation|shipped_change_proof|supabase/i); }); // a table name is not an answer to a customer
  it("a crash AFTER the record lands heals on the next press: one record, and the change then closes", async () => {
    led.flip.mockRejectedValueOnce(new Error("relation change_proposals does not exist"));
    expect((await press(change())).success).toBe(false);
    expect(led.records).toHaveLength(1); // the record is durable, and it is what the retry finds
    expect((await press(change())).success).toBe(true);
    expect([led.records.length, led.flip.mock.calls.length, led.flip.mock.calls[1]![2]]).toEqual([1, 2, "rec-1"]); }); // no second record, and the flip lands carrying it
  it("treats a re-press of the SAME version as nothing at all, a redrafted piece as new work, and an older era's name at its own precision", async () => {
    expect((await press(change())).success).toBe(true);
    const again = await press(change()); // the identical version, pressed again
    expect([again.success, led.records.length, /already on file/.test(again.note ?? "")]).toEqual([true, 1, true]); const REDRAFT = "Iranian comedians: who is actually funny in 2026";
    expect((await press(change(REDRAFT))).success).toBe(true);
    expect(led.records).toHaveLength(2); // new wording is a new piece, measured on its own
    led.records[1]!.componentsApplied = [{ id: "0:title" }]; // as an older era wrote it, before the copy was part of the name
    expect(/already on file/.test((await press(change(REDRAFT))).note ?? "")).toBe(true); }); // still matched, at that name's own precision
});
