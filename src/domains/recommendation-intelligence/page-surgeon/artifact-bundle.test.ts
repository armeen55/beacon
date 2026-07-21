import { describe, it, expect } from "vitest";

import { composeArtifactBundle, type ArtifactBundle } from "./artifact-bundle";
import { qaArtifactBundle } from "./artifact-qa";
import { applyDeterministicGate, type AtomicChange, type PageAtomicDecision } from "./page-decision";
import type { EvidencePacket, GscEvidence } from "./contract";

function gsc(): GscEvidence {
  return {
    windowStart: "", windowEnd: "", impressions: 30000, clicks: 800, ctr: 0.0269, avgPosition: 6.4,
    topQueries: [{ query: "persian swear words", impressions: 799, clicks: 27, ctr: 0.034, position: 7 }],
    expectedCtrForPosition: 0.05, ctrGap: 0.023,
  };
}
function packet(over: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    current: { tenantId: "t", pageUrl: "https://iranopedia.com/funny-farsi-phrases", changeType: "title", elementKey: null, sectionLabel: null, currentText: "Old Title", cmsFieldMapped: true, publishChannel: "wix_cms" },
    gsc: over.gsc ?? gsc(),
    crawl: over.crawl ?? { title: "Old Title", h1: "Old H1", metaDescription: "Old meta.", h2List: ["Pedar Sag"], h3List: [], faqs: [], schemaTypes: [], wordCount: 1279, internalLinkCount: 85, cardTexts: [] },
    sourcesPresent: over.sourcesPresent ?? ["gsc", "crawl"],
    sourcesConnectedButEmpty: over.sourcesConnectedButEmpty ?? ["ga4", "clarity", "profound"],
  };
}
function change(action: AtomicChange["action"], over: Partial<AtomicChange> = {}): AtomicChange {
  return {
    action, exact_change: over.exact_change ?? `do ${action}`, evidence: over.evidence ?? "GSC: 799 impr at 3.4% CTR.",
    hypothesis: over.hypothesis ?? "h", risk: over.risk ?? "", before_after: over.before_after ?? { before: null, after: null },
    measurement: over.measurement ?? "28-day per-query CTR pre/post.", rollback: over.rollback ?? "", publishability: over.publishability ?? "review_only",
    dependency_order: over.dependency_order ?? 1, artifact_text: over.artifact_text ?? null, faq_items: over.faq_items ?? null,
  };
}
function decision(primary: AtomicChange | null, supporting: AtomicChange[] = [], over: Partial<PageAtomicDecision> = {}): PageAtomicDecision {
  return {
    pageUrl: "https://iranopedia.com/funny-farsi-phrases",
    recommended_atomic_action: over.recommended_atomic_action ?? (primary ? primary.action : "keep_current"),
    primary_atomic_change: primary, supporting_atomic_changes: supporting, rejected_changes: over.rejected_changes ?? [],
    source_coverage: [], wording_research: [], confidence: over.confidence ?? "low",
    operator_insight: "i", what_normal_seo_misses: "", why_not_just_title: "", evidence_gaps: [], decided_by: "llm_judge",
  };
}

