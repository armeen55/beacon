import { describe, it, expect } from "vitest";
import {
  evaluateDraftQuality,
  evaluateTitleMetaQuality,
  evaluateCreatePageBriefQuality,
  evaluatePreparedPackQuality,
  evaluateInternalLinkQuality,
  evaluateCROFixQuality,
  evaluateSectionDraftQuality,
  qualityLabel,
} from "./draft-quality";

// Cases are pinned to the REAL Iranopedia draft audit (scripts/wf-draft-quality.js)
// plus the adversarial false-rejection findings.
//
// W5 (2026-07-09, J-69/J-70/J-71): the fixtures below were rewritten to the
// 80-150 word answer-block contract (40-60 is too thin per the operator's own
// spec) and, where the content states a real claim, either carry a qualifying
// `sources` entry (to isolate whatever that specific test is about) or are
// left sourceless on purpose to demonstrate the new missing_source gate. This
// is the intended retroactive effect: a "useful_but_needs_review" verdict for
// a sourceless factual claim now correctly surfaces as "needs a source"
// instead, not a bug, the point of J-69 ("no exceptions").

// A real (non-Iranopedia-flavored) authoritative-domain claim, reused wherever
// a test needs the "sourced -> ready" happy path rather than the
// missing-source path.
const NOWRUZ_SOURCE = {
  domain: "britannica.com",
  claim: "Nowruz marks the Persian new year and is celebrated with community gatherings and Haft-Seen displays",
  // W5 P0-1 (2026-07-09): a qualifying source is generation-time verified. The
  // gate now requires this, so a "ready" fixture models a freshly-verified draft.
  verified: true as const,
  // trust-230 (Codex P1): the coverage check needs the source's fetched passage
  // to actually entail every protected claim in the Nowruz answer block below,
  // not merely share a topic word. This excerpt is the passage the answer was
  // written from, so each of its claims is backed.
  supportingExcerpt:
    "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
};

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
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("PASSES a contextual 'A Persian wedding is…' opener, sourced (ab-3)", () => {
    const r = evaluateDraftQuality({
      answer:
        "A Persian wedding is the traditional marriage ceremony of Persian-speaking cultures, primarily Iran, blending pre-Islamic and Islamic customs into one shared occasion. The centerpiece is the sofreh aghd, a ceremonial spread laid before the couple that carries symbolic items such as a mirror, candelabras, sugar cones, and fresh herbs. Family members hold a decorated canopy above the couple while an officiant reads the marriage vows and guests shower them with sugared almonds for good fortune. The formal ceremony is followed by the jashn reception, an evening of music, dancing, and a shared meal with extended family and friends.",
      sources: [
        {
          domain: "britannica.com",
          claim: "a Persian wedding centers on the sofreh aghd spread and the reading of marriage vows",
          verified: true,
          supportingExcerpt:
            "A Persian wedding is the traditional marriage ceremony of Persian-speaking cultures, primarily Iran, blending pre-Islamic and Islamic customs into one shared occasion. Family members hold a decorated canopy above the couple while an officiant reads the marriage vows and guests shower them with sugared almonds for good fortune.",
        },
      ],
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

  // W5: this fixture's whole point used to be "a sourceless specific fact is
  // COPYABLE but flagged." J-69 replaces that with a hard hold; the honest
  // fix is a real source, not a note to double-check later.
  it("HOLDS a specific unsourced factual claim as missing_source (ab-9: national animal)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(false);
  });

  it("the SAME cheetah claim is ready once a qualifying authoritative source is attached", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.",
      evidenceRefs: 0,
      sources: [
        {
          domain: "britannica.com",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: true,
          supportingExcerpt:
            "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.",
        },
      ],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  // W5: a hedge ("has not been officially announced") no longer exempts a
  // claim from J-69; it is still a factual assertion that needs a source.
  it("HOLDS a hedged forward-looking claim as missing_source, not a free pass (2026 jersey)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's 2026 World Cup jersey has not been officially announced yet, though past Iran kits have featured the national colors alongside the federation crest on the chest. Fans should confirm the final design directly with Iran's football federation once the kit is released ahead of the tournament next year. Retailers typically begin taking preorders only after the federation and its kit supplier jointly publish official photos, so any version circulating online before that point should be treated as a fan concept rather than the real jersey the team will wear in official matches.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
  });

  // W5: evidenceRefs was always a weaker proxy than a real, checkable
  // citation; J-69 requires the latter even when the old evidenceRefs>=1
  // exemption would have let this through.
  it("HOLDS a descriptive 'official flag' answer as missing_source without a real source (Lion and Sun)", () => {
    const r = evaluateDraftQuality({
      answer:
        "The Lion and Sun was used on official Iranian state flags for much of the modern era, drawing on ancient Persian and Near Eastern solar and royal symbolism that predates the modern nation-state by many centuries. Its official state symbolism evolved through the Safavid, Qajar, and Pahlavi periods, shifting from a purely dynastic emblem toward a broader national symbol recognized on coins, seals, and military insignia. Artists rendered the lion holding a curved sword beneath a rising sun, a composition that appeared on currency and postage long before it reached the national flag itself.",
      evidenceRefs: 1,
    });
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
  });

  it("rejects an empty answer as malformed", () => {
    expect(evaluateDraftQuality({ answer: "" }).status).toBe("malformed");
    expect(evaluateDraftQuality({ answer: null }).status).toBe("malformed");
  });
});

// ── G5 (2026-07-10): needs_source_check (honest unfetchable-source hold) ──────
describe("evaluateDraftQuality - G5 needs_source_check", () => {
  const CHEETAH =
    "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.";

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

  it("with no blocked source at all, an unsourced factual claim stays missing_source (unchanged)", () => {
    const r = evaluateDraftQuality({ answer: CHEETAH, evidenceRefs: 0 });
    expect(r.status).toBe("missing_source");
  });

  it("READY still requires verified coverage: a verified covering source wins even when a blocked one is also cited", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      sources: [
        { domain: "britannica.com", claim: "blocked one", verified: false, fetchBlocked: true },
        {
          domain: "iranicaonline.org",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: true,
          supportingExcerpt: CHEETAH,
        },
      ],
      authoritativeSourceDomains: ["iranicaonline.org"],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("G6 combination: a covered draft NOTES the blocked citation but is not held hostage by it", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      sources: [
        { domain: "britannica.com", claim: "blocked one", verified: false, fetchBlocked: true },
        {
          domain: "iranicaonline.org",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: true,
          supportingExcerpt: CHEETAH,
        },
      ],
      authoritativeSourceDomains: ["iranicaonline.org"],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
    // The primary reason is unchanged; the blocked citation is noted as a trailing line.
    expect(r.reasons[0]).toBe("Answers the topic with page-specific context; no risky claims detected.");
    expect(r.reasons.some((x) => x.includes("britannica.com") && x.includes("safe to paste"))).toBe(true);
  });

  it("no blocked source -> a covered draft has NO extra note (byte-identical ready reasons)", () => {
    const r = evaluateDraftQuality({
      answer: CHEETAH,
      sources: [
        {
          domain: "iranicaonline.org",
          claim: "the Asiatic cheetah is Iran's national animal and is critically endangered",
          verified: true,
          supportingExcerpt: CHEETAH,
        },
      ],
      authoritativeSourceDomains: ["iranicaonline.org"],
    });
    expect(r.status).toBe("ready");
    expect(r.reasons).toEqual(["Answers the topic with page-specific context; no risky claims detected."]);
  });

  it("qualityLabel maps needs_source_check to a plain 'Check the source' chip", () => {
    expect(qualityLabel("needs_source_check")).toBe("Check the source");
  });
});

describe("evaluateDraftQuality - J-71 word band (80-150 words)", () => {
  // Deliberately claim-free (no number, no proper-noun-shaped span, no
  // definitional assertion) so these isolate the LENGTH decision from J-69's
  // source gate, a "ready" verdict here needs no sources at all.
  const BASE =
    "Nowruz begins each year on the March equinox and marks the start of the Persian calendar new year across Iran, Afghanistan, and many neighboring countries. Families spend the final days before the holiday cleaning their homes from top to bottom, a custom known as khouneh tekouni, and setting a haft-seen table with seven symbolic items that each start with the Persian letter sin. Relatives visit each other's homes across the full two-week holiday, starting with the oldest members of the family first, and children receive small gifts of money tucked inside books or handed over directly by grandparents and uncles. Markets fill with fresh greens, painted eggs, goldfish, and pastries such as baklava and nan-e nokhodchi in the weeks leading up to the holiday, and many cities in Iran and across the Persian diaspora host public concerts, poetry readings, and craft fairs timed to the same two-week celebration window that closes with a picnic on the thirteenth day known as Sizdah Bedar.";

  function words(n: number): string {
    const w = BASE.trim().split(/\s+/).slice(0, n).join(" ");
    return /[.!?]$/.test(w) ? w : `${w}.`;
  }

  it("79 words: below the floor, too_thin", () => {
    const r = evaluateDraftQuality({ answer: words(79) });
    expect(r.status).toBe("too_thin");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
    expect(r.reasons[0]).toContain("80-150");
  });

  it("80 words: clears the floor, ready (claim-free, no source needed)", () => {
    const r = evaluateDraftQuality({ answer: words(80) });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("150 words: still inside the ceiling, ready", () => {
    const r = evaluateDraftQuality({ answer: words(150) });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("151 words: over the ceiling, not_quotable (trim, don't rewrite from scratch)", () => {
    const r = evaluateDraftQuality({ answer: words(151) });
    expect(r.status).toBe("not_quotable");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
  });
});

describe("evaluateDraftQuality - quotability (BEACON 500 item 78, additive; W5 dropped the length half)", () => {
  it("PIN: does not flip ab-2 (Nowruz USA) off ready, sourced", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("PIN: does not flip ab-3 (Persian wedding) off ready, sourced", () => {
    const r = evaluateDraftQuality({
      answer:
        "A Persian wedding is the traditional marriage ceremony of Persian-speaking cultures, primarily Iran, blending pre-Islamic and Islamic customs into one shared occasion. The centerpiece is the sofreh aghd, a ceremonial spread laid before the couple that carries symbolic items such as a mirror, candelabras, sugar cones, and fresh herbs. Family members hold a decorated canopy above the couple while an officiant reads the marriage vows and guests shower them with sugared almonds for good fortune. The formal ceremony is followed by the jashn reception, an evening of music, dancing, and a shared meal with extended family and friends.",
      sources: [
        {
          domain: "britannica.com",
          claim: "a Persian wedding centers on the sofreh aghd spread and the reading of marriage vows",
          verified: true,
          supportingExcerpt:
            "A Persian wedding is the traditional marriage ceremony of Persian-speaking cultures, primarily Iran, blending pre-Islamic and Islamic customs into one shared occasion. Family members hold a decorated canopy above the couple while an officiant reads the marriage vows and guests shower them with sugared almonds for good fortune.",
        },
      ],
    });
    expect(r.status).toBe("ready");
  });

  it("PIN: the cheetah fixture now surfaces as missing_source, not needs-review (J-69 retroactive gating)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
  });

  it("PIN: the Lion and Sun fixture now surfaces as missing_source (evidenceRefs alone no longer exempts it)", () => {
    const r = evaluateDraftQuality({
      answer:
        "The Lion and Sun was used on official Iranian state flags for much of the modern era, drawing on ancient Persian and Near Eastern solar and royal symbolism that predates the modern nation-state by many centuries. Its official state symbolism evolved through the Safavid, Qajar, and Pahlavi periods, shifting from a purely dynastic emblem toward a broader national symbol recognized on coins, seals, and military insignia. Artists rendered the lion holding a curved sword beneath a rising sun, a composition that appeared on currency and postage long before it reached the national flag itself.",
      evidenceRefs: 1,
    });
    expect(r.copyAllowed).toBe(false);
    expect(r.status).toBe("missing_source");
  });

  it("NEW: rejects a well-formed, on-topic, sourced draft (80-150 words) that opens with a pronoun", () => {
    const r = evaluateDraftQuality({
      answer:
        "It is a traditional Persian celebration held every year in the spring across Iran and neighboring countries, marked by family gatherings, music, and shared meals that continue for nearly two weeks each season. Extended families travel long distances to reunite for the occasion, often visiting several relatives' homes across a single week. Children receive small gifts of money from older relatives, and homes are cleaned and decorated well before the celebration begins. Markets fill with fresh herbs, pastries, and goldfish sold specifically for the holiday table, and many cities host public concerts and craft fairs timed to the same two-week window.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("not_quotable");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
    expect(r.reasons.some((x) => x.toLowerCase().includes("name the subject"))).toBe(true);
  });

  it("does NOT reject a clean, on-topic, sourced draft with no number/date at all (matches the real corpus)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("ready");
  });
});

describe("evaluateDraftQuality - missing_source is never regeneratable (J-69)", () => {
  it("canRegenerate is always false for missing_source - redrafting cannot invent authority", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.",
    });
    expect(r.status).toBe("missing_source");
    expect(r.canRegenerate).toBe(false);
  });

  it("a formatting/technical draft with zero sources is NEVER source-gated (claim-free answer block)", () => {
    // No number, no proper-noun-shaped span, no definitional assertion.
    const r = evaluateDraftQuality({
      answer:
        "Plan ahead for your first visit by choosing your route, packing lightly, and leaving early so the trip goes smoothly from the moment you leave home until the moment you arrive back again. Give yourself extra time at the entrance during busy weekends, and check ahead for any schedule changes before you go so your plans do not need to change once you arrive at the gate with everyone ready to head inside together, and remember to bring comfortable shoes.",
      contextTokens: ["your first visit"],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });
});

describe("evaluateDraftQuality - factual entailment (N8, additive/opt-in)", () => {
  // Pin: every pre-existing fixture above passes NO pageBodyText/evidenceText,
  // so the entailment check never runs for them - already proven by the fact
  // every earlier test in this file still passes unmodified. These new cases
  // only cover the opt-in path itself.

  it("does nothing when neither pageBodyText nor evidenceText is supplied (byte-identical to pre-N8); J-69 still gates it as missing_source", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iran's national animal is the Asiatic cheetah, a critically endangered subspecies native to the country's central plateau and its arid steppe grasslands. Conservation programs coordinated by the Department of Environment work to protect the small remaining population across a network of protected reserves and national parks, including Miandasht and Touran. Camera-trap surveys and radio-collar tracking studies help researchers estimate population trends and identify the roads and fences that fragment the cheetah's remaining range. International partners have supported captive-breeding research as a hedge against further decline, though wild recovery remains the primary conservation goal for the coming decade.",
      evidenceRefs: 0,
    });
    expect(r.status).toBe("missing_source");
  });

  it("PASSES a ready draft whose claims are all grounded in the page body, sourced", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      pageBodyText:
        "Nowruz Activities USA covers community and cultural events across the United States marking Nowruz, the Persian New Year, each spring, including Haft-Seen displays and traditional Persian music performances by local Iranian-American associations in cities such as Los Angeles, Washington, and Houston, plus a small Nowruz market and craft workshops for families and children.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  it("REJECTS an otherwise-ready draft with a number the page body does not support", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz has been celebrated in Iran for more than 3000 years, marking the arrival of spring with family gatherings, music, poetry readings, and shared meals across the region every March. It runs for nearly two weeks, and most families travel to visit relatives during that stretch, starting with grandparents first. The custom of a deep clean happens beforehand, and a table is set with seven symbolic items that each start with the same letter. The celebration closes with a shared picnic on the thirteenth day, out in the open air with the whole family together.",
      // evidenceRefs is no longer what clears this test's path; the ENTAILMENT
      // check below fires regardless, before the J-69 gate is ever reached.
      evidenceRefs: 1,
      pageBodyText:
        "Nowruz is the Persian new year, celebrated in Iran with family gatherings, music, poetry readings, and shared meals marking the arrival of spring every March. The holiday runs for nearly two weeks with visits to relatives and closes with a picnic on the thirteenth day.",
    });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(true);
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

  it("PASSES an atomic title/meta rewrite whose claim is grounded, sourced (J-69: '3000 Years' is a NEW specific fact)", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian New Year Traditions",
      after: "Persian New Year: 3000 Years of Nowruz Traditions in Iran",
      field: "title",
      pageBodyText: "Nowruz is a 3000 year old Persian tradition celebrated across Iran every spring.",
      sources: [
        {
          domain: "britannica.com",
          claim: "Nowruz has been celebrated in Iran for 3000 years",
          verified: true,
          supportingExcerpt: "Persian New Year traditions, known as Nowruz, have been celebrated in Iran for 3000 years.",
        },
      ],
    });
    expect(r.status).toBe("ready");
  });
});

