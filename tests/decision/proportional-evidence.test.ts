/** THE PROOF BURDEN MATCHES THE PROMISE (operator, 2026-08-28). One composed walk through the canonical door:
 *  a typo repair owes nothing beyond its own diff, a factual correction may narrow and must say so, demand
 *  never chooses words, a missing field survives on banked claims, a pattern claim rides a stored shape,
 *  assistant recurrence authorizes investigation and never copy, and a replacement may not silently drop what
 *  the passage carries. The door is completeness's openHold, the same verdict the queue, Today, the detail
 *  page, Mark done, the promotion chain and the producer sweep all read, so one refusal refuses everywhere. */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => store.rows }));
vi.mock("@/domains/measurement/proof-gsc/load-ledger", () => ({ loadProofLedgerCached: async () => null }));
import { openHold } from "@/domains/decision/completeness";
import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { evidenceShortfall, mechanicalRepair, proofOf } from "@/domains/decision/proof";
import { unauthorizedReason } from "@/domains/evidence/pages/fact-checks";
import type { ChangeProposal } from "@/domains/decision/contracts";

const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() }));
const T = "t";
const row = (id: string, over: Record<string, unknown>): ChangeProposal => ({
  id: `${T}::/p::existing_edit::${id}`, tenantId: T, kind: "existing_edit", pagePath: "/p",
  pageUrl: "https://x.example/p", pageLabel: "P", primaryQuery: "onager", opportunityType: "o",
  changeFamily: "meta", status: "ready", whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low",
  confidence: "medium", limitations: [], evidence: { query: "onager", hints: [], evidenceRefCount: 1 },
  impactScore: 10, upsidePerMonth: null, basis: "b", createdAt: "2026-08-01T00:00:00.000Z", ...over,
} as unknown as ChangeProposal);
const edit = (field: string, before: string | null, after: string, more: Record<string, unknown> = {}) =>
  ({ recommendedChange: { kind: "existing_edit", field, before, after }, ...more });

