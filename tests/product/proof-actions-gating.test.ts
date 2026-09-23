import { REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof"; import { componentIdOf } from "@/domains/decision/contracts";
vi.mock("next/server", async () => ({ ...(await vi.importActual<Record<string, unknown>>("next/server")), after: (fn: () => unknown) => { void fn(); } }));
import { describe, it, expect, beforeEach, vi } from "vitest";
const { ownerFlag, mocks } = vi.hoisted(() => ({
  ownerFlag: { value: true },
  mocks: {
    captureChangeMeta: vi.fn(),
    measureRecord: vi.fn(),
    loadShippedChanges: vi.fn(),
    upsertShippedChange: vi.fn(),
    loadPageSurgeonContext: vi.fn(),
    topPagesByDemand: vi.fn(),
    loadChangeProposal: vi.fn(),
    recordShipment: vi.fn(),
    transitionProposalToImplemented: vi.fn(),
    resolveCurrentBasis: vi.fn(),},}));
vi.mock("@/lib/auth/can-publish", () => ({
  isAccountOwner: async () => ownerFlag.value,
  canPublishForCurrentTenant: async () => ownerFlag.value,}));
vi.mock("@/domains/decision", async () => ({
  loadPageSurgeonContext: mocks.loadPageSurgeonContext, topPagesByDemand: mocks.topPagesByDemand,
  loadChangeProposal: mocks.loadChangeProposal, proposalDisposition: async () => null, transitionProposalToImplemented: mocks.transitionProposalToImplemented,
  resolveCurrentBasis: mocks.resolveCurrentBasis,
  actionableProposalFailures: (await vi.importActual<typeof import("@/domains/decision/validate-proposal")>("@/domains/decision/validate-proposal")).actionableProposalFailures,
  openHold: (await vi.importActual<typeof import("@/domains/decision/completeness")>("@/domains/decision/completeness")).openHold, // the REAL one servability verdict, exactly as production gates the press
  dangerousComponents: (await vi.importActual<typeof import("@/domains/decision/contracts")>("@/domains/decision/contracts")).dangerousComponents,
  componentIdOf: (await vi.importActual<typeof import("@/domains/decision/contracts")>("@/domains/decision/contracts")).componentIdOf,
  deliverableGaps: (await vi.importActual<typeof import("@/domains/decision/completeness")>("@/domains/decision/completeness")).deliverableGaps, unsettledCause: (await vi.importActual<typeof import("@/domains/decision/completeness")>("@/domains/decision/completeness")).unsettledCause,
  sameComponentId: (await vi.importActual<typeof import("@/domains/decision/contracts")>("@/domains/decision/contracts")).sameComponentId,
  confirmedVersion: () => "fixture-version",
  treatmentSignatureOf: (await vi.importActual<typeof import("@/domains/decision/mutation-footprint")>("@/domains/decision/mutation-footprint")).treatmentSignatureOf,})); // THE REAL ONE: the press stamps what kind of work it was, so a mock of it would prove nothing about what lands on the record
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: () => ({}) }) }));
vi.mock("@/domains/account", async (orig) => ({ ...(await orig() as object), getTenant: async () => ({ id: "tenant-test", domain: "x.test" }) }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {} }));
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: () => true }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-test") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: mocks.loadPageSurgeonContext, topPagesByDemand: mocks.topPagesByDemand,}));
vi.mock("@/domains/measurement/proof-gsc/measure-pass", () => ({
  captureChangeMeta: mocks.captureChangeMeta, measureRecord: mocks.measureRecord,}));
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: mocks.loadShippedChanges, upsertShippedChange: mocks.upsertShippedChange,}));
vi.mock("@/domains/measurement/proof-gsc/record-shipment", () => ({ recordShipment: mocks.recordShipment }));
import { recordShippedChangeAction, recomputeProofLedgerAction } from "@/app/(shell)/results/actions";
import { markProposalImplementedAction } from "@/app/(shell)/changes/actions";
const BASIS = "basis_today::d6";
const EVENT = { eventId: "123e4567-e89b-42d3-a456-426614174000", shippedAt: "2026-06-20T20:00:00.000Z", timeZone: "America/Los_Angeles", offsetMinutes: -420 };
const external = (over: Record<string, unknown> = {}) => recordShippedChangeAction({ ...EVENT, pageUrl: "https://x.test/cities", changeType: "edit_title", before: "old", after: "new", ...over });
const PROPOSAL_ID = "tenant-test::/nowruz-guide::existing_edit::bundle";
const authorize = <T extends { bundle?: unknown; kind?: string }>(p: T): T => { const parts = ((p.bundle as { components?: { kind: string; label: string; after?: string | null }[] } | undefined)?.components ?? []);
  const owed = parts.map((c, i) => ({ c, i })).filter((x) => x.c.kind !== "title" && x.c.kind !== "meta");
  if (owed.length === 0) return p;
  const claims = owed.map((x) => ({ text: `The ${x.c.label} copy rests on the source below.`, supportedBy: ["fact-1"], of: componentIdOf(x.c, x.i) }));
  const row = { ...p, claims, supportFacts: [{ id: "fact-1", fact: "encyclopedia: the kite festival runs the first weekend of April." }] };
return { ...row, semanticReview: { ...(row.kind === "new_page" ? { scope: "whole_page" as const } : {}), of: copyKey(row as never), version: REVIEW_CONTRACT, editor: { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "Every declared copy component and its placement are accepted against the stated assignment and source." }, claims: claims.map((_, i) => ({ i, by: ["fact-1"], entailed: true })) } }; };
const proposal = (over: Record<string, unknown> = {}) => authorize({
  id: PROPOSAL_ID, tenantId: "tenant-test", kind: "existing_edit", pagePath: "/nowruz-guide",
  pageUrl: "https://x.test/nowruz-guide", pageLabel: "Nowruz guide", primaryQuery: "nowruz traditions",
  opportunityType: "Capture clicks", changeFamily: "title", status: "ready", riskLevel: "low", basis: BASIS, publish: "manual", limitations: [],
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" }, modeledOn: "the stored results page for this search, whose top titles share this shape",
  whyItMatters: "The line Google shows misses the words people search for.",
  bundle: { objective: "Say what the searcher asked for in the line Google shows.",
    scope: { queries: ["nowruz traditions"], prompts: [] },
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks.", observedAt: new Date(Date.now() - 86_400_000).toISOString() }],
      missing: [], freshestObservedAt: new Date(Date.now() - 86_400_000).toISOString() },
    components: [{ kind: "title", label: "Page title", after: null, risk: "safe", evidenceKeys: ["k1"] }, { kind: "opening_answer", label: "Opening answer", risk: "safe", evidenceKeys: ["k1"] }] }, ...over, });
