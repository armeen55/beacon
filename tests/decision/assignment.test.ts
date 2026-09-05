/** ONE ASSIGNMENT, NO CONTRADICTIONS, THE WHOLE BRIEF (campaign, 2026-09-05). The envelope a body edit is written, judged, promoted and re-read from lived inside the editor file and told the writer two incompatible things at once: a replacement had to "add what they miss" and "invent no wording this page does not already carry", and every edit was told the page's own words were never the subject of the new copy while the restructuring and summary standards make those words the whole material. It is one module now, it carries the eight things the work needs and nothing else, and each rule holds only where its own standard holds. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
import { describe, it, expect } from "vitest";
import { assignmentLines, assignmentOf } from "@/domains/decision/assignment";
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
      expect(assignmentLines(a).some((l) => l.includes(`THE EXACT PASSAGE THIS COPY REPLACES, verbatim: "${s.passage}"`)), "and the passage it replaces rides the brief word for word").toBe(true);
    });

    it(`${s.t}: the page's own words are ruled out as the subject only where the standard says so`, () => {
      const body = assignmentLines(assignmentOf(packetOf(s), null, "answer_block")!)[0]!;
      const summary = assignmentLines(assignmentOf(packetOf(s), null, "meta")!)[0]!;
      expect([body.includes("never the subject of the new copy"), summary.includes("never the subject of the new copy"), summary.includes("the material this edit works from")],
        "a missing answer may not restate the page; a summary line's whole job is to summarise it, and one message may not order both").toEqual([true, false, true]);
    });

    it(`${s.t}: the winners reach the brief as publishers with what they are, never as a raw class slug`, () => {
      const lines = assignmentLines(assignmentOf(packetOf(s, { evidence: { "page-title": s.title, "rival-1": `${s.winner} carries this.` } }), null, "answer_block")!);
      const rival = lines.find((l) => l.startsWith("THE PAGES THAT ALREADY WIN THIS SEARCH")) ?? "";
      expect([rival.includes("rival-1"), rival.includes(`${s.winner}, a publisher covering these topics`), /publisher_|_unknown|_directory/.test(rival)],
        "the id a claim may never cite, the publisher and what it is in plain words, and no raw slug").toEqual([true, true, false]);
    });
  }

  /** A LANGUAGE RULE MAY NOT NAME A LANGUAGE (campaign review, 2026-09-05). The assignment carried one instruction that
   *  fired on a single Unicode block and ordered the writer to "write every Persian word in Persian script", which
   *  named a language no page had declared, called Arabic, Urdu and Pashto text Persian, and travelled into a model
   *  prompt as a fact about the account. TWO MORE SYNTHETIC ACCOUNTS, each writing part of its own page in a DIFFERENT
   *  script, so what is measured is a rule about scripts and never a rule about one vocabulary. */
  const SCRIPTS = [
    { t: "tenant-three", base: SITES[0]!, body: "The word carved over the gate is \u0633\u0644\u0627\u0645, written on this page as salaam.", named: /persian|farsi|arabic|urdu|pashto/i },
    { t: "tenant-four", base: SITES[1]!, body: "El nombre del puerto es \u039d\u03b1\u03cd\u03c0\u03bb\u03b9\u03bf, escrito en esta pagina como Nafplio.", named: /greek|griego|hellenic/i },
  ];
  it.each(SCRIPTS)("$t: a page writing some of its own words in another script is told to keep that script and the page's own romanization, and no language is named", (s) => {
    const other = assignmentOf(packetOf(s.base, { bodyText: s.body }), null, "answer_block")!;
    const latin = assignmentOf(packetOf(s.base), null, "answer_block")!;
    expect([/script the page writes them in/.test(other.mustLeadWith), /romaniz/i.test(other.mustLeadWith), /scholar/i.test(other.mustLeadWith)],
      "the page's own script is kept, its own romanization is followed, and a scholar's notation is refused").toEqual([true, true, true]);
    expect(/script the page writes them in/.test(latin.mustLeadWith), "a page written in the Latin alphabet is told nothing about scripts at all").toBe(false);
    expect([s.named.test(other.mustLeadWith), /persian|farsi|arabic|greek|urdu|pashto|hebrew|cyrillic|chinese|japanese|korean|hindi/i.test(other.mustLeadWith)],
      "the rule names no language, not this page's and not any other").toEqual([false, false]);
    expect(assignmentLines(other).join(" ").includes(other.mustLeadWith), "and the writer reads it on the brief itself, which is where the old sentence reached a prompt").toBe(true);
  });
});