describe("evaluateDraftQuality / evaluateTitleMetaQuality - operator correction (page is stale, dated evidence backs the draft)", () => {
  it("a draft that CONTRADICTS the page but is backed by a dated authoritative fact stays ready AND carries the correction, sourced", () => {
    const r = evaluateDraftQuality({
      answer:
        "Iranopedia now lists 4500 Persian recipes in its growing collection, spanning regional dishes, holiday specialties, and everyday family meals from every corner of Iran and its many worldwide diaspora communities. Each recipe entry includes a short history of the dish alongside step by step cooking instructions contributed by home cooks and professional chefs. Readers can filter the collection by region, occasion, or main ingredient to find dishes suited to a specific holiday table or an everyday weeknight meal. New recipes are added every month as contributors submit family recipes passed down across several generations of home cooking.",
      evidenceRefs: 1,
      pageBodyText:
        "Iranopedia lists 3000 Persian recipes in its growing collection, spanning regional dishes and everyday family meals across Iran. Readers can filter the collection by region, occasion, or main ingredient.",
      authoritativeFacts: [
        { source: "your site's recipe count (Wix connector)", date: "2026-07-01", detail: "4500 recipes are currently published" },
      ],
      sources: [
        {
          domain: "britannica.com",
          claim: "Iranopedia's collection spans regional Persian dishes and holiday specialties",
          verified: true,
          supportingExcerpt:
            "Iranopedia now lists 4500 Persian recipes in its growing collection, spanning regional dishes, holiday specialties, and everyday family meals from every corner of Iran and its many worldwide diaspora communities. Readers can filter the collection by region, occasion, or main ingredient to find dishes suited to a specific holiday table or an everyday weeknight meal.",
        },
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
        "Iranopedia now lists 4500 Persian recipes in its growing collection, spanning regional dishes, holiday specialties, and everyday family meals from every corner of Iran and its many worldwide diaspora communities. Each recipe entry includes a short history of the dish alongside step by step cooking instructions contributed by home cooks and professional chefs. Readers can filter the collection by region, occasion, or main ingredient to find dishes suited to a specific holiday table or an everyday weeknight meal. New recipes are added every month as contributors submit family recipes passed down across several generations of home cooking.",
      evidenceRefs: 1,
      pageBodyText:
        "Iranopedia lists 3000 Persian recipes in its growing collection, spanning regional dishes and everyday family meals across Iran. Readers can filter the collection by region, occasion, or main ingredient.",
    });
    expect(r.status).toBe("unverified_claim");
    expect(r.copyAllowed).toBe(false);
    expect(r.corrections).toBeUndefined();
  });

  it("a ready draft with no correction never carries the corrections field (undefined, not empty array), sourced", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      pageBodyText:
        "Nowruz Activities USA covers community and cultural events across the United States marking Nowruz, the Persian New Year, each spring, including Haft-Seen displays and traditional Persian music performances by local Iranian-American associations in cities such as Los Angeles, Washington, and Houston, plus a small Nowruz market and craft workshops for families and children.",
      sources: [NOWRUZ_SOURCE],
    });
    expect(r.status).toBe("ready");
    expect(r.corrections).toBeUndefined();
  });

  it("an atomic title/meta correction stays ready AND carries the correction line with source + date (SPECIFIC_FACT doesn't match '4500 Recipes', so no sources[] needed here)", () => {
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

describe("evaluateDraftQuality - J-70 first-mention rule (soft, tenant-configured)", () => {
  const PERSIAN_FIRST_MENTION = { native: "؀-ۿ", transliteration: false, englishContext: false };

  it("null/absent config leaves a ready draft byte-identical (self-hide)", () => {
    const withoutConfig = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
    });
    const withNullConfig = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
      firstMentionConfig: null,
    });
    expect(withNullConfig).toEqual(withoutConfig);
    expect(withoutConfig.status).toBe("ready");
  });

  it("a miss downgrades an otherwise-ready draft to useful_but_needs_review (never a hard block)", () => {
    const r = evaluateDraftQuality({
      answer:
        "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
      firstMentionConfig: PERSIAN_FIRST_MENTION,
    });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.copyAllowed).toBe(true);
    expect(r.canRegenerate).toBe(false);
  });

  it("passes when the first sentence carries the configured native script", () => {
    const r = evaluateDraftQuality({
      answer:
        "نوروز Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.",
      sources: [NOWRUZ_SOURCE],
      firstMentionConfig: PERSIAN_FIRST_MENTION,
    });
    expect(r.status).toBe("ready");
  });
});

