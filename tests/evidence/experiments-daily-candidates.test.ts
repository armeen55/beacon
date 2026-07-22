import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
// Fail-closed calibration quarantine (2026-07-11): the ledger fixtures default to
// CALIBRATED so the item-29 family-win-propagation wiring cases still fire off a
// proven win exactly as before. An uncalibrated win seeds no propagation.
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

import {
  buildDailyCandidates, MIN_CONTROLS,
  proposeSafeMeta, metaIsWeak,
  proposeSafeInternalLink, buildLinkDestinations, distinctiveAlias, toLinkPath,
  type GscPageInput, type PageFacts, type LinkDestination,
} from "@/domains/experiments/build-daily-candidates";
import { planDailyExperiments } from "@/domains/experiments/daily-experiment-planner";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-01T00:00:00Z");
const gsc = (over: Partial<GscPageInput> & { url: string }): GscPageInput => ({
  pageLabel: "x", impressions: 2000, clicks: 5, ctr: 0.0025, position: 6,
  topQuery: "umayyad caliphate flag", topQueryImpressions: 1200, topQueryPosition: 4, topQueryCtr: 0.002, ownership: 0.5, ...over,
});
const facts = (m: Record<string, PageFacts>) => new Map(Object.entries(m));

describe("buildDailyCandidates — deterministic proposers (no generic templates)", () => {
  it("proposes a query-first TITLE reorder when the title leads with filler", () => {
    const pages = [gsc({ url: "/iran-flags/umayyad-caliphate-flag", topQuery: "umayyad caliphate flag" })];
    const f = facts({ "/iran-flags/umayyad-caliphate-flag": { title: "Meet the Umayyad Caliphate Flag | History", meta: "x", h1: "Umayyad Caliphate Flag" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("title");
    expect(c.proposedText.toLowerCase().startsWith("umayyad")).toBe(true);
    expect(/^meet the/i.test(c.proposedText)).toBe(false);
    expect(c.proposedText).toContain("| History"); // keeps the page's own brand/category tail
  });

  it("yields NO candidate when title is already query-first + meta present + H1 carries the query", () => {
    const pages = [gsc({ url: "/iran-flags/parthian-empire-flag", topQuery: "parthian empire flag" })];
    const f = facts({ "/iran-flags/parthian-empire-flag": { title: "Parthian Empire Flag (247 BC) - Persian Flags History", meta: "Learn about the Parthian Empire Flag.", h1: "Parthian Empire Flag" } });
    expect(buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW })).toHaveLength(0);
  });

  it("H1 lever only drops a filler lead (never chases a synonym/rewrites a clean H1)", () => {
    const pages = [gsc({ url: "/x", topQuery: "kerman rug" })];
    const f = facts({ "/x": { title: "Kerman Rug Buying Guide", meta: "present", h1: "Discover Kerman Rugs" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("h1");
    expect(c.proposedText).toBe("Kerman Rugs");
  });

  it("REGRESSION: never replaces a good bespoke title with a synonym query (no degenerate proposals)", () => {
    const pages = [
      gsc({ url: "/iran-flags/mongol-empire-flag", topQuery: "genghis khan flag" }),
      gsc({ url: "/famous-iranian-directors", topQuery: "iranian directors" }),
      gsc({ url: "/iran-flags/safavid-lion-sun", topQuery: "lion and sun flag" }),
    ];
    const f = facts({
      "/iran-flags/mongol-empire-flag": { title: "Mongol Empire Flag (1219–1335) - Persian Flags History", meta: "present", h1: "Mongol Empire Flag" },
      "/famous-iranian-directors": { title: "Top 20 Most Famous Iranian Filmmakers and Directors Ever", meta: "present", h1: "Famous Iranian Directors" },
      "/iran-flags/safavid-lion-sun": { title: "Safavid Lion and Sun Flag (1576–1732) - Persian Flags History", meta: "present", h1: "Safavid Lion and Sun Flag" },
    });
    // None have a filler lead or a missing meta → NO candidates (honest: don't force weak work).
    expect(buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW })).toHaveLength(0);
  });

  it("proposes a safe meta from the page's OWN opening paragraph when the meta is templated", () => {
    const pages = [gsc({ url: "/y", topQuery: "kerman rug" })];
    const f = facts({ "/y": {
      title: "Kerman Rug Guide", meta: "Learn about kerman rug and discover everything here.", h1: "Kerman Rugs",
      openingParagraph: "The Kerman rug is a hand-knotted Persian carpet from Kerman province in southeast Iran, prized for its floral medallion designs and exceptionally fine wool.",
    } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("meta");
    expect(c.proposedText.toLowerCase()).toContain("kerman");
    expect(c.proposedText.startsWith("Learn about")).toBe(false); // not the template
    expect(c.proposedText.length).toBeLessThanOrEqual(160);
  });

  it("filler-drop consumes 'verb + the' together and never strips a bare leading article", () => {
    // "Discover the Most Popular…" → "Most Popular…" (clean), NOT the broken "the Most Popular…".
    const a = facts({ "/x": { title: "Persian Names List", meta: "A bespoke meta about persian surnames and their meanings on this page.", h1: "Discover the Most Popular Persian Surnames" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages: [gsc({ url: "/x", topQuery: "persian surnames" })], facts: a, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("h1");
    expect(c.proposedText).toBe("Most Popular Persian Surnames");
    expect(/^the /i.test(c.proposedText)).toBe(false);
    // A bare leading article is NOT filler — "The Best Persian Restaurants" yields no title/H1 change.
    const b = facts({ "/y": { title: "The Best Persian Restaurants in Florida", meta: "A bespoke meta about persian food in florida written for this page.", h1: "The Best Persian Restaurants in Florida" } });
    expect(buildDailyCandidates({ tenantId: "t", pages: [gsc({ url: "/y", topQuery: "persian food" })], facts: b, proofLedger: [], now: NOW })).toHaveLength(0);
  });

  it("E-39 D3: a candidate with too few controls is ADMITTED WITH CAUTION (insufficient_controls), not frozen out", () => {
    // One lonely page with no same-family siblings → 0 controls → cannot be measured with
    // a real diff-in-diff, but the operator is NOT locked out: it is admitted with a
    // lower-confidence caution rather than frozen.
    const pages = [gsc({ url: "/iran-flags/lonely-flag", topQuery: "lonely flag", impressions: 2000 })];
    const f = facts({ "/iran-flags/lonely-flag": {
      title: "Lonely Flag", meta: "Learn all about the Lonely Flag here on our site.", h1: "Lonely Flag",
      openingParagraph: "The lonely flag was a historical banner used by a small regional power, notable for its simple single-color field and minimal heraldry.",
    } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.enoughControls).toBe(false);
    expect(c.eligibility.eligible).toBe(true);
    expect(c.eligibility.reason).toBe("insufficient_controls");
    const plan = planDailyExperiments({ tenantId: "t", date: "2026-07-01", candidates: [c], proofLedger: [], config: { now: NOW } });
    expect(plan.selected.map((s) => s.url)).toContain("/iran-flags/lonely-flag");
    const sel = plan.selected.find((s) => s.url.includes("lonely-flag"));
    expect(sel?.attributionCaution?.reason).toBe("insufficient_controls");
    expect(plan.excluded.some((e) => e.reason === "insufficient_controls")).toBe(false);
  });

  it("fires the ANSWER-BLOCK lever (good meta + good title, but a buried direct answer)", () => {
    const pages = [gsc({ url: "/finglish", topQuery: "finglish", impressions: 1200 })];
    const f = facts({ "/finglish": {
      title: "Finglish", meta: "Finglish is Persian written in the Latin alphabet — a quick guide for texting.", h1: "Finglish",
      bodyParagraphs: [
        "People all over the world type Persian on phones and keyboards every single day now.",
        "Finglish is Persian written using the English alphabet, common in texting and chats.",
      ],
    } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.leverField).toBe("answer_block");
    expect(c.answerDetail?.answerText).toBe("Finglish is Persian written using the English alphabet, common in texting and chats.");
    expect(c.answerDetail?.operation).toBe("move_existing_text");
    expect(c.answerDetail?.factualSafety.passed).toBe(true);
    expect(c.actionFamily).toBe("answer");
  });

  it("E-39: attaches eligibility - an active control page comes back ADMIT-WITH-CAUTION (active_control)", () => {
    const ctrl = "https://iranopedia.com/iran-animals/persian-cat";
    const ledger: ShippedChangeRecord[] = [{
      id: "/iran-animals/persian-wolf::2026-06-30", page: "https://iranopedia.com/iran-animals/persian-wolf", path: "/iran-animals/persian-wolf",
      actionType: "edit_title", before: null, after: null, shippedAt: "2026-06-30T00:00:00.000Z",
      baseline: { clicks: 0, impressions: 100, ctr: 0, position: 5, windowDays: 28 }, targetQueries: ["persian wolf"],
      controlPages: [ctrl], windows: [], verdict: "measuring", confidence: "low", measuredAt: null, notes: null,
      verifiedLive: true, liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null, calibrationVersion: TEST_CALIBRATED_VERSION,
      createdAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:00.000Z",
    }];
    const pages = [gsc({ url: ctrl, topQuery: "persian cat" })];
    const f = facts({ [ctrl]: { title: "Meet the Persian Cat | Iran Animals & Wildlife", meta: "x", h1: "Persian Cat" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: ledger, now: NOW });
    expect(c.eligibility.eligible).toBe(true);
    expect(c.eligibility.reason).toBe("active_control");
  });

  it("selects same-family controls + flags enoughControls", () => {
    const pages = [
      gsc({ url: "/iran-flags/umayyad-caliphate-flag", topQuery: "umayyad caliphate flag", impressions: 2000, topQueryPosition: 4 }),
      gsc({ url: "/iran-flags/c1", impressions: 1900, topQueryPosition: 5 }),
      gsc({ url: "/iran-flags/c2", impressions: 2100, topQueryPosition: 4 }),
      gsc({ url: "/iran-flags/c3", impressions: 1800, topQueryPosition: 6 }),
    ];
    const f = facts({ "/iran-flags/umayyad-caliphate-flag": { title: "Meet the Umayyad Caliphate Flag", meta: "x", h1: "Umayyad Caliphate Flag" } });
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], now: NOW });
    expect(c.suggestedControls.length).toBeGreaterThanOrEqual(MIN_CONTROLS);
    expect(c.suggestedControls.every((s) => s.pageFamilyMatch)).toBe(true);
    expect(c.enoughControls).toBe(true);
  });

  it("D-2: emits an LLM-WRITTEN answer_block candidate for an answer GAP (add_new_text, draftSource llm)", () => {
    // Good meta + good title (no meta/title lever) + a WHEN query the body does not answer (only a
    // definition) = an answer gap. With an LLM-written answer supplied, emit an add-a-new-line candidate.
    const pages = [gsc({ url: "/chaharshanbe-suri", topQuery: "chaharshanbe suri 2026", impressions: 1200, topQueryPosition: 6 })];
    const f = facts({ "/chaharshanbe-suri": {
      title: "Chaharshanbe Suri", meta: "Chaharshanbe Suri is the Persian festival of fire celebrated before Nowruz each spring.", h1: "Chaharshanbe Suri",
      bodyParagraphs: [
        "Families across Iran prepare for the evening with snacks, music, and gatherings.",
        "Chaharshanbe Suri is a traditional Persian festival of fire rooted in ancient custom.", // definition, no date
      ],
    } });
    const written = new Map([["/chaharshanbe-suri", { text: "Chaharshanbe Suri 2026 falls on Tuesday, March 17, the last Tuesday eve before Nowruz.", question: "When is Chaharshanbe Suri?" }]]);
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], writtenAnswersByUrl: written, now: NOW });
    expect(c.leverField).toBe("answer_block");
    expect(c.answerDetail?.operation).toBe("add_new_text");
    expect(c.proposedText).toContain("March 17");
    expect(c.draftSource).toBe("llm");
  });

  it("D-2: does NOT emit a written answer when the page has no gap (extractive answer exists)", () => {
    const pages = [gsc({ url: "/finglish", topQuery: "finglish", impressions: 1200 })];
    const f = facts({ "/finglish": {
      title: "Finglish", meta: "Finglish is Persian written in the Latin alphabet, a quick guide for texting.", h1: "Finglish",
      bodyParagraphs: [
        "People all over the world type Persian on phones and keyboards every single day now.",
        "Finglish is Persian written using the English alphabet, common in texting and chats.", // extractive answer exists
      ],
    } });
    // A written answer is offered, but the extractive answer wins (move), so no add_new_text.
    const written = new Map([["/finglish", { text: "Finglish is texting Persian in Latin letters.", question: "What is Finglish?" }]]);
    const [c] = buildDailyCandidates({ tenantId: "t", pages, facts: f, proofLedger: [], writtenAnswersByUrl: written, now: NOW });
    expect(c.answerDetail?.operation).toBe("move_existing_text");
    expect(c.draftSource).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Folded from safe-meta.test.ts (module merged into build-daily-candidates.ts,
// 2026-07-21). Pins the safe-meta lever: weak-meta detection and the factual,
// opening-paragraph-sourced proposal.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Folded from safe-internal-link.test.ts (module merged into
// build-daily-candidates.ts, 2026-07-21). Pins the safe-internal-link lever:
// path normalization, distinctive aliases, exact single-anchor wrapping, the
// intent-fit gate, and the destination registry.
// ---------------------------------------------------------------------------

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
