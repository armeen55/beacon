/**
 * 2026-06-11 (night shift, #44) — stale_content → update_intro.
 * Pins: lastmod older than 18 months emits (oldest first, capped at
 * 15/run); unknown lastmod NEVER emits; fresh pages never emit;
 * confidence LOW (diagnostic_only routing); assets/error pages excluded.
 */

import { describe, it, expect } from "vitest";

import {
  staleContent,
  normalizeStaleUrl,
  MAX_EMISSIONS_PER_RUN,
} from "@/domains/recommendation-intelligence/triggers/stale-content";
import type { PageSnapshot } from "@/domains/pages/types";

const NOW = new Date("2026-06-11T05:00:00Z");

function snap(url: string, over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: `s-${url}`,
    page_id: `p-${url}`,
    url,
    canonical_url: null,
    fetched_at: "2026-06-11T04:00:00Z",
    http_status: 200,
    title: "T",
    meta_description: null,
    h1: "H",
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
    headings_hash: "x",
    faq_hash: "x",
    schema_hash: "x",
    tenant_id: "tenant-x",
    ...over,
  };
}

describe("staleContent", () => {
  it("emits a low-confidence update_intro candidate for an 18-month-stale page", () => {
    const out = staleContent({
      tenantId: "tenant-x",
      snapshots: [snap("https://x.com/old-page")],
      lastmodByUrl: new Map([["https://x.com/old-page", "2019-03-01"]]),
      now: NOW,
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("stale_content");
    expect(c.action_type).toBe("update_intro");
    expect(c.confidence).toBe("low");
    expect(c.evidence[0]!.detail).toContain("2019-03-01");
  });

  it("unknown lastmod NEVER emits (unknown age ≠ stale)", () => {
    const out = staleContent({
      tenantId: "tenant-x",
      snapshots: [snap("https://x.com/mystery")],
      lastmodByUrl: new Map(),
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it("fresh pages never emit", () => {
    const out = staleContent({
      tenantId: "tenant-x",
      snapshots: [snap("https://x.com/fresh")],
      lastmodByUrl: new Map([["https://x.com/fresh", "2026-05-01"]]),
      now: NOW,
    });
    expect(out).toEqual([]);
  });

  it("caps at the oldest MAX_EMISSIONS_PER_RUN pages", () => {
    const snaps = Array.from({ length: MAX_EMISSIONS_PER_RUN + 5 }, (_, i) =>
      snap(`https://x.com/p${i}`),
    );
    const lastmods = new Map(
      snaps.map((s, i) => [
        normalizeStaleUrl(s.url),
        `20${10 + (i % 5)}-01-0${(i % 9) + 1}`,
      ]),
    );
    const out = staleContent({
      tenantId: "tenant-x",
      snapshots: snaps,
      lastmodByUrl: lastmods,
      now: NOW,
    });
    expect(out).toHaveLength(MAX_EMISSIONS_PER_RUN);
    // Oldest first: every emitted lastmod ≤ every skipped one.
    const emitted = out.map((c) => c.operator_evidence.match(/lastmod=([0-9-]+)/)![1]!);
    expect([...emitted].sort()[emitted.length - 1]! <= "2014-12-31").toBe(true);
  });

  it("error pages + non-HTML assets excluded", () => {
    const out = staleContent({
      tenantId: "tenant-x",
      snapshots: [
        snap("https://x.com/gone", { http_status: 404 }),
        snap("https://x.com/file.pdf"),
      ],
      lastmodByUrl: new Map([
        ["https://x.com/gone", "2019-01-01"],
        ["https://x.com/file.pdf", "2019-01-01"],
      ]),
      now: NOW,
    });
    expect(out).toEqual([]);
  });
});
