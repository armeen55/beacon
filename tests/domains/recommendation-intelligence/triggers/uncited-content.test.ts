/**
 * Source-ledger slice tests (2026-06-12 night shift) —
 * `uncited_content`: substantive content pages (contentSiteMode only)
 * with zero external references earn an add_proof_section card whose
 * downstream draft is a DIRECTIVE (never invented sources).
 */

import { describe, expect, it } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { BusinessConfig } from "@/lib/business-config";
import {
  UNCITED_MIN_WORD_COUNT,
  uncitedContent,
} from "@/domains/recommendation-intelligence/triggers/uncited-content";

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-1",
    page_id: "page-1",
    url: "https://iranopedia.com/persepolis",
    canonical_url: null,
    fetched_at: "2026-06-12T04:00:00Z",
    http_status: 200,
    title: "Persepolis",
    meta_description: null,
    h1: "Persepolis",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 4,
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
  } as PageSnapshot;
}

function contentConfig(over: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    contentSiteMode: true,
    ...over,
  } as BusinessConfig;
}

describe("uncitedContent", () => {
  it("fires for a long content page with zero external references", () => {
    const out = uncitedContent({
      tenantId: "tenant-a",
      snapshot: snap(),
      businessConfig: contentConfig(),
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("uncited_content");
    expect(c.action_type).toBe("add_proof_section");
    expect(c.confidence).toBe("medium");
    expect(c.evidence[0]!.detail).toContain("external_link_count=0");
    expect(c.operator_evidence).toContain("play=add_sources_section");
    expect(c.safety_flags).toEqual([]);
  });

  it("abstains when the tenant is NOT a content site (no vertical hardcoding)", () => {
    const out = uncitedContent({
      tenantId: "tenant-a",
      snapshot: snap(),
      businessConfig: contentConfig({ contentSiteMode: false }),
    });
    expect(out).toEqual([]);
  });

  it("abstains on short pages, pages with external links, and error pages", () => {
    const cfg = contentConfig();
    expect(
      uncitedContent({
        tenantId: "t",
        snapshot: snap({ word_count: UNCITED_MIN_WORD_COUNT - 1 }),
        businessConfig: cfg,
      }),
    ).toEqual([]);
    expect(
      uncitedContent({
        tenantId: "t",
        snapshot: snap({ external_link_count: 2 }),
        businessConfig: cfg,
      }),
    ).toEqual([]);
    expect(
      uncitedContent({
        tenantId: "t",
        snapshot: snap({ http_status: 404 }),
        businessConfig: cfg,
      }),
    ).toEqual([]);
  });
});
