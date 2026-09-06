/** THE COMPARISON COMPARES CONTENT (campaign, 2026-09-05). The only comparison a writer ever saw read 20 heading labels and 12 entity names, called a heading missing when no meaningful word of it appeared on the owned page, and authorized body work on a position loss only when two winners shared an IDENTICAL lower-cased heading, so three winners phrasing their headings differently agreed on nothing and the account's three largest body cases were refused every drive while an 8,751 word roster sat banked for their exact search. It now reads the winners' own words, labels each publisher instead of dropping the authorities, and says out loud when a cut capture leaves the answer unknown. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
import { jobComparison } from "@/domains/evidence/comparison";
import { readComparison } from "@/domains/decision/llm/structured-drafter";

const SITES = [
  { t: "tenant-one", own: "https://alpha.example/harbour-seals", host: "rivalone.example", win: "https://rivalone.example/seals",
    queries: ["where harbour seals haul out", "harbour seal haul out spots"],
    ownHeads: ["Where they haul out"], ownPassages: ["Harbour seals haul out on the sand bars below the point, and the colony is largest in summer."],
    covered: "Sand bars below the point", gap: "Pupping season closures",
    prose: "Harbour seals haul out on gravel spits at low tide, and wardens close the eastern spit from June to August while the pups are nursing.",
    entity: "Eastern Spit Warden Service", askedWord: "haul" },
  { t: "tenant-two", own: "https://beta.example/telares", host: "rivaldos.example", win: "https://rivaldos.example/urdimbre",
    queries: ["como se monta la urdimbre", "montar urdimbre telar"],
    ownHeads: ["Como se monta la urdimbre"], ownPassages: ["La urdimbre se monta con doce hilos por centimetro y se tensa antes de la primera trama."],
    covered: "Hilos por centimetro", gap: "Contrapesos para el ancho",
    prose: "La urdimbre se monta hilo por hilo sobre el peine, y la tension se ajusta con contrapesos colgados detras del telar.",
    entity: "Taller Municipal de Telares", askedWord: "urdimbre" },
];
type Site = (typeof SITES)[number];
const extract = (s: Site, over: Record<string, unknown> = {}) => ({ title: "Winner", h1: null, wordCount: 2100, headings: [s.covered, s.gap], faqCount: 0,
  entityNames: [s.entity], hasList: true, hasTable: false, mainText: s.prose, truncated: false, heldChars: s.prose.length, totalChars: s.prose.length, h3s: [], schemaTypes: [], ...over });
const research = (s: Site, over: Record<string, unknown> = {}, url = s.win) => ({
  serpEvidence: [{ query: s.queries[0]!, observedAt: null, organic: [{ rank: 1, url, domain: new URL(url).hostname, title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  winningPages: [{ url, domain: new URL(url).hostname, engines: [], examplePrompts: [], appearances: [{ query: s.queries[0]! }], extract: extract(s, over) }],
}) as never;
const owned = (s: Site) => ({ url: s.own, text: `${s.ownHeads.join(" ")} ${s.ownPassages.join(" ")}`, headings: s.ownHeads, passages: s.ownPassages });

describe("what one comparison of the winners says", () => {
  for (const s of SITES) {
    it(`${s.t}: a winner's own prose that answers the group is an observation, quoted, and the page's own answering passage is kept`, () => {
      const c = jobComparison(research(s), s.queries, owned(s)), w = c.winners[0]!;
      const answers = w.observations.filter((o) => o.kind === "answers");
      expect([c.verdict, answers.length > 0, answers[0] ? s.prose.includes(answers[0].quote.replace(/\.\.\.$/, "")) : false],
        "the comparison names something, and what it names is the winner's own sentence rather than a label").toEqual(["names", true, true]);
      expect(c.keep, "the passage this page already publishes for the group is material to keep, never material to add").toEqual(s.ownPassages);
    });

    it(`${s.t}: a heading this page covers in its own words is not a gap, and one it has no words for is`, () => {
      const w = jobComparison(research(s), s.queries, owned(s)).winners[0]!, covers = w.observations.filter((o) => o.kind === "covers").map((o) => o.quote);
      expect([covers.includes(s.covered), covers.includes(s.gap)], "the same subject worded differently is not missing; a subject with no words on the page is").toEqual([false, true]);
    });

    it(`${s.t}: a winner cut at the capture ceiling never earns the verdict that the winners name nothing`, () => {
      const same = { mainText: s.ownPassages[0]!, headings: [s.covered], entityNames: [], faqCount: 0 };
      const whole = jobComparison(research(s, { ...same, truncated: false }), s.queries, owned(s));
      const partial = jobComparison(research(s, { ...same, truncated: true, heldChars: 12_000, totalChars: 48_000 }), s.queries, owned(s));
      expect([whole.verdict, partial.verdict, partial.winners[0]!.truncated],
        "read whole and carrying nothing this page lacks is a fact; cut at the ceiling is unknown past the cut and never that fact").toEqual(["nothing", "unread", true]);
    });

    /* A READ THAT NEVER LOOKED FOR ENTITIES CANNOT SAY THE WINNER NAMES NOTHING (Build Queue E-039). A page read
     * through the provider carries its words and its tables and reports no entity list, no question count and no
     * list flag; an empty list stood in for all three, so a winner nobody had asked about entities settled the
     * comparison at "the stored winners name nothing this page lacks", the one sentence the body door refuses on. */
    it(`${s.t}: a winner whose read lists nothing it names leaves that unknown instead of settling the comparison`, () => {
      const same = { mainText: s.ownPassages[0]!, headings: [s.covered], faqCount: 0 };
      const looked = jobComparison(research(s, { ...same, entityNames: [] }), s.queries, owned(s));
      const never = jobComparison(research(s, { ...same, entityNames: undefined, hasList: undefined }), s.queries, owned(s));
      expect([looked.verdict, never.verdict, never.winners[0]!.namesRead, never.winners[0]!.shape.lists, never.winners[0]!.shape.questions, looked.winners[0]!.shape.questions],
        "a read that looked and found no names settles the comparison; a read that never looked leaves it unknown, and the shape says which parts of the answer were never captured")
        .toEqual(["nothing", "unread", false, null, 0, 0]);
    });

    it(`${s.t}: the publisher class follows the host, so an authority is labelled rather than dropped`, () => {
      const gov = jobComparison(research(s, {}, "https://records.alpha.gov/report"), s.queries, owned(s)).winners[0]!;
      const cited = jobComparison(research(s, {}, "https://en.wikipedia.org/wiki/Subject"), s.queries, owned(s)).winners[0]!;
      expect([gov.publisherClass, cited.publisherClass, cited.publisher],
        "a public record is a government source and an encyclopedia is a publisher on these topics, both read and both labelled").toEqual(["government_educational", "publisher", "wikipedia.org"]);
    });
  }
});