describe("evaluateTitleMetaQuality — atomic edits", () => {
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

  it("a pure rephrase with zero sources is NEVER source-gated, even when both before/after happen to be sourceless (formatting edit, not a fresh claim)", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian Wolf: Habitat and Diet",
      after: "Persian Wolf Habitat and Diet Explained",
      field: "title",
    });
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
  });

  // trust-230 (Codex P1) operator test 9: a formatting-only edit that introduces
  // no NEW specific fact never reaches the source-coverage gate at all, so it is
  // ready with zero sources (the exemption comes from the SPECIFIC_FACT trigger,
  // not from the coverage check).
  it("9. a formatting-only edit is exempt: never missing_source, even with zero sources", () => {
    const r = evaluateTitleMetaQuality({
      before: "Persian Holidays: Explore the Traditions",
      after: "Persian Holidays and Traditions Explained",
      field: "title",
    });
    expect(r.status).not.toBe("missing_source");
    expect(r.status).toBe("ready");
    expect(r.copyAllowed).toBe(true);
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
    // W5 P1-4 (2026-07-09): the factual openingAnswer needs a verified source.
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

  it("PASSES the 3 real briefs (Persian wedding)", () => {
    expect(evaluateCreatePageBriefQuality(goodBrief).status).toBe("ready");
  });

  // W5 P1-4: the same brief with NO source is held as missing_source.
  it("HOLDS a factual opening with no source as missing_source (P1-4)", () => {
    const { sources: _s, ...noSource } = goodBrief;
    const r = evaluateCreatePageBriefQuality(noSource);
    expect(r.status).toBe("missing_source");
    expect(r.copyAllowed).toBe(false);
    expect(r.canRegenerate).toBe(false);
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

describe("evaluateInternalLinkQuality (formatting kind - never source-gated)", () => {
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

  it("passes a distinct, in-context link with zero sources (internal_link is never source-gated)", () => {
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

describe("evaluateCROFixQuality (formatting kind - never source-gated)", () => {
  it("ready with a concrete fix + Clarity evidence, zero sources (cro_fix is never source-gated)", () => {
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

  it("threads the draft's OWN sources[] field through to the answer gate (W5, J-69)", () => {
    const answer =
      "Nowruz Activities USA refers to community and cultural events held across the United States to observe Nowruz, the Persian New Year, each spring. Local Iranian-American associations in cities such as Los Angeles, Washington, and Houston organize Haft-Seen table displays, traditional Persian music performances, and folk dance shows during the two-week celebration window that follows the spring equinox. Families gather for shared meals, poetry readings, and craft workshops for children, while community centers coordinate a public calendar of events. Many gatherings also host a small Nowruz market selling sweets, herbs, and handmade goods from Persian vendors.";
    const withoutSources = evaluatePreparedPackQuality({
      structuredDraft: { kind: "answer_block", value: { answer, evidenceRefs: [] } },
    });
    const withSources = evaluatePreparedPackQuality({
      structuredDraft: { kind: "answer_block", value: { answer, evidenceRefs: [], sources: [NOWRUZ_SOURCE] } },
    });
    expect(withoutSources.status).toBe("missing_source");
    expect(withSources.status).toBe("ready");
  });
});
