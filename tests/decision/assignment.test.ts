import { describe, it, expect } from "vitest";
import { deliverableFailures, draftFieldForPage } from "@/domains/decision/drafted-copy";
import { ASSIGNMENT_EDITOR, assignmentOf } from "@/domains/decision/assignment";
import type { SourcePacket } from "@/domains/decision/drafted-copy";

const SITES = [
  { t: "tenant-one", url: "https://alpha.example/harbour-seals", title: "Harbour Seals", h1: "Harbour Seals",
    queries: ["where harbour seals haul out", "harbour seal haul out spots"], head: "Where they haul out",
    passage: "Harbour seals haul out on the sand bars below the point, and the colony is largest in summer.",
    prop: "the eastern spit is closed to visitors from June to August while the pups are nursing",
    says: "The eastern spit is closed from June to August each year while harbour seal pups are nursing.",
    winner: "rivalone.example", quote: "Wardens close the eastern spit from June to August while the pups are nursing." },
  { t: "tenant-two", url: "https://beta.example/telares", title: "Telares de mano", h1: "Telares de mano",
    queries: ["como se monta la urdimbre", "montar urdimbre telar"], head: "Como se monta la urdimbre",
    passage: "La urdimbre se monta con doce hilos por centimetro y se tensa antes de la primera trama.",
    prop: "la tension de la urdimbre se ajusta con contrapesos colgados detras del telar",
    says: "La tension de la urdimbre se ajusta con contrapesos colgados detras del telar.",
    winner: "rivaldos.example", quote: "La tension se ajusta con contrapesos colgados detras del telar." },
];
type Site = (typeof SITES)[number];
const packetOf = (s: Site, over: Partial<SourcePacket> = {}): SourcePacket => ({
  targetUrl: s.url, title: s.title, h1: s.h1, metaDescription: null, bodyText: s.passage, headings: [s.head],
  evidence: { "page-title": s.title, "page-copy-1": s.passage, "fact-1": `${s.says} https://source.example says "${s.says}"` },
  checkedSentences: [s.says], trackedQuestion: s.queries[0]!, diagnosedProblem: "the page does not answer this search",
  gap: { kind: "missing_answer", propositions: [s.prop] }, ownedPaths: [], bannedTerms: [],
  informationNeed: { question: s.queries[0]!, requiredAtomKeys: ["atom-1"], polarity: "supports", voice: "publisher", deliveryMode: "headed" }, answerAtoms: [{ key: "atom-1", evidenceId: "fact-1", polarity: "supports", voice: "publisher" }],
  demand: { preserve: [], vocabulary: [], unanswered: [] },
  comparison: { queries: [...s.queries], keep: [s.passage], verdict: "names",
    winners: [{ url: `https://${s.winner}/page`, publisher: s.winner, publisherClass: "publisher", truncated: false, held: s.quote,
      shape: { words: 2100, lists: true, tables: false, questions: 0 },
      observations: [{ kind: "answers", text: `${s.winner} states what this page does not.`, quote: s.quote }] }] },
  ...over,
} as SourcePacket);

