/** THE MARK-IMPLEMENTED TRANSACTION. There is no bare status flip on the decision facade: the record is written FIRST and the change is flipped SECOND, carrying that record's own id, so a crash between the two leaves a record the next press heals where the reverse would leave a change marked done that nothing on earth is measuring. A piece is named by its exact copy too, so a redraft is genuinely new work while pressing the SAME version twice stays one record. AN UNFINISHED DELIVERABLE IS NOT WORK SOMEBODY CAN HAVE DONE. The server asks the ONE completeness boundary, never the prose, so no stale tab opens a 28 day reading on work nobody wrote. THE BOUNDARY IS THE TYPED FACT: a producer that writes a brief instead of copy stamps it as it mints the card, and a blank nobody filled in is still a blank, whoever wrote it. THE ONE DOOR, standing in for the real one: it always writes and always answers with the row's id, it is idempotent on (proposal, version), and the row is durable the moment it lands, which is exactly what a retry after a crash finds. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChangeProposal } from "@/domains/decision";
type Rec = { id: string; proposalId: string; proposalVersion: string; componentsApplied: Array<{ id: string; kind?: string; anchorAfter?: string; redirectTo?: string }>; path: string; page: string; implementedAt: string | null; treatmentStamp: { signature: Record<string, string | null>; overlapAtShip: number } | null };
const led = vi.hoisted(() => ({ verified: [] as string[], records: [] as Rec[], breakWrite: false, flip: vi.fn(async (..._a: unknown[]) => true) }));
const stored = vi.hoisted(() => ({ proposal: null as unknown, byId: null as Map<string, unknown> | null, disposition: null as string | null, tenant: "t" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => stored.tenant }));
vi.mock("@/lib/auth/can-publish", () => ({ canPublishForCurrentTenant: async () => true }));
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: () => ({}) }) }));
const surf = vi.hoisted(() => ({ rebuilds: 0 }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => { surf.rebuilds += 1; } }));
vi.mock("@/domains/account", () => ({ getTenant: async () => ({ id: "t", domain: "site.example" }) }));
vi.mock("@/domains/decision", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision")>("@/domains/decision")),
  loadChangeProposal: async (_t: string, id: string) => stored.byId?.get(id) ?? stored.proposal, proposalDisposition: async () => stored.disposition, resolveCurrentBasis: async () => "basis_now::d4", transitionProposalToImplemented: led.flip }));
vi.mock("next/server", async () => ({ ...(await vi.importActual<Record<string, unknown>>("next/server")), after: (fn: () => unknown) => { void fn(); } }));
vi.mock("@/domains/runtime", () => ({ ensureResearchRunOnVisit: () => {} })); // the bulk press re-arms research after the response through a dynamic import; resolved from the mock cache so the import never lands after the test environment is torn down // production runs in a request scope; here after() executes inline so the exact scheduled shipment is observable
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
/** ONE LINK CHANGE, as the editor hands one over: the destination and the exact words typed on the change itself, and a link piece inside the bundle that types neither of them. The live check reads a link on both its address and its words, so both have to reach the record. */
const linkChange = (): ChangeProposal => { const p = change("One sentence pointing readers to the haft seen page.") as ChangeProposal & { recommendedChange: unknown };
  p.recommendedChange = { kind: "existing_edit", field: "section", before: null, after: "One sentence pointing readers to the haft seen page.", where: 'In the body copy, with "the haft seen explained" linked to /haft-seen', linkTo: "/haft-seen", anchorText: "the haft seen explained" }; (p.bundle as { components: unknown[] }).components = [{ kind: "internal_link_add", label: "Link to the haft seen page", risk: "safe", before: null, after: "One sentence pointing readers to the haft seen page.", evidenceKeys: ["k1"] }]; return p; };
const press = async (p: ChangeProposal) => { stored.proposal = p;
  return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id }); };
