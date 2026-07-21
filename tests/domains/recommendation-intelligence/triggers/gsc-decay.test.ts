/**
 * Decay slice (2026-06-12) — `gsc-decay` trigger tests. The
 * two-signal rule: clicks down >20% AND weighted position worse by
 * ≥2, across consecutive 28d windows; prior-clicks floor keeps
 * percentages meaningful.
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { GscDecaySignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import {
  gscDecay,
  isDecaying,
} from "@/domains/recommendation-intelligence/triggers/gsc-decay";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://example.com/persian-poets",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: "Persian Poets",
    meta_description: null,
    h1: "Persian Poets",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 900,
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

function decaying(over: Partial<GscDecaySignal> = {}): GscDecaySignal {
  return {
    page: "https://example.com/persian-poets",
    clicksNow: 40,
    clicksPrior: 80,
    impressionsNow: 2000,
    impressionsPrior: 2100,
    positionNow: 9.4,
    positionPrior: 5.1,
    windowNowEnd: "2026-07-09",
    ...over,
  };
}

describe("isDecaying — the two-signal rule", () => {
  it("fires when BOTH signals cross (clicks -50%, position +4.3)", () => {
    expect(isDecaying(decaying())).toBe(true);
  });

  it("abstains on a clicks drop alone (position stable)", () => {
    expect(isDecaying(decaying({ positionNow: 5.3 }))).toBe(false);
  });

  it("abstains on a position drop alone (clicks stable)", () => {
    expect(isDecaying(decaying({ clicksNow: 78 }))).toBe(false);
  });

  it("abstains below the prior-clicks floor (percentages meaningless)", () => {
    expect(
      isDecaying(decaying({ clicksPrior: 10, clicksNow: 2 })),
    ).toBe(false);
  });
});

describe("gscDecay predicate", () => {
  it("emits ONE update_intro refresh candidate with the exact numbers", () => {
    const out = gscDecay({
      tenantId: "tenant-a",
      snapshot: snap(),
      signal: decaying(),
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("gsc_decay");
    expect(c.action_type).toBe("update_intro");
    expect(c.confidence).toBe("medium");
    expect(c.evidence[0]!.detail).toContain("80->40");
    expect(c.customer_copy).toContain("50%");
  });

  it("does NOT emit without a signal or when healthy", () => {
    expect(
      gscDecay({ tenantId: "tenant-a", snapshot: snap(), signal: undefined }),
    ).toEqual([]);
    expect(
      gscDecay({
        tenantId: "tenant-a",
        snapshot: snap(),
        signal: decaying({ clicksNow: 85, positionNow: 5.0 }),
      }),
    ).toEqual([]);
  });

  it("threads top queries into operator_evidence (capped to 3, pipe/semicolon-stripped)", () => {
    const c = gscDecay({
      tenantId: "tenant-a",
      snapshot: snap(),
      signal: decaying(),
      topQueries: [
        "persian male names",
        "iran|ian boy; names",
        "farsi names",
        "fourth query dropped",
      ],
    })[0]!;
    expect(c.operator_evidence).toContain(
      "top_queries=persian male names|iran ian boy  names|farsi names",
    );
    // capped at 3 — the fourth is dropped
    expect(c.operator_evidence).not.toContain("fourth query");
  });

  it("omits top_queries when none are supplied (big-tenant heavy-read timeout → numbers-only)", () => {
    const c = gscDecay({
      tenantId: "tenant-a",
      snapshot: snap(),
      signal: decaying(),
    })[0]!;
    expect(c.operator_evidence).not.toContain("top_queries=");
    const empty = gscDecay({
      tenantId: "tenant-a",
      snapshot: snap(),
      signal: decaying(),
      topQueries: [],
    })[0]!;
    expect(empty.operator_evidence).not.toContain("top_queries=");
  });
});
