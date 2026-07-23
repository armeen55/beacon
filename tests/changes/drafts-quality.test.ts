/**
 * The Prepared Output Quality Gate (Core 100K Phase 6 merge of
 * src/domains/decision/drafts/draft-quality.test.ts + draft-quality-repeat-flag.test.ts,
 * trimmed to boundary + operator-locked fixture cases).
 *
 * Cases are pinned to the REAL Referencepedia draft audit + the adversarial
 * false-rejection findings. Locked rules: J-69 "no exceptions" source gate
 * (the cheetah fixture holds without a source, ships with one), the 80-150
 * word band, the never-ready-without-verification pin for robots-blocked
 * sources, entailment against the page body, and the formatting-kind
 * exemptions (internal_link / cro_fix / pure rephrase are never source-gated).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateDraftQuality,
  evaluateTitleMetaQuality,
  evaluateCreatePageBriefQuality,
  evaluatePreparedPackQuality,
  evaluateInternalLinkQuality,
  evaluateCROFixQuality,
  evaluateSectionDraftQuality,
} from "@/domains/decision/drafts/draft-quality";

const NOWRUZ_ANSWER =
  "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.";

const NOWRUZ_SOURCE = {
  domain: "britannica.com",
  claim: "Nowruz marks the Persian new year and is celebrated with community gatherings and Haft-Seen displays",
  verified: true as const,
  supportingExcerpt: NOWRUZ_ANSWER,
};

const CHEETAH =
  "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.";

describe("evaluateDraftQuality - answer blocks", () => {
  it("REJECTS a generic dictionary opening with no context (ab-1: gifts)", () => {
    const r = evaluateDraftQuality({
      answer:
        "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation. Gifts can be tangible or intangible and are exchanged in social, cultural, ceremonial, or commercial contexts. Legal, tax, and ethical considerations can affect gift giving.",
    });
    expect(r.status).toBe("generic_rejected");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
  });

  it("PASSES a contextual definitional opener, sourced (ab-2: Nowruz USA)", () => {
    const r = evaluateDraftQuality({ answer: NOWRUZ_ANSWER, sources: [NOWRUZ_SOURCE] });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
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
        "The Referencepedia page summarizes reported designs, colors, and symbolic elements attributed to those banners. The team has documented this topic and cites wrmea.org as a source; consult that citation for details on Persian Empire flags and their history over time.",
    });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
  });

  it("HOLDS a specific unsourced factual claim as missing_source, never regeneratable (ab-9: cheetah, J-69)", () => {
    const r = evaluateDraftQuality({ answer: CHEETAH, evidenceRefs: 0 });
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(false);
  });

  it("the SAME cheetah claim is ready once a qualifying authoritative source is attached", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      evidenceRefs: 0,
      sources: [
        {
          domain: "britannica.com",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: true,
          supportingExcerpt: CHEETAH,
        },
      ],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("rejects an empty answer as malformed", () => {
    expect(evaluateDraftQuality({ answer: "" }).status).toBe("malformed");
    expect(evaluateDraftQuality({ answer: null }).status).toBe("malformed");
  });

  it("a formatting/technical draft with zero sources is NEVER source-gated (claim-free answer block)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Plan ahead for your first visit by choosing your route, packing lightly, and leaving early so the trip goes smoothly from the moment you leave home until the moment you arrive back again. Give yourself extra time at the entrance during busy weekends, and check ahead for any schedule changes before you go so your plans do not need to change once you arrive at the gate with everyone ready to head inside together, and remember to bring comfortable shoes.",
      contextTokens: ["your first visit"],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });
});

describe("evaluateDraftQuality - G5 needs_source_check (honest unfetchable-source hold)", () => {
  it("holds as needs_source_check (NOT missing_source) when an authority-strong citation was robots-blocked", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      evidenceRefs: 0,
      sources: [
        {
          url: "https://www.britannica.com/animal/asiatic-cheetah",
          domain: "britannica.com",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: false,
          fetchBlocked: true,
        },
      ],
    });
    expect(r.status).toBe("needs_source_check");
    expect(r.reasons[0]).toBe(
      "I could not read britannica.com myself (it blocks robots). Check this citation before you paste.",
    );
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(false);
  });

  it("NEVER-READY-WITHOUT-VERIFICATION pin: a blocked authoritative source alone is never ready", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      sources: [
        { domain: "britannica.com", claim: "the Asiatic cheetah is Iran's national animal", verified: false, fetchBlocked: true },
      ],
    });
    expect(r.status).not.toBe("ready");
    expect(r.copyAllowed).toBe(false);
  });

  it("a robots-block on a NON-authoritative domain is still plain missing_source (a block is no trust grant)", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      sources: [
        { domain: "some-blog.example", claim: "the Asiatic cheetah is Iran's national animal", verified: false, fetchBlocked: true },
      ],
    });
    expect(r.status).toBe("missing_source");
  });

  it("READY still requires verified coverage: a verified covering source wins even when a blocked one is also cited", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      sources: [
        { domain: "britannica.com", claim: "blocked one", verified: false, fetchBlocked: true },
        {
          domain: "heritage-encyclopedia.example",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: true,
          supportingExcerpt: CHEETAH,
        },
      ],
      authoritativeSourceDomains: ["heritage-encyclopedia.example"],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });
});

describe("evaluateDraftQuality - J-71 word band (80-150 words)", () => {
  // Deliberately claim-free so these isolate the LENGTH decision from J-69.
  const BASE =
    "Nowruz begins each year on the March equinox and marks the start of the Persian calendar new year across Iran, Afghanistan, and many neighboring countries. Families spend the final days before the holiday cleaning their homes from top to bottom, a custom known as khouneh tekouni, and setting a haft-seen table with seven symbolic items that each start with the Persian letter sin. Relatives visit each other's homes across the full two-week holiday, starting with the oldest members of the family first, and children receive small gifts of money tucked inside books or handed over directly by grandparents and uncles. Markets fill with fresh greens, painted eggs, goldfish, and pastries such as baklava and nan-e nokhodchi in the weeks leading up to the holiday, and many cities in Iran and across the Persian diaspora host public concerts, poetry readings, and craft fairs timed to the same two-week celebration window that closes with a picnic on the thirteenth day known as Sizdah Bedar.";

  function words(n: number): string {
    const w = BASE.trim().split(/\s+/).slice(0, n).join(" ");
    return /[.!?]$/.test(w) ? w : `${w}.`;
  }

  it("79 words is too_thin; 80 clears the floor and is ready (claim-free, no source needed)", () => {
    const under = evaluateDraftQuality({ answer: words(79) });
    expect(under.status).toBe("too_thin");
    expect(under.reasons[0]).toContain("80-150");
    expect(evaluateDraftQuality({ answer: words(80) }).status).toBe("ready");
  });

  it("150 words is still ready; 151 is not_quotable (trim, don't rewrite from scratch)", () => {
    expect(evaluateDraftQuality({ answer: words(150) }).status).toBe("ready");
    const over = evaluateDraftQuality({ answer: words(151) });
    expect(over.status).toBe("not_quotable");
    expect(over.canRegenerate).toBe(true);
  });
});

describe("evaluateDraftQuality - quotability", () => {
  it("rejects a well-formed, on-topic, sourced draft that opens with a pronoun", () => {
    const r = evaluateDraftQuality({
      answer:
        "It is a traditional Persian celebration held every year in the spring across Iran and neighboring countries, marked by family gatherings, music, and shared meals that continue for nearly two weeks each season. Extended families travel long distances to reunite for the occasion, often visiting several relatives' homes across a single week. Children receive small gifts of money from older relatives, and homes are cleaned and decorated well before the celebration begins. Markets fill with fresh herbs, pastries, and goldfish sold specifically for the holiday table, and many cities host public concerts and craft fairs timed to the same two-week window.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("not_quotable");
    expect(r.reasons.some((x) => x.toLowerCase().includes("name the subject"))).toBe(true);
  });

  it("does NOT reject a clean, on-topic, sourced draft with no number/date at all (matches the real corpus)", () => {
    const r = evaluateDraftQuality({ answer: NOWRUZ_ANSWER, sources: [NOWRUZ_SOURCE] });
    expect(r.status).toBe("ready");
  });
});

describe("evaluateDraftQuality - factual entailment (N8, additive/opt-in)", () => {
  it("REJECTS an otherwise-ready draft with a number the page body does not support", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz has been celebrated in Iran for more than 3000 years, marking the arrival of spring with family gatherings, music, poetry readings, and shared meals across the region every March. It runs for nearly two weeks, and most families travel to visit relatives during that stretch, starting with grandparents first. The custom of a deep clean happens beforehand, and a table is set with seven symbolic items that each start with the same letter. The celebration closes with a shared picnic on the thirteenth day, out in the open air with the whole family together.",
      evidenceRefs: 1,
      pageBodyText:
        "Nowruz is the Persian new year, celebrated in Iran with family gatherings, music, poetry readings, and shared meals marking the arrival of spring every March. The holiday runs for nearly two weeks with visits to relatives and closes with a picnic on the thirteenth day.",
    });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
    expect(r.reasons[0]).toContain("3000");
    expect(r.reasons[0]).toContain("could not find that number");
  });

  it("PASSES the same 3000-year claim when the page body actually supports it, sourced", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz has been celebrated in Iran for more than 3000 years, marking the arrival of spring with family gatherings, music, poetry readings, and shared meals across the region every March. It runs for nearly two weeks, and most families travel to visit relatives during that stretch, starting with grandparents first. The custom of a deep clean happens beforehand, and a table is set with seven symbolic items that each start with the same letter. The celebration closes with a shared picnic on the thirteenth day, out in the open air with the whole family together.",
      evidenceRefs: 1,
      pageBodyText:
        "Nowruz is a 3000 year old Persian tradition celebrated in Iran, marking the arrival of spring every March with family gatherings, music, and poetry readings. The holiday runs for nearly two weeks and closes with a picnic on the thirteenth day.",
      sources: [
        {
          domain: "britannica.com",
          claim: "Nowruz has been celebrated in Iran for more than 3000 years",
          verified: true,
          supportingExcerpt:
            "Nowruz has been celebrated in Iran for more than 3000 years, marking the arrival of spring with family gatherings, music, poetry readings, and shared meals across the region every March.",
        },
      ],
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
});

describe("operator correction (page is stale, dated evidence backs the draft)", () => {
  const RECIPES_ANSWER =
    "Referencepedia now lists 4500 Persian recipes in its growing collection, spanning regional dishes, holiday specialties, and everyday family meals from every corner of Iran and its many worldwide diaspora communities. Each recipe entry includes a short history of the dish alongside step by step cooking instructions contributed by home cooks and professional chefs. Readers can filter the collection by region, occasion, or main ingredient to find dishes suited to a specific holiday table or an everyday weeknight meal. New recipes are added every month as contributors submit family recipes passed down across several generations of home cooking.";
  const STALE_PAGE =
    "Referencepedia lists 3000 Persian recipes in its growing collection, spanning regional dishes and everyday family meals across Iran. Readers can filter the collection by region, occasion, or main ingredient.";

  it("a draft that CONTRADICTS the page but is backed by a dated authoritative fact stays ready AND carries the correction", () => {
    const r = evaluateDraftQuality({
      answer: RECIPES_ANSWER,
      evidenceRefs: 1,
      pageBodyText: STALE_PAGE,
      authoritativeFacts: [
        { source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" },
      ],
      sources: [
        {
          domain: "britannica.com",
          claim: "Referencepedia's collection spans regional Persian dishes and holiday specialties",
          verified: true,
          supportingExcerpt: RECIPES_ANSWER,
        },
      ],
    });
    expect(r.status).toBe("ready");
    expect(r.corrections).toBeDefined();
    expect(r.corrections!.some((c) => c.includes("4500") && c.includes("2026-07-01"))).toBe(true);
  });

  it("the SAME contradicting number with no authoritative fact stays unverified_claim (blocked)", () => {
    const r = evaluateDraftQuality({ answer: RECIPES_ANSWER, evidenceRefs: 1, pageBodyText: STALE_PAGE });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
    expect(r.corrections).toBeUndefined();
  });
});

describe("J-70 first-mention rule (soft, tenant-configured)", () => {
  it("a miss downgrades an otherwise-ready draft to useful_but_needs_review (never a hard block)", () => {
    const r = evaluateDraftQuality({
      answer: NOWRUZ_ANSWER,
      sources: [NOWRUZ_SOURCE],
      firstMentionConfig: { native: "؀-ۿ", transliteration: false, englishContext: false },
    });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
    expect(r.canRegenerate).toBe(false);
  });
});

describe("evaluateTitleMetaQuality - atomic edits", () => {
  it("PASSES an entity-forward rewrite (rec-0: Persian Wolf), no new specific fact, never source-gated", () => {
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

  it("rejects a rewrite that drops the entity", () => {
    const r = evaluateTitleMetaQuality({ before: "Persian Wolf Range and Behavior", after: "Range, Behavior, and Conservation Status", field: "title" });
    expect(r.status).toBe("relevance_rejected");
    expect(r.copyAllowed).toBe(false);
  });

  it("a formatting-only edit is exempt: never missing_source, even with zero sources", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian Holidays: Explore the Traditions",
      after: "Persian Holidays and Traditions Explained",
      field: "title",
    });
    expect(r.status).not.toBe("missing_source");
    expect(r.status).toBe("ready");
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
    sources: [
      {
        domain: "britannica.com",
        claim: "a Persian wedding centers on the sofreh aghd ceremonial spread",
        verified: true as const,
        supportingExcerpt:
          "A Persian wedding blends pre-Islamic and Islamic customs centered on the Sofreh Aghd, a ceremonial spread with symbolic items such as a mirror, candelabras, sugar cones, and sweets.",
      },
    ],
  };

  it("PASSES the real brief; HOLDS the same brief with no source as missing_source (P1-4)", () => {
    expect(evaluateCreatePageBriefQuality(goodBrief).status).toBe("ready");
    const { sources: _s, ...noSource } = goodBrief;
    const r = evaluateCreatePageBriefQuality(noSource);
    expect(r.status).toBe("missing_source");
    expect(r.canRegenerate).toBe(false);
  });

  it("rejects a boilerplate title", () => {
    expect(evaluateCreatePageBriefQuality({ ...goodBrief, title: "Persian Weddings: The Complete Guide" }).status).toBe("generic_rejected");
  });
});

describe("evaluateSectionDraftQuality (outline-to-draft pipeline)", () => {
  it("PASSES a contextual, sourced section; REJECTS the same shape with zero sources", () => {
    const ready = evaluateSectionDraftQuality({
      heading: "The sofreh aghd ceremony",
      body: "The sofreh aghd is a ceremonial spread laid before an Iranian couple during the wedding, carrying symbolic items such as bread, herbs, gold coins, and a mirror. Family members hold a canopy above the couple while an officiant reads the vows.",
      sourceCount: 1,
    });
    expect(ready.status).toBe("ready");
    const unsourced = evaluateSectionDraftQuality({
      heading: "The sofreh aghd ceremony",
      body: "The sofreh aghd is a ceremonial spread laid before an Iranian couple during the wedding, carrying symbolic items such as bread, herbs, gold coins, and a mirror.",
      sourceCount: 0,
    });
    expect(unsourced.status).toBe("missing_source");
  });

  it("REJECTS plan-not-prose language ('this section will present…') caught in the first real Referencepedia run", () => {
    const r = evaluateSectionDraftQuality({
      heading: "Historical and cultural origins",
      body: "This section will present the historical and cultural origins of Persian mythology as a focused topic. Intended chronological context: outline the timeframes and cultural phases that influenced myth formation across the Iranian cultural sphere and its neighbors over the centuries.",
      sourceCount: 1,
    });
    expect(r.status).toBe("too_thin");
    expect(r.reasons[0]).toContain("content plan");
  });

  it("does NOT reject present-tense synthesis ('this section synthesizes…') as plan language", () => {
    const r = evaluateSectionDraftQuality({
      heading: "Creation and end time themes in Persian cosmology",
      body: "Creation narratives in Persian mythology describe the origins of the world and humanity's place within a structured cosmic order. Eschatological cycles of decline and renewal conclude moral history and restore order. This section synthesizes how those themes interact in mythic storytelling and ritual practice.",
      sourceCount: 1,
    });
    expect(r.status).toBe("ready");
  });

  it("REJECTS off-topic sections and unsupported superlative claims", () => {
    const offTopic = evaluateSectionDraftQuality({
      heading: "Choosing a venue",
      body: "Picking the right venue takes planning. Consider the guest count, the season, and the budget before booking anything for the big day ahead.",
      sourceCount: 1,
    });
    expect(offTopic.status).toBe("relevance_rejected");
    const superlative = evaluateSectionDraftQuality({
      heading: "Why the sofreh aghd matters",
      body: "The Persian sofreh aghd is the best wedding ceremony tradition in the world, unmatched by any other culture's rituals or customs across history.",
      sourceCount: 1,
    });
    expect(superlative.status).toBe("unsupported_claim");
  });
});

describe("formatting kinds - never source-gated", () => {
  it("internal link: rejects a self-link; passes a distinct in-context link with zero sources", () => {
    const selfLink = evaluateInternalLinkQuality({
      sourcePage: "https://fixture-content.example/cities",
      targetPage: "https://www.fixture-content.example/cities/",
      anchorText: "Iranian cities",
      linkSentence: "See our guide to Iranian cities for more.",
    });
    expect(selfLink.status).toBe("relevance_rejected");
    const good = evaluateInternalLinkQuality({
      sourcePage: "https://fixture-content.example/nowruz",
      targetPage: "https://fixture-content.example/haft-seen",
      anchorText: "Haft-Seen table",
      linkSentence: "Families arrange a Haft-Seen table during Nowruz celebrations.",
    });
    expect(good.status).toBe("ready");
  });

  it("cro_fix: ready with a concrete fix + Clarity evidence; needs review with no evidence (no fake certainty)", () => {
    const ready = evaluateCROFixQuality({
      frictionType: "dead_click",
      location: "the hero image on the cities page",
      fix: "Make the hero image non-clickable or link it to the cities index, since users dead-click expecting navigation.",
      evidenceRefs: 1,
    });
    expect(ready.status).toBe("ready");
    const noEvidence = evaluateCROFixQuality({
      frictionType: "rage_click",
      location: "the top nav",
      fix: "Increase the tap target size of the menu button for mobile users.",
      evidenceRefs: 0,
    });
    expect(noEvidence.status).toBe("useful_but_needs_review");
  });
});

describe("evaluatePreparedPackQuality - dispatch + repeat flag", () => {
  const READY_ANSWER_PACK = {
    structuredDraft: {
      kind: "answer_block",
      value: {
        answer:
          "Chaharshanbe Suri 2026 falls on Tuesday, March 17, the eve of the last Wednesday before Nowruz. Iranian families gather after sunset to jump over small bonfires, share ajil, and recite the traditional zardi-ye man az to verse to leave the old year's troubles behind. Neighbors light several small fires in a row along streets and courtyards, and children often join in with sparklers and small firecrackers under adult supervision. Musicians sometimes play drums nearby while groups pass from one small fire to the next well into the evening. Many families finish the night with a shared meal indoors once the fires have burned down safely.",
        evidenceRefs: [{ source: "gsc", detail: "194 impressions on the 2026 date query" }],
        sources: [
          {
            domain: "britannica.com",
            claim: "Chaharshanbe Suri falls on the eve of the last Wednesday before Nowruz and involves jumping over bonfires",
            verified: true,
            supportingExcerpt:
              "Chaharshanbe Suri 2026 falls on Tuesday, March 17, the eve of the last Wednesday before Nowruz. Iranian families gather after sunset to jump over small bonfires, share ajil, and recite the traditional zardi-ye man az to verse to leave the old year's troubles behind. Neighbors light several small fires in a row along streets and courtyards, and children often join in with sparklers and small firecrackers under adult supervision. Musicians sometimes play drums nearby while groups pass from one small fire to the next well into the evening. Many families finish the night with a shared meal indoors once the fires have burned down safely.",
          },
        ],
      },
    },
    preparedStatus: "ready_to_review",
    moveType: "answer_block",
  } as const;

  it("a pack with NO draft is too_thin, never ready (rec-3/7/11)", () => {
    const r = evaluatePreparedPackQuality({ structuredDraft: null, preparedStatus: "demand_found", moveType: "edit_page" });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
  });

  it("threads the draft's OWN sources[] field through to the answer gate (W5, J-69)", () => {
    const withoutSources = evaluatePreparedPackQuality({
      structuredDraft: { kind: "answer_block", value: { answer: NOWRUZ_ANSWER, evidenceRefs: [] } },
    });
    const withSources = evaluatePreparedPackQuality({
      structuredDraft: { kind: "answer_block", value: { answer: NOWRUZ_ANSWER, evidenceRefs: [], sources: [NOWRUZ_SOURCE] } },
    });
    expect(withoutSources.status).toBe("missing_source");
    expect(withSources.status).toBe("ready");
  });

  it("R16 repeat flag: demotes ready to useful_but_needs_review; never rescues; omitting is byte-identical", () => {
    expect(evaluatePreparedPackQuality({ ...READY_ANSWER_PACK }).status).toBe("ready");
    const flagged = evaluatePreparedPackQuality({ ...READY_ANSWER_PACK, repeatFlagged: true });
    expect(flagged.status).toBe("useful_but_needs_review");
    expect(flagged.reasons[0]).toBe("Reads like a repeat of recent drafts. Give it a quick look before shipping.");
    expect(flagged.copyAllowed).toBe(true); // repetition is a review concern, not a trust breach
    const thin = evaluatePreparedPackQuality({ structuredDraft: null, repeatFlagged: true });
    expect(thin.status).toBe("too_thin");
    const same = evaluatePreparedPackQuality({ ...READY_ANSWER_PACK, repeatFlagged: false });
    expect(same).toEqual(evaluatePreparedPackQuality({ ...READY_ANSWER_PACK }));
  });
});
