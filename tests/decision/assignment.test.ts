/** ONE ASSIGNMENT, NO CONTRADICTIONS, THE WHOLE BRIEF (campaign, 2026-09-05; the contradictions closed 2026-09-06). On the captured hub row below, one sentence stood under WHAT A READER MUST KNOW AFTERWARDS and again under NAMED BUT UNSUPPORTED "so it may not be stated at all"; a replacement was told nothing on the page is rewritten; a restructuring was told the page's own ids are "never material for the new copy"; and a general body brief carried a lesson about scripts and romanization. The DELETED promise is the script clause, which named a language no page had declared: what stands in its place is that no line of any brief is a lesson about a language. The envelope a body edit is written, judged, promoted and re-read from lived inside the editor file and told the writer two incompatible things at once: a replacement had to "add what they miss" and "invent no wording this page does not already carry", and every edit was told the page's own words were never the subject of the new copy while the restructuring and summary standards make those words the whole material. It is one module now, it carries the eight things the work needs and nothing else, and each rule holds only where its own standard holds. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
import { describe, it, expect } from "vitest";
import { assignmentLines, assignmentOf } from "@/domains/decision/assignment";
import { comparisonTopics, jobComparison } from "@/domains/evidence/comparison";
import HUB from "../fixtures/hub-packet.json";
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
      const l = assignmentLines(a);
      expect([l.some((x) => x.includes(`THE EXACT PASSAGE THIS COPY REPLACES, verbatim: "${s.passage}"`)), /nothing on the page is deleted or rewritten$/m.test(a.mustPreserve), a.mustPreserve.includes("OUTSIDE the passage named above"), a.mustNotRepeat.includes("that STAY on the page")],
        "the passage it replaces rides the brief word for word, and the same brief no longer says nothing on the page is rewritten: what is preserved is what stays, and the replaced passage is the one thing this copy may carry over").toEqual([true, false, true, true]);
    });

    it(`${s.t}: the page's own words are ruled out as the subject only where the standard says so, and every line of the brief gives the same answer`, () => {
      const at = (a: ReturnType<typeof assignmentOf>, starts: string): string => assignmentLines(a!).find((l) => l.startsWith(starts)) ?? "";
      const restructure = assignmentOf(packetOf(s, { gap: { kind: "scattered_answer", propositions: [s.passage] } }), null, "answer_block");
      const body = assignmentOf(packetOf(s), null, "answer_block"), summary = assignmentOf(packetOf(s), null, "meta");
      expect([at(body, "THE ASSIGNMENT").includes("never the subject of the new copy"), at(summary, "THE ASSIGNMENT").includes("the material this edit works from"), at(restructure, "THE ASSIGNMENT").includes("the material this edit works from")],
        "a missing answer may not restate the page; a summary line and a restructuring work from it").toEqual([true, true, true]);
      expect([at(body, "PAGE CONTEXT").includes("never material for the new copy"), at(summary, "PAGE CONTEXT").includes("the material this edit works from"), at(restructure, "PAGE CONTEXT").includes("the material this edit works from"), restructure!.mustNotRepeat.includes("how this page arranges its material")],
        "the page-context line answers the same question the same way, so a restructuring is never told to assemble what it may not use, and what it may not repeat is the arrangement rather than the material").toEqual([true, true, true, true]);
    });

    /* AN UNAVAILABLE FACT BLOCKS ITS OWN CLAIM AND NOTHING ELSE (campaign, 2026-09-06). The envelope printed every diagnosed proposition as what a reader must know and printed the unsupported ones again as what "may not be stated at all", so the writer was ordered to deliver the one sentence it was refused for writing, and the reader's own task went unnamed. */
    it(`${s.t}: a proposition nothing checked carries is never both what a reader must know and what may not be stated`, () => {
      const bare = assignmentOf(packetOf(s, { evidence: { "page-title": s.title, "page-copy-1": s.passage }, checkedSentences: [] }), null, "answer_block")!;
      const must = assignmentLines(bare).find((l) => l.startsWith("WHAT A READER MUST KNOW")) ?? "";
      expect([bare.forbidden, must.includes(s.prop), must.includes(s.queries[0]!), bare.completionTest.includes(s.prop), bare.completionTest.includes(s.queries[0]!), /sentences of your own/.test(bare.mustLeadWith)],
        "the unsupported proposition is named once, as a subject nothing checked carries; what a reader must know and the completion test fall to the reader's own task; and the answer is written in the writer's own sentences rather than out of wording already on the page").toEqual([[s.prop], false, true, false, true, true]);
      const kept = assignmentOf(packetOf(s), null, "answer_block")!;
      expect([kept.forbidden, kept.completionTest.includes(s.prop)], "and a proposition a checked fact carries is deliverable, so the completion test names it").toEqual([[], true]);
    });

    it(`${s.t}: no line of a body brief is a lesson about a language, a script or a spelling`, () => {
      const brief = assignmentLines(assignmentOf(packetOf(s, { bodyText: `${s.passage} \u0633\u0644\u0627\u0645` }), null, "answer_block")!).join(" ");
      expect(/\bscript\b|romaniz|scholar|persian|farsi|arabic|greek|urdu|pashto|hebrew|cyrillic|the form you explain|examples of the rule/i.test(brief),
        "a page writing part of itself in another alphabet is told nothing about alphabets, and no general brief carries a lesson about a linguistic form").toBe(false);
    });

    it(`${s.t}: the winners reach the brief as publishers with what they are, never as a raw class slug`, () => {
      const lines = assignmentLines(assignmentOf(packetOf(s, { evidence: { "page-title": s.title, "rival-1": `${s.winner} carries this.` } }), null, "answer_block")!);
      const rival = lines.find((l) => l.startsWith("THE PAGES THAT ALREADY WIN THIS SEARCH")) ?? "";
      expect([rival.includes("rival-1"), rival.includes(`${s.winner}, a publisher covering these topics`), /publisher_|_unknown|_directory/.test(rival), rival.includes(`"${s.quote}"`), rival.includes("never a fact you may state")],
        "the id a claim may never cite, the publisher and what it is in plain words, no raw slug, the winner's own words as the subject this copy may take, and never as a fact").toEqual([true, true, false, true, true]);
    });
  }

  /** THE ACCOUNT'S OWN STALLED HUB ROW, CAPTURED (2026-09-05; tenant id, site domain and owned URLs neutralised, every other word the capture's own). Its brief printed one sentence twice: "WHAT A READER MUST KNOW AFTERWARDS: <publisher> gives "Artists" a section of its own and nothing on this page covers it" and, eleven lines later, "NAMED BUT UNSUPPORTED, so it may not be stated at all: <the same sentence>". Beside it the brief said the page's own words are never the subject AND told the writer to state only what the page's own words carry. */
  it("the captured hub packet's brief carries no contradictory pair, and the winners are read for the question's subject", () => {
    const q = HUB.card.primaryQuery, body = HUB.body.passages.join(" ");
    const cmp = jobComparison(HUB.research as never, [q], { url: HUB.body.url, text: body, headings: HUB.body.headings, passages: HUB.body.passages });
    const a = assignmentOf({ ...packetOf(SITES[0]!), targetUrl: HUB.body.url, title: HUB.body.title, h1: HUB.body.h1, bodyText: body, headings: HUB.body.headings,
      evidence: Object.fromEntries(HUB.body.passages.map((t, i) => [`page-copy-${i + 1}`, t])), checkedSentences: [], comparison: cmp, trackedQuestion: q,
      gap: { kind: "incomplete_answer", propositions: [comparisonTopics(cmp)[0]!.topic] } } as unknown as SourcePacket, null, "answer_block")!;
    const lines = assignmentLines(a), at = (x: string): string => lines.find((l) => l.startsWith(x)) ?? "";
    expect([a.forbidden.length, at("WHAT A READER MUST KNOW").includes(a.forbidden[0]!), a.completionTest.includes(a.forbidden[0]!), at("WHAT A READER MUST KNOW").includes(q), a.completionTest.includes(q)],
      "the one thing nothing checked carries is named once, as a subject; what a reader must know and the completion test are the reader's own search").toEqual([1, false, false, true, true]);
    expect([/never material for the new copy/.test(at("PAGE CONTEXT")) && /state only what the page's own words carry/.test(a.mustLeadWith), /\bscripts?\b|romaniz|the form you explain/i.test(lines.join(" ")), at("MUST PRESERVE").includes("nothing on the page is deleted or rewritten") && !!a.replaces],
      "no line orders the page's own words as the only material while another rules them out, no line is a lesson about a language, and nothing is told to preserve a passage it replaces").toEqual([false, false, false]);
    const shown = cmp.winners.find((w) => w.observations.length > 0)!;
    expect([shown.held.length > 0, shown.observations.every((o) => shown.held.includes(o.quote) || body.length > 0), cmp.winners.some((w) => !w.heldWhole), cmp.verdict],
      "the winner is read where it answers this search, the capture is bigger than one reading, and a partly shown winner leaves the verdict short of the fact that they name nothing").toEqual([true, true, true, "names"]);
    /* A GAP READ OFF THE WINNERS IS A HYPOTHESIS, NEVER A FACT (campaign, 2026-09-06): the observation names a section, an arrangement or an answer this page could carry, and its new factual content stands on a checked fact or is filed as one for the evidence path to source. The rival's own sentence is never the thing to state. */
    /* AND ONCE THAT SUBJECT'S SOURCE IS ON FILE THE WRITER IS HIRED WITH IT (operator, 2026-09-06): the section is judged by the missing-answer standard, leads with the checked sentence rather than with the rival's, and the completion test names the subject the reader came for. */
    const subject = comparisonTopics(cmp)[0]!.topic, says = `${subject} are set out in full by the source read for them.`;
    const sourced = assignmentOf({ ...packetOf(SITES[0]!), targetUrl: HUB.body.url, bodyText: body, headings: HUB.body.headings, comparison: cmp, trackedQuestion: q, checkedSentences: [says], evidence: { ...Object.fromEntries(HUB.body.passages.map((t, i) => [`page-copy-${i + 1}`, t])), "fact-1": `${says} https://source.example says "${says}".` }, gap: { kind: "incomplete_answer", propositions: [subject] } } as unknown as SourcePacket, null, "answer_block")!;
    expect([sourced.standard, sourced.forbidden, sourced.mustLeadWith.startsWith(says), sourced.completionTest.includes(subject), assignmentLines(sourced).find((l) => l.startsWith("DIAGNOSED GAP"))?.includes(`${subject}. That gap is a READING`)], "the sourced section answers to the missing-answer standard, nothing is left unsupported, the first sentence is the checked one, and the completion test names the subject").toEqual(["missing_answer", [], true, true, true]);
    const plain = assignmentOf({ ...packetOf(SITES[0]!), gap: { kind: "missing_answer", propositions: [SITES[0]!.prop] } } as unknown as SourcePacket, null, "answer_block")!;
    expect([at("DIAGNOSED GAP").includes("READING OF THE PAGES ALREADY WINNING THIS SEARCH"), at("DIAGNOSED GAP").includes("never a fact of its own"), at("DIAGNOSED GAP").includes("state a new fact only where a supporting fact below carries it"), assignmentLines(plain).some((l) => l.startsWith("DIAGNOSED GAP") && l.includes("READING OF THE PAGES"))],
      "the brief names this gap kind as a reading of the winners, says the copy may state a new fact only where a checked fact carries it, and says so for this kind alone").toEqual([true, true, true, false]);
  });
});
