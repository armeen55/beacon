import { describe, it, expect, vi, beforeEach } from "vitest";
import { componentIdOf, confirmedVersion, type ChangeProposal } from "@/domains/decision";
type Rec = { id: string; proposalId: string; proposalVersion: string; componentsApplied: Array<{ id: string; kind?: string; after?: string; before?: string | null; page?: string; where?: string | null; anchorAfter?: string; redirectTo?: string; appliedAfter?: string }>; path: string; page: string; implementedAt: string | null; operatorNote?: string | null; verification?: string | null; treatmentStamp: { signature: Record<string, string | null>; overlapAtShip: number } | null };
const led = vi.hoisted(() => ({ verified: [] as string[], records: [] as Rec[], breakWrite: false, noRecordId: false, flip: vi.fn(async (..._a: unknown[]) => true) }));
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
    if (led.noRecordId) return { shipmentId: "", measurement: "measuring" }; // the reading could not be started, so no row can be named
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
const linkChange = (): ChangeProposal => { const p = change("One sentence pointing readers to the haft seen page.") as ChangeProposal & { recommendedChange: unknown };
  p.recommendedChange = { kind: "existing_edit", field: "section", before: null, after: "One sentence pointing readers to the haft seen page.", where: 'In the body copy, with "the haft seen explained" linked to /haft-seen', linkTo: "/haft-seen", anchorText: "the haft seen explained" }; (p.bundle as { components: unknown[] }).components = [{ kind: "internal_link_add", label: "Link to the haft seen page", risk: "safe", before: null, after: "One sentence pointing readers to the haft seen page.", evidenceKeys: ["k1"] }]; return p; };
const expectedOf = (id: string) => confirmedVersion((stored.byId?.get(id) ?? stored.proposal) as ChangeProposal);
const batch = (ids: string[]) => ({ proposals: ids.map((id) => ({ id, expectedVersion: expectedOf(id) })) });
const schemaChange = (): ChangeProposal => { const p = change("Add a visible answer and matching FAQ markup."), section = { ...p.bundle!.components[0]!, label: "Visible FAQ answer" }, dependency = componentIdOf(section, 0), hash = "a".repeat(64);
  p.bundle = { ...p.bundle!, components: [section, { kind: "schema", label: "FAQ structured data", risk: "safe", before: null, after: '{"@context":"https://schema.org","@type":"FAQPage"}', evidenceKeys: ["k1"], derivation: { rule: "visible_faq_pairs_v1", operation: "add", source: { pageKey: "/famous-iranian-comedians", contentHash: hash, schemaHash: hash, visibleFaqHash: hash, captureRevision: hash }, dependsOn: [{ componentId: dependency, revision: hash }], projectedVisibleFaqHash: hash } }] };
  return p; };
const press = async (p: ChangeProposal) => { stored.proposal = p;
  return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, expectedVersion: confirmedVersion(p) }); };
beforeEach(() => { led.records = []; led.breakWrite = false; led.noRecordId = false; stored.disposition = null; stored.byId = null; stored.tenant = "t"; surf.rebuilds = 0; led.flip.mockReset(); led.flip.mockResolvedValue(true); }); // the rebuild count is reset with every other fixture, so no assertion about it depends on the test before it
describe("many at once is one trip, and still one shipment each", () => {
  it("records twenty changes on one press and rebuilds the surfaces once, not twenty times", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `t::/p-${i}::existing_edit::bundle`);
    stored.proposal = linkChange();
    const mark = (await import("@/app/(shell)/changes/actions")).markManyImplementedAction; const out = await mark(batch(ids)); expect(surf.rebuilds, "one rebuild for the whole batch").toBe(1); expect(out.done + out.already, "and every id is answered").toBe(20);
    expect(led.flip).toHaveBeenCalledTimes(20); expect(led.records[0]!.componentsApplied[0], "and the words the link has to carry reach the record through the batch door too").toMatchObject({ kind: "internal_link_add", anchorAfter: "the haft seen explained" }); // still one atomic transition each
    surf.rebuilds = 0; led.flip.mockClear();
    const again = await mark(batch(ids)); expect(again.done, "nothing is recorded twice").toBe(0); expect(again.already).toBe(20); });});