beforeEach(() => { led.records = []; led.breakWrite = false; stored.disposition = null; stored.byId = null; stored.tenant = "t"; surf.rebuilds = 0; led.flip.mockReset(); led.flip.mockResolvedValue(true); }); // the rebuild count is reset with every other fixture, so no assertion about it depends on the test before it
describe("many at once is one trip, and still one shipment each", () => {
  it("records twenty changes on one press and rebuilds the surfaces once, not twenty times", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t::/p-${i}::existing_edit::bundle`);
    stored.proposal = linkChange();
    const mark = (await import("@/app/(shell)/changes/actions")).markManyImplementedAction; const out = await mark({ proposalIds: ids }); expect(surf.rebuilds, "one rebuild for the whole batch").toBe(1); expect(out.done + out.already, "and every id is answered").toBe(20);
    expect(led.flip).toHaveBeenCalledTimes(20); expect(led.records[0]!.componentsApplied[0], "and the words the link has to carry reach the record through the batch door too").toMatchObject({ kind: "internal_link_add", anchorAfter: "the haft seen explained" }); // still one atomic transition each
    surf.rebuilds = 0; led.flip.mockClear();
    const again = await mark({ proposalIds: ids }); expect(again.done, "nothing is recorded twice").toBe(0); expect(again.already).toBe(20); });});
/** WHAT THE OPERATOR ACTUALLY APPLIED IS RECORDED WHOLE, and the piece is named by the change and never by the brief the writer was handed: four live records carried "Write a real description on <address>: ..." where the name of the applied piece belongs. Proof 12 of the loop plan. */
describe("an applied change keeps the suggestion and the version applied side by side", () => {
  const atomic = (tenant: string, after = AFTER): ChangeProposal => ({ ...change(after), id: `${tenant}::/famous-iranian-comedians::existing_edit::title`, tenantId: tenant, bundle: undefined } as unknown as ChangeProposal);
  const facts = () => led.records[led.records.length - 1] as unknown as { componentsApplied: Array<{ label: string; after: string; appliedAfter?: string }>; operatorNote?: string | null; after?: string; implementedAt: string | null };
  it("names the piece off the change, keeps both versions when the operator applied their own wording, and repeats none of it on a second press, on two accounts", async () => {
    for (const [tenant, wording] of [["acct-one", "The line that is really on this page now."], ["acct-two", "A second account's own line, typed by hand."]] as const) {
      led.records = []; stored.tenant = tenant; stored.proposal = atomic(tenant);
      const press = async (over: Record<string, unknown> = {}) => (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: atomic(tenant).id, ...over });
      const first = await press({ appliedText: wording });
      expect([first.success, facts().componentsApplied.map((c) => c.label)], "the piece is named by the change and the page it is on, never by the sentence the writer was briefed with").toEqual([true, ["Page title on Famous Iranian comedians"]]);
      expect([facts().componentsApplied[0]!.after, facts().componentsApplied[0]!.appliedAfter, facts().operatorNote, facts().after], "the prepared wording stays exactly where it was, the operator's version rides the piece it replaced, and their own account of it is on the row").toEqual([AFTER, wording, wording, AFTER]);
      expect((first.note ?? "").startsWith("Your wording is recorded as what is on the page, and the prepared wording is kept beside it."), "and the press says so rather than leaving them to guess which version is being read").toBe(true);
      const stamp = facts().implementedAt;
      const again = await press({ appliedText: wording });
      expect([again.success, led.records.length, facts().implementedAt], "the same press again is the same record: no second row, and the day it was applied does not move").toEqual([true, 1, stamp]);
    }});
  it("never lets one typed line claim to be the version applied to several pieces at once", async () => {
    stored.proposal = change(); // the two-piece bundle: nothing can say which piece the line landed on
    (stored.proposal as ChangeProposal & { bundle: { components: unknown[] } }).bundle.components = [{ kind: "title", label: "Title", risk: "safe", before: "Comedians", after: AFTER, evidenceKeys: ["k1"] }, { kind: "meta", label: "Meta", risk: "safe", before: null, after: "B", evidenceKeys: ["k1"] }];
    await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: change().id, appliedText: "One line for two pieces." });
    expect([facts().componentsApplied.map((c) => c.appliedAfter), facts().operatorNote], "no piece claims it, and their words are kept on the row where they are true").toEqual([[undefined, undefined], "One line for two pieces."]);
    const other = { ...change("A second change, recorded by the batch"), id: "t::/other::existing_edit::bundle" } as ChangeProposal;
    stored.byId = new Map([[other.id, other]]);
    const batch = await (await import("@/app/(shell)/changes/actions")).markManyImplementedAction({ proposalIds: [other.id] });
    expect([batch.done, facts().operatorNote ?? null, facts().componentsApplied.map((c) => c.appliedAfter)], "and a batch carries no shared wording at all: one line cannot be the version applied to twenty different changes, so the batch records the prepared wording and nothing else").toEqual([1, null, [undefined]]); });});
/** A BATCH ANSWERS FOR EVERY CHANGE IN IT, one by one. Proof 13 of the loop plan. */
describe("a partial batch failure is visible per change and retryable without duplicating what landed", () => {
  it("records the good ones once, names each refusal against its own change, and a retry of the whole batch adds no second record", async () => {
    const good = { ...change("Words that are finished and ready"), id: "t::/a::existing_edit::bundle" } as ChangeProposal;
    const held = { ...change("Words nobody has approved yet"), id: "t::/b::existing_edit::bundle", status: "needs_review" } as ChangeProposal;
    const unfinished = { ...change("Write a description of about 150 characters that names this page's subject."), id: "t::/c::existing_edit::bundle", researchOnly: true } as ChangeProposal;
    stored.byId = new Map([[good.id, good], [held.id, held], [unfinished.id, unfinished]]);
    const mark = (await import("@/app/(shell)/changes/actions")).markManyImplementedAction;
    const first = await mark({ proposalIds: [good.id, held.id, unfinished.id] });
    expect([first.done, first.already, first.failed.map((f) => f.id), first.results.map((r) => r.outcome), led.records.length], "one recorded, two refused, each refusal carrying the id of the change it belongs to").toEqual([1, 0, [held.id, unfinished.id], ["recorded", "failed", "failed"], 1]);
    expect(first.failed.map((f) => f.error), "and each one says what is wrong with THAT change, in its own words").toEqual(["This change is still being reviewed.", expect.stringContaining("has not finished this one yet")]);
    const retry = await mark({ proposalIds: [good.id, held.id, unfinished.id] });
    expect([retry.done, retry.already, retry.failed.length, led.records.length], "pressing the whole batch again records nothing twice: the one that landed answers as already measuring and the two refusals are unchanged").toEqual([0, 1, 2, 1]); });});
describe("nothing is marked done that no record stands behind", () => {
  it("schedules the exact shipment it just wrote, on the full press and on a partial bundle alike", async () => {
    led.verified = [];
    const whole = linkChange();
    await press(whole);
    expect(led.verified, "the full press schedules its own shipment").toEqual([led.records[led.records.length - 1]!.id]); expect(led.records[0]!.componentsApplied[0], "and the link's own words travel with it through the single door").toMatchObject({ kind: "internal_link_add", anchorAfter: "the haft seen explained" });
    led.verified = [];
    const two = change("Partial-press verification target");
    (two.bundle as { components: unknown[] }).components = [{ kind: "title", label: "Title", risk: "safe", before: "Comedians", after: "A", anchorAfter: "smuggled", evidenceKeys: ["k1"] },
      { kind: "meta", label: "Meta", risk: "safe", before: null, after: "B", evidenceKeys: ["k1"] }];
    stored.proposal = two;
    const r = await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: two.id, componentIds: ["0:title"] }); expect([r.success, r.note ?? ""], "and it really was the partial branch").toEqual([true, expect.stringContaining("still on your list")]); expect(led.verified, "the partial press schedules the same shipment").toEqual([led.records[led.records.length - 1]!.id]); expect(led.records[led.records.length - 1]!.componentsApplied[0]!.anchorAfter, "and words riding a piece the live check would never read them off are not recorded at all").toBeUndefined(); });
  it("stamps what kind of work it was, and how much of theirs was already being measured on that page", async () => {
    const first = { ...change(), treatment: "title_or_h1", diagnosisCause: "ctr_snippet" } as ChangeProposal; // THE PRESS IS THE LAST MOMENT THE CARD EXISTS: the treatment and the diagnosed cause live nowhere on a shipment, so a Results screen asking which of this account's bets pay would have nothing but the coarse action word to group by.
    expect((await press(first)).success).toBe(true);
    expect(led.records[0]!.treatmentStamp).toEqual({ signature: { family: "title", treatment: "title_or_h1", field: "title", cause: "ctr_snippet" }, overlapAtShip: 0 });
    const second = { ...change("A second change to the very same page"), id: "t::/famous-iranian-comedians::existing_edit::meta" } as ChangeProposal; expect((await press(second)).success).toBe(true); expect(led.records[1]!.treatmentStamp, "a different change of theirs is already being read on this page, and the card carried neither of the other two facts").toEqual({ signature: { family: "title", treatment: null, field: "title", cause: null }, overlapAtShip: 1 });
    await press(change("Redrafted words for that very same change"));
    expect(led.records[2]!.treatmentStamp!.overlapAtShip, "a redraft of their own change is not a second change crowding the page").toBe(1); });
  it("has no bare flip on the facade at all: the one door demands the record that is measuring the change", async () => {
    const facade = await vi.importActual<Record<string, unknown>>("@/domains/decision"); expect(Object.keys(facade)).not.toContain("markProposalImplemented"); expect([typeof facade.transitionProposalToImplemented, typeof facade.reconcileImplementedWithoutShipment]).toEqual(["function", "function"]); });
  it("refuses to record unfinished work as done, whatever a stale screen sends", async () => {
    const research = await press({ ...change(), researchOnly: true } as ChangeProposal); // full copy on the row, so only the typed fact can be refusing it
    const errand = await press({ ...change(), researchOnly: true, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Write a description of about 150 characters that names this page's subject." } } as ChangeProposal);
    expect([research.success, errand.success, led.records.length, led.flip.mock.calls.length, research.error, errand.error]).toEqual([false, false, 0, 0, expect.stringContaining("nothing has been written for it yet"), expect.stringContaining("nothing has been written for it yet")]);
    expect([(await press({ ...change(), limitations: ["Nothing here is ready to paste: this card is research, not an edit."] } as ChangeProposal)).success, led.records.length]).toEqual([true, 1]); }); // that sentence on finished copy stops nothing
  it("the press outvotes a reconciliation withdrawal, and never a dismissal", async () => {
    stored.disposition = "withdrawn"; // THE LIVE RACE (2026-08-29): Noor's row was withdrawn by the producer seconds before the press loaded it, and "could not be found" recorded NOTHING the operator did. A reconciliation-withdrawn row is still theirs to finish; a DISMISSAL was the operator's own decision, asked BEFORE any shipment is written so a stale tab can neither undo it nor orphan a record (Mahsa's orphan was a shipment written before a doomed flip).
    const res = await press(change()); expect([res.success, led.records.length, led.flip.mock.calls.length]).toEqual([true, 1, 1]);
    stored.disposition = "dismissed"; led.records = []; led.flip.mockReset();
    const no = await press(change("Different words for the dismissed row")); expect([no.success, led.records.length, led.flip.mock.calls.length], "no shipment and no flip on a dismissed row").toEqual([false, 0, 0]); });
  /** A PRESS HELD ON THE DEVICE IS SENT AGAIN ONLY WHERE SENDING IT AGAIN COULD WORK. The browser queue used to drop every answered failure, so "press it again in a moment" threw away a press the operator had already made; a verdict must still settle the entry or the device argues with the server for ever. */
  it("tells a bad moment apart from a verdict on every ending of the press, so a held press is retried and a refusal never is", async () => {
    const press = async (p: ChangeProposal) => { stored.proposal = p; return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id }); };
    led.flip.mockRejectedValueOnce(new Error("relation change_proposals does not exist"));
    const moment = await press(change());
    const refused = await press({ ...change("Words nobody has approved"), status: "needs_review" } as ChangeProposal);
    stored.disposition = "dismissed"; const gone = await press(change("Words on a change put aside"));
    expect([moment.retryable, refused.retryable ?? null, gone.retryable ?? null], "the outage is retryable; being in review and being put aside are answers and are never sent again").toEqual([true, null, null]); });
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