beforeEach(() => {
  ownerFlag.value = true;
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.captureChangeMeta.mockResolvedValue({
    canonPage: "https://x.test/cities", path: "/cities", before: "old", after: "new", targetQueries: ["cities in iran"],
    headlineAction: "title", contentHash: "hash-before",});
  mocks.recordShipment.mockResolvedValue({ shipmentId: "shp_1", measurement: "measuring" });
  mocks.loadShippedChanges.mockResolvedValue([]);
  mocks.resolveCurrentBasis.mockResolvedValue(BASIS);
  mocks.loadChangeProposal.mockResolvedValue(proposal());
  mocks.transitionProposalToImplemented.mockResolvedValue(true);});
describe("external work uses the same Shipment contract", () => {
  it("requires the owner and refuses a foreign host before a matching-path capture can rewrite it", async () => {
    ownerFlag.value = false; expect((await external()).success).toBe(false); ownerFlag.value = true;
    expect((await external({ pageUrl: "https://other.test/cities" })).success).toBe(false);
    expect(mocks.captureChangeMeta).not.toHaveBeenCalled(); expect(mocks.recordShipment).not.toHaveBeenCalled(); });
  it("records two distinct same-day edits, including weak controls, with their true instants and no self-verification", async () => {
    expect((await external({ changeType: "edit_meta", before: "old meta", after: "new meta", notes: "own edit", targetQueries: "cities in iran\nlargest cities in iran" })).success).toBe(true);
    expect((await external({ eventId: "123e4567-e89b-42d3-a456-426614174001", shippedAt: "2026-06-20T21:00:00.000Z", changeType: "edit_title" })).success).toBe(true);
    const [a, b] = mocks.recordShipment.mock.calls.map((c) => c[0]);
    expect([a.proposalId !== b.proposalId, a.implementedAt, b.implementedAt, a.preChangeHashUnavailable, a.componentsApplied[0].kind, a.targetQueries, "verifiedLive" in a]).toEqual([true, EVENT.shippedAt, "2026-06-20T21:00:00.000Z", true, "meta", ["cities in iran", "largest cities in iran"], false]);
  });
  it("rejects unzoned, mismatched-offset, and spring-gap instants before writing", async () => {
    for (const over of [{ shippedAt: "2026-06-20T13:00" }, { offsetMinutes: -480 }, { shippedAt: "2026-03-08T10:30:00.000Z", offsetMinutes: -480 }])
      expect((await external(over)).success).toBe(false);
    expect(mocks.recordShipment).not.toHaveBeenCalled();
    expect((await external({ shippedAt: "2026-11-01T09:30:00.000Z", offsetMinutes: -480 })).success).toBe(true);
    expect((await external({ eventId: "123e4567-e89b-42d3-a456-426614174001", shippedAt: "2026-06-21T06:30:00.000Z" })).success).toBe(true);
    expect(mocks.recordShipment.mock.calls.map((c) => c[0].implementedAt)).toEqual(["2026-11-01T09:30:00.000Z", "2026-06-21T06:30:00.000Z"]); });
  it("a lost response retry keeps operator intent while cached query suggestions change", async () => {
    await external(); mocks.captureChangeMeta.mockResolvedValue({ canonPage: "https://x.test/cities", path: "/cities", before: "old", after: "new", targetQueries: ["a fresh GSC suggestion"], headlineAction: "title" });
    await external(); expect(mocks.recordShipment.mock.calls.map((c) => c[0].targetQueries)).toEqual([[], []]);
    expect(mocks.recordShipment.mock.calls.map((c) => c[0].proposalId)).toEqual([`external::${EVENT.eventId}`, `external::${EVENT.eventId}`]);
    mocks.recordShipment.mockRejectedValueOnce(new Error("This event ID already records different implementation facts"));
    expect((await external({ after: "different" })).error).toContain("first record was kept"); });
  it("refuses unsupported structure and incomplete copy", async () => {
    mocks.captureChangeMeta.mockResolvedValue({ canonPage: "https://x.test/cities", path: "/cities", before: null, after: null, targetQueries: [], headlineAction: null });
    expect((await external({ after: "" })).success).toBe(false);
    for (const changeType of ["keep_current", "monitor", "new_page", "section_add", "schema", "faq", "add_internal_link"]) expect((await external({ changeType })).success).toBe(false);
    expect(mocks.recordShipment).not.toHaveBeenCalled(); });
});
describe("recomputeProofLedgerAction, account-owner gating", () => {
  it("non-owner ⇒ refused, nothing recomputed", async () => {
    ownerFlag.value = false;
    const res = await recomputeProofLedgerAction(); expect(res.success).toBe(false);
    expect(mocks.loadShippedChanges).not.toHaveBeenCalled();});});
