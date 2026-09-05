/** A SITE'S FURNITURE IS NOT A GAP IN A PAGE (campaign review, 2026-09-05), AT EITHER DOOR THAT READS ONE.
 *
 *  `jobComparison` reads a winner's `headings` and `h3s` and mints a "covers" observation for every one of them the
 *  owned page has no words for. The crawler builds `h2_list` and `h3_list` off the WHOLE document (evidence/pages/
 *  extractor.ts:49 and :58), while only `body_text` is de-chromed (:331), so a winner's "Newsletter", "Related
 *  articles" or "Categories" heading reaches the comparison as content. One of them is enough to move the verdict to
 *  "names", which is the single answer the ranking-loss door reads before it authorizes paid body work
 *  (decision/drafted-copy.ts:479), and it also reaches the writer as a briefing line telling it to write a section
 *  about a newsletter signup. The paid confirmation cannot undo it: the firewall in `readComparison`
 *  (decision/llm/structured-drafter.ts:1007) accepts any quote found in the winner's held text OR IN THE CANDIDATES
 *  THEMSELVES, so echoing the furniture candidate back survives.
 *
 *  `FURNITURE_LABEL` (evidence/relevance-gate) is now the account's ONE definition of a navigation label, moved down
 *  out of decision/proof and decision/drafted-copy with the hardcoded account token retired, and every door reads it:
 *  the writer's anchor rule, the replacement door, the assignment's anchor rule, this comparison, and the thin-page
 *  subjects an operator is actually handed.
 */
import { describe, it, expect } from "vitest";
import { jobComparison } from "@/domains/evidence/comparison";
import { winnersAgreeOn } from "@/domains/decision/drafted-copy";

/** TWO SYNTHETIC ACCOUNTS with unrelated subjects and different languages: a rule that holds for one is not a rule. */
const SITES = [
  { t: "tenant-one", own: "https://alpha.example/harbour-seals", win: "https://rivalone.example/seals",
    queries: ["where harbour seals haul out", "harbour seal haul out spots"],
    ownHeads: ["Where they haul out"],
    ownPassages: ["Harbour seals haul out on the sand bars below the point, and the colony there is largest in summer."],
    /** The winner's own prose says exactly what the owned page says, in the owned page's own words, so nothing it
     *  writes is a difference. Every observation this fixture can produce has to come from the chrome. */
    prose: "Harbour seals haul out on the sand bars below the point, and the colony there is largest in summer.",
    covered: "Where they haul out", subject: "Pupping season closures" },
  { t: "tenant-two", own: "https://beta.example/telares", win: "https://rivaldos.example/urdimbre",
    queries: ["como se monta la urdimbre", "montar urdimbre telar"],
    ownHeads: ["Como se monta la urdimbre"],
    ownPassages: ["La urdimbre se monta con doce hilos por centimetro y se tensa antes de la primera trama."],
    prose: "La urdimbre se monta con doce hilos por centimetro y se tensa antes de la primera trama.",
    covered: "Como se monta la urdimbre", subject: "Contrapesos para el ancho" },
];
type Site = (typeof SITES)[number];

/** The winner as the crawler banks it: main text de-chromed, headings taken off the whole document. */
const research = (s: Site, headings: string[]) => ({
  serpEvidence: [{ query: s.queries[0]!, observedAt: null, organic: [{ rank: 1, url: s.win, domain: new URL(s.win).hostname, title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  winningPages: [{ url: s.win, domain: new URL(s.win).hostname, engines: [], examplePrompts: [], appearances: [{ query: s.queries[0]! }],
    extract: { title: "Winner", h1: null, wordCount: 900, headings, faqCount: 0, entityNames: [], hasList: false, hasTable: false,
      mainText: s.prose, truncated: false, heldChars: s.prose.length, totalChars: s.prose.length, h3s: [], schemaTypes: [] } }],
}) as never;
const owned = (s: Site) => ({ url: s.own, text: `${s.ownHeads.join(" ")} ${s.ownPassages.join(" ")}`, headings: s.ownHeads, passages: s.ownPassages });

describe("the comparison answers on content, never on a site's furniture", () => {
  it.each(SITES)("$t: a winner that says exactly what this page says, with only its own chrome beside it, names nothing this page lacks", (s) => {
    const bare = jobComparison(research(s, [s.covered]), s.queries, owned(s));
    expect(bare.verdict).toBe("nothing"); // control: read whole, nothing to say

    for (const label of ["Newsletter", "Related articles", "Categories", "Follow us", "Shop now", "Table of contents"]) {
      const c = jobComparison(research(s, [s.covered, label]), s.queries, owned(s));
      const said = c.winners.flatMap((w) => w.observations.map((o) => o.text)).join(" | ");
      expect(`${label}: ${c.verdict}`).toBe(`${label}: nothing`);
      expect(`${label}: ${said}`).toBe(`${label}: `);
    }
  });

  /** THE SAME RULE WHERE A CUSTOMER READS IT (campaign review, finding 2). The thin-page producer and the operator step
   *  "Give each of these its own section: ..." stood on `winnersCover`, a second and older comparison that filtered
   *  furniture with its own private list. One comparison decides it now, so the label the winners share around their
   *  content never becomes a section this operator is told to write. */
  it.each(SITES)("$t: a label every winner repeats around its content is never handed to an operator as a subject to write", (s) => {
    const winner = (host: string, heads: string[]) => ({ url: `https://${host}/page`, domain: host, engines: [], examplePrompts: [], appearances: [{ query: s.queries[0]! }],
      extract: { title: "Winner", h1: null, wordCount: 900, headings: heads, faqCount: 0, entityNames: [], hasList: false, hasTable: false, mainText: null, truncated: false, heldChars: null, totalChars: null, h3s: [], schemaTypes: [] } });
    const hosts = ["one.example", "two.example"];
    const research = { serpEvidence: [{ query: s.queries[0]!, observedAt: null, organic: hosts.map((h, i) => ({ rank: i + 1, url: `https://${h}/page`, domain: h, title: null })), aiOverview: [], aiMode: [], paa: [], related: [] }],
      winningPages: hosts.map((h) => winner(h, [s.covered, "Newsletter", s.subject])) };
    const page = { url: s.own, content: { wordCount: 150, title: s.ownHeads[0]!, h1: s.ownHeads[0]!, outline: s.ownHeads, h2: s.ownHeads },
      search: { topQueries: [{ query: s.queries[0]!, impressions: 900 }] } };
    const agreed = winnersAgreeOn({ research } as never, page as never);
    expect(agreed, "the subject both winners give a section to and this page has no words for, and nothing else").toEqual([s.subject]);
  });
});
