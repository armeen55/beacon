/**
 * Insight Graph slice 2 (2026-06-12) — `semrush-striking-distance`
 * trigger tests. Band 4–20 (sourced union), volume ≥10, keyword-in-
 * title presence check (SEJ play): absent → edit_title candidate;
 * present → abstain.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { SemrushPageSignal } from "@/domains/recommendation-intelligence/semrush-page-signals";
import {
  semrushStrikingDistance,
  textContainsKeyword,
} from "@/domains/recommendation-intelligence/triggers/semrush-striking-distance";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/persian-rugs",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: "Rug Shop",
    meta_description: null,
    h1: "Persian Rugs",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 600,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "x",
    headings_hash: "y",
    faq_hash: "z",
    schema_hash: "w",
    tenant_id: "tenant-a",
    extraction_certainty: "confirmed",
    ...over,
  };
}

function signal(over: Partial<SemrushPageSignal> = {}): SemrushPageSignal {
  return {
    page: "https://example.com/persian-rugs",
    keywords: [],
    strikingDistance: [
      { keyword: "persian rugs qom", position: 12, volume: 590, difficulty: 30, intent: "1" },
      { keyword: "antique rugs", position: 8, volume: 320, difficulty: 25, intent: "0" },
    ],
    ...over,
  };
}

describe("textContainsKeyword", () => {
  it("tokenized containment, case-insensitive", () => {
    expect(textContainsKeyword("Persian Rugs from Qom", "persian rugs qom")).toBe(true);
    expect(textContainsKeyword("Rug Shop", "persian rugs")).toBe(false);
    expect(textContainsKeyword(null, "x")).toBe(false);
  });
});

describe("semrushStrikingDistance predicate", () => {
  it("emits ONE edit_title candidate for the top striking keyword absent from the title", () => {
    const out = semrushStrikingDistance({
      tenantId: "tenant-a",
      snapshot: snap(),
      signal: signal(),
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("semrush_striking_distance");
    expect(c.action_type).toBe("edit_title");
    expect(c.topic_cluster_label).toBe("persian rugs qom");
    expect(c.evidence[0]!.detail).toContain("position=12");
    expect(c.evidence[0]!.detail).toContain("volume_per_month=590");
    expect(c.customer_copy).toContain("persian rugs qom");
    expect(c.customer_copy).toContain("#12");
  });

  it("skips keywords already present in the title (falls to the next; abstains when all covered)", () => {
    const covered = snap({ title: "Persian Rugs Qom | Antique Rugs Shop" });
    const out = semrushStrikingDistance({
      tenantId: "tenant-a",
      snapshot: covered,
      signal: signal(),
    });
    expect(out).toEqual([]);
  });

  it("does NOT emit without a signal or with an empty striking list", () => {
    expect(
      semrushStrikingDistance({ tenantId: "tenant-a", snapshot: snap(), signal: undefined }),
    ).toEqual([]);
    expect(
      semrushStrikingDistance({
        tenantId: "tenant-a",
        snapshot: snap(),
        signal: signal({ strikingDistance: [] }),
      }),
    ).toEqual([]);
  });
});
