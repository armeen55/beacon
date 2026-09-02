/** WHAT A CHANGE OWES NEXT IS TYPED (operator, 2026-09-02). The machine used to work its next step out of English: a lowercase first letter meant a gate wrote this, a phrase list meant a hold was withdrawn, and a review that was owed was filed as a fact acquisition, so the runtime bought facts while the reading nobody had taken stayed untaken. These pin the ladder itself, and the one merge that must never overrule it. */
import { describe, it, expect, beforeEach, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], client: {} as Record<string, unknown> }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
import { nextObligation } from "@/domains/decision/obligation";
import { saveChangeProposal } from "@/domains/decision/proposal-store";
import { supabaseFake } from "../helpers/supabase-fake";
import type { ChangeProposal } from "@/domains/decision/contracts";
Object.assign(db.client, supabaseFake({ rows: () => db.rows }), { rpc: async () => ({ data: "saved", error: null }) });
const held = (): ChangeProposal => ((db.rows[0]!.payload as { proposal: ChangeProposal }).proposal);
const row = (over: Partial<ChangeProposal> = {}): ChangeProposal => ({ id: "t::/p::existing_edit::title", tenantId: "t", kind: "existing_edit", pagePath: "/p", pageUrl: "https://fixture.example/p", pageLabel: "P", primaryQuery: "q", opportunityType: "Capture clicks", changeFamily: "title", status: "ready", researchOnly: false, recommendedChange: { kind: "existing_edit", field: "title", before: "Old", after: "A finished title for this page" }, whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "q", hints: [], evidenceRefCount: 1 }, impactScore: 10, upsidePerMonth: null, modeledOn: "the stored results page for this search", publish: "manual", createdAt: "2026-09-02T00:00:00.000Z", ...over });
describe("the typed next step a stored change owes", () => {
  it("owes nothing on a finished row, however its caveats happen to be worded", () => expect(nextObligation(row({ limitations: ["it reads a little flat to me", "this rearranges the page"] }))).toBeNull());
  it("owes a draft while nothing exact is written, and a redraft once its own gates faulted the words", () => {
    expect(nextObligation(row({ researchOnly: true, status: "needs_review" }))).toEqual({ kind: "draft" });
    expect(nextObligation(row({ status: "needs_review", faults: ["it lands in the wrong place"] }))).toEqual({ kind: "redraft", attempt: 1, instruction: "it lands in the wrong place" }); });
  it("settles rather than retries after two corrective drafts, and keeps a settlement it already made", () => {
    expect(nextObligation(row({ status: "needs_review", faults: ["f"], previousCopy: { after: "old words", retiredBecause: "r", at: "2026-09-01T00:00:00.000Z", attempts: 2 } }))?.kind).toBe("terminal");
    expect(nextObligation(row({ obligation: { kind: "terminal", reason: "settled once" }, faults: ["f"] }))).toEqual({ kind: "terminal", reason: "settled once" }); });
  it("owes the one cheap reading a shape hold asks for, rather than sitting behind that sentence for ever", () =>
    expect(nextObligation(row({ modeledOn: undefined, primaryQuery: "nowruz traditions" }))).toEqual({ kind: "evidence", need: { kind: "serp", query: "nowruz traditions", reasonCode: "shape_unbacked" } }));
  it("owes a redraft carrying whatever still blocks final copy, and settles a lever its own diagnosed cause cannot use", () => {
    expect(nextObligation(row({ status: "needs_review", changeFamily: "section", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A finished section that adds something.", where: 'A new section headed "How the forms differ"' } }))).toEqual({ kind: "redraft", attempt: 1, instruction: "nothing on file says what a reader gains from it that the page does not already say, so it is held until an evaluator reads it against the page and names the gain" });
    expect(nextObligation(row({ status: "needs_review", diagnosisCause: "weak_opening" }))?.kind).toBe("terminal"); });
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
});
