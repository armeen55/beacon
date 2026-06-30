import { describe, it, expect } from "vitest";

import { proposeSafeInternalLink, buildLinkDestinations, distinctiveAlias, toLinkPath, type LinkDestination } from "./safe-internal-link";

const dest = (over: Partial<LinkDestination> & { path: string; alias: string }): LinkDestination => ({
  canonicalUrl: `https://www.iranopedia.com${over.path}`, label: over.path.split("/").filter(Boolean).at(-1)!.replace(/-/g, " "),
  family: over.path.split("/").filter(Boolean)[0]!, eligible: true, ...over,
});

describe("toLinkPath — canonical normalization", () => {
  it("normalizes host / www / trailing slash / query / case", () => {
    expect(toLinkPath("https://www.iranopedia.com/persian-rugs/kerman-rug/")).toBe("/persian-rugs/kerman-rug");
    expect(toLinkPath("/persian-rugs/Kerman-Rug?utm=x#h")).toBe("/persian-rugs/kerman-rug");
    expect(toLinkPath("https://iranopedia.com/tehran")).toBe("/tehran");
  });
});

describe("distinctiveAlias", () => {
  it("accepts a distinctive 2-4 word entity, rejects generic / CTA / single tokens", () => {
    expect(distinctiveAlias("Kerman Rug", "kerman-rug")).toBe("Kerman Rug");
    expect(distinctiveAlias("San Diego", "san-diego")).toBe("San Diego");
    expect(distinctiveAlias("Discover Iran", "discover-iran")).toBeNull(); // CTA lead
    expect(distinctiveAlias("Iran Flag", "iran-flag")).toBeNull(); // both tokens generic
    expect(distinctiveAlias("Iran", "iran")).toBeNull(); // single + generic
    expect(distinctiveAlias("Persian Rugs", "persian-rugs")).toBeNull(); // generic-only
  });

  it("rejects site-chrome H1s (adversarial: 'Related Articles', 'Featured Items', 'Main Content')", () => {
    expect(distinctiveAlias("Related Articles", "related-articles")).toBeNull();
    expect(distinctiveAlias("Featured Items", "featured-items")).toBeNull();
    expect(distinctiveAlias("Main Content", "main-content")).toBeNull();
    expect(distinctiveAlias("Additional Resources", "additional-resources")).toBeNull();
    expect(distinctiveAlias("More Information", "more-information")).toBeNull();
  });
});

