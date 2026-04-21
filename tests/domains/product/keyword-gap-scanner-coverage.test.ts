/**
 * Plan B1 (2026-04-20) — scanner coverage broadening tests.
 *
 * Asserts that a concept covered ONLY in one of the newly-captured
 * PageSnapshot fields (h3_list, body_paragraph_sample, card_texts,
 * schema_entity_names, meta_description, faqs[].question) is recognized
 * by the scanner as covered and therefore doesn't fire as a
 * saturation_miss.
 */

import { describe, it, expect } from "vitest";
import { scanKeywordGaps } from "@/domains/product/keyword-gap-scanner";
import type { PageSnapshot, CitationEvidenceIndex } from "@/domains/pages/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

function makePage(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://site.example/target",
    canonical_url: null,
    fetched_at: "2026-04-20T00:00:00Z",
    http_status: 200,
    title: "Unrelated Title",
    meta_description: null,
    h1: "Unrelated H1",
    h2_list: ["Unrelated H2"],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 500,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    table_count: 0,
    tenant_id: "",
    ...overrides,
  };
}

function makeObs(id: string, query: string): PromptAnswerObservation {
  return {
    id,
    observation_run_id: "run-1",
    prompt_id: "p-1",
    prompt: "",
    platform: "chatgpt",
    topic: "topic-x",
    answered_at: "2026-04-20T00:00:00Z",
    tracked_brand_cited: false,
    tracked_brand_mentioned: false,
    mentions: ["CompetitorCo"],
    tenant_id: "",
    search_queries: [query],
  } as unknown as PromptAnswerObservation;
}

function floodObs(query: string, n = 25): PromptAnswerObservation[] {
  return Array.from({ length: n }, (_, i) => makeObs(`obs-${i}`, query));
}

function run(page: PageSnapshot, observations: PromptAnswerObservation[]) {
  const citationCountMap = new Map<string, number>([
    [page.url.replace(/\/+$/, "").toLowerCase(), 200],
  ]);
  const citationIndex = {
    by_page_and_topic: [],
    by_topic: [],
    page_to_topics: { [page.url]: ["topic-x"] },
  } as unknown as CitationEvidenceIndex;
  return scanKeywordGaps({
    pageSnapshots: [page],
    citationCountMap,
    citationIndex,
    observations,
    answerTexts: {},
    brandAliases: ["BrandCo"],
    competitorExclusions: [],
  });
}

// Concept we probe throughout these tests.
const QUERY = "luxury custom home builder bay area peninsula clients process";

// Sanity check — a page that does NOT cover the concept anywhere should
// surface a saturation_miss (confirms the test setup actually fires).
describe("coverage baseline — concept genuinely uncovered still fires", () => {
  it("fires saturation_miss when page has zero coverage for the concept", () => {
    const findings = run(makePage(), floodObs(QUERY));
    // Expect at least one finding whose concept tokens are all in the query.
    const hasCustomHome = findings.some((f) =>
      f.conceptNormalized.includes("custom home"),
    );
    expect(hasCustomHome).toBe(true);
  });
});

describe("Plan B1 — coverage recognizes concept in h3_list", () => {
  it("does NOT fire saturation_miss when 'custom home' is in an H3", () => {
    const page = makePage({
      h3_list: ["Custom Home Builder services across the peninsula"],
    });
    const findings = run(page, floodObs(QUERY));
    // No saturation_miss surfacing "custom home" because h3_list covers it.
    const satMiss = findings.filter(
      (f) => f.kind === "saturation_miss" && f.conceptNormalized.includes("custom home"),
    );
    expect(satMiss.length).toBe(0);
  });
});

describe("Plan B1 — coverage recognizes concept in body_paragraph_sample", () => {
  it("does NOT fire saturation_miss when concept lives in a body paragraph", () => {
    const page = makePage({
      body_paragraph_sample: [
        "We are a luxury custom home builder serving the bay area peninsula with architect-led design.",
      ],
    });
    const findings = run(page, floodObs(QUERY));
    const satMiss = findings.filter(
      (f) => f.kind === "saturation_miss" && f.conceptNormalized.includes("custom home"),
    );
    expect(satMiss.length).toBe(0);
  });
});

describe("Plan B1 — coverage recognizes concept in card_texts", () => {
  it("does NOT fire saturation_miss when concept lives in a card text", () => {
    const page = makePage({
      card_texts: ["Custom Home Builder — palo alto peninsula luxury design-build service"],
    });
    const findings = run(page, floodObs(QUERY));
    const satMiss = findings.filter(
      (f) => f.kind === "saturation_miss" && f.conceptNormalized.includes("custom home"),
    );
    expect(satMiss.length).toBe(0);
  });
});

describe("Plan B1 — coverage recognizes concept in schema_entity_names", () => {
  it("does NOT fire saturation_miss when concept lives in a schema entity name", () => {
    const page = makePage({
      schema_entity_names: ["Custom Home Builder Service"],
    });
    const findings = run(page, floodObs(QUERY));
    const satMiss = findings.filter(
      (f) => f.kind === "saturation_miss" && f.conceptNormalized.includes("custom home"),
    );
    expect(satMiss.length).toBe(0);
  });
});

describe("Plan B1 — coverage recognizes concept in faqs[].question", () => {
  it("does NOT fire saturation_miss when concept lives in a FAQ question", () => {
    const page = makePage({
      faqs: [
        {
          question: "How do I choose a custom home builder in the bay area?",
          answer_excerpt: "A custom home builder should...",
          source: "jsonld",
        },
      ],
    });
    const findings = run(page, floodObs(QUERY));
    const satMiss = findings.filter(
      (f) => f.kind === "saturation_miss" && f.conceptNormalized.includes("custom home"),
    );
    expect(satMiss.length).toBe(0);
  });
});

describe("Plan B1 — coverage recognizes concept in meta_description", () => {
  it("does NOT fire saturation_miss when concept lives in meta_description", () => {
    const page = makePage({
      meta_description: "Luxury custom home builder serving the bay area and peninsula for 30 years.",
    });
    const findings = run(page, floodObs(QUERY));
    const satMiss = findings.filter(
      (f) => f.kind === "saturation_miss" && f.conceptNormalized.includes("custom home"),
    );
    expect(satMiss.length).toBe(0);
  });
});

describe("Plan B1 — genuinely uncovered still surfaces", () => {
  it("fires saturation_miss when concept is nowhere on the page", () => {
    const page = makePage({
      h3_list: ["About our team"],
      body_paragraph_sample: ["We serve clients across the peninsula with design-led projects."],
      card_texts: ["Modern peninsula designs"],
      schema_entity_names: ["Unrelated Service"],
      faqs: [
        { question: "When was the company founded?", answer_excerpt: "...", source: "jsonld" },
      ],
    });
    const findings = run(page, floodObs(QUERY));
    // 'custom home' isn't in any of those fields — concept should still fire.
    const hasCustomHome = findings.some((f) =>
      f.conceptNormalized.includes("custom home"),
    );
    expect(hasCustomHome).toBe(true);
  });
});

describe("Plan B1 — missing fields are graceful", () => {
  it("handles snapshots without any new fields (pre-A+B1 snapshots)", () => {
    const page = makePage(); // all new fields undefined
    const findings = run(page, floodObs(QUERY));
    // Should not throw; scanner still produces findings from title/h1/h2.
    expect(Array.isArray(findings)).toBe(true);
  });
});