describe("an applied change keeps the suggestion and the version applied side by side", () => {
  const atomic = (tenant: string, after = AFTER): ChangeProposal => ({ ...change(after), id: `${tenant}::/famous-iranian-comedians::existing_edit::title`, tenantId: tenant, bundle: undefined } as unknown as ChangeProposal);
  const facts = () => led.records[led.records.length - 1] as unknown as { componentsApplied: Array<{ label: string; after: string; appliedAfter?: string }>; operatorNote?: string | null; after?: string; implementedAt: string | null };
  it("names the piece off the change, keeps both versions when the operator applied their own wording, and repeats none of it on a second press, on two accounts", async () => {
    for (const [tenant, wording] of [["acct-one", "The line that is really on this page now."], ["acct-two", "A second account's own line, typed by hand."]] as const) {
      led.records = []; stored.tenant = tenant; stored.proposal = atomic(tenant);
      const press = async (over: Record<string, unknown> = {}) => (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: atomic(tenant).id, expectedVersion: expectedOf(atomic(tenant).id), ...over });
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
    await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: change().id, expectedVersion: expectedOf(change().id), appliedText: "One line for two pieces." });
    expect([facts().componentsApplied.map((c) => c.appliedAfter), facts().operatorNote], "no piece claims it, and their words are kept on the row where they are true").toEqual([[undefined, undefined], "One line for two pieces."]);
    const held = led.records[0]!, at = held.implementedAt; held.verification = "confirmed on the page"; const again = await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: change().id, expectedVersion: expectedOf(change().id), appliedText: "One line for two pieces." }); expect([again.success, led.records.length, led.records[0]!.implementedAt, led.records[0]!.verification]).toEqual([true, 1, at, "confirmed on the page"]);
    const other = { ...change("A second change, recorded by the batch"), id: "t::/other::existing_edit::bundle" } as ChangeProposal;
    stored.byId = new Map([[other.id, other]]);
    const batchResult = await (await import("@/app/(shell)/changes/actions")).markManyImplementedAction(batch([other.id]));
    expect([batchResult.done, facts().operatorNote ?? null, facts().componentsApplied.map((c) => c.appliedAfter)], "and a batch carries no shared wording at all: one line cannot be the version applied to twenty different changes, so the batch records the prepared wording and nothing else").toEqual([1, null, [undefined]]);
    const many = stored.proposal as ChangeProposal; stored.byId = new Map([[many.id, many]]); const forged = await (await import("@/app/(shell)/changes/actions")).markManyImplementedAction(batch([many.id]));
    expect([forged.done, forged.failed[0]?.error, led.records.length], "a forged bulk request cannot flatten a multi-piece bundle into one recorded press").toEqual([0, "This change has several pieces or needs confirmation, so record it from its own change page.", 2]); });});
describe("a partial batch failure is visible per change and retryable without duplicating what landed", () => {
  it("records the good ones once, names each refusal against its own change, and a retry of the whole batch adds no second record", async () => {
    const good = { ...change("Words that are finished and ready"), id: "t::/a::existing_edit::bundle" } as ChangeProposal;
    const held = { ...change("Words nobody has approved yet"), id: "t::/b::existing_edit::bundle", status: "needs_review" } as ChangeProposal;
    const unfinished = { ...change("Write a description of about 150 characters that names this page's subject."), id: "t::/c::existing_edit::bundle", researchOnly: true } as ChangeProposal;
    stored.byId = new Map([[good.id, good], [held.id, held], [unfinished.id, unfinished]]);
    const mark = (await import("@/app/(shell)/changes/actions")).markManyImplementedAction;
    const first = await mark(batch([good.id, held.id, unfinished.id]));
    expect([first.done, first.already, first.failed.map((f) => f.id), first.results.map((r) => r.outcome), led.records.length], "one recorded, two refused, each refusal carrying the id of the change it belongs to").toEqual([1, 0, [held.id, unfinished.id], ["recorded", "failed", "failed"], 1]);
    expect(first.failed.map((f) => f.error), "and each one says what is wrong with THAT change, in its own words").toEqual(["This change is still being reviewed.", expect.stringContaining("is not finished yet")]);
    const retry = await mark(batch([good.id, held.id, unfinished.id]));
    expect([retry.done, retry.already, retry.failed.length, led.records.length], "pressing the whole batch again records nothing twice: the one that landed answers as already measuring and the two refusals are unchanged").toEqual([0, 1, 2, 1]); });});
