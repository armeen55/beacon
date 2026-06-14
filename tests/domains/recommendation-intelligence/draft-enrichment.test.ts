/**
 * 2026-06-10 — deterministic draft enrichment (P0 wall 3).
 * Pins: every composer produces correct copy from snapshot data, the
 * no-fake-content rule (insufficient data → row unchanged), the
 * never-overwrite rule, id/element-key stability, and brand-suffix
 * inference from the tenant's own titles (zero hardcoding).
 */

import { describe, it, expect } from "vitest";

import {
  enrichPromotionRow,
  inferBrandSuffix,
  stripBrandSuffix,
  clipOnWordBoundary,
  suggestLinkSources,
  type DraftEnrichmentContext,
} from "@/domains/recommendation-intelligence/draft-enrichment";
import type { DeterministicPromotionEditRow } from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";
import type { RecommendationCandidateRow } from "@/domains/recommendation-intelligence/emitter/candidate-row";
import type { PageSnapshot } from "@/domains/pages/types";

const URL_A = "https://example-site.com/persian-tea-houses";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: URL_A,
    canonical_url: URL_A,
    fetched_at: "2026-06-10T04:00:00Z",
    http_status: 200,
    title: "Persian Tea Houses | Iranopedia",
    meta_description: null,
    h1: "Persian Tea Houses",
    h2_list: ["History", "Where to go"],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 3,
    external_link_count: 0,
    word_count: 900,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "x",
    faq_hash: "x",
    schema_hash: "x",
    tenant_id: "tenant-iranopedia",
    body_paragraph_sample: [
      "Tea houses have anchored Iranian social life for centuries, serving as gathering places for poetry, conversation, and business across every city.",
    ],
    ...over,
  };
}

function candidate(over: Partial<RecommendationCandidateRow> = {}): RecommendationCandidateRow {
  return {
    tenant_id: "tenant-iranopedia",
    trigger_signal: "missing_title",
    action_type: "edit_title",
    generator_kind: "trigger",
    target_url: URL_A,
    topic_cluster_label: "persian tea houses",
    evidence: [],
    confidence: "medium",
    impact_estimate: "medium",
    customer_copy: "This page has no title.",
    operator_evidence: "missing_title",
    dedupe_key: "d",
    cooldown_key: "c",
    created_from_signal_at: "2026-06-10T04:00:00Z",
    safety_flags: [],
    ...over,
  } as unknown as RecommendationCandidateRow;
}