describe("Page Surgeon — artifact composer (finished, CMS-ready content)", () => {
  it("title → a CMS field with char count + limit check; snippet after reflects it", () => {
    const b = composeArtifactBundle(decision(change("title", { exact_change: "Persian Swear Words & Farsi Insults — Meanings" })), packet());
    expect(b.primary!.cmsField).toMatchObject({ field: "title", withinLimit: true });
    expect(b.primary!.cmsField!.value).toContain("Swear Words");
    // The no-em-dash enforcer converts a spaced " — " in generated copy to ", ".
    expect(b.snippetAfter.title).toBe("Persian Swear Words & Farsi Insults, Meanings");
    expect(b.snippetBefore.title).toBe("Old Title");
    expect(b.primary!.rollback).toContain("Old Title"); // rollback restores the current value
  });

  it("over-limit copy is auto-trimmed to a clean word boundary within the limit", () => {
    const long = "Persian Swear Words And Farsi Insults And Curse Words With Full Meanings And Pronunciation Guide";
    const b = composeArtifactBundle(decision(change("title", { exact_change: long })), packet());
    const f = b.primary!.cmsField!;
    expect(f.autoTrimmed).toBe(true);
    expect(f.withinLimit).toBe(true);
    expect(f.charCount).toBeLessThanOrEqual(60);
    expect(long.startsWith(f.value)).toBe(true); // prefix only — clean cut, no garbage
    expect(/[\s,;:.\-]$/.test(f.value)).toBe(false); // no dangling punctuation
  });

  it("intro_answer_block → literal HTML + text from artifact_text", () => {
    const text = "Persian swear words range from playful to harsh. Pedar sag literally means 'father of a dog'.";
    const b = composeArtifactBundle(decision(change("intro_answer_block", { artifact_text: text })), packet());
    expect(b.primary!.answerBlockText).toBe(text);
    expect(b.primary!.answerBlockHtml).toBe(`<p>${text.replace(/&/g, "&amp;")}</p>`);
  });

  it("faq → literal Q&A; schema → parseable JSON-LD incl. FAQPage when faq present", () => {
    const faq = [{ question: "What does pedar sag mean?", answer: "Literally 'father of a dog' — a common scolding." }];
    const b = composeArtifactBundle(decision(change("schema", { faq_items: faq }), [change("faq", { faq_items: faq })]), packet());
    expect(b.primary!.jsonLd).toBeDefined();
    const parsed = JSON.parse(b.primary!.jsonLd!.code);
    expect(parsed["@graph"].some((g: { "@type": string }) => g["@type"] === "FAQPage")).toBe(true);
    const faqArtifact = b.supporting.find((c) => c.action === "faq");
    // The em dash in the answer is stripped by the no-em-dash enforcer.
    expect(faqArtifact!.faq).toEqual([
      { question: "What does pedar sag mean?", answer: "Literally 'father of a dog', a common scolding." },
    ]);
  });

  it("schema breadcrumbs include the site root and URL hierarchy, never one weak self item", () => {
    const base = packet();
    const b = composeArtifactBundle(
      decision(change("schema")),
      {
        ...base,
        current: {
          ...base.current,
          pageUrl: "https://iranopedia.com/language/funny-farsi-phrases",
        },
      },
    );
    const parsed = JSON.parse(b.primary!.jsonLd!.code);
    const crumb = parsed["@graph"].find(
      (node: { "@type": string }) => node["@type"] === "BreadcrumbList",
    );
    expect(crumb.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "iranopedia.com",
        item: "https://iranopedia.com/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Language",
        item: "https://iranopedia.com/language",
      },
      { "@type": "ListItem", position: 3, name: "Old Title" },
    ]);
  });

  it("does not claim breadcrumbs on the homepage", () => {
    const base = packet();
    const b = composeArtifactBundle(
      decision(change("schema")),
      {
        ...base,
        current: { ...base.current, pageUrl: "https://iranopedia.com/" },
      },
    );
    const parsed = JSON.parse(b.primary!.jsonLd!.code);
    expect(
      parsed["@graph"].some(
        (node: { "@type": string }) => node["@type"] === "BreadcrumbList",
      ),
    ).toBe(false);
  });

  it("measurement is made counterfactual with control pages (diff-in-diff)", () => {
    const b = composeArtifactBundle(decision(change("title", { exact_change: "New Title" })), packet(), [], ["/cities", "/iran-flags"]);
    expect(b.primary!.measurement).toMatch(/control/i);
    expect(b.primary!.measurement).toContain("/cities");
  });

  it("ux_cta_fix does NOT get GSC control pages (it's Clarity-measured)", () => {
    const c = change("ux_cta_fix", { measurement: "" });
    const b = composeArtifactBundle(decision(c), packet(), [], ["/cities"]);
    expect(b.primary!.measurement).not.toMatch(/control/i);
  });

  it("internal_link → resolves anchors to real site URLs by topic, unresolved → null", () => {
    const site = [
      { url: "https://iranopedia.com/persian-language", title: "Persian Language Guide" },
      { url: "https://iranopedia.com/cities", title: "Cities of Iran" },
    ];
    const c = change("internal_link", { exact_change: 'Add a link with anchor "persian language" to the language hub.' });
    const b = composeArtifactBundle(decision(c), packet(), site);
    const links = b.primary!.internalLinks!;
    expect(links[0]!.targetUrl).toBe("https://iranopedia.com/persian-language");
  });
});

