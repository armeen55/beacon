import { describe, it, expect } from "vitest";

import { proposeSafeMeta, metaIsWeak } from "./safe-meta";

describe("metaIsWeak", () => {
  it("flags missing / too-short / filler-led / no-query metas", () => {
    expect(metaIsWeak(null, "umayyad caliphate flag")).toBe(true);
    expect(metaIsWeak("short", "umayyad caliphate flag")).toBe(true);
    expect(metaIsWeak("Learn about the History of Iran Flags and the Umayyad Caliphate Flag. Discover its symbolism.", "umayyad caliphate flag")).toBe(true); // filler lead
    expect(metaIsWeak("A page about rugs and carpets from the region with lots of detail here.", "kerman rug")).toBe(true); // no query
  });
  it("leaves a strong bespoke query-carrying meta alone", () => {
    expect(metaIsWeak("The Umayyad Caliphate flag (661–750) was a plain white banner; here is its symbolism and history.", "umayyad caliphate flag")).toBe(false);
  });
});

describe("proposeSafeMeta — factual, from the page's own opening paragraph", () => {
  it("derives a meta from the opening paragraph when the current meta is templated", () => {
    const r = proposeSafeMeta({
      currentMeta: "Learn about the History of Iran Flags and the Umayyad Caliphate Flag (661–750). Discover its symbolism, role in Persian History, its changes, and its origins.",
      openingParagraph: "The Umayyad Caliphate flag was a solid white banner used from 661 to 750 CE, symbolizing the first hereditary Islamic dynasty that ruled over Persia after the Rashidun era.",
      query: "umayyad caliphate flag",
    });
    expect(r).toBeTruthy();
    expect(r!.proposed.toLowerCase()).toContain("umayyad");
    expect(r!.proposed.length).toBeLessThanOrEqual(160);
    expect(r!.proposed.length).toBeGreaterThanOrEqual(80);
    expect(r!.proposed.startsWith("Learn about")).toBe(false); // not the template
    expect(r!.source).toBe("page_opening_paragraph");
  });

  it("returns null when the current meta is already strong", () => {
    expect(proposeSafeMeta({
      currentMeta: "The Kerman rug is a hand-knotted Persian carpet from Kerman province, prized for floral medallion designs and fine wool — its history and styles explained.",
      openingParagraph: "The Kerman rug is a hand-knotted Persian carpet from Kerman province in southeast Iran.",
      query: "kerman rug",
    })).toBeNull();
  });

  it("returns null (no fabrication) when the opening paragraph does NOT address the query", () => {
    expect(proposeSafeMeta({
      currentMeta: "Learn about this page.",
      openingParagraph: "This article covers a variety of topics about the region, its people, and assorted cultural notes for visitors.",
      query: "kerman rug",
    })).toBeNull();
  });

  it("returns null when there is no usable opening paragraph", () => {
    expect(proposeSafeMeta({ currentMeta: null, openingParagraph: "", query: "kerman rug" })).toBeNull();
    expect(proposeSafeMeta({ currentMeta: null, openingParagraph: "Too short.", query: "kerman rug" })).toBeNull();
  });

  it("returns null when the opening paragraph is itself boilerplate", () => {
    expect(proposeSafeMeta({
      currentMeta: null,
      openingParagraph: "Learn about the kerman rug and discover everything you need to know about kerman rug here on our site today.",
      query: "kerman rug",
    })).toBeNull();
  });

  it("treats the real Iranopedia rug template ('Learn all about… The complete guide…') as weak and replaces it from the body", () => {
    const r = proposeSafeMeta({
      currentMeta: "Learn all about the Khorasan Rug , where its from, design, history, and patterns. The complete guide to Persian Rugs!",
      openingParagraph: "A Khorasan rug is a luxurious Persian carpet originating from Khorasan, a historically significant weaving region in northeastern Iran, prized for its dense knotting.",
      query: "khorasan rug",
    });
    expect(r).toBeTruthy();
    expect(r!.proposed.toLowerCase()).toContain("khorasan");
    expect(/^learn all about/i.test(r!.proposed)).toBe(false);
  });

  it("flags 'complete guide'-led and 'your guide'-led metas as weak (named filler)", () => {
    expect(metaIsWeak("The complete guide to kerman rug history and styles for collectors today.", "kerman rug")).toBe(true);
    expect(metaIsWeak("Your guide to the kerman rug and its origins, designs, and weaving regions today.", "kerman rug")).toBe(true);
  });

  it("trims long openings to a clean sentence/word boundary within 160 chars", () => {
    const long = "The Caspian red deer, also called the maral, is a large subspecies of red deer native to the forests south of the Caspian Sea in Iran, where it is a protected species today and a symbol of the region's wildlife heritage.";
    const r = proposeSafeMeta({ currentMeta: "Learn about the caspian red deer here.", openingParagraph: long, query: "caspian red deer" });
    expect(r).toBeTruthy();
    expect(r!.proposed.length).toBeLessThanOrEqual(160);
    expect(/[.!?]$|[a-z]$/i.test(r!.proposed)).toBe(true); // ends cleanly, no mid-word cut artifacts
  });
});
