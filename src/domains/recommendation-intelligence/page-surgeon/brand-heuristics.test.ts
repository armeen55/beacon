/**
 * brand-heuristics tests (2026-07-21) - ported from the retired
 * draft-enrichment.test.ts pure-helper block when the trigger->promotion
 * producer pipeline was deleted. Pins the two helpers the Ready path
 * (artifact-bundle / assemble-packet) still consumes.
 */
import { describe, it, expect } from "vitest";
import { inferBrandSuffix, isCmsPlaceholder } from "./brand-heuristics";
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

describe("inferBrandSuffix", () => {
  it("finds the brand tail (>=3 pages across >=2 path segments)", () => {
    const brand = inferBrandSuffix([
      snap({ url: "https://x.com/tea-houses", title: "Tea Houses | Iranopedia" }),
      snap({ url: "https://x.com/rugs/qom", title: "Persian Rugs | Iranopedia" }),
      snap({ url: "https://x.com/flags", title: "Iran Flags | Iranopedia" }),
      snap({ url: "https://x.com/one-off", title: "One-off — Other" }),
    ]);
    expect(brand).toEqual({ separator: " | ", suffix: "Iranopedia" });
  });

  it("returns null without a repeated suffix", () => {
    expect(
      inferBrandSuffix([snap({ url: "u1", title: "Just A Title" })]),
    ).toBeNull();
  });

  it("REJECTS a collection tail confined to one path segment (Wix dynamic pages)", () => {
    // Caught live: every /iran-animals/* page ends "| Iran Animals &
    // Wildlife" - the most COMMON tail, but a collection, not the brand.
    const brand = inferBrandSuffix([
      snap({ url: "https://x.com/iran-animals/leopard", title: "Persian Leopard | Iran Animals & Wildlife" }),
      snap({ url: "https://x.com/iran-animals/cheetah", title: "Asiatic Cheetah | Iran Animals & Wildlife" }),
      snap({ url: "https://x.com/iran-animals/bear", title: "Brown Bear | Iran Animals & Wildlife" }),
    ]);
    expect(brand).toBeNull();
  });
});

describe("isCmsPlaceholder", () => {
  it("flags CMS template residue, case- and whitespace-insensitively", () => {
    expect(isCmsPlaceholder("Untitled Page")).toBe(true);
    expect(isCmsPlaceholder("  page title  ")).toBe(true);
    expect(isCmsPlaceholder("Your Title Here")).toBe(true);
  });

  it("never flags real content titles", () => {
    expect(isCmsPlaceholder("Persian Tea Houses")).toBe(false);
    expect(isCmsPlaceholder("Iranopedia")).toBe(false);
  });
});