describe("nothing is marked done that no record stands behind", () => {
  it("refuses a copied version after the saved copy changes, before any shipment or status flip", async () => {
    const shown = { ...change("Copy the operator actually saw"), supportFacts: [{ id: "k1", fact: "A supported fact", sources: [{ url: "https://source.example/old", kind: "publisher" }] }] } as ChangeProposal, rewritten = change("A later saved rewrite"); stored.proposal = rewritten; stored.byId = new Map([[shown.id, rewritten]]);
    const { markProposalImplementedAction, markManyImplementedAction } = await import("@/app/(shell)/changes/actions"), intent = { id: shown.id, expectedVersion: confirmedVersion(shown) };
    const single = await markProposalImplementedAction({ proposalId: intent.id, expectedVersion: intent.expectedVersion }), bulk = await markManyImplementedAction({ proposals: [intent] });
    expect([single.success, single.error?.includes("rewritten"), bulk.failed[0]?.error.includes("rewritten"), led.records.length, led.flip.mock.calls.length]).toEqual([false, true, true, 0, 0]);
    const sourceOnly = { ...shown, supportFacts: [{ ...shown.supportFacts![0]!, sources: [{ url: "https://source.example/new", kind: "publisher" }] }] }; stored.byId.set(shown.id, sourceOnly);
    const staleSource = await markProposalImplementedAction({ proposalId: shown.id, expectedVersion: intent.expectedVersion }); expect([staleSource.success, staleSource.error?.includes("rewritten"), led.records.length, led.flip.mock.calls.length]).toEqual([false, true, 0, 0]); });
  it("rejects a bare historical component selector even with a current proposal version", async () => {
    const p = change(); stored.proposal = p; const result = await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, expectedVersion: confirmedVersion(p), componentIds: ["0:title"] });
    expect([result.success, led.records.length, led.flip.mock.calls.length]).toEqual([false, 0, 0]); });
  it("does not reuse a prior Shipment when only the cited source changed", async () => { const first = { ...change(), supportFacts: [{ id: "k1", fact: "A fact", sources: [{ url: "https://source.example/first", kind: "publisher" }] }] } as ChangeProposal;
    expect((await press(first)).success).toBe(true); const next = { ...first, supportFacts: [{ ...first.supportFacts![0]!, sources: [{ url: "https://source.example/second", kind: "publisher" }] }] };
    expect((await press(next)).success).toBe(true); expect([led.records.length, led.records[0]!.proposalVersion === led.records[1]!.proposalVersion]).toEqual([2, false]); });
  it("refuses forged partial schema groups and records the visible copy with its derived schema as one press", async () => { const linked = schemaChange(), ids = linked.bundle!.components.map(componentIdOf); stored.proposal = linked;
    const mark = (componentIds: string[]) => import("@/app/(shell)/changes/actions").then(({ markProposalImplementedAction }) => markProposalImplementedAction({ proposalId: linked.id, expectedVersion: expectedOf(linked.id), componentIds }));
    const copyOnly = await mark([ids[0]!]), schemaOnly = await mark([ids[1]!]);
    expect([copyOnly.success, schemaOnly.success, copyOnly.error, schemaOnly.error, led.records.length]).toEqual([false, false, expect.stringContaining("one linked change"), expect.stringContaining("one linked change"), 0]);
    const both = await mark(ids); expect([both.success, led.records.length, led.records[0]!.componentsApplied.map((component) => component.kind)]).toEqual([true, 1, ["title", "schema"]]); });
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
    const r = await (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: two.id, expectedVersion: expectedOf(two.id), componentIds: [componentIdOf(two.bundle!.components[0]!, 0)] }); expect([r.success, r.note ?? ""], "and it really was the partial branch").toEqual([true, expect.stringContaining("still on your list")]); expect(led.verified, "the partial press schedules the same shipment").toEqual([led.records[led.records.length - 1]!.id]); expect(led.records[led.records.length - 1]!.componentsApplied[0]!.anchorAfter, "and words riding a piece the live check would never read them off are not recorded at all").toBeUndefined(); });
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
  it("never lets a stale press revive terminal work or write an orphan shipment", async () => {
    stored.disposition = "withdrawn";
    const res = await press(change()); expect([res.success, led.records.length, led.flip.mock.calls.length]).toEqual([false, 0, 0]);
    stored.disposition = "dismissed"; led.records = []; led.flip.mockReset();
    const no = await press(change("Different words for the dismissed row")); expect([no.success, led.records.length, led.flip.mock.calls.length], "no shipment and no flip on a dismissed row").toEqual([false, 0, 0]); });
  it("tells a bad moment apart from a verdict on every ending of the press, so a held press is retried and a refusal never is", async () => {
    const press = async (p: ChangeProposal) => { stored.proposal = p; return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, expectedVersion: confirmedVersion(p) }); };
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
});

