/** GSC Proof ledger, server-action gating. Measurement mutations are ACCOUNT-OWNER-ONLY (2026-07-23 account-isolation contraction): the record / recompute actions must never run their heavy GSC reads or writes unless the authenticated user owns the current account, and no environment flag can grant it. The server-only deps are mocked so this is a fast behavioural test of the gate. */
import { describe, it, expect, beforeEach, vi } from "vitest";
const { ownerFlag, mocks } = vi.hoisted(() => ({
  ownerFlag: { value: true },
  mocks: {
    captureChangeMeta: vi.fn(),
    recordShippedChange: vi.fn(),
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
  loadChangeProposal: mocks.loadChangeProposal, transitionProposalToImplemented: mocks.transitionProposalToImplemented,
  resolveCurrentBasis: mocks.resolveCurrentBasis,
  // The ONE verdict every door asks, and the kinds that move or hide a page: the REAL ones, so the mutation door under test is gated here exactly as production gates it.
  actionableProposalFailures: (await vi.importActual<typeof import("@/domains/decision/validate-proposal")>("@/domains/decision/validate-proposal")).actionableProposalFailures,
  openHold: (await vi.importActual<typeof import("@/domains/decision/completeness")>("@/domains/decision/completeness")).openHold, // the REAL one servability verdict, exactly as production gates the press
  dangerousComponents: (await vi.importActual<typeof import("@/domains/decision/contracts")>("@/domains/decision/contracts")).dangerousComponents,
  componentIdOf: (await vi.importActual<typeof import("@/domains/decision/contracts")>("@/domains/decision/contracts")).componentIdOf,
  deliverableGaps: (await vi.importActual<typeof import("@/domains/decision/completeness")>("@/domains/decision/completeness")).deliverableGaps, unsettledCause: (await vi.importActual<typeof import("@/domains/decision/authorization")>("@/domains/decision/authorization")).unsettledCause,
  sameComponentId: (await vi.importActual<typeof import("@/domains/decision/contracts")>("@/domains/decision/contracts")).sameComponentId,}));
vi.mock("@/lib/persistence/repositories", () => ({ getRepository: () => ({ forTenant: () => ({}) }) }));
vi.mock("@/domains/account", async (orig) => ({ ...(await orig() as object), getTenant: async () => ({ id: "tenant-test", domain: "x.test" }) }));
vi.mock("@/app/(shell)/surface-release", () => ({ invalidateCoreSurfaces: async () => {} }));
// The presentation-only operator flag must be POWERLESS here: force it on to prove it cannot authorize a mutation for a non-owner.
vi.mock("@/lib/operator-mode", () => ({ isOperatorModeServer: () => true }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: vi.fn(async () => "tenant-test") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/domains/decision/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: mocks.loadPageSurgeonContext, topPagesByDemand: mocks.topPagesByDemand,}));
vi.mock("@/domains/measurement/proof-gsc/measure-pass", () => ({
  captureChangeMeta: mocks.captureChangeMeta, recordShippedChange: mocks.recordShippedChange, measureRecord: mocks.measureRecord,
  // audit-4: actions.ts now defaults shipDate to the Pacific calendar day.
  defaultPacificShipDate: () => "2026-06-22",
  // THE ONE comparison-page chooser, shared by the record path and the shipment, so both doors refuse alike. null is the read that FAILED, which is a different sentence from a site that genuinely has too few pages.
  selectControlPages: async () => { const pages = mocks.topPagesByDemand(); return pages === null ? null : pages.slice(0, 3); },}));
