/**
 * first-audit tests (2026-07-03, BEACON_500 R12 / T0e).
 *
 * Pins the day-0 scorecard math: question derivation for the poll library,
 * Google-check term derivation, the first-win priority ladder (deterministic,
 * crawl-evidence only), scorecard composition, and dash-free copy.
 */
import { describe, it, expect } from "vitest";

import {
  composeFirstAuditScorecard,
  deriveQuestionSeedsFromFacts,
  deriveSerpTermsFromFacts,
  pickFirstWin,
  stripSiteSuffix,
  THIN_PAGE_WORDS,
} from "./first-audit";
import type { CrawlFrontierState, CrawlPageFact } from "@/domains/scanning/crawl-frontier";

function fact(over: Partial<CrawlPageFact>): CrawlPageFact {
  return {
    url: "https://acme.com/page",
    path: "/page",
    title: "A perfectly fine page",
    h1: "A perfectly fine page",
    has_meta_description: true,
    word_count: 400,
    faq_count: 0,
    questions: [],
    ...over,
  };
}

function state(facts: CrawlPageFact[], over: Partial<CrawlFrontierState> = {}): CrawlFrontierState {
  return {
    tenant_id: "tenant-x",
    domain: "acme.com",
    status: "in_progress",
    frontier: ["https://acme.com/q1", "https://acme.com/q2"],
    visited: facts.map((f) => `acme.com${f.path}`),
    pages_crawled: facts.length,
    pages_failed: 0,
    page_cap: 150,
    source: "sitemap",
    started_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z",
    last_batch_at: "2026-07-03T00:00:00.000Z",
    batches_run: 1,
    page_facts: facts,
    day0: { question_seeding: null, serp_terms: [] },
    ...over,
  };
}

describe("deriveQuestionSeedsFromFacts", () => {
  it("flattens, dedupes case-insensitively, and tags the crawl source", () => {
    const seeds = deriveQuestionSeedsFromFacts([
      fact({ questions: ["What is saffron rice", "How long does it cook"] }),
      fact({ path: "/b", questions: ["what is saffron rice", "Can you freeze it"] }),
    ]);
    expect(seeds.map((s) => s.text)).toEqual([
      "What is saffron rice",
      "How long does it cook",
      "Can you freeze it",
    ]);
    expect(new Set(seeds.map((s) => s.source))).toEqual(new Set(["crawl"]));
  });
});

describe("stripSiteSuffix / deriveSerpTermsFromFacts", () => {
  it("strips pipe and spaced-hyphen site suffixes", () => {
    expect(stripSiteSuffix("Best Kabob in LA | Acme")).toBe("Best Kabob in LA");
    expect(stripSiteSuffix("Best Kabob in LA - Acme")).toBe("Best Kabob in LA");
    expect(stripSiteSuffix("Well-known Kabob")).toBe("Well-known Kabob");
  });

  it("derives up to 5 terms from the biggest non-homepage pages, deduped", () => {
    const facts = [
      fact({ path: "/", title: "Acme | Home", word_count: 900 }),
      fact({ path: "/a", title: "Persian Wedding Venues | Acme", word_count: 800 }),
      fact({ path: "/b", title: "Persian Wedding Venues | Acme", word_count: 700 }),
      fact({ path: "/c", title: null, h1: "Saffron Rice Guide", word_count: 600 }),
      fact({ path: "/d", title: "Kabob Catering Prices", word_count: 500 }),
      fact({ path: "/e", title: "Tahdig Recipes", word_count: 400 }),
      fact({ path: "/f", title: "Persian Tea Houses", word_count: 300 }),
    ];
    const terms = deriveSerpTermsFromFacts(facts);
    expect(terms).toEqual([
      "persian wedding venues",
      "saffron rice guide",
      "kabob catering prices",
      "tahdig recipes",
      "persian tea houses",
    ]);
  });

  it("falls back to the homepage when it is the only page", () => {
    expect(deriveSerpTermsFromFacts([fact({ path: "/", title: "Acme Plumbing Co" })])).toEqual([
      "acme plumbing co",
    ]);
  });
});

