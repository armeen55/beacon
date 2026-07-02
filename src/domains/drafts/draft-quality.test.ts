import { describe, it, expect } from "vitest";
import {
  evaluateDraftQuality,
  evaluateTitleMetaQuality,
  evaluateCreatePageBriefQuality,
  evaluatePreparedPackQuality,
  evaluateInternalLinkQuality,
  evaluateCROFixQuality,
  evaluateSectionDraftQuality,
} from "./draft-quality";

// Cases are pinned to the REAL Iranopedia draft audit (scripts/wf-draft-quality.js)
// plus the adversarial false-rejection findings.

describe("evaluateDraftQuality — answer blocks", () => {
  it("REJECTS a generic dictionary opening with no context (ab-1: gifts)", () => {
    const r = evaluateDraftQuality({
      answer:
        "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation. Gifts can be tangible or intangible and are exchanged in social, cultural, ceremonial, or commercial contexts. Legal, tax, and ethical considerations can affect gift giving.",
    });
    expect(r.status).toBe("generic_rejected");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
  });

  it("PASSES a contextual definitional opener (ab-2: Nowruz USA)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year. These activities include Haft-Seen displays, traditional Persian music and dance performances, food festivals, and community gatherings hosted by Iranian-American organizations.",
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("PASSES a contextual 'A Persian wedding is…' opener (ab-3)", () => {
    const r = evaluateDraftQuality({
      answer:
        "A Persian wedding is the traditional marriage ceremony of Persian-speaking cultures, primarily Iran, combining legal, religious and cultural elements. Key features often include the sofreh-aghd wedding spread, poetry readings, and the exchange of vows witnessed by family and friends.",
    });
    expect(r.status).toBe("ready");
  });

  it("REJECTS a punt non-answer as too_thin (ab-5: most-followed Instagram)", () => {
    const r = evaluateDraftQuality({
      answer:
        "The most-followed Iranian on Instagram changes over time; follower counts and rankings vary. For an accurate answer, check the individual profiles or consult up-to-date social-media analytics sites.",
    });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
  });

  it("REJECTS a meta non-answer that talks about the page (rec-5/rec-12)", () => {
    const r = evaluateDraftQuality({
      answer:
        "The Iranopedia page summarizes reported designs, colors, and symbolic elements attributed to those banners. The team has documented this topic and cites wrmea.org as a source; consult that citation for details on Persian Empire flags and their history over time.",
    });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
  });

  it("FLAGS (not rejects) a specific unsourced factual claim as needs-review (ab-9: national animal)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau. Conservation programs work to protect the small remaining population across protected reserves and national parks in Iran.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
  });

  it("does NOT reject a hedged forward-looking claim (adversarial: 2026 jersey)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's 2026 World Cup jersey has not been officially announced. Past Iran kits have featured the national colors and the federation crest; fans should confirm the final design with Iran's football federation once it is released ahead of the tournament.",
      evidenceRefs: 0,
    });
    // hedge ("has not been officially announced") exempts the 'official'/2026 tokens.
    expect(["ready", "useful_but_needs_review"]).toContain(r.status);
    expect(r.copyAllowed).toBe(true);
  });

  it("does NOT reject a descriptive 'official flag' answer (adversarial: bare-official over-match)", () => {
    const r = evaluateDraftQuality({
      answer:
        "The Lion and Sun was used on official Iranian state flags for much of the modern era, drawing on ancient Persian and Near Eastern symbolism. Its official state symbolism evolved through the Safavid, Qajar, and Pahlavi periods before later changes.",
      evidenceRefs: 1,
    });
    // evidenceRefs>=1 + descriptive 'official' must NOT hard-reject.
    expect(r.copyAllowed).toBe(true);
    expect(["ready", "useful_but_needs_review"]).toContain(r.status);
  });

  it("rejects an empty answer as malformed", () => {
    expect(evaluateDraftQuality({ answer: "" }).status).toBe("malformed");
    expect(evaluateDraftQuality({ answer: null }).status).toBe("malformed");
  });
});

