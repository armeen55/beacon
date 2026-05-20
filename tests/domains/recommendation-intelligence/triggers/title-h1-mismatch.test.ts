/**
 * Slice 4.5.B.α₁ — trigger predicate `title-h1-mismatch` unit tests.
 *
 * Stopword-aware Jaccard ≥ 0.3 suppresses; below 0.3 fires PAIRED
 * candidates (edit_title + change_h1) with distinct dedupe_keys.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { titleH1Mismatch } from "@/domains/recommendation-intelligence/triggers/title-h1-mismatch";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/a",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "Whole Home Remodel in Palo Alto",
    meta_description: "Meta",
    h1: "Whole Home Remodel",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 100,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-a",
    ...overrides,
  };
}

describe("titleH1Mismatch predicate — alignment", () => {
  it("suppresses when title and h1 align (high Jaccard)", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Whole Home Remodel in Palo Alto",
        h1: "Whole Home Remodel in Palo Alto",
      }),
    });
    expect(out).toHaveLength(0);
  });

  it("suppresses when token overlap is partial but above threshold", () => {
    // title: {whole, home, remodel, palo, alto} (5 tokens)
    // h1:    {whole, home, remodel}             (3 tokens)
    // intersection: 3; union: 5; jaccard: 0.6 ≥ 0.3 → suppress
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Whole Home Remodel in Palo Alto",
        h1: "Whole Home Remodel",
      }),
    });
    expect(out).toHaveLength(0);
  });

  it("fires when token overlap is below threshold", () => {
    // title: {whole, home, remodel}      (3 tokens, "in" stripped)
    // h1:    {atherton, excellence}      (2 tokens)
    // intersection: 0; union: 5; jaccard: 0 < 0.3 → FIRE
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    });
    expect(out).toHaveLength(2);
  });
});

describe("titleH1Mismatch predicate — paired emission", () => {
  it("fires both edit_title and change_h1 candidates with distinct dedupe_keys", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    });
    expect(out).toHaveLength(2);
    const actionTypes = out.map((r) => r.action_type).sort();
    expect(actionTypes).toEqual(["change_h1", "edit_title"]);
    expect(out[0]!.dedupe_key).not.toBe(out[1]!.dedupe_key);
    // Same trigger_signal across both rows.
    expect(out[0]!.trigger_signal).toBe("title_h1_mismatch");
    expect(out[1]!.trigger_signal).toBe("title_h1_mismatch");
    // Cooldown keys also differ (action_type contributes).
    expect(out[0]!.cooldown_key).not.toBe(out[1]!.cooldown_key);
  });

  it("paired rows share confidence, impact, customer_copy, target_url, evidence", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    });
    expect(out[0]!.confidence).toBe(out[1]!.confidence);
    expect(out[0]!.confidence).toBe("medium");
    expect(out[0]!.impact_estimate).toBe(out[1]!.impact_estimate);
    expect(out[0]!.customer_copy).toBe(out[1]!.customer_copy);
    expect(out[0]!.target_url).toBe(out[1]!.target_url);
    expect(out[0]!.operator_evidence).toBe(out[1]!.operator_evidence);
  });
});

describe("titleH1Mismatch predicate — stopword handling", () => {
  it("strips universal stopwords before Jaccard so 'in/the/of' alignment does not save", () => {
    // After stopword strip:
    // title: {custom, builder} (2 tokens; "the", "best")
    // h1:    {atherton} (1 token; "the")
    // intersection: 0; union: 3; jaccard: 0 < 0.3 → FIRE
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "The Best Custom Builder",
        h1: "The Atherton",
      }),
    });
    expect(out).toHaveLength(2);
  });

  it("suppresses tokens of length < 2", () => {
    // "X" + "I" + "1" — all length-1 tokens are stripped from
    // tokenization. Keeps only multi-char tokens.
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "X home",
        h1: "I home",
      }),
    });
    // Both tokenize to {home} → jaccard 1.0 → suppress.
    expect(out).toHaveLength(0);
  });

  it("keeps numeric tokens (years, zips, phones) when length >= 2", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Atherton 94027 Homes",
        h1: "94027 Builders",
      }),
    });
    // title: {atherton, 94027, homes}
    // h1:    {94027, builders}
    // intersection: 1 ({94027}); union: 4; jaccard: 0.25 < 0.3 → FIRE
    expect(out).toHaveLength(2);
  });
});

describe("titleH1Mismatch predicate — defensive behavior", () => {
  it("skips when title is null", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, h1: "Some heading" }),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when h1 is null", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: "Some title", h1: null }),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when title is empty", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: "  ", h1: "Heading" }),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when h1 is empty", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: "Title", h1: "" }),
    });
    expect(out).toHaveLength(0);
  });

  it("skips when tokenization yields empty sets (all stopwords)", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "the a an",
        h1: "of and or",
      }),
    });
    expect(out).toHaveLength(0);
  });

  it("customer_copy passes operator-locked phrasing", () => {
    const out = titleH1Mismatch({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        title: "Whole Home Remodel",
        h1: "Atherton Excellence",
      }),
    });
    expect(out[0]!.customer_copy).toBe(
      "Bring the page title and H1 into closer alignment so AI search platforms see consistent intent for this page.",
    );
  });
});