describe("what the confirming reading may change", () => {
  for (const s of SITES) {
    it(`${s.t}: no candidate means no call and no cost, and a refused reading leaves what the words established`, async () => {
      let calls = 0; const complete = async () => { calls += 1; return { value: { observations: [] } }; };
      const blank = jobComparison(research(s, { mainText: "", headings: [], entityNames: [], faqCount: 0, wordCount: 5 }), s.queries, owned(s));
      const back = await readComparison(blank, { url: s.own, passages: s.ownPassages }, { tenantId: s.t, complete: complete as never });
      expect([calls, back], "a comparison the words found nothing in is never bought a reading").toEqual([0, blank]);
      const found = jobComparison(research(s), s.queries, owned(s));
      const refused = await readComparison(found, { url: s.own, passages: s.ownPassages }, { tenantId: s.t, complete: (async () => { throw new Error("provider down"); }) as never });
      expect(refused.winners[0]!.observations, "a reading that did not come back leaves the candidates standing rather than emptying the comparison").toEqual(found.winners[0]!.observations);
    });

    it(`${s.t}: the reading keeps only what it can show in the winner's own words, and the verdict follows what survives`, async () => {
      const found = jobComparison(research(s), s.queries, owned(s));
      const quote = s.prose.slice(0, 60);
      const value = { observations: [{ winner: s.win, kind: "answers", text: `${s.host} states what this page does not.`, quote },
        { winner: s.win, kind: "covers", text: "invented", quote: "words no page shown here ever printed" },
        { winner: "https://elsewhere.example/other", kind: "names", text: "a page nobody supplied", quote }] };
      const read = await readComparison(found, { url: s.own, passages: s.ownPassages }, { tenantId: s.t, complete: (async () => ({ value })) as never });
      expect([read.winners[0]!.observations.map((o) => o.quote), read.verdict],
        "an invented quote and a page that was never supplied are dropped at the door; what the winner really says survives").toEqual([[quote], "names"]);
      const emptied = await readComparison(found, { url: s.own, passages: s.ownPassages }, { tenantId: s.t, complete: (async () => ({ value: { observations: [] } })) as never });
      expect([emptied.winners[0]!.observations.length, emptied.verdict], "a reading that confirms no candidate on a winner read whole settles the comparison at nothing").toEqual([0, "nothing"]);
    });
  }
});