const SITES = [
  { t: "acct-tide", path: "/tide-pools", label: "Tide Pools", q: "tide pool safety", after: "Tide pools: when to go and how to stay upright on the rocks", mine: "The exact line that is on the page now." },
  { t: "acct-bordado", path: "/bordado", label: "Bordado a mano", q: "puntadas de bordado", after: "Bordado a mano: las puntadas que lleva cada motivo", mine: "La linea exacta que quedo en la pagina." },
];
type Site = (typeof SITES)[number];
const card = (s: Site, over: Partial<ChangeProposal> = {}): ChangeProposal => ({ ...change(s.after), id: `${s.t}::${s.path}::existing_edit::title`, tenantId: s.t,
  pagePath: s.path, pageUrl: `https://${s.t}.example${s.path}`, pageLabel: s.label, primaryQuery: s.q, ...over } as ChangeProposal);
const atomic = (s: Site, over: Partial<ChangeProposal> = {}): ChangeProposal => card(s, { bundle: undefined, ...over } as Partial<ChangeProposal>);
const pressOn = async (s: Site, p: ChangeProposal, over: Record<string, unknown> = {}) => { stored.tenant = s.t; stored.proposal = p;
  return (await import("@/app/(shell)/changes/actions")).markProposalImplementedAction({ proposalId: p.id, expectedVersion: confirmedVersion(p), ...over }); };

