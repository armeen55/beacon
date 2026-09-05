/** A WINNER READ IS A READING, NOT A FINGERPRINT (campaign, 2026-09-05). Every page that wins one of this account's searches was fetched, parsed and banked as 20 headings, 12 entity names and 600 characters of opening, so the only comparison the writer ever saw could ask whether two labels matched and never what a winning page ANSWERS. The extract now carries the page's own main content with the furniture removed, what was kept of it and what there was, its subheadings and its structured-data types; a cut capture is unknown beyond the cut and never absent. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
import { describe, it, expect } from "vitest";
import { mainOf, pageExtractFrom, pageExtractFromRecord } from "@/domains/evidence/funnel/research-evidence";
/** The comparison ceiling, read off the one function that applies it rather than a second copy of the number. */
const MAIN_TEXT_CEILING = mainOf("word ".repeat(20_000)).heldChars!;
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import { parseCapability } from "@/domains/evidence/dataforseo/capabilities";

/** TWO SYNTHETIC WINNERS, each on its own subject, each with the same shape a real winning page has: a navigation rail, a heading run, prose that answers the search, a subheading and a footer. */
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/harbour-seals", nav: "Home Shop Newsletter", h2: "Where they haul out",
    h3: "Best months to look", body: "Harbour seals haul out on the sand bars below the point at low tide, and the colony is largest between June and August.",
    foot: "Copyright the harbour trust", rail: "Newsletter", schema: "Article" },
  { t: "tenant-two", url: "https://beta.example/telares", nav: "Inicio Tienda Boletin", h2: "Como se monta la urdimbre",
    h3: "Cuantos hilos por centimetro", body: "La urdimbre se monta con doce hilos por centimetro y se tensa antes de pasar la primera trama del telar.",
    foot: "Derechos reservados del taller", rail: "Boletin", schema: "HowTo" },
];
const htmlOf = (s: (typeof SITES)[number], body = s.body): string => `<html><head><title>${s.h2}</title>
  <script type="application/ld+json">{"@type":"${s.schema}","name":"${s.h2}"}</script></head><body>
  <nav>${s.nav}</nav><header>${s.nav}</header>
  <main><h1>${s.h2}</h1><h2>${s.h2}</h2><p>${body}</p><h3>${s.h3}</h3><p>${body}</p></main>
  <aside>${s.nav}</aside><footer><h2>${s.rail}</h2>${s.foot}</footer></body></html>`;

describe("what one read of a winning page carries", () => {
  for (const s of SITES) {
    it(`${s.t}: the fresh read keeps the page's own main content, its subheadings and its schema types, and leaves the furniture out`, () => {
      const x = pageExtractFrom(extractPageSnapshot(htmlOf(s), s.url, "p1", s.t));
      expect([x.mainText?.includes(s.body), x.mainText?.includes(s.nav), x.mainText?.includes(s.foot), x.mainText?.includes(s.rail), x.h3s, x.schemaTypes, x.truncated],
        "the words a reader gets are held, the navigation rail, the footer and a heading standing inside the footer are not, and an uncut capture says so").toEqual([true, false, false, false, [s.h3], [s.schema], false]);
      /* AND THE HEADING LIST IS HONEST ABOUT WHERE IT COMES FROM (reviewer, 2026-09-05): the crawler builds it off the WHOLE document, so a heading a site repeats in its footer IS banked, and this test only ever measured the main text. What refuses that label as a subject is the one navigation-label definition, asked at the comparison (tests/evidence/comparison-furniture.test.ts) rather than here. */
      expect(x.headings.includes(s.rail), "a heading standing in the footer is still banked, so the comparison is where it has to be refused").toBe(true);
      expect([x.heldChars === (x.mainText ?? "").length, x.totalChars === x.heldChars], "what was kept and what there was are the same number on a page that fits").toEqual([true, true]);
    });

    it(`${s.t}: a stored read comes back whole and a row banked before the reading existed reads as absence, never as a page with no words`, () => {
      const fresh = pageExtractFrom(extractPageSnapshot(htmlOf(s), s.url, "p1", s.t));
      const back = pageExtractFromRecord(JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>);
      expect([back.mainText, back.h3s, back.schemaTypes, back.truncated, back.heldChars, back.totalChars],
        "every field the read banked is the field the next pass reads").toEqual([fresh.mainText, fresh.h3s, fresh.schemaTypes, fresh.truncated, fresh.heldChars, fresh.totalChars]);
      const legacy = pageExtractFromRecord({ title: s.h2, h1: s.h2, wordCount: 900, headings: [s.h2], faqCount: 0, openingSample: s.body });
      expect([legacy.mainText, legacy.truncated, legacy.heldChars, legacy.totalChars, legacy.openingSample === s.body],
        "a row from before the reading says nothing was captured, which is not the claim that the page carries nothing").toEqual([null, null, null, null, true]);
    });

    it(`${s.t}: a page longer than one comparison reads is held to the ceiling and says how much of it stands behind the read`, () => {
      const long = `${s.body} `.repeat(400), x = pageExtractFrom(extractPageSnapshot(htmlOf(s, long), s.url, "p1", s.t));
      expect([x.truncated, x.heldChars, (x.totalChars ?? 0) > MAIN_TEXT_CEILING, (x.mainText ?? "").length],
        "the cut is recorded with both counts, so everything past it is unknown rather than absent").toEqual([true, MAIN_TEXT_CEILING, true, MAIN_TEXT_CEILING]);
      expect(mainOf(x.mainText, x.totalChars ?? 0).totalChars, "re-holding a capture at the same ceiling never understates the page it came from").toBe(x.totalChars);
    });

    it(`${s.t}: the paid read hands back the page's own main content, and a parse with no words is a gap rather than a body`, () => {
      const envelope = { tasks: [{ result: [{ items: [{ page_content: { main_topic: [{ main_title: s.h2, h_title: s.h2, primary_content: [{ text: s.body }] }],
        secondary_topic: [{ h_title: s.h3, primary_content: [{ text: s.body }] }] } }] }] }] };
      const got = parseCapability("onpage_content_parsing", envelope as never);
      expect([got?.mainText?.includes(s.body), got?.headings, (got?.wordCount ?? 0) > 0], "the provider's main and secondary topics are the reading, and its headings ride with it").toEqual([true, [s.h2, s.h3], true]);
      const empty = parseCapability("onpage_content_parsing", { tasks: [{ result: [{ items: [{ page_content: {} }] }] }] } as never);
      expect([empty?.mainText, empty?.wordCount, empty?.truncated], "a read that came back with no words carries none, so nothing downstream can mistake it for a page that answers").toEqual([null, 0, false]);
    });
  }
});