describe("the proof burden matches the promise, at the one door every surface reads", () => {
  it("scales the evidence each treatment owes, and refuses the promise the evidence never made", async () => {
    // 1. A MARK-ONLY REPAIR IS ITS OWN EVIDENCE: no diagnosis, no results page, and the receipt certifies the
    // marks alone, never the sentence around them.
    const typo = row("typo", edit("meta", "Learn all about the Kerman Rug , where its from.", "Learn all about the Kerman Rug, where it's from."));
    expect(evidenceShortfall(typo)).toBeNull();
    expect(openHold(typo).blocking).toBeNull();
    expect(proofOf(typo).limits.join(" ")).toContain("not certified as the best copy");
    expect(mechanicalRepair("teh Kerman rug", "the Kerman rug"), "letter-order typos too").toBe(true);
    expect(mechanicalRepair("founded 1979", "founded 1980"), "a digit change is factual, never mechanical").toBe(false);
    // 2. A FACTUAL CORRECTION MAY NARROW, AND SAYS SO: shorter survives when only the source-carried meaning
    // does, and the receipt discloses the narrowing instead of posing as traffic copy.
    const noor = row("fact", { ...edit("section", "Meaning:Bright, radiant, or glowing.", "Meaning:Light."), changeFamily: "factual_correction",
      claims: [{ text: "Noor means light", supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: 'encyclopedia says: "The name Noor means light"' }] });
    expect(evidenceShortfall(noor)).toBeNull();
    expect(proofOf(noor).limits.join(" ")).toContain("the unsupported wording was narrowed");
    // 3. RICHER FACTUAL CONTEXT WITHOUT EVIDENCE STAYS REFUSED, by the quote-bound authority chain itself.
    expect(unauthorizedReason({ subject: "Noor", current: "Meaning:Light.", proposed: "radiant and glowing",
      sources: [{ kind: "encyclopedia", says: 'The name Noor means "light"' }] } as never)).toContain("do not carry every word");
    // 4. DEMAND NEVER CHOOSES WORDS: replacing a title that exists, on impressions and a page claim alone, is
    // held until a diagnosis names the defect or a stored results page backs the shape.
    const creative = row("title", { ...edit("title", "Persian Onager (Asiatic Wild Ass): Facts & Habitat", "Onager (Persian Wild Ass): What It Is and Where It Lives"),
      changeFamily: "title-family", demandImpressions90d: 8112, claims: [{ text: "about the onager", supportedBy: ["page-copy-1"] }] });
    expect(evidenceShortfall(creative)).toContain("demand evidence alone");
    // 5. A MISSING FIELD FILLED WITH BANKED CLAIMS SURVIVES WITHOUT A RESULTS PAGE; with no claims it does not.
    const fill = row("meta", { ...edit("meta", null, "Iran adopted a new flag in 1979 and redesigned it in 1980."),
      claims: [{ text: "covers both versions", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "the page covers both" }] });
    expect(evidenceShortfall(fill)).toBeNull();
    expect(evidenceShortfall(row("meta2", edit("meta", null, "Everything you need to know.")))).toContain("no banked claim");
    // 6. A PATTERN CLAIM RIDES A STORED SHAPE: the same creative replacement passes once a stored results page
    // backs it, and the shape is named on the receipt rather than implied.
    expect(evidenceShortfall({ ...creative, modeledOn: "the stored results page for onager, whose top titles share this shape" } as ChangeProposal)).toBeNull();
    // 7. ASSISTANT RECURRENCE AUTHORIZES INVESTIGATION, NEVER COPY: an answer standing only on the page's own
    // words, or on nothing, is held whatever the answer count says.
    const aeo = (claims: unknown) => row("ans", { ...edit("answer_block", null, "The four phrases are salam, khodahafez, merci and bale.",
      { recommendedChange: undefined }), recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "The four phrases are salam, khodahafez, merci and bale.", where: "Add as a single new paragraph at the top of the body on /p." },
      aiImpact: { answers: 3, mentionRate: 0, citedRivals: 1, audienceWeight: null, days: 3, stage: "owned_retrieved_not_cited" }, claims });
    expect(evidenceShortfall(aeo([{ text: "restates the page", supportedBy: ["page-copy-1"] }]))).toContain("recurrence authorizes investigation");
    expect(evidenceShortfall(aeo([]))).toContain("recurrence authorizes investigation");
    // 8. AN OBSERVED GAP WITH SUPPORTED GAIN AUTHORIZES: the same answer carrying one claim something beyond
    // this page stands behind clears the door whole.
    const gained = aeo([{ text: "salam is the standard greeting", supportedBy: ["fact-1"] }]);
    (gained as { supportFacts: unknown }).supportFacts = [{ id: "fact-1", fact: "dictionary: salam is the standard Persian greeting" }];
    expect(evidenceShortfall(gained)).toBeNull();
    expect(openHold(gained).blocking).toBeNull();
    // 9. A REPLACEMENT ACCOUNTS FOR WHAT THE PASSAGE CARRIES: dropping the lesson link and its button copy
    // silently is refused; naming both as intentional removals, with reasons, passes.
    const cta = row("sec", edit("section", "Try Lesson 1 Free at https://x.example/lessons today.", "Salam means hello.", { where: "Replaces the closing paragraph of the body on /p." }));
    expect(evidenceShortfall(cta)).toContain("nothing typed says that removal is intended");
    const accounted = { ...cta, bundle: { plan: { keeps: [], removes: [
      { what: "the Try Lesson 1 Free button copy", why: "moved to the page footer by the same change" },
      { what: "the link https://x.example/lessons", why: "carried by the footer button" }], entries: [] }, components: [], receipt: { items: [], missing: [], freshestObservedAt: null } } } as unknown as ChangeProposal;
    expect(evidenceShortfall(accounted)).toBeNull();
    // 10. ONE CANONICAL DECISION: the queue lanes by the very same verdict, so the held title reaches the
    // operator as a draft to review and never as Ready, while the diagnosed fill stays Ready.
    expect(openHold(creative).blocking, "openHold speaks the same sentence").toBe(evidenceShortfall(creative));
    store.rows = new Map([[creative.id, creative], [fill.id, fill]]);
    const q = await loadProposalQueue(T, { currentBasis: "b", now: new Date("2026-08-02T00:00:00.000Z") });
    expect(q.ready.map((p) => p.id)).toEqual([fill.id]);
    expect(q.toDo.map((p) => p.id)).toContain(creative.id);
  });
});