function row(over: Partial<DeterministicPromotionEditRow> = {}): DeterministicPromotionEditRow {
  return {
    id: "promotion-abc__edit_title__null",
    tenant_id: "tenant-iranopedia",
    rec_id: "promotion-abc",
    action_type: "edit_title",
    target_url: URL_A,
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "This page has no title.",
    evidence: [{ type: "owned_page", url: URL_A }],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion",
    provider_name: null,
    evidence_hash: "h",
    model: null,
    cost_usd: 0,
    created_at: "2026-06-10T05:30:00Z",
    updated_at: "2026-06-10T05:30:00Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as DeterministicPromotionEditRow;
}

function ctxOf(...snaps: PageSnapshot[]): DraftEnrichmentContext {
  return { snapshotByUrl: new Map(snaps.map((s) => [s.url, s])) };
}

describe("pure helpers", () => {
  it("inferBrandSuffix finds the brand tail (≥3 pages across ≥2 path segments)", () => {
    const brand = inferBrandSuffix([
      snap({ url: "https://x.com/tea-houses", title: "Tea Houses | Iranopedia" }),
      snap({ url: "https://x.com/rugs/qom", title: "Persian Rugs | Iranopedia" }),
      snap({ url: "https://x.com/flags", title: "Iran Flags | Iranopedia" }),
      snap({ url: "https://x.com/one-off", title: "One-off — Other" }),
    ]);
    expect(brand).toEqual({ separator: " | ", suffix: "Iranopedia" });
  });

  it("inferBrandSuffix returns null without a repeated suffix", () => {
    expect(
      inferBrandSuffix([snap({ url: "u1", title: "Just A Title" })]),
    ).toBeNull();
  });

  it("inferBrandSuffix REJECTS a collection tail confined to one path segment (Wix dynamic pages)", () => {
    // Caught live: every /iran-animals/* page ends "| Iran Animals &
    // Wildlife" — the most COMMON tail, but a collection, not the brand.
    const brand = inferBrandSuffix([
      snap({ url: "https://x.com/iran-animals/leopard", title: "Persian Leopard | Iran Animals & Wildlife" }),
      snap({ url: "https://x.com/iran-animals/cheetah", title: "Asiatic Cheetah | Iran Animals & Wildlife" }),
      snap({ url: "https://x.com/iran-animals/bear", title: "Brown Bear | Iran Animals & Wildlife" }),
    ]);
    expect(brand).toBeNull();
  });

  it("stripBrandSuffix removes only the inferred suffix", () => {
    const brand = { separator: " | ", suffix: "Iranopedia" };
    expect(stripBrandSuffix("Tea Houses | Iranopedia", brand)).toBe("Tea Houses");
    expect(stripBrandSuffix("Tea Houses | Elsewhere", brand)).toBe("Tea Houses | Elsewhere");
  });

  it("clipOnWordBoundary clips at a word, ≤ max", () => {
    const out = clipOnWordBoundary("alpha beta gamma delta", 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out).toBe("alpha beta");
  });
});

describe("enrichPromotionRow — content drafts", () => {
  it("edit_title: composes from h1 + inferred brand suffix", () => {
    const s1 = snap({ title: null });
    const s2 = snap({ url: "https://x.com/rugs/qom", title: "Persian Rugs | Iranopedia" });
    const s3 = snap({ url: "https://x.com/flags", title: "Iran Flags | Iranopedia" });
    const s4 = snap({ url: "https://x.com/cities/tehran", title: "Tehran | Iranopedia" });
    const out = enrichPromotionRow(row(), candidate(), ctxOf(s1, s2, s3, s4));
    expect(out.proposed_text).toBe("Persian Tea Houses | Iranopedia");
    expect(out.display_label).toContain("Add a page title");
    expect(out.target_element_key).toBeNull(); // id stability
    expect(out.id).toBe(row().id);
  });

  it("strips zero-width junk (U+200B/U+FEFF) from TITLE drafts too, not just meta (#12)", () => {
    // The #105 fix only sanitized composeMeta; composeTitle/H1/schema passed
    // raw snap.h1/snap.title (which can carry CMS zero-width chars) into
    // customer proposed_text. The single chokepoint now strips every draft.
    const s1 = snap({ title: null, h1: "Persian Tea Houses\u200B" });
    const s2 = snap({ url: "https://x.com/rugs/qom", title: "Persian Rugs | Iranopedia" });
    const s3 = snap({ url: "https://x.com/flags", title: "Iran Flags | Iranopedia" });
    const s4 = snap({ url: "https://x.com/cities/tehran", title: "Tehran | Iranopedia" });
    const out = enrichPromotionRow(row(), candidate(), ctxOf(s1, s2, s3, s4));
    // Without the strip this would be "Persian Tea Houses\u200B | Iranopedia".
    expect(out.proposed_text).toBe("Persian Tea Houses | Iranopedia");
    expect(out.proposed_text!).not.toMatch(/[\u200B\uFEFF]/);
    expect(out.display_label ?? "").not.toMatch(/[\u200B\uFEFF]/);
  });

  it("edit_title: a CMS placeholder h1 (“Page Title”) never becomes the draft", () => {
    const out = enrichPromotionRow(
      row(),
      candidate(),
      ctxOf(snap({ h1: "Page Title", h2_list: [] })),
    );
    // Falls past the placeholder h1 to the title-cased cluster label.
    expect(out.proposed_text).toBe("Persian Tea Houses");
  });

  it("edit_meta: clips real body copy to ≤155 chars on a word boundary", () => {
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(snap()),
    );
    expect(out.proposed_text).not.toBeNull();
    expect(out.proposed_text!.length).toBeLessThanOrEqual(155);
    expect(out.proposed_text!).toContain("Tea houses");
  });

  it("edit_meta: thin body falls back to page structure (h1 + h2s, own words only)", () => {
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(snap({ body_paragraph_sample: ["Too short."] })),
    );
    expect(out.proposed_text).toBe("Persian Tea Houses — History — Where to go");
  });

  it("edit_meta: refuses when body AND structure are both thin (no fake content)", () => {
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(snap({ body_paragraph_sample: [], h1: null, h2_list: [], card_texts: [] })),
    );
    expect(out.proposed_text).toBeNull(); // unchanged row
  });

  it("edit_meta: site-wide chrome pieces are excluded from the structural fallback", () => {
    // "Browse by" + "Explore More" appear on 3 of 4 pages (>50%, ≥3) —
    // template chrome, not content (caught live on Wix category pages).
    const chrome = ["Browse by", "Explore More"];
    const target = snap({
      body_paragraph_sample: [],
      h1: "Persian Accessories",
      h2_list: [...chrome, "Handmade jewelry and traditional accessories from Iran"],
      card_texts: [],
    });
    const others = [1, 2, 3].map((i) =>
      snap({ url: `https://x.com/p${i}`, h2_list: [...chrome], card_texts: [] }),
    );
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(target, ...others),
    );
    expect(out.proposed_text).toContain("Handmade jewelry");
    expect(out.proposed_text).not.toContain("Browse by");
    expect(out.proposed_text).not.toContain("Explore More");
  });

  it("edit_meta: drops colon-terminated section LABELS so a recipe/spec page isn't a broken label list", () => {
    // Caught live on iranopedia.com/persian-kabobs/koobideh-kabob: the
    // structural fallback joined the page's section headings
    // ("Ingredients:", "Serving Info:", "Cooking Time:") with " — ",
    // producing a meta description that reads as broken placeholder. Labels
    // (fragments ending in ":") must be dropped; real prose stays.
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(
        snap({
          body_paragraph_sample: [],
          h1: "Koobideh Kabob Recipe",
          h2_list: ["Ingredients:", "Serving Info:", "Cooking Time:"],
          card_texts: [
            "Combine ground beef with grated onion, salt, and pepper, then knead until the mixture is smooth and holds together on the skewer.",
          ],
        }),
      ),
    );
    expect(out.proposed_text).not.toBeNull();
    expect(out.proposed_text!).not.toMatch(/Ingredients:|Serving Info:|Cooking Time:/);
    expect(out.proposed_text!).toContain("Koobideh Kabob Recipe");
    expect(out.proposed_text!).toContain("Combine ground beef");
  });

  it("edit_meta: refuses when the structural source is ONLY section labels (all colon-terminated)", () => {
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(
        snap({
          body_paragraph_sample: [],
          h1: "Specs:",
          h2_list: ["Dimensions:", "Weight:", "Materials:"],
          card_texts: [],
        }),
      ),
    );
    expect(out.proposed_text).toBeNull(); // all labels filtered → < 40 chars → no fake draft
  });

  it("edit_meta: drops zero-width-only chunks (no \"Kabob Barg \u2014 \u200b \u2014\" garbage)", () => {
    // Wix injects ZERO-WIDTH SPACE into empty headings/cards; they
    // survive .trim() and previously joined as 1-char chunks. Caught
    // live on iranopedia's kabob page.
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(
        snap({
          body_paragraph_sample: [],
          h1: "Kabob Barg, a classic Persian grilled lamb skewer dish",
          h2_list: ["\u200B", " \u200B ", "\u200B\u200B"],
          card_texts: ["\u200B"],
        }),
      ),
    );
    expect(out.proposed_text).toBe(
      "Kabob Barg, a classic Persian grilled lamb skewer dish",
    );
    expect(out.proposed_text).not.toContain(" \u2014 ");
    expect(out.proposed_text).not.toContain("\u200B");
  });

  it("edit_meta: PRESERVES internal Persian ZWNJ (U+200C) inside real words", () => {
    const word = "می‌روم"; // mi-ravam, with internal ZWNJ
    const out = enrichPromotionRow(
      row({ action_type: "edit_meta" }),
      candidate({ trigger_signal: "missing_meta", action_type: "edit_meta" }),
      ctxOf(
        snap({
          body_paragraph_sample: [],
          h1: word + " " + "چهارشنبه سوری جشن آتش ایرانیان است",
          h2_list: ["\u200B"],
          card_texts: [],
        }),
      ),
    );
    expect(out.proposed_text).toContain(word); // ZWNJ kept intact
  });

  it("change_h1: derives from the title with the brand suffix stripped", () => {
    const s1 = snap({ h1: null });
    const s2 = snap({ url: "https://x.com/rugs/qom", title: "Persian Rugs | Iranopedia" });
    const s3 = snap({ url: "https://x.com/flags", title: "Iran Flags | Iranopedia" });
    const s4 = snap({ url: "https://x.com/cities/tehran", title: "Tehran | Iranopedia" });
    const out = enrichPromotionRow(
      row({ action_type: "change_h1" }),
      candidate({ trigger_signal: "missing_h1", action_type: "change_h1" }),
      ctxOf(s1, s2, s3, s4),
    );
    expect(out.proposed_text).toBe("Persian Tea Houses");
  });
});