describe("what one assignment carries", () => {
  for (const s of SITES) {
    it(`${s.t}: a body row carries all eight things the work needs, and the reader's task is the whole intent group`, () => {
      const a = assignmentOf(packetOf(s), null, "answer_block")!;
      expect(deliverableFailures({ actionType: "answer_block", targetUrl: s.url, placementAnchor: s.passage, beforeText: s.passage, finalCopy: s.says, naturalHeading: null, claims: [{ text: s.says, supportedBy: ["fact-1"] }], supportFacts: [], evidenceIdsUsed: ["fact-1"], uncertaintyOrOmitted: [], implementationMinutes: 2, measurementTarget: s.queries[0] }, { ...packetOf(s), assignment: a }), "a contextual addition may never acquire deletion scope from the writer").toContain("this assignment adds copy and deletes nothing, but the draft replaces existing words");
      expect([a.shape, a.maxSentences, a.anchor, a.deliveryMode, a.format.includes("descriptive heading")], "the producer fixes a complete delivery mode before drafting").toEqual(["section", undefined, s.passage, "headed", true]);
      expect([a.intent.includes(s.queries[0]!), a.intent.includes(s.queries[1]!)], "the reader's task is every phrasing of the group, never the one string the card was minted under").toEqual([true, true]);
      expect([a.propositions, ["answer_block", "section", "replacement", "restructure", "field"].includes(a.treatment), a.placement, a.keep, a.facts, a.observations?.map((o) => [o.publisher, o.publisherClass, o.quote]), a.completionTest.includes(s.prop)],
        "the diagnosed gap, a typed treatment, the placement, the material to keep, the checked statements with their sentences, the competitor observations with their quotes and classes, and the improvement in one sentence").toEqual([
        [s.prop], true, "additive", [s.passage], [{ id: "fact-1", says: s.says }], [[s.winner, "publisher", s.quote]], true]);
    });

    it(`${s.t}: a summary field is judged by the summary standard and a body row is not`, () => {
      expect([assignmentOf(packetOf(s), null, "meta")!.standard, assignmentOf(packetOf(s), null, "answer_block")!.standard],
        "the standard is chosen once, by what the edit is, and never re-inferred from whichever evidence ids are in the packet").toEqual(["summary", "missing_answer"]);
    });

    it(`${s.t}: a replacement is told to keep what is true and add the improvement, and is never forbidden new wording`, () => {
      const a = assignmentOf(packetOf(s), { replaces: s.passage, heading: s.head }, "answer_block")!;
      expect([a.shape, a.replaces, a.format.includes("invent no wording"), a.format.includes("add the improvement the completion test below names"), a.format.includes("cite a supporting fact")],
        "the contradiction is gone: a replacement adds the named improvement and any new statement stands on a cited fact").toEqual(["exact_replacement", s.passage, false, true, true]);
      const l = ASSIGNMENT_EDITOR.lines(a);
      expect([l.some((x) => x.includes(`THE EXACT PASSAGE THIS COPY REPLACES, verbatim: "${s.passage}"`)), /nothing on the page is deleted or rewritten$/m.test(a.mustPreserve), a.mustPreserve.includes("OUTSIDE the passage named above"), a.mustNotRepeat.includes("that STAY on the page")],
        "the passage it replaces rides the brief word for word, and the same brief no longer says nothing on the page is rewritten: what is preserved is what stays, and the replaced passage is the one thing this copy may carry over").toEqual([true, false, true, true]);
    });

    it(`${s.t}: the page's own words are ruled out as the subject only where the standard says so, and every line of the brief gives the same answer`, () => {
      const at = (a: ReturnType<typeof assignmentOf>, starts: string): string => ASSIGNMENT_EDITOR.lines(a!).find((l) => l.startsWith(starts)) ?? "";
      const restructure = assignmentOf(packetOf(s, { gap: { kind: "scattered_answer", propositions: [s.passage] } }), null, "answer_block");
      const body = assignmentOf(packetOf(s), null, "answer_block"), summary = assignmentOf(packetOf(s), null, "meta");
      expect([at(body, "THE ASSIGNMENT").includes("supported words provide reader context"), at(summary, "THE ASSIGNMENT").includes("the material this edit works from"), at(restructure, "THE ASSIGNMENT").includes("the material this edit works from")],
        "a missing answer may not restate the page; a summary line and a restructuring work from it").toEqual([true, true, true]);
      expect([at(body, "PAGE CONTEXT").includes("usable where necessary for reader context"), at(summary, "PAGE CONTEXT").includes("the material this edit works from"), at(restructure, "PAGE CONTEXT").includes("the material this edit works from"), restructure!.mustNotRepeat.includes("how this page arranges its material")],
        "the page-context line answers the same question the same way, so a restructuring is never told to assemble what it may not use, and what it may not repeat is the arrangement rather than the material").toEqual([true, true, true, true]);
    });

    it(`${s.t}: exact atom polarity and publisher voice fail closed`, () => {
      const atoms = (polarity: "supports" | "contradicts" | "unknown", voice: "publisher" | "container", key = "atom-1") => [{ key, evidenceId: "fact-1", polarity, voice }];
      expect([assignmentOf(packetOf(s, { answerAtoms: atoms("contradicts", "publisher") }), null, "answer_block"), assignmentOf(packetOf(s, { answerAtoms: atoms("unknown", "publisher") }), null, "answer_block"), assignmentOf(packetOf(s, { answerAtoms: atoms("supports", "container") }), null, "answer_block"), assignmentOf(packetOf(s, { answerAtoms: atoms("supports", "publisher", "other") }), null, "answer_block")],
        "contradiction, unknown proof, container narration, and an unbound atom never become assignments").toEqual([null, null, null, null]);
      expect(assignmentOf(packetOf(s), null, "answer_block")?.informationNeed?.requiredAtomKeys).toEqual(["atom-1"]);
    });

    it(`${s.t}: no line of a body brief is a lesson about a language, a script or a spelling`, () => {
      const brief = ASSIGNMENT_EDITOR.lines(assignmentOf(packetOf(s, { bodyText: `${s.passage} \u0633\u0644\u0627\u0645` }), null, "answer_block")!).join(" ");
      expect(/\bscript\b|romaniz|scholar|persian|farsi|arabic|greek|urdu|pashto|hebrew|cyrillic|the form you explain|examples of the rule/i.test(brief),
        "a page writing part of itself in another alphabet is told nothing about alphabets, and no general brief carries a lesson about a linguistic form").toBe(false);
    });

    it(`${s.t}: the winners reach the brief as publishers with what they are, never as a raw class slug`, () => {
      const lines = ASSIGNMENT_EDITOR.lines(assignmentOf(packetOf(s, { evidence: { "page-title": s.title, "rival-1": `${s.winner} carries this.` } }), null, "answer_block")!);
      const rival = lines.find((l) => l.startsWith("THE PAGES THAT ALREADY WIN THIS SEARCH")) ?? "";
      expect([rival.includes("rival-1"), rival.includes(`${s.winner}, a publisher covering these topics`), /publisher_|_unknown|_directory/.test(rival), rival.includes(`"${s.quote}"`), rival.includes("never whole-page absence") && rival.includes("or facts you may state")],
        "the id a claim may never cite, the publisher and what it is in plain words, no raw slug, the winner's own words as the subject this copy may take, and never as a fact").toEqual([true, true, false, true, true]);
    });
  }

  it("a rewritten acquisition subject remains bound to the original information atom", () => {
    const s = SITES[0]!, rewritten = "seasonal access rules for the eastern seal nursery", key = "original-missing-topic";
    const a = assignmentOf(packetOf(s, { gap: { kind: "missing_answer", propositions: [rewritten] }, informationNeed: { question: s.queries[0]!, requiredAtomKeys: [key], polarity: "supports", voice: "publisher", deliveryMode: "inline" }, answerAtoms: [{ key, evidenceId: "fact-1", polarity: "supports", voice: "publisher" }] }), null, "answer_block")!;
    expect([a.propositions, a.facts, a.shape, a.deliveryMode, a.format.includes("without an outer heading")], "the acquired wording may change while its producer-issued atom identity and fixed delivery remain exact").toEqual([[rewritten], [{ id: "fact-1", says: s.says }], "inline_addition", "inline", true]);
  });

  it("an unknown required atom is refused before the writer call", async () => {
    const s = SITES[0]!, calls: string[] = [], refusals = new Map<string, string>(); await draftFieldForPage({ field: "answer_block", body: { url: s.url, title: s.title, h1: s.h1, metaDescription: null, headings: [s.head], passages: [s.passage], vocabulary: s.passage, completeness: "complete", version: "current" } as never, query: s.queries[0]!, brief: "answer", evidenceHints: [], ownedPaths: [], minutes: 1, refusalKey: "row", informationNeed: { question: s.prop, requiredAtomKeys: ["unknown"], polarity: "supports", voice: "publisher", deliveryMode: "headed" } }, { tenantId: s.t, now: new Date("2026-09-19T00:00:00Z"), refusals, complete: (async () => (calls.push("paid"), { error: "must not run", retryable: false })) as never });
    expect([calls.length, refusals.get("row")]).toEqual([0, "The information need is not completely bound to qualified facts and a delivery mode; research is owed before drafting."]);
  });
});