describe("Page Surgeon — auto-QA gate", () => {
  const cleanTitle = () => change("title", { exact_change: "Persian Swear Words & Farsi Insults — Meanings", before_after: { before: "Old Title", after: "x" } });

  const richCrawl = {
    title: "Cities of Iran — Tehran Isfahan Shiraz Tabriz Mashhad Population Guide",
    h1: "Major Iranian Cities and Their Provinces",
    metaDescription: "Explore Iran's largest cities by population, province, history, and landmarks.",
    h2List: ["Tehran Capital Province", "Isfahan Historic Landmarks", "Shiraz Poetry Gardens", "Tabriz Bazaar Heritage", "Mashhad Religious Pilgrimage"],
    h3List: ["Population Statistics", "Provincial Capitals", "Tourist Attractions"],
    faqs: ["What is the largest city in Iran?", "Which province is Isfahan in?"],
    schemaTypes: [], wordCount: 1500, internalLinkCount: 40,
    cardTexts: ["Tehran population twelve million residents", "Isfahan famous for mosques and bridges"],
  };

  it("flags fact_check_required when an answer block's claims aren't on the crawled page", () => {
    const ab = change("intro_answer_block", { artifact_text: "Baking sourdough bread requires fermented flour, careful hydration, kneading, long proofing, scoring, and a very hot oven for proper crust development." });
    const b = composeArtifactBundle(decision(ab), packet({ crawl: richCrawl }));
    const qa = qaArtifactBundle(b, packet({ crawl: richCrawl }));
    expect(qa.factCheckRequired).toBe(true);
    expect(qa.factCheckNote).toMatch(/verify these claims/i);
  });

  it("does NOT flag when the answer restates content that's on the crawled page", () => {
    const ab = change("intro_answer_block", { artifact_text: "Iran's major cities include Tehran, Isfahan, Shiraz, Tabriz, and Mashhad, each a provincial capital known for population, landmarks, and heritage." });
    const b = composeArtifactBundle(decision(ab), packet({ crawl: richCrawl }));
    const qa = qaArtifactBundle(b, packet({ crawl: richCrawl }));
    expect(qa.factCheckRequired).toBe(false);
  });

  it("does NOT fact-check when the crawl corpus is too thin to judge (no crying wolf)", () => {
    const ab = change("intro_answer_block", { artifact_text: "Completely unrelated content about astrophysics, nebulae, quasars, and deep space exploration here." });
    const b = composeArtifactBundle(decision(ab), packet()); // tiny default crawl
    const qa = qaArtifactBundle(b, packet());
    expect(qa.factCheckRequired).toBe(false);
  });

  it("a clean, in-limit, evidenced bundle PASSES", () => {
    const b = composeArtifactBundle(decision(cleanTitle()), packet());
    const qa = qaArtifactBundle(b, packet());
    expect(qa.pass).toBe(true);
    expect(qa.failures).toHaveLength(0);
  });

  it("an over-limit title is auto-trimmed so the bundle still PASSES QA", () => {
    const long = "Persian Swear Words And Farsi Insults And Curse Words With Full Meanings And Pronunciation Guide";
    const b = composeArtifactBundle(decision(change("title", { exact_change: long, before_after: { before: "Old Title", after: "x" } })), packet());
    const qa = qaArtifactBundle(b, packet());
    expect(b.primary!.cmsField!.autoTrimmed).toBe(true);
    expect(qa.pass).toBe(true);
  });

  it("genuinely empty CMS copy still FAILS the CMS check", () => {
    const b = composeArtifactBundle(decision(change("title", { exact_change: "   ", before_after: { before: "Old Title", after: "x" } })), packet());
    const qa = qaArtifactBundle(b, packet());
    expect(qa.pass).toBe(false);
    expect(qa.failures.some((f) => /CMS copy/i.test(f))).toBe(true);
  });

  it("the gate strips a deprecated FAQ rich-result justification (claim cleaner)", () => {
    // Build a decision whose faq change cites rich results, run it through the gate.
    const faq = change("faq", {
      faq_items: [{ question: "What does pedar sag mean?", answer: "Literally 'father of a dog'." }],
      evidence: "Page-1 underperforming query 'persian swear words' (799 impr at pos 7). FAQ schema will win a rich result and grow SERP real estate for more CTR.",
      hypothesis: "Adding FAQ rich results increases CTR via more SERP real estate.",
    });
    const gated = applyDeterministicGate(
      decision(change("intro_answer_block", { artifact_text: "Persian swear words explained: pedar sag means 'father of a dog'." }), [faq]),
      packet(),
    );
    const b = composeArtifactBundle(gated, packet());
    const qa = qaArtifactBundle(b, packet());
    const faqArtifact = [b.primary, ...b.supporting].find((c) => c?.action === "faq")!;
    expect(/rich result|serp real estate/i.test(`${faqArtifact.evidence} ${faqArtifact.hypothesis}`)).toBe(false);
    expect(qa.checks.find((c) => c.name === "No stale tactics")!.pass).toBe(true);
  });

  it("placeholder copy FAILS brand/fact-safety", () => {
    const b = composeArtifactBundle(decision(change("intro_answer_block", { artifact_text: "This page covers [insert topic] and TODO add meanings here for the reader." })), packet());
    const qa = qaArtifactBundle(b, packet());
    expect(qa.pass).toBe(false);
    expect(qa.failures.some((f) => /Brand\/fact-safe/i.test(f))).toBe(true);
  });

  it("image_alt FAILS the stale-tactics check", () => {
    const b = composeArtifactBundle(decision(cleanTitle(), [change("image_alt")]), packet());
    const qa = qaArtifactBundle(b, packet());
    expect(qa.pass).toBe(false);
    expect(qa.failures.some((f) => /stale/i.test(f))).toBe(true);
  });

  it("keep_current bundle PASSES (consistency, no artifacts)", () => {
    const b = composeArtifactBundle(decision(null, [], { recommended_atomic_action: "keep_current" }), packet());
    const qa = qaArtifactBundle(b, packet());
    expect(qa.pass).toBe(true);
  });

  it("vague/empty rollback + measurement are backfilled to specific, and QA passes", () => {
    const c = cleanTitle();
    c.rollback = ""; // empty
    c.measurement = "monitor performance"; // vague, no metric/timeframe
    const b = composeArtifactBundle(decision(c), packet());
    expect(b.primary!.rollback).toMatch(/Old Title|previous title/i); // concrete restore
    expect(b.primary!.rollback.length).toBeGreaterThanOrEqual(15);
    expect(/ctr|click|impression|day|week/i.test(b.primary!.measurement)).toBe(true);
    const qa = qaArtifactBundle(b, packet());
    expect(qa.pass).toBe(true);
    expect(qa.checks.find((x) => x.name === "Rollback specified")!.pass).toBe(true);
    expect(qa.checks.find((x) => x.name === "Measurement specific")!.pass).toBe(true);
  });

  it("a ux_cta_fix gets a Clarity-based measurement default", () => {
    const ux = change("ux_cta_fix", { measurement: "", rollback: "" });
    const b = composeArtifactBundle(decision(ux), packet());
    expect(/clarity|dead-click|rage-click/i.test(b.primary!.measurement)).toBe(true);
    expect(b.primary!.rollback.length).toBeGreaterThanOrEqual(15);
  });
});