describe("evaluateDraftQuality - quotability (BEACON 500 item 78, additive)", () => {
  // Pin: every pre-existing "ready" fixture from the real Iranopedia draft audit
  // must stay ready now that the quotability check runs. None of them fail
  // pronoun_opener or the self-contained length band, so this is a pure pin.
  it("PIN: does not flip ab-2 (Nowruz USA) off ready", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year. These activities include Haft-Seen displays, traditional Persian music and dance performances, food festivals, and community gatherings hosted by Iranian-American organizations.",
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("PIN: does not flip ab-3 (Persian wedding) off ready", () => {
    const r = evaluateDraftQuality({
      answer:
        "A Persian wedding is the traditional marriage ceremony of Persian-speaking cultures, primarily Iran, combining legal, religious and cultural elements. Key features often include the sofreh-aghd wedding spread, poetry readings, and the exchange of vows witnessed by family and friends.",
    });
    expect(r.status).toBe("ready");
  });

  it("PIN: does not flip the cheetah needs-review fixture", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau. Conservation programs work to protect the small remaining population across protected reserves and national parks in Iran.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
  });

  it("PIN: does not flip the Lion and Sun needs-review/ready fixture", () => {
    const r = evaluateDraftQuality({
      answer:
        "The Lion and Sun was used on official Iranian state flags for much of the modern era, drawing on ancient Persian and Near Eastern symbolism. Its official state symbolism evolved through the Safavid, Qajar, and Pahlavi periods before later changes.",
      evidenceRefs: 1,
    });
    expect(r.copyAllowed).toBe(true);
    expect(["ready", "useful_but_needs_review"]).toContain(r.status);
  });

  it("NEW: rejects a well-formed, on-topic, sourced draft that opens with a pronoun", () => {
    const r = evaluateDraftQuality({
      answer:
        "It is a traditional Persian celebration held every year in the spring across Iran and neighboring countries, marked by family gatherings, music, and shared meals that continue for nearly two weeks each season.",
    });
    expect(r.status).toBe("not_quotable");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
    expect(r.reasons.some((x) => x.toLowerCase().includes("name the subject"))).toBe(true);
  });

  it("NEW: rejects a draft under the 30-word self-contained floor (above the existing 25-word hard floor)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz is the Persian new year celebrated across Iran and Afghanistan every March by many families who gather together for meals and music each spring season.",
    });
    // 26 words: clears the existing too_thin floor (<25) but misses the 30-70 self-contained band.
    expect(r.status).toBe("not_quotable");
    expect(r.copyAllowed).toBe(false);
  });

  it("does NOT reject a clean, on-topic draft with no number/date at all (matches the real corpus)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year. These activities include Haft-Seen displays and traditional Persian music performances hosted by Iranian-American community organizations nationwide.",
    });
    expect(r.status).toBe("ready");
  });
});

describe("evaluateDraftQuality - factual entailment (N8, additive/opt-in)", () => {
  // Pin: every pre-existing fixture above passes NO pageBodyText/evidenceText,
  // so the entailment check never runs for them - already proven by the fact
  // every earlier test in this file still passes unmodified. These new cases
  // only cover the opt-in path itself.

  it("does nothing when neither pageBodyText nor evidenceText is supplied (byte-identical to pre-N8)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau. Conservation programs work to protect the small remaining population across protected reserves and national parks in Iran.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("useful_but_needs_review");
  });

  it("PASSES a ready draft whose claims are all grounded in the page body", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year. These activities include Haft-Seen displays and traditional Persian music performances hosted by Iranian-American community organizations nationwide.",
      pageBodyText:
        "Nowruz Activities USA covers community and cultural events across the United States marking Nowruz, the Persian New Year, including Haft-Seen displays and traditional Persian music performances by Iranian-American community organizations.",
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("REJECTS an otherwise-ready draft with a number the page body does not support", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz has been celebrated in Iran for more than 3000 years, marking the arrival of spring with family gatherings, music, poetry readings, and shared meals across the region every March.",
      // evidenceRefs:1 clears the earlier unsourced-specific-fact check (step 6)
      // so this fixture actually reaches the entailment check (step 8) - a
      // "sourced" draft still has to match the REAL page body, not just claim
      // to be grounded.
      evidenceRefs: 1,
      pageBodyText:
        "Nowruz is the Persian new year, celebrated in Iran with family gatherings, music, poetry readings, and shared meals marking the arrival of spring every March.",
    });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
    expect(r.reasons[0]).toContain("3000");
    expect(r.reasons[0]).toContain("could not find that number");
  });

  it("PASSES the same 3000-year claim when the page body actually supports it", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz has been celebrated in Iran for more than 3000 years, marking the arrival of spring with family gatherings, music, poetry readings, and shared meals across the region every March.",
      evidenceRefs: 1,
      pageBodyText:
        "Nowruz is a 3000 year old Persian tradition celebrated in Iran, marking the arrival of spring every March with family gatherings, music, and poetry readings.",
    });
    expect(r.status).toBe("ready");
  });

  it("REJECTS an atomic title/meta rewrite that introduces an unsupported number", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian New Year Traditions",
      after: "Persian New Year: 3000 Years of Nowruz Traditions in Iran",
      field: "title",
      pageBodyText: "Nowruz is the Persian new year, celebrated across Iran every spring.",
    });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
  });

  it("PASSES an atomic title/meta rewrite whose claim is grounded", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian New Year Traditions",
      after: "Persian New Year: 3000 Years of Nowruz Traditions in Iran",
      field: "title",
      pageBodyText: "Nowruz is a 3000 year old Persian tradition celebrated across Iran every spring.",
    });
    expect(r.status).toBe("ready");
  });
});

