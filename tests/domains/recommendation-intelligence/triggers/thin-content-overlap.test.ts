/**
 * 2026-06-11 (night shift, #43) — thin_content_overlap → merge_pages.
 * Pins: thin+overlap pair emits ONE diagnostic candidate targeting the
 * alphabetically-second page; fat pages never pair; boilerplate brand
 * tokens don't count as overlap; confidence is LOW (diagnostic_only
 * routing); technical assets and error pages are excluded.
 */

import { describe, it, expect } from "vitest";

import {
  thinContentOverlap,
  THIN_WORD_COUNT,
} from "@/domains/recommendation-intelligence/triggers/thin-content-overlap";
import type { PageSnapshot } from "@/domains/pages/types";

function snap(over: Partial<PageSnapshot>): PageSnapshot {
  return {
    id: `s-${over.url}`,
    page_id: `p-${over.url}`,
    url: "https://x.com/a",
    canonical_url: null,
    fetched_at: "2026-06-11T04:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 200,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "x",
    faq_hash: "x",
    schema_hash: "x",
    tenant_id: "tenant-x",
    ...over,
  };
}

const A = snap({
  url: "https://x.com/persian-tea-houses",
  title: "Persian Tea Houses in Tehran",
  word_count: 250,
});
const B = snap({
  url: "https://x.com/tehran-tea-houses",
  title: "Tea Houses of Tehran — Persian Traditions",
  word_count: 180,
});

describe("thinContentOverlap", () => {
  it("emits ONE low-confidence merge candidate for an overlapping thin pair", () => {
    const out = thinContentOverlap({ tenantId: "tenant-x", snapshots: [A, B] });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("thin_content_overlap");
    expect(c.action_type).toBe("merge_pages");
    expect(c.confidence).toBe("low"); // diagnostic_only routing
    // Target = alphabetically-second URL; anchor referenced in evidence.
    expect(c.target_url).toBe("https://x.com/tehran-tea-houses");
    expect(c.evidence[0]!.detail).toContain("persian-tea-houses");
    expect(c.customer_copy).toContain("Folding them into one stronger page");
  });

  it("fat pages never pair, even with identical titles", () => {
    const out = thinContentOverlap({
      tenantId: "tenant-x",
      snapshots: [
        snap({ url: "u1", title: "Persian Tea Houses", word_count: THIN_WORD_COUNT + 100 }),
        snap({ url: "u2", title: "Persian Tea Houses", word_count: 200 }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("non-overlapping thin pages never pair", () => {
    const out = thinContentOverlap({
      tenantId: "tenant-x",
      snapshots: [
        snap({ url: "u1", title: "Persian Rugs of Qom", word_count: 150 }),
        snap({ url: "u2", title: "Caspian Sea Travel Tips", word_count: 150 }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("site-wide brand tokens don't count as topical overlap", () => {
    // "Iranopedia" appears on every page (≥3 docs, >50%) — boilerplate.
    const filler = [1, 2, 3].map((i) =>
      snap({ url: `f${i}`, title: `Topic ${i}ABCD | Iranopedia`, word_count: 900 }),
    );
    const out = thinContentOverlap({
      tenantId: "tenant-x",
      snapshots: [
        ...filler,
        snap({ url: "t1", title: "Alpha Beta | Iranopedia", word_count: 100 }),
        snap({ url: "t2", title: "Gamma Delta | Iranopedia", word_count: 100 }),
      ],
    });
    expect(out).toEqual([]);
  });

  it("error pages and non-HTML assets are excluded", () => {
    const out = thinContentOverlap({
      tenantId: "tenant-x",
      snapshots: [
        { ...A, http_status: 404 },
        B,
        snap({ url: "https://x.com/file.pdf", title: B.title, word_count: 100 }),
      ],
    });
    expect(out).toEqual([]);
  });
});
