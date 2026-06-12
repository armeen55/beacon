/**
 * Insight Graph slice 1 (2026-06-12) — `gsc-low-ctr` trigger tests.
 * Rule A: position ≤5 (sourced benchmark band), impressions ≥200/28d,
 * ctr < 0.5 × positional benchmark → ONE edit_title candidate carrying
 * the worst under-performing query.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import {
  EXPECTED_CTR_BY_POSITION,
  gscLowCtr,
  underperformingQueries,
} from "@/domains/recommendation-intelligence/triggers/gsc-low-ctr";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/persian-tea-houses",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: "Tea",
    meta_description: null,
    h1: "Persian Tea Houses",
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

function signal(over: Partial<GscPageSignal> = {}): GscPageSignal {
  return {
    page: "https://example.com/persian-tea-houses",
    clicks28d: 12,
    impressions28d: 900,
    ctr28d: 0.013,
    position28d: 3.2,
    topQueries: [
      // position 3 → benchmark 10.2%; ctr 1.0% < 5.1% threshold → FIRES
      { query: "persian tea houses", clicks: 5, impressions: 500, ctr: 0.01, position: 3.1 },
      // healthy query — above threshold
      { query: "tea house history", clicks: 30, impressions: 250, ctr: 0.12, position: 2.2 },
    ],
    ...over,
  };
}

describe("underperformingQueries", () => {
  it("flags only sourced-band (pos 1–5), high-impression, below-half-benchmark queries", () => {
    const out = underperformingQueries(signal());
    expect(out.map((q) => q.query)).toEqual(["persian tea houses"]);
  });

  it("ignores queries outside positions 1–5 (no guessed benchmarks)", () => {
    const out = underperformingQueries(
      signal({
        topQueries: [
          { query: "deep query", clicks: 1, impressions: 800, ctr: 0.001, position: 9.4 },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("ignores low-impression queries (28d noise floor)", () => {
    const out = underperformingQueries(
      signal({
        topQueries: [
          { query: "rare query", clicks: 0, impressions: 40, ctr: 0, position: 2.0 },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("benchmark table covers exactly positions 1–5", () => {
    expect(Object.keys(EXPECTED_CTR_BY_POSITION).map(Number).sort()).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});

describe("gscLowCtr predicate", () => {
  it("emits ONE edit_title candidate carrying the worst query + exact numbers", () => {
    const out = gscLowCtr({
      tenantId: "tenant-a",
      snapshot: snap(),
      signal: signal(),
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("gsc_low_ctr");
    expect(c.action_type).toBe("edit_title");
    expect(c.confidence).toBe("medium");
    expect(c.impact_estimate).toBe("high");
    expect(c.topic_cluster_label).toBe("persian tea houses");
    expect(c.evidence[0]!.detail).toContain("impressions=500");
    expect(c.evidence[0]!.detail).toContain("position=3.1");
    expect(c.customer_copy).toContain("persian tea houses");
    expect(c.customer_copy).toContain("500");
    expect(c.safety_flags).toEqual([]);
  });

  it("does NOT emit without a signal (GSC not connected / no rows)", () => {
    expect(
      gscLowCtr({ tenantId: "tenant-a", snapshot: snap(), signal: undefined }),
    ).toEqual([]);
  });

  it("does NOT emit when every query is healthy", () => {
    const healthy = signal({
      topQueries: [
        { query: "good one", clicks: 60, impressions: 400, ctr: 0.15, position: 2.0 },
      ],
    });
    expect(
      gscLowCtr({ tenantId: "tenant-a", snapshot: snap(), signal: healthy }),
    ).toEqual([]);
  });
});

// ── Rule B (2026-06-12) — first-party striking distance ──────────────
import { gscStrikingDistance } from "@/domains/recommendation-intelligence/triggers/gsc-low-ctr";

describe("gscStrikingDistance predicate (Rule B)", () => {
  it("emits when a 4–15 position query with ≥100 impressions is absent from the title", () => {
    const out = gscStrikingDistance({
      tenantId: "tenant-a",
      snapshot: snap({ title: "Tea" }),
      signal: signal({
        topQueries: [
          { query: "persian tea ceremony", clicks: 4, impressions: 320, ctr: 0.0125, position: 9.2 },
        ],
      }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.trigger_signal).toBe("gsc_striking_distance");
    expect(out[0]!.topic_cluster_label).toBe("persian tea ceremony");
    expect(out[0]!.evidence[0]!.detail).toContain("impressions=320");
  });

  it("abstains when the query already appears in the title", () => {
    const out = gscStrikingDistance({
      tenantId: "tenant-a",
      snapshot: snap({ title: "Persian Tea Ceremony Guide" }),
      signal: signal({
        topQueries: [
          { query: "persian tea ceremony", clicks: 4, impressions: 320, ctr: 0.0125, position: 9.2 },
        ],
      }),
    });
    expect(out).toEqual([]);
  });

  it("ignores positions outside 4–15 and low impressions", () => {
    const out = gscStrikingDistance({
      tenantId: "tenant-a",
      snapshot: snap({ title: "Tea" }),
      signal: signal({
        topQueries: [
          { query: "top three", clicks: 9, impressions: 300, ctr: 0.03, position: 2.1 },
          { query: "page two deep", clicks: 0, impressions: 300, ctr: 0, position: 18.0 },
          { query: "thin one", clicks: 1, impressions: 40, ctr: 0.025, position: 9.0 },
        ],
      }),
    });
    expect(out).toEqual([]);
  });
});

// ── Fusion-EV slice (2026-06-12) ──────────────────────────────────────
import { upsideBonus, MAX_UPSIDE_BONUS, priorityScore } from "@/domains/recommendation-intelligence/priority-score";

describe("fusion EV — upside_clicks_28d", () => {
  it("Rule A candidates carry the CTR-gap × impressions upside", () => {
    const out = gscLowCtr({ tenantId: "tenant-a", snapshot: snap(), signal: signal() });
    // pos 3.1 → benchmark 10.2%; actual 1.0%; 500 impressions →
    // (0.102 − 0.01) × 500 ≈ 46.
    expect(out[0]!.upside_clicks_28d).toBe(46);
  });

  it("upsideBonus is log-scaled and capped", () => {
    expect(upsideBonus(undefined)).toBe(0);
    expect(upsideBonus(0)).toBe(0);
    expect(upsideBonus(9)).toBe(4); // 4·log10(10) = 4
    expect(upsideBonus(99)).toBe(8);
    expect(upsideBonus(1_000_000)).toBe(MAX_UPSIDE_BONUS);
  });

  it("the bonus lifts the score but an index blocker still outranks content polish", () => {
    const content = priorityScore({
      trigger_signal: "gsc_low_ctr",
      action_type: "edit_title",
      target_page_type: "content",
      confidence: "medium",
      prerequisite_resolved: true,
      safety_flags: [],
      upside_clicks_28d: 1_000_000, // even at the cap…
    });
    const blocker = priorityScore({
      trigger_signal: "bad_http_status",
      action_type: "fix_status_code",
      target_page_type: "content",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // (28+0+12+15)·0.75 ≈ 41 < (30+25+12)·1.0 = 67
    expect(blocker).toBeGreaterThan(content);
  });
});

// ── GA4 value weight (2026-06-12) ─────────────────────────────────────
import { ga4ValueWeight } from "@/domains/recommendation-intelligence/ga4-page-values";

describe("ga4ValueWeight", () => {
  it("neutral without data or value mass", () => {
    expect(ga4ValueWeight(undefined)).toBe(1.0);
    expect(
      ga4ValueWeight({ page: "p", sessions28d: 50, engaged28d: 0, conversions28d: 0 }),
    ).toBe(1.0);
  });

  it("log-damped and capped at 1.5", () => {
    const small = ga4ValueWeight({ page: "p", sessions28d: 0, engaged28d: 0, conversions28d: 9 });
    expect(small).toBeCloseTo(1.25, 2); // 1 + 0.25·log10(10)
    const huge = ga4ValueWeight({ page: "p", sessions28d: 0, engaged28d: 0, conversions28d: 1_000_000 });
    expect(huge).toBe(1.5);
  });

  it("priorityScore applies the bounded multiplier without breaking the blocker ordering", () => {
    const weighted = priorityScore({
      trigger_signal: "gsc_low_ctr",
      action_type: "edit_title",
      target_page_type: "content",
      confidence: "medium",
      prerequisite_resolved: true,
      safety_flags: [],
      page_value_weight: 1.5,
    });
    const blocker = priorityScore({
      trigger_signal: "bad_http_status",
      action_type: "fix_status_code",
      target_page_type: "content",
      confidence: "high",
      prerequisite_resolved: true,
      safety_flags: [],
    });
    // (28+12)·1.5·0.75 = 45 < 67
    expect(blocker).toBeGreaterThan(weighted);
  });
});