const PRESS = { proposalId: PROPOSAL_ID, expectedVersion: "fixture-version", destructiveConfirmed: true };
describe("markProposalImplementedAction, the shipment transaction", () => {
  const facts = (i = 0) => mocks.recordShipment.mock.calls[i]![0];
  it("writes the shipment BEFORE it flips the change", async () => {
    expect((await markProposalImplementedAction({ ...PRESS })).success).toBe(true); expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([1, 1]);
    expect(mocks.recordShipment.mock.invocationCallOrder[0]).toBeLessThan(mocks.transitionProposalToImplemented.mock.invocationCallOrder[0]);
    expect([facts().proposalId, facts().basis, facts().preChangeContentHash, facts().componentsApplied.map((c: { kind: string }) => c.kind)])
      .toEqual([PROPOSAL_ID, BASIS, "hash-before", ["title", "opening_answer"]]);
    expect(/line Google shows/.test(facts().bundleHypothesis)).toBe(true);
    expect(mocks.transitionProposalToImplemented.mock.calls[0]![2]).toBe("shp_1");});
  it.each([
    ["a selection I do not recognize", { componentIds: ["bogus"] }],
    ["a selection with nothing in it", { componentIds: [] as string[] }],
  ])("%s is refused before anything is written", async (_name, over) => {
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID, expectedVersion: PRESS.expectedVersion, ...over })).success).toBe(false); expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([0, 0]);});
  it("a change still in review is refused however it is pressed", async () => {
    mocks.loadChangeProposal.mockResolvedValue(proposal({ status: "needs_review", riskLevel: "high",
      bundle: { ...(proposal().bundle as object), components: [{ kind: "title", label: "Page title", after: null, risk: "dangerous", evidenceKeys: ["k1"] }] } }));
    const res = await markProposalImplementedAction({ ...PRESS }); expect([res.success, res.error]).toEqual([false, "This change is still being reviewed, so it cannot be marked done yet. Open Changes for the work that is ready to make today."]);
    expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([0, 0]);});
  it.each([
    ["insufficient_comparison", "Too few pages on your site can be fairly compared"],
    ["measurement_unavailable", "Your search data could not be read just now"],
  ])("records the work whatever the data can support, and says so: %s", async (state, said) => {
    mocks.recordShipment.mockResolvedValue({ shipmentId: "shp_1", measurement: state });
    const res = await markProposalImplementedAction({ ...PRESS }); expect([res.success, res.note?.startsWith("Recorded."), res.note?.includes(said)]).toEqual([true, true, true]);
    expect(mocks.transitionProposalToImplemented).toHaveBeenCalledOnce(); // the change is done, and the reading is a separate fact
  });
  /** P1-1 + P1-2. The remainder came off THIS press, so press two of three said "the other 2" with one left; and the picker pre-ticks everything with no memory of what is already recorded, so a partial press followed by the default full press wrote a SECOND record measuring the same component twice. The server owes both answers whatever the screen sends: the true remainder, and a wanted set with everything already on file taken out of it. */
  it("names the true remainder, and can never record one piece twice", async () => {
    const part = (kind: string, label: string, after: string) => ({ kind, label, after, risk: "safe", evidenceKeys: ["k1"] });
    const parts = [part("title", "Page title", "a"), part("meta", "Description", "b"), part("opening_answer", "Opening answer", "c")];
    mocks.loadChangeProposal.mockResolvedValue(proposal({ bundle: { ...(proposal().bundle as object),
      components: parts } }));
    const held: unknown[] = []; const press = async (over: Record<string, unknown> = {}) => { mocks.loadShippedChanges.mockResolvedValue([...held]); mocks.recordShipment.mockClear();
      const res = await markProposalImplementedAction({ proposalId: PROPOSAL_ID, expectedVersion: PRESS.expectedVersion, ...over });
      for (const c of mocks.recordShipment.mock.calls) held.push({ id: `s${held.length}`, ...c[0] });
      return res; };
    expect((await press({ componentIds: [componentIdOf(parts[0]!, 0)] })).note).toContain("The other 2"); expect((await press({ componentIds: [componentIdOf(parts[1]!, 1)] })).note).toContain("The other 1");
    expect((await press()).success).toBe(true); expect(facts().componentsApplied.map((c: { id: string }) => c.id.split(":").slice(0, 2).join(":"))).toEqual(["2:opening_answer"]);
    expect(mocks.transitionProposalToImplemented).toHaveBeenCalledOnce(); const again = await press();
    expect([again.success, again.note]).toEqual([true, "Every piece of this change is already on file and being measured. There is nothing left for you to record here."]); expect(mocks.recordShipment).not.toHaveBeenCalled();
    held.length = 0;
    const once = (await press({ componentIds: [componentIdOf(parts[0]!, 0)] }), facts());
    held.length = 0;
    await press({ componentIds: [componentIdOf(parts[0]!, 0), componentIdOf(parts[0]!, 0)] }); expect([facts().proposalVersion, facts().componentsApplied]).toEqual([once.proposalVersion, once.componentsApplied]);});
  it("never hands a customer a backend error", async () => { // P1-13: a Supabase relation name is not an answer
    mocks.transitionProposalToImplemented.mockRejectedValue(new Error("relation change_proposals does not exist"));
    expect(await markProposalImplementedAction({ ...PRESS })).toEqual({ success: false, retryable: true, error: "That could not be recorded just now. Press it again in a moment." });});
  it("keeps the operator's own applied wording on the record beside the prepared one, and never lets a press stand in for a reading", async () => {
    await markProposalImplementedAction({ ...PRESS, appliedText: "The words that are on my page." });
    expect([facts().operatorNote, facts().componentsApplied.map((c: { appliedAfter?: string }) => c.appliedAfter), facts().after, "verification" in facts()], "a press recording SEVERAL pieces cannot say which one their line landed on, so it stays on the row, no piece claims it, and the prepared wording is untouched").toEqual(["The words that are on my page.", [undefined, undefined], "Nowruz Traditions and the Haft-Seen Table", false]);
    mocks.recordShipment.mockClear();
    await markProposalImplementedAction({ ...PRESS }); expect(facts().operatorNote).toBeNull();});
  it.each([
    ["a change whose page words are gone", () => mocks.loadChangeProposal.mockResolvedValue(proposal({ recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "The exact wording has not been written yet" } }))], // REPLACES "a change I set aside": a basis stamped in an earlier generation no longer refuses a press, so the row that is refused before anything is written is the one whose deliverable is not written
    ["a change I cannot find", () => mocks.loadChangeProposal.mockResolvedValue(null)],
    ["a press by someone who may not publish", () => { ownerFlag.value = false; }],
  ])("%s is refused before anything is written", async (_name, arrange) => {
    arrange();
    expect((await markProposalImplementedAction({ ...PRESS })).success).toBe(false); expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([0, 0]);});});