describe("evaluateDraftQuality / evaluateTitleMetaQuality - operator correction (page is stale, dated evidence backs the draft)", () => {
  it("a draft that CONTRADICTS the page but is backed by a dated authoritative fact stays ready AND carries the correction", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iranopedia now lists 4500 Persian recipes in its growing collection, spanning regional dishes, holiday specialties, and everyday family meals from every corner of Iran and its many worldwide diaspora communities.",
      evidenceRefs: 1,
      pageBodyText:
        "Iranopedia lists 3000 Persian recipes in its growing collection, spanning regional dishes and everyday family meals across Iran.",
      authoritativeFacts: [
        { source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" },
      ],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
    expect(r.corrections).toBeDefined();
    expect(r.corrections!.some((c) => c.includes("4500") && c.includes("2026-07-01"))).toBe(true);
  });

  it("the SAME contradicting number with no authoritative fact stays unverified_claim (blocked)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iranopedia now lists 4500 Persian recipes in its growing collection, spanning regional dishes, holiday specialties, and everyday family meals from every corner of Iran and its many worldwide diaspora communities.",
      evidenceRefs: 1,
      pageBodyText:
        "Iranopedia lists 3000 Persian recipes in its growing collection, spanning regional dishes and everyday family meals across Iran.",
    });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
    expect(r.corrections).toBeUndefined();
  });

  it("a ready draft with no correction never carries the corrections field (undefined, not empty array)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year. These activities include Haft-Seen displays and traditional Persian music performances hosted by Iranian-American community organizations nationwide.",
      pageBodyText:
        "Nowruz Activities USA covers community and cultural events across the United States marking Nowruz, the Persian New Year, including Haft-Seen displays and traditional Persian music performances by Iranian-American community organizations.",
    });
    expect(r.status).toBe("ready");
    expect(r.corrections).toBeUndefined();
  });

  it("an atomic title/meta correction stays ready AND carries the correction line with source + date", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian New Year Traditions",
      after: "Persian New Year: 4500 Recipes and Nowruz Traditions in Iran",
      field: "title",
      pageBodyText: "Nowruz is the Persian new year, celebrated across Iran every spring with 3000 traditional recipes.",
      authoritativeFacts: [
        { source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" },
      ],
    });
    expect(r.status).toBe("ready");
    expect(r.corrections).toBeDefined();
    expect(r.corrections![0]).toContain("your site's recipe count (Wix connector)");
    expect(r.corrections![0]).toContain("2026-07-01");
  });
});