describe("enrichPromotionRow — fix directives", () => {
  it("fix_canonical quotes current vs correct canonical", () => {
    const out = enrichPromotionRow(
      row({ action_type: "fix_canonical" }),
      candidate({ trigger_signal: "canonical_mismatch", action_type: "fix_canonical" }),
      ctxOf(snap({ canonical_url: "https://other.example.com/page" })),
    );
    expect(out.proposed_text).toContain('to "https://example-site.com/persian-tea-houses"');
    expect(out.proposed_text).toContain("https://other.example.com/page");
    expect(out.current_text).toBe("https://other.example.com/page");
  });

  it("fix_status_code quotes the observed status", () => {
    const out = enrichPromotionRow(
      row({ action_type: "fix_status_code" }),
      candidate({ trigger_signal: "bad_http_status", action_type: "fix_status_code" }),
      ctxOf(snap({ http_status: 404 })),
    );
    expect(out.proposed_text).toContain("HTTP 404");
    expect(out.display_label).toContain("404");
  });

  it("fix_noindex quotes the current robots meta", () => {
    const out = enrichPromotionRow(
      row({ action_type: "fix_noindex" }),
      candidate({ trigger_signal: "noindex_on_indexable_page", action_type: "fix_noindex" }),
      ctxOf(snap({ robots_meta: "noindex, follow" })),
    );
    expect(out.proposed_text).toContain("noindex, follow");
  });

  it("fix_sitemap + fix_robots produce origin-specific directives", () => {
    const sm = enrichPromotionRow(
      row({ action_type: "fix_sitemap" }),
      candidate({ trigger_signal: "sitemap_missing", action_type: "fix_sitemap" }),
      ctxOf(snap()),
    );
    expect(sm.proposed_text).toContain("https://example-site.com/sitemap.xml");
    const rb = enrichPromotionRow(
      row({ action_type: "fix_robots" }),
      candidate({ trigger_signal: "robots_blocks_googlebot", action_type: "fix_robots" }),
      ctxOf(snap()),
    );
    expect(rb.proposed_text).toContain("Googlebot");
  });
});

