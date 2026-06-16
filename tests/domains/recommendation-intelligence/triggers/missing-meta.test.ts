/**
 * Slice 4.5.B.α₀ — trigger predicate `missing-meta` unit tests.
 *
 * 2026-06-16 (root-cause-#3 gap): the predicate now splits on whether the
 * deterministic composeMeta can auto-draft a meta from the page
 * (`selectMetaSource` non-null). When it CAN → `edit_meta` (publishable,
 * pushable) exactly as before. When it CANNOT (list/label-soup prose,
 * common on Wix) → a NON-PUSHABLE `improve_meta` DIRECTIVE instead of a
 * blank `edit_meta` card with a NULL draft.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import { missingMeta } from "@/domains/recommendation-intelligence/triggers/missing-meta";

// Default snapshot carries a clean prose body sentence (>40 chars) so
// `selectMetaSource` CAN auto-draft → the default missing-meta case stays
// `edit_meta`. Individual tests override `body_paragraph_sample` / h2 / cards
// to exercise the improve_meta directive branch.
function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/a",
    canonical_url: null,
    fetched_at: "2026-05-19T00:00:00Z",
    http_status: 200,
    title: "A real title",
    meta_description: "A clean meta description",
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
    body_paragraph_sample: [
      "Our whole-home remodels rework the layout, finishes, and systems of an entire house into one cohesive design.",
    ],
    ...overrides,
  };
}

describe("missingMeta predicate", () => {
  it("emits zero candidates when meta is a non-empty string", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: "real meta" }),
    });
    expect(out).toHaveLength(0);
  });

  it("emits a single edit_meta candidate when meta is null AND prose is draftable", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: null }),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("missing_meta");
    expect(row.action_type).toBe("edit_meta");
    expect(row.target_url).toBe("https://example.com/a");
    expect(row.confidence).toBe("high");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.evidence.length).toBeGreaterThanOrEqual(1);
    expect(row.safety_flags).toEqual([]);
  });

  it("emits a single candidate when meta is empty string", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: "" }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.action_type).toBe("edit_meta");
  });

  it("emits a single candidate when meta is whitespace-only", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: "   \n  " }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.action_type).toBe("edit_meta");
  });

  it("edit_meta customer_copy passes operator-locked phrasing", () => {
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ meta_description: null }),
    });
    expect(out[0]!.customer_copy).toBe(
      "Add a meta description so AI search platforms have a clean snippet to extract.",
    );
  });

  // ── Root-cause-#3 gap (2026-06-16): improve_meta directive branch ──────

  it("emits improve_meta when meta is null AND there's NO liftable prose (list-soup body, label-only structure)", () => {
    // Caught live on Wix recipe pages: the body is a bullet ingredient list
    // (not prose) and the structure is colon-labels / step headings, so
    // composeMeta refuses (selectMetaSource null). Instead of a blank
    // edit_meta card, emit a directive.
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        meta_description: null,
        body_paragraph_sample: [
          "• 1 lb Ground Beef• 1 small Onion, minced• 2 cloves Garlic• 2 Tbsp Mint• 1 Tbsp Aleppo Pepper",
        ],
        h1: "Koobideh Kabob Recipe",
        h2_list: ["Ingredients:", "Serving Info:", "Step 1: Mix the Meat"],
        card_texts: [],
      }),
    });
    expect(out).toHaveLength(1);
    const row = out[0]!;
    expect(row.trigger_signal).toBe("missing_meta");
    expect(row.action_type).toBe("improve_meta");
    expect(row.confidence).toBe("high");
    expect(row.target_url).toBe("https://example.com/a");
    expect(row.safety_flags).toEqual([]);
    // White-label, jargon-free directive copy.
    expect(row.customer_copy).toContain("too thin to draft one automatically");
    expect(row.customer_copy).not.toMatch(/Profound/i);
  });

  it("emits improve_meta when meta is null AND structure is too short (thin page)", () => {
    // No body prose, H1 alone < 40 chars, no real prose fragments → null.
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        meta_description: null,
        body_paragraph_sample: ["Too short."],
        h1: "Tea",
        h2_list: ["History", "Where to go"],
        card_texts: [],
      }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.action_type).toBe("improve_meta");
  });

  it("stays edit_meta when meta is null AND a clean prose card fragment carries the description", () => {
    // Wix hides body copy from the extractor, but a long prose CARD fragment
    // is liftable → composeMeta can draft → edit_meta (unchanged).
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        meta_description: null,
        body_paragraph_sample: [],
        h1: "Persian Tea Houses",
        h2_list: ["History", "Where to go"],
        card_texts: [
          "Iranian tea houses, known as chaikhaneh, have served as gathering places for poetry and conversation for generations.",
        ],
      }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.action_type).toBe("edit_meta");
  });

  it("a chromeDetector that flags the only prose fragment as chrome → improve_meta (matches enrichment)", () => {
    // The card fragment is the ONLY liftable prose; if the site-wide chrome
    // detector flags it as boilerplate, composeMeta drops it and refuses —
    // so the trigger must emit improve_meta, NOT a blank edit_meta. This
    // pins the no-divergence contract between trigger + enrichment.
    const cardText =
      "Iranian tea houses, known as chaikhaneh, have served as gathering places for poetry and conversation for generations.";
    const out = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({
        meta_description: null,
        body_paragraph_sample: [],
        h1: "Tea",
        h2_list: [],
        card_texts: [cardText],
      }),
      chromeDetector: (t) => t.trim() === cardText.trim(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.action_type).toBe("improve_meta");
  });

  it("(α₂.2) SKIPS technical assets (`.txt`, `.xml`, `.json`, `.pdf`, images)", () => {
    for (const url of [
      "https://example.com/llms.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/data.json",
      "https://example.com/file.pdf",
      "https://example.com/image.png",
    ]) {
      const out = missingMeta({
        tenantId: "tenant-a",
        snapshot: makeSnapshot({ url, meta_description: null }),
      });
      expect(out, `should skip ${url}`).toHaveLength(0);
    }
  });

  it("dedupe_key and cooldown_key differ from missing-title's keys (different action_type)", async () => {
    const { missingTitle } = await import(
      "@/domains/recommendation-intelligence/triggers/missing-title"
    );
    const titleOut = missingTitle({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, meta_description: null }),
    })[0]!;
    const metaOut = missingMeta({
      tenantId: "tenant-a",
      snapshot: makeSnapshot({ title: null, meta_description: null }),
    })[0]!;
    expect(titleOut.dedupe_key).not.toBe(metaOut.dedupe_key);
    expect(titleOut.cooldown_key).not.toBe(metaOut.cooldown_key);
  });
});