describe("Page Surgeon — crawl-freshness gate", () => {
  const crawlAt = (fetchedAt: string) => packet({
    crawl: { title: "Old Title", h1: "Old H1", metaDescription: "Old meta.", h2List: ["Pedar Sag"], h3List: [], faqs: [], schemaTypes: [], wordCount: 1279, internalLinkCount: 85, cardTexts: [], fetchedAt },
  });
  const NOW = Date.parse("2026-06-18T00:00:00Z");
  const title = () => change("title", { exact_change: "Persian Swear Words & Farsi Insults — Meanings", before_after: { before: "Old Title", after: "x" } });

  it("a >90d-old crawl FAILS the freshness gate for a CMS-field change", () => {
    const p = crawlAt("2020-01-01T00:00:00Z");
    const qa = qaArtifactBundle(composeArtifactBundle(decision(title()), p), p, NOW);
    expect(qa.pass).toBe(false);
    expect(qa.failures.some((f) => /Crawl fresh/i.test(f))).toBe(true);
  });
  it("a fresh crawl PASSES the freshness gate", () => {
    const p = crawlAt("2026-06-10T00:00:00Z");
    const qa = qaArtifactBundle(composeArtifactBundle(decision(title()), p), p, NOW);
    expect(qa.pass).toBe(true);
  });
  it("the freshness gate is SKIPPED when nowMs is not supplied", () => {
    const p = crawlAt("2020-01-01T00:00:00Z");
    const qa = qaArtifactBundle(composeArtifactBundle(decision(title()), p), p);
    expect(qa.checks.find((c) => c.name === "Crawl fresh enough")).toBeUndefined();
    expect(qa.pass).toBe(true);
  });
});