describe("pickFirstWin priority ladder", () => {
  it("1: a substantial page with no title wins first", () => {
    const win = pickFirstWin([
      fact({ path: "/big", title: null, h1: null, word_count: 500, has_meta_description: false }),
      fact({ path: "/", has_meta_description: false }),
    ]);
    expect(win?.action).toBe("Write a title");
    expect(win?.plainWhy).toContain("500 words");
  });

  it("2: then the homepage missing its search description", () => {
    const win = pickFirstWin([
      fact({ path: "/", url: "https://acme.com/", has_meta_description: false }),
      fact({ path: "/b", has_meta_description: false, word_count: 900 }),
    ]);
    expect(win?.action).toBe("Add a search description");
    expect(win?.url).toBe("https://acme.com/");
    expect(win?.plainWhy).toContain("homepage");
  });

  it("3: then the biggest page missing a description", () => {
    const win = pickFirstWin([
      fact({ path: "/" }),
      fact({ path: "/big", title: "Saffron Guide | Acme", has_meta_description: false, word_count: 1200 }),
    ]);
    expect(win?.action).toBe("Add a search description");
    expect(win?.plainWhy).toContain("1200 words");
    expect(win?.plainWhy).toContain('"Saffron Guide"');
  });

  it("4: then the thinnest titled page", () => {
    const win = pickFirstWin([
      fact({ path: "/" }),
      fact({ path: "/thin", title: "Contact | Acme", word_count: THIN_PAGE_WORDS - 80 }),
    ]);
    expect(win?.action).toBe("Add real content");
    expect(win?.plainWhy).toContain(`${THIN_PAGE_WORDS - 80} words`);
  });

  it("5: then a missing headline; a clean site yields null", () => {
    const win = pickFirstWin([fact({ path: "/a", h1: null })]);
    expect(win?.action).toBe("Add a headline");
    expect(pickFirstWin([fact({})])).toBeNull();
    expect(pickFirstWin([])).toBeNull();
  });

  it("every sentence is dash-free with a concrete next step", () => {
    const win = pickFirstWin([fact({ path: "/", has_meta_description: false })]);
    expect(`${win?.plainWhy} ${win?.exactFix}`).not.toMatch(/[\u2012\u2013\u2014\u2015]/);
  });
});

describe("composeFirstAuditScorecard", () => {
  it("counts the gaps, estimates the honest total, and carries the first win", () => {
    const s = state(
      [
        fact({ path: "/", has_meta_description: false, questions: ["What is acme"] }),
        fact({ path: "/thin", word_count: 60, questions: [] }),
        fact({ path: "/no-title", title: null, word_count: 20 }),
      ],
      { day0: { question_seeding: "seeded", serp_terms: [{ term: "x", status: "dry_run" }] } },
    );
    const card = composeFirstAuditScorecard(s);
    expect(card.pagesRead).toBe(3);
    expect(card.estimatedTotal).toBe(5); // 3 visited + 2 queued
    expect(card.missingTitle).toBe(1);
    expect(card.missingDescription).toBe(1);
    expect(card.thinPages).toBe(2);
    expect(card.questionsFound).toBe(1);
    expect(card.firstWin?.action).toBe("Add a search description");
    expect(card.serpTerms).toEqual(["x"]);
    expect(card.seededQuestions).toBe(true);
    expect(card.progressLine).toContain("I have read 3 of about 5 pages");
  });

  it("passes the unreachable status + detail through honestly", () => {
    const card = composeFirstAuditScorecard(
      state([], { status: "unreachable", detail: "no_reachable_pages", frontier: [], visited: [] }),
    );
    expect(card.status).toBe("unreachable");
    expect(card.progressLine).toBe(
      "I could not reach acme.com. Check the address and try again.",
    );
  });
});
