import { describe, it, expect } from "vitest";
import {
  evaluateDraftQuality,
  evaluateTitleMetaQuality,
  evaluateCreatePageBriefQuality,
  evaluatePreparedPackQuality,
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

describe("evaluatePreparedPackQuality — dispatch (adversarial #1 fix)", () => {
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
