/** THE COMPARISON COMPARES CONTENT (campaign, 2026-09-05). The only comparison a writer ever saw read 20 heading labels and 12 entity names, called a heading missing when no meaningful word of it appeared on the owned page, and authorized body work on a position loss only when two winners shared an IDENTICAL lower-cased heading, so three winners phrasing their headings differently agreed on nothing and the account's three largest body cases were refused every drive while an 8,751 word roster sat banked for their exact search. It now reads the winners' own words, labels each publisher instead of dropping the authorities, and says out loud when a cut capture leaves the answer unknown. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
import { comparisonLines, jobComparison } from "@/domains/evidence/comparison";
import { readComparison } from "@/domains/decision/llm/structured-drafter";
import { winnersAgreeOn } from "@/domains/decision/drafted-copy";

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

    /* WHAT THE PAID READING IS SHOWN IS CHOSEN BY THE READER'S QUESTION (campaign, 2026-09-06). It was the first 4,000 characters of the main text, so on the account's 8,751 word roster the reading was handed a navigation rail and a table of contents and not one line about the subject, and the "nothing" it then answered stood as proof the winner carried nothing this page lacks. */
    it(`${s.t}: a long winner is read where it answers the search, and a winner shown only in part never proves an absence`, () => {
      const rail = "Home Menu Contact Newsletter Sign up here. ".repeat(120), deep = `${rail}${s.prose} ${rail}`;
      const far = jobComparison(research(s, { mainText: deep, truncated: false, heldChars: deep.length, totalChars: deep.length }), s.queries, owned(s)).winners[0]!;
      expect([deep.length > 4_000, far.held.includes(s.prose), far.held.startsWith("Home Menu"), far.heldWhole],
        "the passages about the search ride, the page's opening rail does not, and the winner says out loud that it was shown only in part").toEqual([true, true, false, false]);
      const long = `${rail}${s.ownPassages[0]!} ${rail}`;
      const partial = jobComparison(research(s, { mainText: long, headings: [s.covered], entityNames: [], faqCount: 0, truncated: false, heldChars: long.length, totalChars: long.length }), s.queries, owned(s));
      expect([partial.verdict, comparisonLines(partial)[0]!.includes("Only its passages about this search were read")],
        "a winner carrying nothing this page lacks, read whole but shown in part, is unread rather than the fact that it names nothing").toEqual(["unread", true]);
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

/** A SITE'S FURNITURE IS NOT A GAP IN A PAGE (campaign review, 2026-09-05), AT EITHER DOOR THAT READS ONE. `jobComparison` reads a winner's `headings` and `h3s` and mints a "covers" observation for every one of them the owned page has no words for, while the crawler builds those lists off the WHOLE document and de-chromes only `body_text`, so a winner's "Newsletter" or "Related articles" heading reached the comparison as content; one of them was enough to move the verdict to "names", which is the one answer the ranking-loss door reads before it authorizes paid body work, and it reached the writer as a briefing line telling it to write a section about a newsletter signup. `FURNITURE_LABEL` (evidence/relevance-gate) is the account's ONE definition of a navigation label and every door reads it. AN OBSERVATION ALSO NEEDS A READING (production 03:01Z, 2026-09-06): a change carried eight things "the pages winning this cover", every one a heading off the crawler's list of a winner whose words were never read, three of them an encyclopedia's "Gallery", "Notes" and "References", each printed twice because the publisher ranked two pages. THESE RAN AS tests/evidence/comparison-furniture.test.ts on a second copy of this file's own two accounts and its own winner builder, and are here whole, on one fixture, because one module owes one preamble. */
const chrome = (s: Site, headings: string[], main: string | null = s.ownPassages[0]!) => research(s, { headings, mainText: main, entityNames: [], faqCount: 0, hasList: false, hasTable: false, wordCount: 900, heldChars: main?.length ?? null, totalChars: main?.length ?? null });
describe("a winner speaks only once its own words are on file", () => {
  it.each(SITES)("$t: a winner nobody has read yet names nothing, and leaves the comparison unread rather than answered", (s) => {
    const heads = [s.gap, "Gallery", "References"];
    const blind = jobComparison(chrome(s, heads, null), s.queries, owned(s)), seen = jobComparison(chrome(s, heads), s.queries, owned(s));
    expect([blind.winners[0]!.observations, blind.verdict],
      "a rich heading list with no reading behind it is no observation at all, and a door that asks whether the winners name anything is told the winner is unread rather than told it names nothing").toEqual([[], "unread"]);
    expect([seen.winners[0]!.observations.map((o) => o.quote), seen.verdict],
      "the same winner with its own words on file names the one subject this page has no words for, and an encyclopedia's gallery and reference list are not subjects").toEqual([[s.gap], "names"]);
  });
  it.each(SITES)("$t: one publisher saying one thing on two of its pages is one observation, not the same absence twice", (s) => {
    const at = (n: number) => `${s.win}/${n}`, host = new URL(s.win).hostname, main = s.ownPassages[0]!;
    const two = { serpEvidence: [{ query: s.queries[0]!, observedAt: null, aiOverview: [], aiMode: [], paa: [], related: [],
      organic: [1, 2].map((n) => ({ rank: n, url: at(n), domain: host, title: null })) }],
      winningPages: [1, 2].map((n) => ({ url: at(n), domain: host, engines: [], examplePrompts: [], appearances: [{ query: s.queries[0]! }],
        extract: { title: "Winner", h1: null, wordCount: 900, headings: [s.gap], faqCount: 0, entityNames: [], hasList: false, hasTable: false,
          mainText: main, truncated: false, heldChars: main.length, totalChars: main.length, h3s: [], schemaTypes: [] } })) } as never;
    const c = jobComparison(two, s.queries, owned(s));
    expect([c.winners.length, c.winners.flatMap((w) => w.observations.map((o) => o.quote))],
      "both pages are read and compared, and the subject their publisher gives a section to is offered once").toEqual([2, [s.gap]]);
  });
});
describe("the comparison answers on content, never on a site's furniture", () => {
  it.each(SITES)("$t: a winner that says exactly what this page says, with only its own chrome beside it, names nothing this page lacks", (s) => {
    expect(jobComparison(chrome(s, [s.ownHeads[0]!]), s.queries, owned(s)).verdict).toBe("nothing"); // control: read whole, nothing to say
    for (const label of ["Newsletter", "Related articles", "Categories", "Follow us", "Shop now", "Table of contents",
      "Gallery", "Notes", "References", "External links", "Further reading", "Bibliography", "Citations", "Sources", "Footnotes", "Navigation menu"]) {
      const c = jobComparison(chrome(s, [s.ownHeads[0]!, label]), s.queries, owned(s));
      expect(`${label}: ${c.verdict}`).toBe(`${label}: nothing`);
      expect(`${label}: ${c.winners.flatMap((w) => w.observations.map((o) => o.text)).join(" | ")}`).toBe(`${label}: `);
    }
  });
  /** THE SAME RULE WHERE A CUSTOMER READS IT (campaign review, finding 2). The thin-page producer and the operator step "Give each of these its own section: ..." stood on `winnersCover`, a second and older comparison that filtered furniture with its own private list. One comparison decides it now, so the label the winners share around their content never becomes a section this operator is told to write. */
  it.each(SITES)("$t: a label every winner repeats around its content is never handed to an operator as a subject to write", (s) => {
    const main = s.ownPassages[0]!, hosts = ["one.example", "two.example"];
    const winner = (host: string) => ({ url: `https://${host}/page`, domain: host, engines: [], examplePrompts: [], appearances: [{ query: s.queries[0]! }],
      extract: { title: "Winner", h1: null, wordCount: 900, headings: [s.ownHeads[0]!, "Newsletter", s.gap], faqCount: 0, entityNames: [], hasList: false, hasTable: false, mainText: main, truncated: false, heldChars: main.length, totalChars: main.length, h3s: [], schemaTypes: [] } });
    const research2 = { serpEvidence: [{ query: s.queries[0]!, observedAt: null, organic: hosts.map((h, i) => ({ rank: i + 1, url: `https://${h}/page`, domain: h, title: null })), aiOverview: [], aiMode: [], paa: [], related: [] }], winningPages: hosts.map(winner) };
    const page = { url: s.own, content: { wordCount: 150, title: s.ownHeads[0]!, h1: s.ownHeads[0]!, outline: s.ownHeads, h2: s.ownHeads }, search: { topQueries: [{ query: s.queries[0]!, impressions: 900 }] } };
    expect(winnersAgreeOn({ research: research2 } as never, page as never), "the subject both winners give a section to and this page has no words for, and nothing else").toEqual([s.gap]);
  });
});
