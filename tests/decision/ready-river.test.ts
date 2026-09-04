/** WHAT A CHANGE OWES NEXT IS TYPED (operator, 2026-09-02). The machine used to work its next step out of English: a lowercase first letter meant a gate wrote this, a phrase list meant a hold was withdrawn, and a review that was owed was filed as a fact acquisition, so the runtime bought facts while the reading nobody had taken stayed untaken. These pin the ladder itself, and the one merge that must never overrule it. */
import { describe, it, expect, beforeEach, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], client: {} as Record<string, unknown> }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
import { nextObligation } from "@/domains/decision/obligation";
import { preferFinished } from "@/domains/decision/completeness";
import { proposalFingerprint, readQueuePage, saveChangeProposal } from "@/domains/decision/proposal-store";
import { copyKey } from "@/domains/decision/proof";
import { supabaseFake } from "../helpers/supabase-fake";
import { deserializeChangeProposal, type ChangeProposal } from "@/domains/decision/contracts";
Object.assign(db.client, supabaseFake({ rows: () => db.rows }), { rpc: async () => ({ data: "saved", error: null }) });
const held = (): ChangeProposal => ((db.rows[0]!.payload as { proposal: ChangeProposal }).proposal);
const row = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id: "t::/p::existing_edit::title", tenantId: "t", kind: "existing_edit", pagePath: "/p", pageUrl: "https://fixture.example/p", pageLabel: "P", primaryQuery: "q", opportunityType: "Capture clicks", changeFamily: "title", status: "ready", researchOnly: false, recommendedChange: { kind: "existing_edit", field: "title", before: "Old", after: "A finished title for this page" }, whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "q", hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, modeledOn: "the stored results page for this search", publish: "manual", createdAt: "2026-09-02T00:00:00.000Z", ...over });
describe("the typed next step a stored change owes", () => {
  it("owes nothing on a finished row, however its caveats happen to be worded", () => expect(nextObligation(row({ limitations: ["it reads a little flat to me", "this rearranges the page"] }))).toBeNull());
  it("owes a draft while nothing exact is written, and a redraft once its own gates faulted the words", () => {
    expect(nextObligation(row({ researchOnly: true, status: "needs_review" }))).toEqual({ kind: "draft" });
    expect(nextObligation(row({ status: "needs_review", faults: ["it lands in the wrong place"] }))).toEqual({ kind: "redraft", attempt: 1, instruction: "it lands in the wrong place" }); });
  it("settles rather than retries after two corrective drafts, keeps a settlement it already made, and settles the moment a redraft hands back the exact retired words", () => {
    expect(nextObligation(row({ status: "needs_review", faults: ["f"], previousCopy: { after: "old words", retiredBecause: "r", at: "2026-09-01T00:00:00.000Z", attempts: 2 } }))?.kind).toBe("terminal");
    expect(nextObligation(row({ obligation: { kind: "terminal", reason: "settled once" }, faults: ["f"] }))).toEqual({ kind: "terminal", reason: "settled once" });
    const retired = row({ status: "needs_review", faults: ["f"], previousCopy: { after: "A finished title for this page", retiredBecause: "r", at: "2026-09-01T00:00:00.000Z", attempts: 1 } }); // attempt 1 of 2, so only the identical words settle it
    const back = preferFinished(retired, null); expect([back.obligation?.kind, nextObligation(back)?.kind], "the same words back again are the answer, not a second attempt").toEqual(["terminal", "terminal"]); });
  /** A REFUSED REVIEW IS NOT BOUGHT AGAIN THE SAME DAY (falsifier, 2026-09-02): /farsi-numbers was reviewed at 02:56Z and again at 03:08Z, with the reviewer's own objection sitting on the row as a typed fault both times. A reading is for copy with no KNOWN defect. */ it("owes the corrective draft before another reading, once a reviewer has already refused these exact words", () => {
    const reviewed = row({ status: "needs_review", changeFamily: "factual_correction", claims: [{ text: "c", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "f" }] });
    expect(nextObligation(reviewed), "with nothing known against it, the reading is what is owed").toEqual({ kind: "review" });
    const stale = { ...reviewed, semanticReview: { of: copyKey(reviewed), version: 4, claims: [{ i: 0, entailed: true, by: ["fact-1"] }], materialChange: true } as never, faults: ["the reading on file was made under an older review contract, so it is read again before these words are offered"] };
    expect([nextObligation(stale), nextObligation({ ...stale, faults: [...stale.faults, "it lands in the wrong place"] })], "A REVIEW OWED IS NOT A REDRAFT WEARING A FAULT: sixteen live rows carried the cutover's own sentence as a typed fault and each owed a paid rewrite of words nothing had faulted; a real fault beside it still buys the redraft").toEqual([{ kind: "review" }, { kind: "redraft", attempt: 1, instruction: "it lands in the wrong place" }]);
    expect(nextObligation({ ...reviewed, faults: ["a claim here was not shown to follow from the exact sources it names"] }), "and once that reading has refused it, the redraft is").toEqual({ kind: "redraft", attempt: 1, instruction: "a claim here was not shown to follow from the exact sources it names" }); });
  /** STRUCTURED DATA IS REVIEWED BY ITS OWN GATE, NOT BY THE EDITOR'S CHECKLIST (falsifier, 2026-09-02): /farsi-numbers owed a semantic review that every paid reading refused with "the code adds no visible text", so it could never clear. */ it("owes no semantic reading on a schema block, whose truth is the canon's visible-content proof", () => {
    const withFact = { claims: [{ text: "c", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: "https://www.britannica.com/nowruz carries it" }], status: "needs_review" as const };
    expect(nextObligation(row({ ...withFact, changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A finished section.", where: 'A new section headed "H"' } })), "prose citing a checked source owes the reading").toEqual({ kind: "review" });
    expect(nextObligation(row({ ...withFact, changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "schema", before: null, after: '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}' } })), "the same claims inside JSON-LD owe nothing to a reader of prose").toBeNull(); });
  it("owes the one cheap reading a shape hold asks for, rather than sitting behind that sentence for ever", () =>
    expect(nextObligation(row({ modeledOn: undefined, primaryQuery: "nowruz traditions" }))).toEqual({ kind: "evidence", need: { kind: "serp", query: "nowruz traditions", reasonCode: "shape_unbacked" } }));
  it("owes a redraft carrying whatever still blocks final copy, and settles a lever its own diagnosed cause cannot use", () => {
    expect(nextObligation(row({ status: "needs_review", changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A finished section that adds something.", where: 'A new section headed "How the forms differ"' } }))).toEqual({ kind: "redraft", attempt: 1, instruction: "nothing on file says what a reader gains from it that the page does not already say, so it is held until an evaluator reads it against the page and names the gain" });
    expect(nextObligation(row({ status: "needs_review", diagnosisCause: "weak_opening" }))?.kind).toBe("terminal"); });
});
describe("what a sweep may take back", () => {
  beforeEach(() => { db.rows = []; });
  /** A $0 produce inside the publish phase withdrew SEVEN drafted descriptions, the actors line seven minutes after a paid redraft carried it to Ready, on "the producer that owns this family rewrote it and did not re-emit this card". A brief producer's silence says nothing about paid words already written, and the withdrawal it writes is a cache of that silence rather than a decision about the work. */ it("revives a swept row on the next save, keeps refusing the one the operator put away, and never sweeps drafted words", async () => {
    const drafted = row({ id: "t::/actors::existing_edit::missing_description", pagePath: "/actors", changeFamily: "meta", status: "needs_review", basis: "b1", recommendedChange: { kind: "existing_edit", field: "meta", before: "Old", after: "A finished description of the actors page." } });
    expect(await saveChangeProposal(drafted)).toBe("saved");
    Object.assign(db.rows[0]!, { terminal_disposition: "withdrawn", withdrawn_reason: "swept: the producer that owns this family rewrote it and did not re-emit this card" });
    expect(await saveChangeProposal(drafted), "a swept withdrawal is a cache of one pass's silence, so the next save revives the row").toBe("saved");
    Object.assign(db.rows[0]!, { terminal_disposition: "dismissed", withdrawn_reason: null });
    expect(await saveChangeProposal(drafted), "the operator's own putting-away is a decision and still refuses").toBe("refused"); });
});
describe("the store merge protects words, never a caller's decision about the same words", () => {
  beforeEach(() => { db.rows = []; });
  it("keeps a same-words demotion exactly as the caller decided it, and still keeps finished words under a re-minted brief", async () => {
    const finished = row({ claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "f" }], copyStamp: "T|H|D|O", workKey: "w1" });
    expect(await saveChangeProposal(finished)).toBe("saved");
    expect(await saveChangeProposal({ ...finished, status: "needs_review", faults: ["it names iranopedia 3 times"], limitations: ["it names iranopedia 3 times"] })).toBe("saved"); // identical words, so there is nothing to preserve and the demotion stands
    expect([held().status, held().faults, held().obligation?.kind]).toEqual(["needs_review", ["it names iranopedia 3 times"], "redraft"]);
    await saveChangeProposal({ ...finished, status: "needs_review", researchOnly: true, recommendedChange: { kind: "existing_edit", field: "title", before: "Old", after: "The exact title is not written yet." } });
    expect((held().recommendedChange as { after: string }).after, "a brief's words differ, so the merge still protects the finished ones").toBe("A finished title for this page"); });
  /** IDENTITY IS THE WORK, NOT THE QUEUE POSITION (operator, 2026-09-04). The ranking receipt was inside the payload fingerprint and the score is computed against neighbours, so one card moving re-minted twenty-six untouched rows in a pass and this account reached proposal_version 2,271. The receipt still persists, on its own column. */ it("writes one version for two identical saves, moves nothing but the receipt column when only the rank moved, and still writes a new version when the number on the card moves", async () => {
    const scored = (score: number): ChangeProposal => ({ ...row(), rankingReceipt: { score, directional: false, basis: "b", factors: [] } });
    expect(await saveChangeProposal(row()), "the $0 producers mint unranked").toBe("saved");
    expect([await saveChangeProposal(scored(10)), (db.rows[0]!.payload as { proposal: { rankingReceipt?: unknown } }).proposal.rankingReceipt != null], "and a row's FIRST receipt is written into the payload once, so nothing on file is ever unable to say why it ranked where it did").toEqual(["saved", true]);
    const first = { version: db.rows[0]!.proposal_version, payload: JSON.stringify(db.rows[0]!.payload), at: db.rows[0]!.updated_at };
    expect(await saveChangeProposal(scored(10)), "the same decision said twice is not a second decision").toBe("unchanged");
    expect(await saveChangeProposal(scored(41)), "and a neighbour moving is not this row changing").toBe("unchanged");
    expect([db.rows.length, db.rows[0]!.proposal_version, JSON.stringify(db.rows[0]!.payload), db.rows[0]!.updated_at], "one row, one version, the same payload bytes and the same timestamp").toEqual([1, first.version, first.payload, first.at]);
    expect((db.rows[0]!.ranking_receipt as { score: number }).score, "the receipt itself is refreshed where it lives, so the order stays inspectable").toBe(41);
    expect(await saveChangeProposal({ ...scored(41), impactScore: 999 }), "the clicks printed ON the card are what an operator acts on, so that number moving IS a new version").toBe("saved");
    expect(db.rows[0]!.proposal_version).toBe((first.version as number) + 1); });
  /** READY IS A FINISHED STATE (operator, 2026-09-04): /persian-rugs/heriz-rug stood at `ready` still saying "The exact wording lands on this card once the next funded pass writes it", because every promotion door spread the stored row whole and the one shared gate normalized nothing. */ it("stores a promoted row clean, dropping the brief, the faults and every refusal sentence, and keeps a caveat that describes the accepted copy", async () => {
    expect(await saveChangeProposal({ ...row(), status: "ready", research: { missing: "a description", next: "The exact wording lands on this card once the next funded pass writes it." }, redraftRequested: "2026-09-01T00:00:00.000Z",
      faults: ["it lands in the wrong place"], limitations: ["it lands in the wrong place", "Snippet may truncate if rendered with wider characters"] })).toBe("saved");
    expect([held().status, held().research, held().redraftRequested, held().faults, held().limitations, held().obligation], "the brief, the ask and the gate's own sentences go; the honest caveat about these exact words stays").toEqual(["ready", undefined, undefined, [], ["Snippet may truncate if rendered with wider characters"], undefined]); });
  /** A STAMP CAN OUTLIVE THE ROW IT STAMPS (live, 2026-09-04): at 06:45Z five cards were still served as ready seven minutes after the store had demoted all five, because the ready lane was cut on the release's stamp alone. */ it("serves the ready lane off the row's own status, so a demoted card stops rendering as finished the moment it is demoted", async () => {
    const at = (id: string, status: ChangeProposal["status"]) => ({ ...row({ id, basis: "b1", status }), pagePath: `/${id.split("::")[1]}` });
    for (const [i, p] of [at("t::/keeps::existing_edit::title", "ready"), at("t::/demoted::existing_edit::title", "needs_review")].entries()) {
      db.rows.push({ id: p.id, tenant_id: "t", basis: "b1", status: p.status, terminal_disposition: null, superseded_by: null, withdrawn_reason: null, proposal_version: 1, queue_rank: i + 1, queue_lane: "rel-9::ready", payload: JSON.parse(JSON.stringify({ v: 1, proposal: p })) }); }
    const lane = await readQueuePage("t", "ready", "b1", 0, 10);
    expect([lane.release, lane.rows.map((p) => p.id)], "the ranking is still the one on file, and only the row that IS ready is in its lane").toEqual(["rel-9", ["t::/keeps::existing_edit::title"]]); });
  it("stamps ONE typed next step, or none, on every row it stores, and the stored payload decodes wearing exactly that", async () => {
    for (const [owed, p] of [["draft", row({ id: "t::/p1::existing_edit::title", researchOnly: true, status: "needs_review" })], ["redraft", row({ id: "t::/p2::existing_edit::title", status: "needs_review", faults: ["it lands in the wrong place"] })],
      ["evidence", row({ id: "t::/p3::existing_edit::title", modeledOn: undefined })], [undefined, row({ id: "t::/p4::existing_edit::title" })]] as Array<[string | undefined, ChangeProposal]>) {
      db.rows = []; expect(await saveChangeProposal(p)).toBe("saved");
      const back = deserializeChangeProposal(JSON.stringify(db.rows[0]!.payload))!; // the stored payload, decoded exactly as any later pass reads it back
      expect([back.obligation?.kind, nextObligation(back)?.kind], `${p.id} owes ${owed ?? "nothing"} on file and computes the same answer from the row alone`).toEqual([owed, owed]); } });
  it("key order is not identity: a finding minted in the producer's order and the same finding in schema order hash alike, and a re-mint carrying one reads unchanged (reviewer, 2026-09-04: the fingerprint was key-order sensitive, so an identical re-mint wrote a new version every tick and erased the retirement receipt on the way)", async () => {
    const producerOrder = { cause: "ctr_snippet", action: "meta", evidenceKeys: ["e1"], competingExplanations: [], notConsidered: [], explanation: "x", falsifier: "y" } as unknown as ChangeProposal["causeFinding"];
    const schemaOrder = { cause: "ctr_snippet", action: "meta", evidenceKeys: ["e1"], competingExplanations: [], falsifier: "y", explanation: "x", notConsidered: [] } as unknown as ChangeProposal["causeFinding"];
    const base = row(); expect(proposalFingerprint({ ...base, causeFinding: producerOrder })).toBe(proposalFingerprint({ ...base, causeFinding: schemaOrder }));
    db.rows = []; expect(await saveChangeProposal({ ...base, causeFinding: producerOrder })).toBe("saved"); expect(await saveChangeProposal({ ...base, causeFinding: producerOrder }), "decoded in schema order, minted in the producer's, one identity").toBe("unchanged"); });
});