describe("evaluateTitleMetaQuality — atomic edits", () => {
  it("PASSES an entity-forward rewrite (rec-0: Persian Wolf)", () => {
    const r = evaluateTitleMetaQuality({
      before: "Meet the Persian Wolf (Iranian Wolf) | Iran Animals & Wildlife",
      after: "Persian Wolf (Iranian Wolf): Range, Behavior, Conservation",
      field: "title",
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("FLAGS a newly-introduced count as needs-review (rec-9: 150+ surnames)", () => {
    const r = evaluateTitleMetaQuality({
      before: "Popular Iranian First and Last Names with Meanings",
      after: "Persian Surnames: 150+ Last Names and Meanings",
      field: "title",
    });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
  });

  it("treats boilerplate REMOVAL as an improvement, not a flag (rec-19)", () => {
    const r = evaluateTitleMetaQuality({
      before: "Complete Flag of Iran Timeline (All Flags)",
      after: "Iran Flag History: Timeline and Images of All Flags",
      field: "title",
    });
    expect(r.status).toBe("ready");
  });

  it("rejects a rewrite that drops the entity", () => {
    const r = evaluateTitleMetaQuality({ before: "Persian Wolf Range and Behavior", after: "Range, Behavior, and Conservation Status", field: "title" });
    expect(r.status).toBe("relevance_rejected");
    expect(r.copyAllowed).toBe(false);
  });
});

describe("evaluateCreatePageBriefQuality", () => {
  const goodBrief = {
    title: "Persian wedding traditions and Sofreh Aghd rituals",
    meta: "A concise guide to Persian wedding customs, Sofreh Aghd elements and their meanings, guest etiquette and regional variations across Iran.",
    opening:
      "A Persian wedding blends pre-Islamic and Islamic customs centered on the Sofreh Aghd, a ceremonial spread with symbolic items such as a mirror, candelabras, sugar cones, and sweets.",
    outline: ["What is a Persian wedding: overview and origins", "The Sofreh Aghd: meaning and layout", "Mirror and candelabras ceremony"],
    faqQuestions: ["What is a sofreh aghd?", "What items go on the spread?", "How long is a Persian wedding?"],
    schemaTypes: ["Article", "FAQPage"],
    hasSerpVerdict: true,
  };

  it("PASSES the 3 real briefs (Persian wedding)", () => {
    expect(evaluateCreatePageBriefQuality(goodBrief).status).toBe("ready");
  });

  it("flags missing SERP verdict as needs-review", () => {
    const r = evaluateCreatePageBriefQuality({ ...goodBrief, hasSerpVerdict: false });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
  });

  it("rejects a boilerplate title", () => {
    expect(evaluateCreatePageBriefQuality({ ...goodBrief, title: "Persian Weddings: The Complete Guide" }).status).toBe("generic_rejected");
  });

  it("malformed when a required field is missing", () => {
    expect(evaluateCreatePageBriefQuality({ ...goodBrief, opening: "" }).status).toBe("malformed");
  });
});

describe("evaluateSectionDraftQuality (BEACON 500 item 55 - outline-to-draft pipeline)", () => {
  it("PASSES a contextual, sourced section", () => {
    const r = evaluateSectionDraftQuality({
      heading: "The sofreh aghd ceremony",
      body: "The sofreh aghd is a ceremonial spread laid before an Iranian couple during the wedding, carrying symbolic items such as bread, herbs, gold coins, and a mirror. Family members hold a canopy above the couple while an officiant reads the vows.",
      sourceCount: 1,
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("REJECTS a section with zero sources as missing_source", () => {
    const r = evaluateSectionDraftQuality({
      heading: "The sofreh aghd ceremony",
      body: "The sofreh aghd is a ceremonial spread laid before an Iranian couple during the wedding, carrying symbolic items such as bread, herbs, gold coins, and a mirror.",
      sourceCount: 0,
    });
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
  });

  it("rejects an empty heading/body as malformed", () => {
    expect(evaluateSectionDraftQuality({ heading: "", body: "", sourceCount: 1 }).status).toBe("malformed");
  });

  it("REJECTS a generic dictionary opening with no page context", () => {
    const r = evaluateSectionDraftQuality({
      heading: "What is a gift",
      body: "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation. Gifts can be tangible or intangible and are exchanged in many contexts across cultures worldwide.",
      sourceCount: 1,
    });
    expect(r.status).toBe("generic_rejected");
    expect(r.copyAllowed).toBe(false);
  });

  it("REJECTS a too-thin section under 20 words", () => {
    const r = evaluateSectionDraftQuality({
      heading: "The reception",
      body: "Iranian wedding receptions are joyful, with music and dancing.",
      sourceCount: 1,
    });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
  });

  it("REJECTS plan-not-prose language ('this section will present…') caught in the first real Iranopedia run", () => {
    const r = evaluateSectionDraftQuality({
      heading: "Historical and cultural origins",
      body: "This section will present the historical and cultural origins of Persian mythology as a focused topic. Intended chronological context: outline the timeframes and cultural phases that influenced myth formation across the Iranian cultural sphere and its neighbors over the centuries.",
      sourceCount: 1,
    });
    expect(r.status).toBe("too_thin");
    expect(r.reasons[0]).toContain("content plan");
    expect(r.canRegenerate).toBe(true);
  });

  it("does NOT reject present-tense synthesis ('this section synthesizes…') as plan language", () => {
    const r = evaluateSectionDraftQuality({
      heading: "Creation and end time themes in Persian cosmology",
      body: "Creation narratives in Persian mythology describe the origins of the world and humanity's place within a structured cosmic order. Eschatological cycles of decline and renewal conclude moral history and restore order. This section synthesizes how those themes interact in mythic storytelling and ritual practice.",
      sourceCount: 1,
    });
    expect(r.status).toBe("ready");
  });

  it("REJECTS a section with no page-topic context anywhere (off-topic)", () => {
    const r = evaluateSectionDraftQuality({
      heading: "Choosing a venue",
      body: "Picking the right venue takes planning. Consider the guest count, the season, and the budget before booking anything for the big day ahead.",
      sourceCount: 1,
    });
    expect(r.status).toBe("relevance_rejected");
    expect(r.copyAllowed).toBe(false);
  });

  it("REJECTS an unsupported superlative claim", () => {
    const r = evaluateSectionDraftQuality({
      heading: "Why the sofreh aghd matters",
      body: "The Persian sofreh aghd is the best wedding ceremony tradition in the world, unmatched by any other culture's rituals or customs across history.",
      sourceCount: 1,
    });
    expect(r.status).toBe("unsupported_claim");
    expect(r.copyAllowed).toBe(false);
  });
});

describe("evaluateInternalLinkQuality", () => {
  it("rejects a self-link", () => {
    const r = evaluateInternalLinkQuality({
      sourcePage: "https://iranopedia.com/cities",
      targetPage: "https://www.iranopedia.com/cities/",
      anchorText: "Iranian cities",
      linkSentence: "See our guide to Iranian cities for more.",
    });
    expect(r.status).toBe("relevance_rejected");
    expect(r.copyAllowed).toBe(false);
  });

  it("passes a distinct, in-context link", () => {
    const r = evaluateInternalLinkQuality({
      sourcePage: "https://iranopedia.com/nowruz",
      targetPage: "https://iranopedia.com/haft-seen",
      anchorText: "Haft-Seen table",
      linkSentence: "Families arrange a Haft-Seen table during Nowruz celebrations.",
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("flags when the anchor is not in the link sentence", () => {
    const r = evaluateInternalLinkQuality({
      sourcePage: "/a",
      targetPage: "/b",
      anchorText: "Persian calendar",
      linkSentence: "Learn more about the Iranian new year here.",
    });
    expect(r.status).toBe("useful_but_needs_review");
  });

  it("malformed when missing fields", () => {
    expect(evaluateInternalLinkQuality({ sourcePage: "/a", targetPage: "", anchorText: "x" }).status).toBe("malformed");
  });
});

describe("evaluateCROFixQuality", () => {
  it("ready with a concrete fix + Clarity evidence", () => {
    const r = evaluateCROFixQuality({
      frictionType: "dead_click",
      location: "the hero image on the cities page",
      fix: "Make the hero image non-clickable or link it to the cities index, since users dead-click expecting navigation.",
      evidenceRefs: 1,
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("needs review when there's no evidence (no fake certainty)", () => {
    const r = evaluateCROFixQuality({
      frictionType: "rage_click",
      location: "the top nav",
      fix: "Increase the tap target size of the menu button for mobile users.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
  });

  it("too_thin when the fix is vague", () => {
    expect(evaluateCROFixQuality({ frictionType: "cta_clarity", location: "page", fix: "improve it", evidenceRefs: 1 }).status).toBe("too_thin");
  });
});

describe("evaluatePreparedPackQuality — dispatch (adversarial #1 fix)", () => {
  it("dispatches cro_fix to the CRO gate", () => {
    const r = evaluatePreparedPackQuality({
      structuredDraft: { kind: "cro_fix", value: { frictionType: "dead_click", location: "hero", fix: "Make the hero image link to the index since users dead-click it expecting navigation.", evidenceRefs: [{ source: "clarity", detail: "x" }] } },
    });
    expect(r.status).toBe("ready");
  });

  it("dispatches internal_link to the link gate (self-link rejected)", () => {
    const r = evaluatePreparedPackQuality({
      structuredDraft: { kind: "internal_link", value: { sourcePage: "/x", targetPage: "/x", anchorText: "x", linkSentence: "x x" } },
    });
    expect(r.status).toBe("relevance_rejected");
  });

  it("a pack with NO draft is too_thin, never ready (rec-3/7/11)", () => {
    const r = evaluatePreparedPackQuality({ structuredDraft: null, preparedStatus: "demand_found", moveType: "edit_page" });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
  });

  it("dispatches atomic_edit to the title gate", () => {
    const r = evaluatePreparedPackQuality({
      structuredDraft: { kind: "atomic_edit", value: { before: "Persian Holidays: Explore Traditions", after: "Persian Holidays and Traditions: Nowruz, Mehregan, Yalda", field: "title" } },
    });
    expect(r.status).toBe("ready");
  });

  it("dispatches answer_block to the answer gate", () => {
    const r = evaluatePreparedPackQuality({
      structuredDraft: { kind: "answer_block", value: { answer: "A gift is a voluntarily transferred item given without payment. Gifts can be tangible or intangible and exchanged in social or commercial contexts everywhere in the world today.", evidenceRefs: [] } },
    });
    expect(r.status).toBe("generic_rejected");
  });
});
