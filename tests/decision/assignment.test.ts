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
      expect([a.intent.includes(s.queries[0]!), a.intent.includes(s.queries[1]!)], "the reader's task is every phrasing of the group, never the one string the card was minted under").toEqual([true, true]);
    });

    it(`${s.t}: a summary field is judged by the summary standard and a body row is not`, () => {
      const summary = assignmentOf(packetOf(s), null, "meta", "find a source the prior attempt asked for")!, body = assignmentOf(packetOf(s), null, "answer_block", "find a source the prior attempt asked for")!; expect([summary.standard, body.standard, summary.owed, body.owed, ASSIGNMENT_EDITOR.lines({ ...summary, owed: "historical source request" }).some((l) => l.includes("STILL OWES"))],
        "the standard is chosen once; a summary neither banks nor reprints settled source instructions, while body correction debt remains available").toEqual(["summary", "missing_answer", undefined, "find a source the prior attempt asked for", false]);
    });
    it(`${s.t}: exact atom polarity and publisher voice fail closed`, () => {
      const atoms = (polarity: "supports" | "contradicts" | "unknown", voice: "publisher" | "container", key = "atom-1") => [{ key, evidenceId: "fact-1", polarity, voice }];
      expect([assignmentOf(packetOf(s, { answerAtoms: atoms("contradicts", "publisher") }), null, "answer_block"), assignmentOf(packetOf(s, { answerAtoms: atoms("unknown", "publisher") }), null, "answer_block"), assignmentOf(packetOf(s, { answerAtoms: atoms("supports", "container") }), null, "answer_block"), assignmentOf(packetOf(s, { answerAtoms: atoms("supports", "publisher", "other") }), null, "answer_block")],
        "contradiction, unknown proof, container narration, and an unbound atom never become assignments").toEqual([null, null, null, null]);
      expect(assignmentOf(packetOf(s), null, "answer_block")?.informationNeed?.requiredAtomKeys).toEqual(["atom-1"]);
    });
  }

  it("a rewritten acquisition subject remains bound to the original information atom", () => {
    const s = SITES[0]!, rewritten = "seasonal access rules for the eastern seal nursery", key = "original-missing-topic";
    const a = assignmentOf(packetOf(s, { gap: { kind: "missing_answer", propositions: [rewritten] }, informationNeed: { question: s.queries[0]!, requiredAtomKeys: [key], polarity: "supports", voice: "publisher", deliveryMode: "inline" }, answerAtoms: [{ key, evidenceId: "fact-1", polarity: "supports", voice: "publisher" }] }), null, "answer_block")!;
    expect([a.propositions, a.facts, a.shape, a.deliveryMode, a.format.includes("without an outer heading")], "the acquired wording may change while its producer-issued atom identity and fixed delivery remain exact").toEqual([[rewritten], [{ id: "fact-1", says: packetOf(s).evidence["fact-1"] }], "inline_addition", "inline", true]);
  });

  it("requires the original material for a saved structural assignment before starting a writer", async () => {
    const s = SITES[0]!, key = `restructure:${s.queries[0]}`, need = { question: s.prop, requiredAtomKeys: [key], polarity: "supports" as const, voice: "publisher" as const, deliveryMode: "headed" as const }, original = assignmentOf(packetOf(s, { gap: { kind: "weak_extractability", propositions: [s.prop] }, informationNeed: need, answerAtoms: [{ key, evidenceId: "page-copy-1", polarity: "supports", voice: "publisher" }] }), null, "answer_block")!;
    const tryPage = async (passage: string | string[], assignment = original, complete = true) => { const calls: string[] = [], passages = Array.isArray(passage) ? passage : [passage]; await draftFieldForPage({ field: "answer_block", body: { url: s.url, title: s.title, h1: s.h1, metaDescription: null, headings: [s.head], passages, vocabulary: passages.join(" "), completeness: complete ? "complete" : "partial", version: "current" } as never, query: s.queries[0]!, brief: "answer", evidenceHints: [], ownedPaths: [], minutes: 1, assignment }, { tenantId: s.t, now: new Date("2026-09-19T00:00:00Z"), complete: (async () => (calls.push("writer"), { error: "test transport stop", retryable: false })) as never }); return calls.length; };
    expect(await tryPage(s.passage)).toBeGreaterThan(0); expect(await tryPage(["A new unrelated opening.", s.passage])).toBeGreaterThan(0); expect(await tryPage("The new page talks only about unrelated harbor restaurants and parking lots.")).toBe(0);
    expect(await tryPage(s.passage, { ...original, informationNeed: { ...need, requiredAtomKeys: ["unknown"] } })).toBe(0); expect(await tryPage("The unrelated replacement gives no seal facts.", { ...original, atomBindings: undefined, basis: "a".repeat(64) })).toBe(0); expect(await tryPage(s.passage, original, false)).toBe(0);
    expect(await tryPage(s.passage, { ...original, gapKind: "full_rewrite_piece", basis: "a".repeat(64), informationNeed: { ...need, requiredAtomKeys: [`${"a".repeat(64)}::0`] }, atomBindings: undefined })).toBe(0);
  });
});