describe("a complete new page is one recorded publication", () => {
  const sections = ["When it runs", "Where to watch"], opening = "The kite festival runs the first weekend of April.";
  const page = () => proposal({ kind: "new_page", informationGain: { adds: "the page answers an uncovered reader task", by: ["fact-1"], pageWhole: true }, pagePath: null, pageUrl: null, recommendedChange: { kind: "new_page", proposedTitle: "Kite festival guide", metaDescription: "A guide to the kite festival dates, viewing places, and what visitors can expect.", openingAnswer: opening, outline: sections, faqQuestions: [], schemaTypes: [] },
    newPageDraft: { brief: { proposedTitle: "Kite festival guide", pageHeading: "Kite festival dates and places", sections: sections.map(heading => ({ heading })) }, pieces: [{ slot: 0, after: opening }, ...sections.map((heading, i) => ({ slot: i + 1, heading, after: `${heading}: ${opening}` }))] }, bundle: { ...proposal().bundle, components: [{ kind: "title", label: "Page title", after: "Kite festival guide", risk: "safe", evidenceKeys: ["k1"] }, { kind: "meta", label: "Meta description", after: "A guide to the kite festival dates, viewing places, and what visitors can expect.", risk: "safe", evidenceKeys: ["k1"] }, { kind: "h1", label: "Page heading (H1)", after: "Kite festival dates and places", risk: "safe", evidenceKeys: ["k1"] }, { kind: "opening_answer", label: "Opening answer", after: opening, risk: "safe", evidenceKeys: ["k1"] }, ...sections.map(h => ({ kind: "section", label: h, after: `${h}\n\n${h}: ${opening}`, risk: "safe", evidenceKeys: ["k1"] }))] } });
  it("refuses a duplicate that hides the H1 or a section before any Shipment write", async () => {
    const row = page(), parts = row.bundle!.components, ids = parts.map(componentIdOf); mocks.loadChangeProposal.mockResolvedValue(row); const missingH1 = await markProposalImplementedAction({ ...PRESS, liveUrl: "https://x.test/kite", componentIds: [ids[0]!, ids[1]!, ids[3]!, ids[4]!, ids[5]!, ids[4]!] });
    const missingSection = await markProposalImplementedAction({ ...PRESS, liveUrl: "https://x.test/kite", componentIds: [ids[0]!, ids[1]!, ids[2]!, ids[3]!, ids[4]!, ids[4]!] }); expect([missingH1.error, missingSection.error, mocks.recordShipment.mock.calls.length]).toEqual(["A new page is one complete publication. Apply and record every component together.", "A new page is one complete publication. Apply and record every component together.", 0]); const noUrl = await markProposalImplementedAction({ ...PRESS, componentIds: ids }); expect(noUrl.success).toBe(false); const complete = await markProposalImplementedAction({ ...PRESS, liveUrl: "https://x.test/kite", componentIds: ids }); expect([complete.success, mocks.recordShipment.mock.calls.length]).toEqual([true, 1]);
  }); });