vi.mock("@/domains/measurement/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: mocks.loadShippedChanges, upsertShippedChange: mocks.upsertShippedChange,}));
// THE ONE DOOR THAT WRITES A SHIPMENT. It always writes and always answers with the row's id and what that row can be fairly compared against; the mark-implemented press consumes it and never decides any of that for itself.
vi.mock("@/domains/measurement/proof-gsc/record-shipment", () => ({ recordShipment: mocks.recordShipment }));
import { recordShippedChangeAction, recomputeProofLedgerAction } from "@/app/(shell)/results/actions";
import { markProposalImplementedAction } from "@/app/(shell)/changes/actions";
const BASIS = "basis_today::d6";
const PROPOSAL_ID = "tenant-test::/nowruz-guide::existing_edit::bundle";
/** The change the operator is confirming: a two-component bundle on a page Beacon holds. */
const proposal = (over: Record<string, unknown> = {}) => ({
  id: PROPOSAL_ID, tenantId: "tenant-test", kind: "existing_edit", pagePath: "/nowruz-guide",
  pageUrl: "https://x.test/nowruz-guide", pageLabel: "Nowruz guide", primaryQuery: "nowruz traditions",
  // THE SHIPMENT PATH IS EXERCISED ON A CHANGE THE READY LANE REALLY HANDS OVER, because `ready` is now the only lane any door will record: a card still in review is refused by the action itself (pinned below). The canon already refuses a dangerous piece in the ready lane, so the pieces here are graded safe and the dangerous shape is exercised where it truly lives, at needs_review. Its readings are dated relative to now.
  opportunityType: "Capture clicks", changeFamily: "title", status: "ready", riskLevel: "low", basis: BASIS, publish: "manual", limitations: [],
  recommendedChange: { kind: "existing_edit", field: "title", before: "Nowruz", after: "Nowruz Traditions and the Haft-Seen Table" },
  whyItMatters: "The line Google shows misses the words people search for.",
  bundle: { objective: "Say what the searcher asked for in the line Google shows.",
    scope: { queries: ["nowruz traditions"], prompts: [] },
    receipt: { items: [{ key: "k1", kind: "gsc_demand", fact: "1,200 impressions and 9 clicks.", observedAt: new Date(Date.now() - 86_400_000).toISOString() }],
      missing: [], freshestObservedAt: new Date(Date.now() - 86_400_000).toISOString() },
    components: [{ kind: "title", label: "Page title", after: null, risk: "safe", evidenceKeys: ["k1"] }, { kind: "opening_answer", label: "Opening answer", risk: "safe", evidenceKeys: ["k1"] }] },
  ...over, });
beforeEach(() => {
  ownerFlag.value = true;
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.captureChangeMeta.mockResolvedValue({
    canonPage: "https://x.test/cities", path: "/cities", before: "old", after: "new", targetQueries: ["cities in iran"],
    headlineAction: "title", contentHash: "hash-before",});
  mocks.recordShippedChange.mockResolvedValue({ id: "/cities::2026-06-19", verdict: "measuring" });
  mocks.recordShipment.mockResolvedValue({ shipmentId: "shp_1", measurement: "measuring" });
  mocks.upsertShippedChange.mockResolvedValue(undefined);
  mocks.loadShippedChanges.mockResolvedValue([]);
  mocks.loadPageSurgeonContext.mockResolvedValue({});
  mocks.topPagesByDemand.mockReturnValue(["https://x.test/a", "https://x.test/b", "https://x.test/c"]);
  mocks.resolveCurrentBasis.mockResolvedValue(BASIS);
  mocks.loadChangeProposal.mockResolvedValue(proposal());
  mocks.transitionProposalToImplemented.mockResolvedValue(true);});
describe("recordShippedChangeAction, account-owner gating", () => {
  it("non-owner ⇒ refused even with the operator env flag on, no record written", async () => {
    ownerFlag.value = false;
    const res = await recordShippedChangeAction({ pageUrl: "https://x.test/cities" });
    expect([res.success, /owner/i.test(res.error ?? ""), mocks.recordShippedChange.mock.calls.length, mocks.upsertShippedChange.mock.calls.length]).toEqual([false, true, 0, 0]);});
  it("account owner ⇒ captures baseline + persists the record, and a missing page is refused", async () => {
    expect((await recordShippedChangeAction({ pageUrl: "https://x.test/cities" })).success).toBe(true); expect([mocks.recordShippedChange.mock.calls.length, mocks.upsertShippedChange.mock.calls.length]).toEqual([1, 1]);
    expect((await recordShippedChangeAction({ pageUrl: "" })).success).toBe(false); expect(mocks.recordShippedChange).toHaveBeenCalledOnce();});
  it("ANY page ⇒ still records, controls derived from top-demand pages", async () => {
    expect((await recordShippedChangeAction({ pageUrl: "/cities" })).success).toBe(true);
    expect(mocks.topPagesByDemand).toHaveBeenCalled(); // fallback control selection fired
    expect(mocks.recordShippedChange.mock.calls[0][0].controlPages.length).toBeGreaterThan(0);});
  it("passes explicit change fields through to recordShippedChange", async () => {
    const res = await recordShippedChangeAction({
      pageUrl: "/cities", changeType: "edit_meta", before: "old meta", after: "new meta", shippedAt: "2026-06-20",
      notes: "manual edit on my site", targetQueries: "cities in iran\nlargest cities in iran, cities of iran",
      verifiedLive: true, liveSourceUrl: "https://www.fixture-content.example/cities",
    });
    expect(res.success).toBe(true); const arg = mocks.recordShippedChange.mock.calls[0][0];
    expect(arg.actionType).toBe("edit_meta"); expect(arg.before).toBe("old meta");
    expect(arg.after).toBe("new meta"); expect(arg.notes).toBe("manual edit on my site");
    expect(arg.verifiedLive).toBe(true); expect(arg.liveSourceUrl).toBe("https://www.fixture-content.example/cities");
    expect(arg.targetQueries).toEqual(["cities in iran", "largest cities in iran", "cities of iran"]);});
  it("a real edit owes its before and after; a keep-current decision does not", async () => {
    const noCopy = { canonPage: "https://x.test/cities", path: "/cities", before: null, after: null, targetQueries: [], headlineAction: null };
    mocks.captureChangeMeta.mockResolvedValue(noCopy);
    const refused = await recordShippedChangeAction({ pageUrl: "/cities", changeType: "edit_title" });
    expect([refused.success, /before and after/i.test(refused.error ?? ""), mocks.recordShippedChange.mock.calls.length]).toEqual([false, true, 0]);
    expect([(await recordShippedChangeAction({ pageUrl: "/cities", changeType: "keep_current" })).success, mocks.recordShippedChange.mock.calls.length]).toEqual([true, 1]);});
  it("duplicate page + ship date ⇒ refused, nothing overwritten", async () => {
    mocks.loadShippedChanges.mockResolvedValue([{ path: "/cities", actionType: "meta", shippedAt: "2026-06-20T08:00:00.000Z" }]);
    const res = await recordShippedChangeAction({ pageUrl: "/cities", shippedAt: "2026-06-20" }); expect([res.success, /already recorded/i.test(res.error ?? ""), mocks.recordShippedChange.mock.calls.length]).toEqual([false, true, 0]);});
  it("fewer than 2 control pages ⇒ refused, nothing recorded", async () => {
    mocks.topPagesByDemand.mockReturnValue(["https://x.test/a"]); // only 1 candidate
    const res = await recordShippedChangeAction({ pageUrl: "/cities" }); expect([res.success, /only 1 page on your site/i.test(res.error ?? ""), mocks.recordShippedChange.mock.calls.length]).toEqual([false, true, 0]);});
  it("never hands a customer a backend error", async () => { // P1-13
    mocks.captureChangeMeta.mockRejectedValue(new Error("relation shipped_change_proof does not exist"));
    expect(await recordShippedChangeAction({ pageUrl: "/cities" })).toEqual({ success: false, error: "That change could not be recorded just now. Try it again in a moment." });});});
describe("recomputeProofLedgerAction, account-owner gating", () => {
  it("non-owner ⇒ refused, nothing recomputed", async () => {
    ownerFlag.value = false;
    const res = await recomputeProofLedgerAction(); expect(res.success).toBe(false);
    expect(mocks.loadShippedChanges).not.toHaveBeenCalled();});});
/** THE SHIPMENT TRANSACTION (Phase 6). "Mark implemented" used to flip a status and nothing else, so a change the operator really made left no record of what was applied or where the page stood beforehand. The press now writes a Shipment FIRST and flips SECOND: a crash between them leaves a Shipment nobody flipped, which the next press heals, where the reverse leaves a change marked done that nothing measures. */
/** The fixture's title piece is GRADED dangerous, so every whole-bundle press carries the deliberate yes: the canonical rule is the risk grade OR the kind, never the four kinds alone. */
const PRESS = { proposalId: PROPOSAL_ID, destructiveConfirmed: true };
describe("markProposalImplementedAction, the shipment transaction", () => {
  const facts = (i = 0) => mocks.recordShipment.mock.calls[i]![0];
  it("writes the shipment BEFORE it flips the change", async () => {
    expect((await markProposalImplementedAction({ ...PRESS })).success).toBe(true); expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([1, 1]);
    expect(mocks.recordShipment.mock.invocationCallOrder[0]).toBeLessThan(mocks.transitionProposalToImplemented.mock.invocationCallOrder[0]);
    expect([facts().proposalId, facts().basis, facts().preChangeContentHash, facts().componentsApplied.map((c: { kind: string }) => c.kind)])
      .toEqual([PROPOSAL_ID, BASIS, "hash-before", ["title", "opening_answer"]]);
    expect(/line Google shows/.test(facts().bundleHypothesis)).toBe(true);
    // And the flip carries the id of the record that is measuring it, so no bare status flip is reachable from this door.
    expect(mocks.transitionProposalToImplemented.mock.calls[0]![2]).toBe("shp_1");});
  it("a shipment that does not land leaves the change unflipped, and never leaks the reason", async () => {
    mocks.recordShipment.mockRejectedValue(new Error("relation shipped_change_proof does not exist"));
    const res = await markProposalImplementedAction({ ...PRESS });
    expect([res.success, /could not start/i.test(res.error ?? ""), /shipped_change_proof/.test(res.error ?? ""), mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([false, true, false, 0]);});
  it("a second press on the same change does NOTHING: the record I already hold stands", async () => {
    await markProposalImplementedAction({ ...PRESS });
    // The change is now on file, checked, with its own ship date and starting numbers.
    mocks.loadShippedChanges.mockResolvedValue([{ id: "shp_1", proposalId: PROPOSAL_ID, proposalVersion: facts().proposalVersion,
      componentsApplied: facts().componentsApplied, shippedAt: "2026-06-19T00:00:00.000Z", baseline: { clicks: 9 },
      verification: { status: "verified", checkedAt: "2026-06-20T00:00:00.000Z", components: [] } }]);
    mocks.loadChangeProposal.mockResolvedValue(proposal({ status: "implemented_pending_verification" })); // the flip already happened
    mocks.recordShipment.mockClear();
    // Success, because the change really is recorded as done. And nothing is rebuilt: rebuilding it erased the live check back to null, moved the ship date to today, and recomputed the displayed starting numbers over a window that included the days AFTER the change.
    expect((await markProposalImplementedAction({ ...PRESS })).success).toBe(true); expect(mocks.recordShipment).not.toHaveBeenCalled();});
  it("a genuinely new version of the copy is a new Shipment, and leaves the old one alone", async () => {
    await markProposalImplementedAction({ ...PRESS });
    mocks.loadShippedChanges.mockResolvedValue([{ id: "shp_1", proposalId: PROPOSAL_ID, proposalVersion: "an-older-version" }]);
    mocks.recordShipment.mockClear();
    expect((await markProposalImplementedAction({ ...PRESS })).success).toBe(true); expect(mocks.recordShipment).toHaveBeenCalledOnce();});
  // The grade travels because measurement owes a dangerous change a fourth checkpoint and the kind alone never says it is dangerous; the id travels because two pieces of one kind are picked apart, and because the flip waits until every piece is on file.
  it("records only the components the operator says they applied, with the risk grade each carried", async () => {
    expect((await markProposalImplementedAction({ ...PRESS, componentIds: ["0:title"] })).success).toBe(true);
    // The name carries the exact copy as well as the position and the kind, so a redraft is never mistaken for work already recorded; the piece is pinned by both.
    const [one] = facts().componentsApplied; expect([one.id.startsWith("0:title:"), one.kind, one.label, one.after, one.risk]).toEqual([true, "title", "Page title", null, "safe"]);});
  // P0-4. The server used to trust whatever kinds the caller sent: ["bogus"] selected nothing, skipped the deliberate yes entirely, wrote a shipment and closed the whole proposal.
  it.each([
    ["a selection I do not recognize", { componentIds: ["bogus"] }],
    ["a selection with nothing in it", { componentIds: [] as string[] }],
  ])("%s is refused before anything is written", async (_name, over) => {
    expect((await markProposalImplementedAction({ proposalId: PROPOSAL_ID, ...over })).success).toBe(false); expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([0, 0]);});
  // THE LANE IS THE RULE. A complete card with no cause mismatch and a deliberate yes on every piece is STILL refused while it sits in review: the queue holds it back, the detail page hands over no Copy and no Mark done, and a direct press on the action cannot start a 28 day reading of work nobody promoted. A dangerous piece lives here too, because the canon refuses one in the ready lane, so the deliberate-yes gate below it is reached by nothing today.
  it("a change still in review is refused however it is pressed", async () => {
    mocks.loadChangeProposal.mockResolvedValue(proposal({ status: "needs_review", riskLevel: "high",
      bundle: { ...(proposal().bundle as object), components: [{ kind: "title", label: "Page title", after: null, risk: "dangerous", evidenceKeys: ["k1"] }] } }));
    const res = await markProposalImplementedAction({ ...PRESS }); expect([res.success, res.error]).toEqual([false, "This change is still being reviewed, so it cannot be marked done yet. Open Changes for the work that is ready to make today."]);
    expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([0, 0]);});
  // AN IMPLEMENTATION FACT IS A FACT. A true implementation used to go unrecorded because the comparison set was short, so the queue offered the operator's own finished work back the next morning. It is recorded either way now, and the press says which reading it can actually start.
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
    mocks.loadChangeProposal.mockResolvedValue(proposal({ bundle: { ...(proposal().bundle as object),
      components: [part("title", "Page title", "a"), part("meta", "Description", "b"), part("opening_answer", "Opening answer", "c")] } }));
    const held: unknown[] = []; const press = async (over: Record<string, unknown> = {}) => { mocks.loadShippedChanges.mockResolvedValue([...held]); mocks.recordShipment.mockClear();
      const res = await markProposalImplementedAction({ proposalId: PROPOSAL_ID, ...over });
      for (const c of mocks.recordShipment.mock.calls) held.push({ id: `s${held.length}`, ...c[0] });
      return res; };
    expect((await press({ componentIds: ["0:title"] })).note).toContain("The other 2"); expect((await press({ componentIds: ["1:meta"] })).note).toContain("The other 1");
    // The default press ticks everything; only the piece nobody has recorded may land, and the change then closes.
    expect((await press()).success).toBe(true); expect(facts().componentsApplied.map((c: { id: string }) => c.id.split(":").slice(0, 2).join(":"))).toEqual(["2:opening_answer"]);
    expect(mocks.transitionProposalToImplemented).toHaveBeenCalledOnce(); const again = await press();
    expect([again.success, again.note]).toEqual([true, "Every piece of this change is already on file and being measured. There is nothing left for you to record here."]); expect(mocks.recordShipment).not.toHaveBeenCalled();
    // P2: the same piece twice in one press is one piece, so a repeated pick can never mint a second version of one record.
    held.length = 0;
    const once = (await press({ componentIds: ["0:title"] }), facts());
    held.length = 0;
    await press({ componentIds: ["0:title", "0:title"] }); expect([facts().proposalVersion, facts().componentsApplied]).toEqual([once.proposalVersion, once.componentsApplied]);});
  // P1-3. A read that FAILED is not a site with too few pages: telling a connected operator to connect Search Console is a false diagnosis of their own account, and the fix it asks for is one they already did. The Results door still owes that distinction on its own read.
  it("tells a failed comparison read apart from a site that genuinely has too few pages", async () => {
    mocks.topPagesByDemand.mockReturnValue(null);
    expect(await recordShippedChangeAction({ pageUrl: "/cities" }))
      .toEqual({ success: false, error: "Your other pages could not be read just now, so this is not recorded yet. Try it again in a moment." });
    expect(mocks.recordShippedChange).not.toHaveBeenCalled();});
  it("never hands a customer a backend error", async () => { // P1-13: a Supabase relation name is not an answer
    mocks.transitionProposalToImplemented.mockRejectedValue(new Error("relation change_proposals does not exist"));
    expect(await markProposalImplementedAction({ ...PRESS })).toEqual({ success: false, error: "That could not be recorded just now. Press it again in a moment." });});
  // PIN (B): THE BYPASS IS GONE. A press that still carries the retired override flag records a note and a Shipment with NO verification on it, so the live check is owed exactly as it is for every other press.
  it("keeps the operator's words as a note and never lets a press stand in for a reading", async () => {
    await markProposalImplementedAction({ ...PRESS, operatorConfirmed: true, operatorNote: "I pasted it in myself." });
    expect([facts().operatorNote, "operatorConfirmed" in facts(), "verification" in facts()]).toEqual(["I pasted it in myself.", false, false]);
    mocks.recordShipment.mockClear();
    await markProposalImplementedAction({ ...PRESS }); expect(facts().operatorNote).toBeNull();});
  it.each([
    // The ACCOUNT half of the basis moved. A generation-only bump (::d6 to ::d9) no longer sets a row aside; the checks decide those.
    ["a change I set aside", () => mocks.resolveCurrentBasis.mockResolvedValue("basis_moved::d6")],
    ["a change I cannot find", () => mocks.loadChangeProposal.mockResolvedValue(null)],
    ["a press by someone who may not publish", () => { ownerFlag.value = false; }],
  ])("%s is refused before anything is written", async (_name, arrange) => {
    arrange();
    expect((await markProposalImplementedAction({ ...PRESS })).success).toBe(false); expect([mocks.recordShipment.mock.calls.length, mocks.transitionProposalToImplemented.mock.calls.length]).toEqual([0, 0]);});});
describe("a new page owes me the address it is live at", () => {
  // A PUBLISH-READY PAGE, because the ADDRESS gate is what is under test: an outline with no copy behind it is refused a step earlier by the completeness boundary.
  const SECTIONS = ["When it runs", "Where to watch", "What to bring"], OPENS = "The kite festival runs the first weekend of April.";
  const newPage = () => proposal({ kind: "new_page", pagePath: null, pageUrl: null, pageLabel: "Kite festival guide", recommendedChange: { kind: "new_page", proposedTitle: "Kite festival guide", metaDescription: "Everything the kite festival guide covers.", openingAnswer: OPENS, outline: SECTIONS, faqQuestions: [], schemaTypes: [] },
    bundle: { ...proposal().bundle, components: SECTIONS.map((h) => ({ kind: "section_add", label: h, after: `${h}: ${OPENS}`, risk: "safe", evidenceKeys: ["k1"] })) } });
  it("refuses with no address and with someone else's site, then records and verifies the one I can read", async () => {
    mocks.loadChangeProposal.mockResolvedValue(newPage()); const none = await markProposalImplementedAction({ ...PRESS });
    const away = await markProposalImplementedAction({ ...PRESS, liveUrl: "https://elsewhere.example/kite" });
    expect([none.success, none.error, away.success, away.error]).toEqual([false, "Add the address the new page is live at, on x.test, so it can be read.",
      false, "That address is on elsewhere.example, not on x.test. Only pages on your own site are recorded and read."]);
    expect(mocks.recordShipment).not.toHaveBeenCalled(); // nothing is written until I hold an address I can check
    expect((await markProposalImplementedAction({ ...PRESS, liveUrl: "https://www.x.test/kite-festival-guide" })).success).toBe(true);
    expect(mocks.recordShipment.mock.calls[0]![0]).toMatchObject({ page: "https://www.x.test/kite-festival-guide", path: "/kite-festival-guide" }); // verification reads THAT page
    // The flip carries the record that is measuring it, and the address that record was written against.
    expect(mocks.transitionProposalToImplemented).toHaveBeenCalledWith("tenant-test", PROPOSAL_ID, "shp_1", "https://www.x.test/kite-festival-guide");
  });});