describe("enrichPromotionRow — links + schema", () => {
  it("add_internal_link suggests related pages by title-word overlap", () => {
    const target = snap();
    const related = snap({
      url: "https://example-site.com/persian-tea-ceremony",
      title: "Persian Tea Ceremony | Iranopedia",
      h1: "Persian Tea Ceremony",
    });
    const unrelated = snap({
      url: "https://example-site.com/contact",
      title: "Contact | Iranopedia",
      h1: "Contact",
    });
    const out = enrichPromotionRow(
      row({ action_type: "add_internal_link" }),
      candidate({ trigger_signal: "orphan_page", action_type: "add_internal_link" }),
      ctxOf(target, related, unrelated),
    );
    expect(out.proposed_text).toContain("persian-tea-ceremony");
    expect(out.proposed_text).not.toContain("/contact");
  });

  it("suggestLinkSources excludes error pages and the target itself", () => {
    const sources = suggestLinkSources(
      URL_A,
      snap(),
      "persian tea houses",
      ctxOf(
        snap(),
        snap({ url: "u2", title: "Persian Tea Gardens", http_status: 404 }),
      ).snapshotByUrl,
    );
    expect(sources).toEqual([]);
  });

  it("add_schema emits valid JSON-LD carrying the page's own name/url", () => {
    const out = enrichPromotionRow(
      row({ action_type: "add_schema" }),
      candidate({ trigger_signal: "missing_schema", action_type: "add_schema" }),
      ctxOf(snap()),
    );
    const m = out.proposed_text!.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]!) as Record<string, unknown>;
    expect(parsed["@type"]).toBe("WebPage");
    expect(parsed.url).toBe(URL_A);
    expect(parsed.name).toContain("Persian Tea Houses");
  });
});

