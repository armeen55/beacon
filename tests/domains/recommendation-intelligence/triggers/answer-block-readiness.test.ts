/**
 * AEO answer-block readiness tests (2026-06-12 night shift) —
 * `missing_answer_block`: question-shaped pages lacking an early
 * direct answer earn an add_answer_block directive card. GSC question
 * query is the primary demand signal; a question-shaped title/H1 is
 * the crawl-only fallback. Merely-definitional titles do NOT fire.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import {
  answerBlockReadiness,
  hasEarlyAnswerScaffold,
  isQuestionShaped,
  strongestQuestion,
} from "@/domains/recommendation-intelligence/triggers/answer-block-readiness";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://iranopedia.com/chaharshanbe-suri",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: "What is Chaharshanbe Suri? Meaning, Traditions, History",
    meta_description: null,
    h1: "Chaharshanbe Suri",
    h2_list: ["History", "Traditions", "Food"],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 5,
    external_link_count: 3,
    word_count: 1200,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-a",
    extraction_certainty: "confirmed",
    ...over,
  } as PageSnapshot;
}

function signal(over: Partial<GscPageSignal> = {}): GscPageSignal {
  return {
    page: "https://iranopedia.com/chaharshanbe-suri",
    clicks28d: 40,
    impressions28d: 3000,
    ctr28d: 0.013,
    position28d: 6.2,
    topQueries: [
      { query: "what is chaharshanbe suri", clicks: 20, impressions: 1500, ctr: 0.013, position: 5.1 },
      { query: "persian fire festival", clicks: 10, impressions: 600, ctr: 0.016, position: 7.0 },
    ],
    ...over,
  };
}

describe("isQuestionShaped", () => {
  it("matches interrogative openers and question marks", () => {
    expect(isQuestionShaped("what is nowruz")).toBe(true);
    expect(isQuestionShaped("How to cook ghormeh sabzi")).toBe(true);
    expect(isQuestionShaped("Cities in Iran?")).toBe(true);
    expect(isQuestionShaped("list of largest cities in iran")).toBe(true);
  });
  it("does NOT match merely-definitional titles", () => {
    expect(isQuestionShaped("Khorasan Rug: Motifs, History, and Patterns")).toBe(false);
    expect(isQuestionShaped("Famous Iranian Poets")).toBe(false);
    expect(isQuestionShaped("")).toBe(false);
  });
});

describe("hasEarlyAnswerScaffold", () => {
  it("true when FAQs, FAQ schema, or a question-shaped H2 exist", () => {
    expect(hasEarlyAnswerScaffold(snap({ faqs: [{ question: "q", answer_excerpt: "a", source: "jsonld" }] }))).toBe(true);
    expect(hasEarlyAnswerScaffold(snap({ faq_schema_block_count: 1 }))).toBe(true);
    expect(hasEarlyAnswerScaffold(snap({ h2_list: ["What is it?", "More"] }))).toBe(true);
  });
  it("false for a plain content page with topic-label H2s", () => {
    expect(hasEarlyAnswerScaffold(snap())).toBe(false);
  });
});

describe("strongestQuestion", () => {
  it("prefers the highest-impression question GSC query", () => {
    const out = strongestQuestion(snap(), signal());
    expect(out).toEqual({ question: "what is chaharshanbe suri", source: "gsc_query" });
  });
  it("falls back to a question-shaped title when GSC absent", () => {
    const out = strongestQuestion(snap(), undefined);
    expect(out!.source).toBe("title");
    expect(out!.question).toContain("Chaharshanbe Suri");
  });
  it("ignores low-impression question queries", () => {
    const out = strongestQuestion(
      snap({ title: "Khorasan Rug: Motifs" }),
      signal({ topQueries: [{ query: "what is a khorasan rug", clicks: 0, impressions: 40, ctr: 0, position: 9 }] }),
    );
    expect(out).toBeNull();
  });
});

describe("answerBlockReadiness", () => {
  it("emits add_answer_block on a question page with no answer scaffold", () => {
    const out = answerBlockReadiness({ tenantId: "tenant-a", snapshot: snap(), signal: signal() });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("missing_answer_block");
    expect(c.action_type).toBe("add_answer_block");
    expect(c.topic_cluster_label).toBe("what is chaharshanbe suri");
    expect(c.operator_evidence).toContain("demand_source=gsc_query");
    expect(c.customer_copy).toContain("chaharshanbe suri");
    expect(c.safety_flags).toEqual([]);
  });

  it("fires crawl-only (no GSC) on a question-shaped title", () => {
    const out = answerBlockReadiness({ tenantId: "tenant-a", snapshot: snap(), signal: undefined });
    expect(out).toHaveLength(1);
    expect(out[0]!.operator_evidence).toContain("demand_source=title");
  });

  it("abstains when the page already has an answer scaffold", () => {
    const out = answerBlockReadiness({
      tenantId: "tenant-a",
      snapshot: snap({ h2_list: ["What is Chaharshanbe Suri?", "History"] }),
      signal: signal(),
    });
    expect(out).toEqual([]);
  });

  it("abstains on a definitional (non-question) title with no question query", () => {
    const out = answerBlockReadiness({
      tenantId: "tenant-a",
      snapshot: snap({ title: "Khorasan Rug: Motifs, History, and Patterns", h1: "Khorasan Rug" }),
      signal: signal({ topQueries: [{ query: "khorasan rug patterns", clicks: 5, impressions: 800, ctr: 0.006, position: 8 }] }),
    });
    expect(out).toEqual([]);
  });

  it("abstains on non-HTML and error pages", () => {
    expect(answerBlockReadiness({ tenantId: "t", snapshot: snap({ url: "https://x.com/a.pdf" }), signal: signal() })).toEqual([]);
    expect(answerBlockReadiness({ tenantId: "t", snapshot: snap({ http_status: 404 }), signal: signal() })).toEqual([]);
  });
});
