import { describe, expect, it } from "vitest";
import { deliverableFailures, staleCopyReasons } from "@/domains/decision/drafted-copy";
import { topicTokens } from "@/domains/evidence/relevance-gate";

const run = (BODY: string, copy: string, kind: "meta" | "section" = "meta") => {
  const P = { targetUrl: "https://www.iranopedia.com/persian-rugs", title: "Persian Rugs | Iranopedia", h1: "Persian Rugs",
    metaDescription: null, bodyText: BODY, headings: [], trackedQuestion: "persian rugs", ownedPaths: ["/persian-rugs"],
    demand: { preserve: [], vocabulary: [] }, bannedTerms: [], evidence: { "page-copy-1": BODY } };
  return deliverableFailures({ actionType: kind, targetUrl: P.targetUrl, placementAnchor: "the page's description field",
    beforeText: null, naturalHeading: null, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1,
    measurementTarget: "clicks", claims: [{ text: "a claim about rugs", supportedBy: ["page-copy-1"] }], supportFacts: [],
    finalCopy: copy } as never, P as never);
};

describe("ADVERSARIAL", () => {
  it("A: topicTokens dedupes, so seq is not a sequence", () => {
    console.log("tokens:", topicTokens("Persian rugs are woven in Tabriz. The collection features silk rugs and wool rugs."));
  });

  it("B: recombined fires on a phrase the page literally prints", () => {
    const BODY = "Persian rugs are hand knotted in Tabriz and Kashan over many months. The collection features silk rugs, wool rugs and hand woven kilims from every weaving region of Iran.";
    const copy = "Iranopedia covers Persian rugs, silk rugs, wool rugs and kilims woven in Tabriz.";
    console.log("B failures:", run(BODY, copy));
    console.log("B literal check: body contains 'silk rugs' =", BODY.includes("silk rugs"), "| 'wool rugs' =", BODY.includes("wool rugs"));
  });

  it("C: an ordinary Persian list of synonyms/plurals against the stuffing gate", () => {
    const BODY = "Persian rugs, carpets and textiles from Iran, including kilims, gabbehs and jajims woven across the country.";
    const copy = "This page covers Persian rugs, Persian carpets, and Persian textiles from Iran.";
    console.log("C failures:", run(BODY, copy));
    const copy2 = "The page covers popular Persian names, common Persian names, and unique Persian names for a new baby.";
    console.log("C2 failures:", run(BODY, copy2));
  });

  it("D: the 'modern designs' recombination is invisible to the banked re-read", () => {
    const BODY = "Persian AccessoriesShowcase your heritage with our Persian accessories, featuring timeless designs inspired by Iranian culture and craftsmanship. From stylish Iranian hats to intricately patterned Persian phone cases, each piece blends tradition with modern fashion.";
    const copy = "Persian Accessories - showcases heritage-inspired hats, intricately patterned phone cases and modern designs; page lists these accessory types.";
    console.log("D fresh-draft failures:", run(BODY, copy));
    const row = {
      id: "t::/category/persian-accessories::existing_edit::meta", tenantId: "t", pagePath: "/category/persian-accessories",
      pageUrl: "https://www.iranopedia.com/category/persian-accessories", status: "needs_review", researchOnly: false,
      recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: copy },
      claims: [{ text: "The page showcases heritage-inspired hats and phone cases", supportedBy: ["card-1"] }],
      supportFacts: [{ id: "card-1", fact: BODY }],
      limitations: ["it tells a reader this page offers \"modern designs\", and this page never puts those words together"],
      primaryQuery: "persian accessories", evidence: { query: "persian accessories", hints: [], evidenceRefCount: 1 },
    };
    console.log("D banked re-read:", staleCopyReasons(row as never, new Map(), [], { title: "Persian Accessories", h1: "Persian Accessories", metaDescription: null, outline: [] }, false, []));
  });

  it("E: a banked row with no claims/facts is exempt from every rule", () => {
    const row = {
      id: "t::/x::existing_edit::meta", tenantId: "t", pagePath: "/x", pageUrl: "https://www.iranopedia.com/x",
      status: "needs_review", researchOnly: false,
      recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "People also search persian female names. Buy now!!! http://spam.example" },
      claims: [], supportFacts: [], limitations: ["it prints the name of a results-page feature, which belongs to the research and never to the page"],
      primaryQuery: "q", evidence: { query: "q", hints: [], evidenceRefCount: 0 },
    };
    console.log("E banked re-read:", staleCopyReasons(row as never, new Map(), [], null, false, []));
  });
});