describe("proposeSafeInternalLink — exact, safe, non-duplicative", () => {
  const dests = [
    dest({ path: "/persian-kabobs/joojeh-kabob", alias: "Joojeh Kabob", family: "persian-kabobs" }),
    dest({ path: "/california-persian-cities/san-diego", alias: "San Diego", family: "california-persian-cities" }),
  ];

  it("wraps the exact phrase in its exact sentence; everything else byte-identical", () => {
    const r = proposeSafeInternalLink({
      sourcePath: "/kabob-dishes",
      sourceParagraphs: ["Popular Persian kabobs include koobideh, barg kabob, and flavorful Joojeh Kabob, each bursting with unique flavor."],
      sourceLinkedPaths: new Set(),
      destinations: dests,
    });
    expect(r).toBeTruthy();
    expect(r!.destinationPath).toBe("/persian-kabobs/joojeh-kabob");
    expect(r!.anchorText).toBe("Joojeh Kabob");
    expect(r!.exactReplacementText).toBe('Popular Persian kabobs include koobideh, barg kabob, and flavorful <a href="https://www.iranopedia.com/persian-kabobs/joojeh-kabob">Joojeh Kabob</a>, each bursting with unique flavor.');
    // The only difference between current and replacement is the <a> wrapper.
    expect(r!.exactReplacementText.replace(/<\/?a[^>]*>/g, "")).toBe(r!.exactSourceText);
    expect(r!.relationship).toBe("contextual_related");
  });

  it("preserves the source's own casing of the matched phrase", () => {
    const r = proposeSafeInternalLink({
      sourcePath: "/cuisine", sourceParagraphs: ["Try favorites such as Koobideh and joojeh kabob, prepared fresh daily here."],
      sourceLinkedPaths: new Set(), destinations: dests,
    });
    expect(r!.anchorText).toBe("joojeh kabob"); // lowercase as written
  });

  it("returns null when the source already links the destination (canonical-equivalent)", () => {
    expect(proposeSafeInternalLink({
      sourcePath: "/kabob-dishes",
      sourceParagraphs: ["We love Joojeh Kabob around here, the best kabob of them all served hot."],
      sourceLinkedPaths: new Set(["/persian-kabobs/joojeh-kabob"]),
      destinations: dests,
    })).toBeNull();
  });

  it("never links a page to itself", () => {
    expect(proposeSafeInternalLink({
      sourcePath: "/persian-kabobs/joojeh-kabob",
      sourceParagraphs: ["Joojeh Kabob is a grilled chicken skewer marinated in saffron and lemon for hours."],
      sourceLinkedPaths: new Set(), destinations: dests,
    })).toBeNull();
  });

  it("does not fire on a generic token (no 'flag'/'iran'-only links)", () => {
    expect(proposeSafeInternalLink({
      sourcePath: "/some-page",
      sourceParagraphs: ["The flag of Iran has changed many times throughout its long and storied history."],
      sourceLinkedPaths: new Set(),
      destinations: [dest({ path: "/iran-flags/pahlavi-iran-flag", alias: "Iran Flag" })], // generic alias never built, but guard anyway
    })).toBeNull();
  });

  it("never proposes an INELIGIBLE (protected) destination", () => {
    expect(proposeSafeInternalLink({
      sourcePath: "/some-cat-fan-page",
      sourceParagraphs: ["The Persian Cat is a beloved long-haired breed admired across the country today."],
      sourceLinkedPaths: new Set(),
      destinations: [dest({ path: "/iran-animals/persian-cat", alias: "Persian Cat", family: "iran-animals", eligible: false, ineligibleReason: "active_control" })],
    })).toBeNull();
  });

  it("preserves trailing punctuation exactly (round-trip: replacement minus <a> === source)", () => {
    const d = [dest({ path: "/iran-animals-x/persian-wolf", alias: "Persian Wolf", family: "iran-animals-x" })];
    const r = proposeSafeInternalLink({
      sourcePath: "/wildlife", sourceParagraphs: ["Something rare: the Persian Wolf! It roams the north."],
      sourceLinkedPaths: new Set(), destinations: d,
    });
    expect(r).toBeTruthy();
    expect(r!.exactReplacementText.replace(/<\/?a[^>]*>/g, "")).toBe(r!.exactSourceText);
    expect(r!.exactSourceText.endsWith("!")).toBe(true);
    expect(r!.exactReplacementText.endsWith("!")).toBe(true); // trailing boundary char NOT dropped
  });

  it("wraps ONLY the first occurrence when the phrase appears twice", () => {
    const d = [dest({ path: "/persian-kabobs/joojeh-kabob", alias: "Joojeh Kabob", family: "persian-kabobs" })];
    const r = proposeSafeInternalLink({
      sourcePath: "/menu", sourceParagraphs: ["We serve Joojeh Kabob; yes, Joojeh Kabob is our specialty here."],
      sourceLinkedPaths: new Set(), destinations: d,
    });
    expect((r!.exactReplacementText.match(/<a /g) ?? []).length).toBe(1);
  });

  it("blocks a canonical-EQUIVALENT existing link (www/trailing-slash/case variant)", () => {
    const d = [dest({ path: "/persian-kabobs/joojeh-kabob", canonicalUrl: "https://www.iranopedia.com/Persian-Kabobs/Joojeh-Kabob/", alias: "Joojeh Kabob", family: "persian-kabobs" })];
    // source already links a differently-cased / trailing-slash variant → normalized match → blocked
    const r = proposeSafeInternalLink({
      sourcePath: "/menu", sourceParagraphs: ["Try our famous Joojeh Kabob today, grilled to perfection over charcoal."],
      sourceLinkedPaths: new Set([toLinkPath("https://iranopedia.com/persian-kabobs/joojeh-kabob")]),
      destinations: d,
    });
    expect(r).toBeNull();
  });

  it("emits no proposal when the phrase is absent (no fabrication, no placement guess)", () => {
    expect(proposeSafeInternalLink({
      sourcePath: "/kabob-dishes",
      sourceParagraphs: ["This page is about rice dishes and stews only, nothing grilled on a skewer here."],
      sourceLinkedPaths: new Set(), destinations: dests,
    })).toBeNull();
  });

  it("intent-fit gate: REJECTS an off-topic cross-family link (doodool t-shirt → Persian jewelry)", () => {
    const r = proposeSafeInternalLink({
      sourcePath: "/product-page/persian-farsi-iranian-jokes-doodool-tala-t-shirt",
      sourceParagraphs: ["Our Persian jewelry is made from hypoallergenic stainless steel that's waterproof and tarnish-resistant."],
      sourceLinkedPaths: new Set(),
      destinations: [dest({ path: "/category/persian-jewelry-iran-necklaces-and-chains", alias: "Persian Jewelry", family: "category" })],
      sourceQuery: "doodool tala", sourceLabel: "doodool tala t shirt",
    });
    expect(r).toBeNull();
  });

  it("intent-fit gate: ALLOWS a cross-family link that shares a distinctive token with the page", () => {
    const r = proposeSafeInternalLink({
      sourcePath: "/jewelry-care-guide",
      sourceParagraphs: ["Caring for your Persian Jewelry keeps the stainless steel bright for years of daily wear."],
      sourceLinkedPaths: new Set(),
      destinations: [dest({ path: "/category/persian-jewelry-iran-necklaces-and-chains", alias: "Persian Jewelry", family: "category" })],
      sourceQuery: "persian jewelry care", sourceLabel: "jewelry care guide",
    });
    expect(r).toBeTruthy();
    expect(r!.destinationPath).toBe("/category/persian-jewelry-iran-necklaces-and-chains");
  });

  it("intent-fit gate: ALLOWS a same-family link even without token overlap", () => {
    const r = proposeSafeInternalLink({
      sourcePath: "/iran-flags/umayyad-caliphate-flag",
      sourceParagraphs: ["The era is often compared with the later Abbasid Caliphate Flag in design and symbolism."],
      sourceLinkedPaths: new Set(),
      destinations: [dest({ path: "/iran-flags/abbasid-caliphate-flag", alias: "Abbasid Caliphate Flag", family: "iran-flags" })],
      sourceQuery: "umayyad caliphate flag", sourceLabel: "umayyad caliphate flag",
    });
    expect(r).toBeTruthy();
  });

  it("classifies same-family hub→child and child→hub relationships", () => {
    const d = [dest({ path: "/persian-rugs/kerman-rug", alias: "Kerman Rug", family: "persian-rugs" })];
    const hubToChild = proposeSafeInternalLink({ sourcePath: "/persian-rugs", sourceParagraphs: ["Regional styles include the famous Kerman Rug among many other beautiful weaves."], sourceLinkedPaths: new Set(), destinations: d });
    expect(hubToChild!.relationship).toBe("hub_to_child");
    const childToHub = proposeSafeInternalLink({ sourcePath: "/persian-rugs/kerman-rug/detail", sourceParagraphs: ["See more about the Kerman Rug style and its regional cousins on our site."], sourceLinkedPaths: new Set(), destinations: d });
    expect(childToHub!.relationship).toBe("child_to_hub");
  });
});

describe("buildLinkDestinations", () => {
  it("builds eligible destinations + marks protected ones ineligible", () => {
    const snaps = [
      { url: "https://www.iranopedia.com/persian-rugs/kerman-rug", canonical_url: "https://www.iranopedia.com/persian-rugs/kerman-rug", h1: "Kerman Rug" },
      { url: "https://www.iranopedia.com/iran-animals/persian-wolf", canonical_url: "https://www.iranopedia.com/iran-animals/persian-wolf", h1: "Persian Wolf" },
      { url: "https://www.iranopedia.com/home", canonical_url: "https://www.iranopedia.com/", h1: "Home" }, // root → skipped
    ];
    const reg = buildLinkDestinations(snaps, (p) => (/\/iran-animals\//.test(p) ? "active_animal" : null));
    const kerman = reg.find((d) => d.path === "/persian-rugs/kerman-rug");
    const wolf = reg.find((d) => d.path === "/iran-animals/persian-wolf");
    expect(kerman?.eligible).toBe(true);
    expect(wolf?.eligible).toBe(false);
    expect(wolf?.ineligibleReason).toBe("active_animal");
    expect(reg.some((d) => d.path === "/")).toBe(false);
  });
});
