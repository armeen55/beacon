import { describe, it, expect } from "vitest";

import { classifyFaqChange } from "@/domains/scanning/faq-change-classifier";
import type { PageSnapshot, FaqItem } from "@/domains/pages/types";

/**
 * Phase C (2026-04-24) — FAQ change classifier contract.
 *
 * Covers the five cases the operator called out. Fixtures model the
 * four Ritz pages that produced misleading findings on 2026-04-22,
 * plus a visible-removed case and a pure-expansion case.
 */

function faq(
  source: "jsonld" | "html_details" | "html_section",
  question: string,
): FaqItem {
  return { question, answer_excerpt: "a", source };
}

function mkSnap(
  url: string,
  faqs: FaqItem[],
  blocks: number,
  fetchedAt = "2026-04-22T00:00:00Z",
): PageSnapshot {
  return {
    id: `snap-${url}-${fetchedAt}`,
    page_id: `pg-${url}`,
    url,
    canonical_url: url,
    fetched_at: fetchedAt,
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs,
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    faq_schema_block_count: blocks,
    tenant_id: "",
  };
}

describe("classifyFaqChange", () => {
  // ── Case C: duplicate schema cleanup ───────────────────────────────

  it("/our-process-style: 16 → 8 JSON-LD with 2 → 1 FAQPage blocks → duplicate_schema_cleanup", () => {
    const q = Array.from({ length: 8 }, (_, i) => faq("jsonld", `Q${i}`));
    const prev = mkSnap(
      "https://ritzbuilders.com/our-process",
      [...q, ...q], // 2 duplicate FAQPage blocks × 8 Qs
      2,
    );
    const curr = mkSnap(
      "https://ritzbuilders.com/our-process",
      [...q], // 1 block × 8 Qs
      1,
    );
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("duplicate_schema_cleanup");
    expect(r.severity).toBe("low");
    expect(r.summary).toMatch(/Duplicate FAQ.schema cleanup/);
    expect(r.summary).toContain("/our-process");
    expect(r.summary).toContain("2 FAQPage blocks → 1");
  });

  it("/locations/palo-alto-style: 12 → 6 JSON-LD with 2 → 1 blocks → duplicate_schema_cleanup", () => {
    const q = Array.from({ length: 6 }, (_, i) => faq("jsonld", `Q${i}`));
    const prev = mkSnap("https://ritzbuilders.com/locations/palo-alto", [...q, ...q], 2);
    const curr = mkSnap("https://ritzbuilders.com/locations/palo-alto", [...q], 1);
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("duplicate_schema_cleanup");
    expect(r.severity).toBe("low");
  });

  // ── Case B: FAQ schema removed, visible content still present ─────

  it("/services-style with visible FAQs: 10 jsonld → 0 jsonld, visible intact → schema_removed_visible_present", () => {
    const jsonldQs = Array.from({ length: 10 }, (_, i) => faq("jsonld", `Q${i}`));
    const visibleQs = Array.from({ length: 6 }, (_, i) =>
      faq("html_details", `Visible Q${i}`),
    );
    const prev = mkSnap(
      "https://ritzbuilders.com/services",
      [...jsonldQs, ...visibleQs],
      1,
    );
    const curr = mkSnap(
      "https://ritzbuilders.com/services",
      [...visibleQs],
      0,
    );
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("schema_removed_visible_present");
    expect(r.summary).toMatch(/FAQ schema removed/);
    expect(r.summary).toMatch(/visible FAQ content still present/);
    expect(r.summary).toContain("6 Q&A");
  });

  // ── Case A: visible FAQ content removed ───────────────────────────

  it("true visible removal: html_details go 5 → 0 → visible_removed", () => {
    const visibleQs = Array.from({ length: 5 }, (_, i) =>
      faq("html_details", `Q${i}`),
    );
    const prev = mkSnap("https://ritzbuilders.com/services", visibleQs, 0);
    const curr = mkSnap("https://ritzbuilders.com/services", [], 0);
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("visible_removed");
    expect(r.severity).toBe("high");
    expect(r.summary).toMatch(/Visible FAQ content removed/);
  });

  // ── Case D: FAQ content expanded ──────────────────────────────────

  it("/faq-style: 10 → 34 → expanded", () => {
    const prevQs = Array.from({ length: 10 }, (_, i) => faq("jsonld", `Q${i}`));
    const currQs = Array.from({ length: 34 }, (_, i) => faq("jsonld", `Q${i}`));
    const prev = mkSnap("https://ritzbuilders.com/faq", prevQs, 1);
    const curr = mkSnap("https://ritzbuilders.com/faq", currQs, 1);
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("expanded");
    expect(r.severity).toBe("low");
    expect(r.summary).toMatch(/FAQ content expanded/);
    expect(r.summary).toContain("10 → 34");
    expect(r.summary).toContain("+24");
  });

  // ── Case E: structure changed — review ────────────────────────────

  it("mixed reduction not matching a known pattern → structure_changed", () => {
    // 10 jsonld + 0 visible → 4 jsonld + 0 visible. 1 block → 1 block.
    // Not halving (10 / 4 != 2), not zero-out, not schema removal.
    const prev = mkSnap(
      "https://ritzbuilders.com/services",
      Array.from({ length: 10 }, (_, i) => faq("jsonld", `Q${i}`)),
      1,
    );
    const curr = mkSnap(
      "https://ritzbuilders.com/services",
      Array.from({ length: 4 }, (_, i) => faq("jsonld", `Q${i}`)),
      1,
    );
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("structure_changed");
    expect(r.summary).toMatch(/FAQ structure changed/);
  });

  it("jsonld-only content zeroed out with no visible content → structure_changed (cannot confirm visible-removed)", () => {
    // /services-style without visible fallback. JSON-LD was the only
    // source; we legitimately can't tell from the extractor whether
    // visible content was ever there. Fall to structure_changed, not
    // visible_removed — operator must open the page.
    const prev = mkSnap(
      "https://ritzbuilders.com/services",
      Array.from({ length: 10 }, (_, i) => faq("jsonld", `Q${i}`)),
      1,
    );
    const curr = mkSnap("https://ritzbuilders.com/services", [], 0);
    const r = classifyFaqChange(prev, curr);
    expect(r.kind).toBe("structure_changed");
    expect(r.summary).toMatch(/FAQ structure changed/);
  });

  // ── Evidence shape ─────────────────────────────────────────────────

  it("evidence object carries prev/curr counts per source and block count", () => {
    const prev = mkSnap(
      "https://ritzbuilders.com/our-process",
      [
        faq("jsonld", "A"),
        faq("jsonld", "B"),
        faq("html_details", "C"),
      ],
      2,
    );
    const curr = mkSnap(
      "https://ritzbuilders.com/our-process",
      [faq("jsonld", "A"), faq("html_details", "C")],
      1,
    );
    const r = classifyFaqChange(prev, curr);
    expect(r.evidence.prevTotal).toBe(3);
    expect(r.evidence.currTotal).toBe(2);
    expect(r.evidence.prevJsonld).toBe(2);
    expect(r.evidence.currJsonld).toBe(1);
    expect(r.evidence.prevVisible).toBe(1);
    expect(r.evidence.currVisible).toBe(1);
    expect(r.evidence.prevBlocks).toBe(2);
    expect(r.evidence.currBlocks).toBe(1);
  });
});