describe("enrichPromotionRow — guardrails", () => {
  it("never overwrites an existing proposed_text", () => {
    const pre = row({ proposed_text: "operator-authored draft" });
    const out = enrichPromotionRow(pre, candidate(), ctxOf(snap()));
    expect(out.proposed_text).toBe("operator-authored draft");
  });

  it("unknown action types pass through unchanged", () => {
    const pre = row({ action_type: "watch" as DeterministicPromotionEditRow["action_type"] });
    const out = enrichPromotionRow(
      pre,
      candidate({ action_type: "watch" as RecommendationCandidateRow["action_type"] }),
      ctxOf(snap()),
    );
    expect(out).toBe(pre);
  });

  it("no snapshot for the URL → content composers degrade to cluster label, fix composers stay silent", () => {
    const title = enrichPromotionRow(row(), candidate(), ctxOf());
    expect(title.proposed_text).toBe("Persian Tea Houses"); // title-cased cluster
    const canon = enrichPromotionRow(
      row({ action_type: "fix_canonical" }),
      candidate({ trigger_signal: "canonical_mismatch", action_type: "fix_canonical" }),
      ctxOf(),
    );
    expect(canon.proposed_text).toBeNull();
  });
});

// ── Content Schema Engine (2026-06-12) ───────────────────────────────
// `missing_schema_content` candidates get a COMPLETE Article
// (+BreadcrumbList) JSON-LD draft. The drafts are pinned against the
// scanner's own validateSchema() so Beacon can never propose markup
// its own scanner would flag (closed loop).

import { validateSchemaToStrings } from "@/domains/pages/schema-validator";

const CONTENT_URL = "https://example-site.com/famous-iranians/hafez";

/** Parse every JSON-LD <script> block out of a proposed_text draft. */
function extractJsonLdBlocks(text: string | null): unknown[] {
  if (!text) return [];
  const out: unknown[] = [];
  const re = /<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(JSON.parse(m[1]!));
  }
  return out;
}

function contentSnap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return snap({
    url: CONTENT_URL,
    title: "Hafez | Iranopedia",
    h1: "Hafez",
    meta_description:
      "Hafez was a 14th-century Persian lyric poet whose ghazals remain central to Iranian culture.",
    ...over,
  });
}

function contentCandidate(over: Partial<RecommendationCandidateRow> = {}) {
  return candidate({
    trigger_signal: "missing_schema_content",
    action_type: "add_schema",
    target_url: CONTENT_URL,
    ...over,
  });
}

function contentRow(over: Partial<DeterministicPromotionEditRow> = {}) {
  return row({
    action_type: "add_schema",
    target_url: CONTENT_URL,
    ...over,
  });
}

/** Brand-bearing fleet: ≥3 titled pages across ≥2 first path segments
 *  ending " | Iranopedia" so inferBrandSuffix resolves the brand. */
function brandFleet(): PageSnapshot[] {
  return [
    snap({ url: "https://example-site.com/tea-houses", title: "Tea Houses | Iranopedia" }),
    snap({ url: "https://example-site.com/rugs/qom", title: "Persian Rugs | Iranopedia" }),
    snap({ url: "https://example-site.com/flags", title: "Iran Flags | Iranopedia" }),
    contentSnap(),
  ];
}

