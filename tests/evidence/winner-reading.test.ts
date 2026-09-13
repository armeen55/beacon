/** A WINNER READ IS A READING, NOT A FINGERPRINT (campaign, 2026-09-05). Every page that wins one of this account's searches was fetched, parsed and banked as 20 headings, 12 entity names and 600 characters of opening, so the only comparison the writer ever saw could ask whether two labels matched and never what a winning page ANSWERS. The extract now carries the page's own main content with the furniture removed, what was kept of it and what there was, its subheadings and its structured-data types; a cut capture is unknown beyond the cut and never absent. TWO SYNTHETIC ACCOUNTS, neither a real customer and neither on the same subject. */
import { describe, it, expect } from "vitest";
import { mainOf, pageExtractFrom, pageExtractFromRecord } from "@/domains/evidence/funnel/research-evidence";
/** The comparison ceiling, read off the one function that applies it rather than a second copy of the number. */
const MAIN_TEXT_CEILING = mainOf("word ".repeat(20_000)).heldChars!;
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import { parseCapability } from "@/domains/evidence/dataforseo/capabilities";
import { jobEvidenceHash } from "@/domains/evidence/snapshot";

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
    it(`${s.t}: fresh and stored bodies retain content, scope and honest legacy absence`, () => {
      const fresh = pageExtractFrom(extractPageSnapshot(htmlOf(s), s.url, "p1", s.t));
      expect([fresh.mainText?.includes(s.body), fresh.mainText?.includes(s.nav), fresh.mainText?.includes(s.foot), fresh.mainText?.includes(s.rail), fresh.h3s, fresh.schemaTypes, fresh.truncated]).toEqual([true, false, false, false, [s.h3], [s.schema], false]);
      expect(fresh.headings.includes(s.rail)).toBe(true); // labels remain banked; main-content comparison qualifies them
      expect([fresh.heldChars === (fresh.mainText ?? "").length, fresh.totalChars === fresh.heldChars]).toEqual([true, true]);
      const back = pageExtractFromRecord(JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>);
      expect([back.mainText, back.h3s, back.schemaTypes, back.truncated, back.heldChars, back.totalChars],
        "every field the read banked is the field the next pass reads").toEqual([fresh.mainText, fresh.h3s, fresh.schemaTypes, fresh.truncated, fresh.heldChars, fresh.totalChars]);
      const legacy = pageExtractFromRecord({ title: s.h2, h1: s.h2, wordCount: 900, headings: [s.h2], faqCount: 0, openingSample: s.body });
      expect([legacy.mainText, legacy.truncated, legacy.heldChars, legacy.totalChars, legacy.openingSample === s.body, legacy.entityNames],
        "a row from before the reading says nothing was captured, which is not the claim that the page carries nothing, and a row that banked no entity list hands back no list rather than an empty one").toEqual([null, null, null, null, true, undefined]);
      const long = `${s.body} `.repeat(400), x = pageExtractFrom(extractPageSnapshot(htmlOf(s, long), s.url, "p1", s.t));
      expect([x.truncated, x.heldChars, (x.totalChars ?? 0) > MAIN_TEXT_CEILING, (x.mainText ?? "").length],
        "the cut is recorded with both counts, so everything past it is unknown rather than absent").toEqual([true, MAIN_TEXT_CEILING, true, MAIN_TEXT_CEILING]);
      expect(mainOf(x.mainText, x.totalChars ?? 0).totalChars, "re-holding a capture at the same ceiling never understates the page it came from").toBe(x.totalChars);
    });

    it(`${s.t}: cached provider sections retain their words and move exact-query job identity, never inventing unreported fields`, () => {
      const envelope = { tasks: [{ result: [{ items: [{ page_content: { main_topic: [{ main_title: s.h2, h_title: s.h2, primary_content: [{ text: s.body }], table_content: [{ table_content: [["one", "two"]] }] }],
        secondary_topic: [{ h_title: s.h3, primary_content: [{ text: s.body }] }] } }] }] }] };
      const got = parseCapability("onpage_content_parsing", envelope as never)!;
      expect([got?.mainText?.includes(s.body), got?.headings, (got?.wordCount ?? 0) > 0], "the provider's main and secondary topics are the reading, and its headings ride with it").toEqual([true, [s.h2, s.h3], true]);
      const back = pageExtractFromRecord(JSON.parse(JSON.stringify(got))); expect([back.sections, back.h3s, back.schemaTypes]).toEqual([got.sections, undefined, undefined]);
      const key = (extract: object) => jobEvidenceHash({ ownedPages: [], research: { serpEvidence: [{ query: s.h2, organic: [{ rank: 1, url: s.url }], aiOverview: [], aiMode: [] }], winningPages: [{ url: s.url, appearances: [], extract }] } } as never, [], s.h2);
      expect(key(back)).toBe(key(got)); expect(key({ ...back, mainText: `${back.mainText} Changed evidence.` })).not.toBe(key(back)); expect(key({ ...back, fetchedAt: "2099-01-01" })).toBe(key(back));
      expect([got.hasTable, got.faqCount, got.metaDescription, got.entityNames, got.hasList, got.internalLinkCount, got.externalLinkCount]).toEqual([true, undefined, undefined, undefined, undefined, undefined, undefined]);
      const empty = parseCapability("onpage_content_parsing", { tasks: [{ result: [{ items: [{ page_content: {} }] }] }] } as never);
      expect([empty?.mainText, empty?.wordCount, empty?.truncated], "a read that came back with no words carries none, so nothing downstream can mistake it for a page that answers").toEqual([null, 0, false]);
    });
  }
});