describe("one press is one record, and every ending of a press is named", () => {
  for (const s of SITES) {
    it(`${s.t}: retries preserve receipts while changed physical edits are recorded independently`, async () => {
      const p = card(s); expect((await pressOn(s, p, { appliedText: s.mine })).success).toBe(true);
      led.records[0]!.verification = "confirmed on the page";
      const original = structuredClone(led.records[0]!);
      const again = await pressOn(s, { ...p, status: "implemented_pending_verification" }, { appliedText: s.mine });
      expect([again.success, led.records.length, led.records[0], again.note]).toEqual([true, 1, original, expect.stringContaining("already on file")]);
      const variants = [
        [{ after: "A genuinely redrafted page title" }, null],
        [{ before: "A different predecessor" }, null],
        [{ page: `https://${s.t}.example/other` }, null],
        [{ where: "A different location on the page" }, null],
        [{}, "Different wording actually applied by the operator"],
      ] as const;
      for (const [i, [variant, wording]] of variants.entries()) {
        const next = structuredClone(p); Object.assign(next.bundle!.components[0]!, variant);
        expect((await pressOn(s, next, { appliedText: wording })).success).toBe(true);
        expect([led.records.length, led.records.at(-1)!.componentsApplied[0], led.records[0]]).toEqual([i + 2, expect.objectContaining({ ...variant, ...(wording ? { appliedAfter: wording } : {}) }), original]);
        expect((await pressOn(s, next, { appliedText: wording })).note).toContain("already on file");
        expect(led.records).toHaveLength(i + 2);
      }
    });

    it(`${s.t}: a bad moment keeps the press and a verdict settles it, each in the sentence the server gave`, async () => {
      led.noRecordId = true; const noReading = await pressOn(s, atomic(s));
      led.noRecordId = false; led.breakWrite = true; const noWrite = await pressOn(s, atomic(s));
      led.breakWrite = false;
      const review = await pressOn(s, atomic(s, { status: "needs_review" }));
      const unfinished = await pressOn(s, atomic(s, { researchOnly: true }));
      expect([noReading.retryable, noWrite.retryable], "a reading that could not start and a write that threw are bad moments, not verdicts").toEqual([true, true]);
      expect([review.retryable ?? null, unfinished.retryable ?? null], "being held for review and being unfinished are verdicts, so they are never sent again").toEqual([null, null]);
      expect([led.records.length, led.flip.mock.calls.length], "and none of the four wrote a record or flipped the change").toEqual([0, 0]);
      expect([review.error, unfinished.error], "each refusal names its own reason").toEqual([expect.stringContaining("still being reviewed"), expect.stringContaining("is not finished yet")]); });

    it(`${s.t}: a bad moment on the first press is kept on this device, and only a verdict ends it`, async () => {
      const { MARK_PRESS } = await import("@/app/(shell)/changes/change-controls");
      led.noRecordId = true; const moment = await pressOn(s, atomic(s)); led.noRecordId = false; // the reading could not be started: a bad moment the server types as retryable
      const refused = await pressOn(s, atomic(s, { researchOnly: true }));
      const landed = await pressOn(s, atomic(s));
      const plain = [landed, moment, refused, null].map((a) => MARK_PRESS.fresh(a, { queueable: true }));
      expect(plain.map((e) => e.ending), "the press that landed is recorded, the bad moment and the throw are kept on this device, and only the verdict ends the press").toEqual(["recorded", "queued", "unrecorded", "queued"]);
      expect([plain[1]!.said, plain[2]!.said], "a kept press says it sends itself, and a verdict is said in the sentence the server gave").toEqual(["Saved on this device. It records itself when the connection returns.", refused.error]);
      const narrower = [moment, null].map((a) => MARK_PRESS.fresh(a, { queueable: false }));
      expect(narrower.map((e) => [e.ending, e.said]), "and a press this device cannot send again faithfully is never kept: the server's own sentence stands, and a press that never reached the server says what to check").toEqual(
        [["unrecorded", moment.error], ["unrecorded", "It did not save. Check you are signed in, then press it again."]]); });

    it(`${s.t}: the device counts only the presses that landed and repeats the server's own refusal`, async () => {
      const { MARK_PRESS } = await import("@/app/(shell)/changes/change-controls");
      const landed = await pressOn(s, atomic(s));
      const refused = await pressOn(s, atomic(s, { researchOnly: true }));
      led.breakWrite = true; const moment = await pressOn(s, atomic(s), { appliedText: "A new operator version that has not been recorded" }); led.breakWrite = false;
      const out = MARK_PRESS.flush([landed, refused, moment, null]);
      expect(out.keep, "the bad moment and the throw stay on the device; the record and the verdict do not").toEqual([2, 3]);
      expect(out.said, "one landed, one is refused in the server's own words, two are still waiting, and a refusal is never counted as recorded").toBe(
        `1 press held on this device was recorded. 1 press could not be recorded: ${refused.error} 2 presses held on this device could not be recorded yet and are still waiting. Reload this page to send them again.`); });
  }
});