describe("enrichPromotionRow — Content Schema Engine (add_schema, content pages)", () => {
  it("composes a COMPLETE Article + BreadcrumbList draft from page facts", () => {
    const out = enrichPromotionRow(
      contentRow(),
      contentCandidate(),
      ctxOf(...brandFleet()),
    );
    expect(out.display_label).toBe(
      "Add Article structured data so AI engines understand this page",
    );
    const blocks = extractJsonLdBlocks(out.proposed_text) as Array<
      Record<string, unknown>
    >;
    expect(blocks).toHaveLength(2);

    const article = blocks[0]!;
    expect(article["@type"]).toBe("Article");
    expect(article["headline"]).toBe("Hafez");
    expect(article["description"]).toContain("14th-century Persian lyric poet");
    expect(article["mainEntityOfPage"]).toEqual({
      "@type": "WebPage",
      "@id": CONTENT_URL,
    });
    expect(article["author"]).toEqual({
      "@type": "Organization",
      name: "Iranopedia",
    });
    expect(article["publisher"]).toEqual({
      "@type": "Organization",
      name: "Iranopedia",
    });

    const breadcrumb = blocks[1]!;
    expect(breadcrumb["@type"]).toBe("BreadcrumbList");
    const items = breadcrumb["itemListElement"] as Array<
      Record<string, unknown>
    >;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Iranopedia",
      item: "https://example-site.com/",
    });
    expect(items[1]).toEqual({
      "@type": "ListItem",
      position: 2,
      name: "Famous Iranians",
      item: "https://example-site.com/famous-iranians",
    });
    // Google breadcrumb rule: the LAST element omits `item`.
    expect(items[2]).toEqual({ "@type": "ListItem", position: 3, name: "Hafez" });
    expect(Object.keys(items[2]!)).not.toContain("item");
  });

  it("CLOSED LOOP: drafts pass the scanner's own validateSchema with zero criticals", () => {
    const out = enrichPromotionRow(
      contentRow(),
      contentCandidate(),
      ctxOf(...brandFleet()),
    );
    const blocks = extractJsonLdBlocks(out.proposed_text);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const criticals = validateSchemaToStrings(block).filter((s) =>
        s.startsWith("schema_critical"),
      );
      expect(criticals).toEqual([]);
    }
  });

  it("omits author/publisher when no brand infers and description when no source exists (never fabricates)", () => {
    const bare = contentSnap({
      meta_description: null,
      body_paragraph_sample: [],
      title: "Hafez", // no suffix → brand cannot infer from one page
    });
    const out = enrichPromotionRow(
      contentRow(),
      contentCandidate(),
      ctxOf(bare),
    );
    const blocks = extractJsonLdBlocks(out.proposed_text) as Array<
      Record<string, unknown>
    >;
    const article = blocks[0]!;
    expect(article["headline"]).toBe("Hafez");
    expect(article).not.toHaveProperty("author");
    expect(article).not.toHaveProperty("publisher");
    expect(article).not.toHaveProperty("description");
  });

  it("keeps Persian text verbatim — no Latin casing mangling, JSON round-trips", () => {
    const fa = contentSnap({ h1: "حافظ شیرازی", title: null });
    const out = enrichPromotionRow(contentRow(), contentCandidate(), ctxOf(fa));
    const blocks = extractJsonLdBlocks(out.proposed_text) as Array<
      Record<string, unknown>
    >;
    expect(blocks[0]!["headline"]).toBe("حافظ شیرازی");
    const items = (blocks[1]! as { itemListElement: Array<Record<string, unknown>> })
      .itemListElement;
    expect(items[items.length - 1]!["name"]).toBe("حافظ شیرازی");
  });

  it("returns the row UNCHANGED when neither h1 nor title exists (better empty than fake)", () => {
    const empty = contentSnap({ h1: null, title: null });
    const pre = contentRow();
    const out = enrichPromotionRow(pre, contentCandidate(), ctxOf(empty));
    expect(out).toBe(pre);
  });

  it("non-content add_schema candidates keep the generic WebPage skeleton", () => {
    const out = enrichPromotionRow(
      contentRow(),
      contentCandidate({ trigger_signal: "missing_schema" }),
      ctxOf(contentSnap()),
    );
    expect(out.proposed_text).toContain('"@type": "WebPage"');
    expect(out.proposed_text).toContain("extend the @type");
  });
});

// ── fix_schema slice (2026-06-12) ────────────────────────────────────
// `invalid_schema` candidates get a repair directive quoting the
// scanner's own validator output verbatim (prefix stripped).

describe("enrichPromotionRow — fix_schema repair directives", () => {
  const warnedSnap = () =>
    contentSnap({
      schema_types: ["Product"],
      schema_validation_warnings: [
        "schema_warning:Product: Product missing offers block — price/availability rich results won't fire.",
        "schema_critical:FAQPage: Missing mainEntity.",
        "schema_info:LocalBusiness: missing telephone.",
      ],
    });

  it("drafts a directive listing exactly the actionable validator lines (info excluded)", () => {
    const out = enrichPromotionRow(
      contentRow({ action_type: "fix_schema" }),
      contentCandidate({
        trigger_signal: "invalid_schema",
        action_type: "fix_schema",
      }),
      ctxOf(warnedSnap()),
    );
    expect(out.display_label).toBe("Repair this page's structured data");
    expect(out.proposed_text).toContain("2 issues");
    expect(out.proposed_text).toContain(
      "- Product: Product missing offers block",
    );
    expect(out.proposed_text).toContain("- FAQPage: Missing mainEntity.");
    expect(out.proposed_text).not.toContain("schema_warning:");
    expect(out.proposed_text).not.toContain("missing telephone");
  });

  it("returns the row UNCHANGED when the snapshot has no actionable warnings", () => {
    const pre = contentRow({ action_type: "fix_schema" });
    const out = enrichPromotionRow(
      pre,
      contentCandidate({
        trigger_signal: "invalid_schema",
        action_type: "fix_schema",
      }),
      ctxOf(contentSnap({ schema_validation_warnings: [] })),
    );
    expect(out).toBe(pre);
  });
});
