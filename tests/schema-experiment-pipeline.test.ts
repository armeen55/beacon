/**
 * Phase 1 — End-to-end integration test for the schema-experiment pipeline.
 *
 * Traces one synthetic deploy through every layer:
 *
 *   1. Before snapshot (FAQPage only)
 *   2. After snapshot  (FAQPage + 3 new types)
 *   3. `deriveSchemaChangelogFields` → schema_added + structured fields
 *   4. ChangelogEntry carries the structured fields
 *   5. Event assembler claims the entry as a page_level event
 *   6. `attributeEvents` with `changelogById` → matching_specificity = "exact"
 *   7. EventAttribution.evidence reflects the matched schema experiment
 *
 * This is the spine of Day 4's work — if every step passes, tomorrow's
 * manual-confirm flow will produce clean attribution.
 */

import { describe, it, expect } from "vitest";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { PageSnapshot } from "@/domains/pages/types";
import type { UrlDailySeries } from "@/domains/attribution/event-attributor";
import { deriveSchemaChangelogFields } from "@/domains/changelog/derive-schema-fields";
import { assembleEvents } from "@/domains/events/assembler";
import { attributeEvents } from "@/domains/attribution/event-attributor";

function snap(over: Partial<PageSnapshot> & { url: string }): PageSnapshot {
  const base: PageSnapshot = {
    id: "snap-test",
    page_id: "pg-test",
    url: over.url,
    canonical_url: over.url,
    fetched_at: "2026-04-16T12:00:00Z",
    http_status: 200,
    title: "Test",
    meta_description: "Test",
    h1: "Test",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    internal_links: [],
    word_count: 100,
    robots_meta: "index, follow",
    has_canonical_mismatch: false,
    content_hash: "c-same",
    headings_hash: "h-same",
    faq_hash: "f-same",
    schema_hash: "s-same",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    table_count: 0,
    tenant_id: "",
    observation_run_id: "obs-test",
  } as PageSnapshot;
  return { ...base, ...over };
}

describe("Phase 1 — schema-experiment pipeline end-to-end", () => {
  it("palo-alto: FAQPage-only → full stack → attributed at exact specificity", () => {
    // ── 1. Pre-deploy snapshot (the state on Apr 16 before tonight) ────
    const prev = snap({
      url: "https://ritzbuilders.com/locations/palo-alto",
      schema_types: ["FAQPage"],
      schema_hash: "palo-schema-v1",
      content_hash: "palo-content-v1",
    });

    // ── 2. Post-deploy snapshot (what tomorrow's scan will see) ────────
    const cur = snap({
      url: "https://ritzbuilders.com/locations/palo-alto",
      schema_types: [
        "FAQPage",
        "HomeAndConstructionBusiness",
        "WebPage",
        "BreadcrumbList",
      ],
      schema_hash: "palo-schema-v2",
      // Visible copy unchanged per tonight's prompt rule.
      content_hash: "palo-content-v1",
    });

    // ── 3. Derive structured schema-diff fields ────────────────────────
    const derived = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(derived).not.toBeNull();
    expect(derived!.change_family).toBe("schema_experiment");
    expect(derived!.change_type).toBe("schema_added");
    expect(derived!.schema_types_added).toEqual([
      "BreadcrumbList",
      "HomeAndConstructionBusiness",
      "WebPage",
    ]);
    expect(derived!.visible_copy_changed).toBe(false);
    expect(derived!.page_scope).toBe("single_url");

    // ── 4. Build a ChangelogEntry with the derived fields ──────────────
    const confirmedAt = "2026-04-17T08:00:00+00:00";
    const entry: ChangelogEntry = {
      id: "cl-palo-schema",
      timestamp: confirmedAt,
      signal_type: "technical",
      asset_type: "city_page",
      url: "/locations/palo-alto",
      asset_name: "/locations/palo-alto",
      change_description:
        "Palo Alto city page — added HomeAndConstructionBusiness + WebPage + BreadcrumbList JSON-LD",
      topic_targeted: "",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: "7-14 days",
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: confirmedAt,
      updated_at: confirmedAt,
      source_system: "scan_detection",
      tenant_id: "tenant-ritz-founder",
      ...derived,
    };

    // ── 5. Event assembler claims it as a page_level event ─────────────
    const events = assembleEvents({
      changelog: [entry],
      firstCitationDateByUrl: {},
      tenant_id: "tenant-ritz-founder",
    });
    expect(events).toHaveLength(1);
    expect(events[0].scope).toBe("page_level");
    expect(events[0].target_urls).toEqual(["/locations/palo-alto"]);
    expect(events[0].child_change_ids).toEqual(["cl-palo-schema"]);

    // ── 6. Attribution with changelogById uses the matching ladder ─────
    // Synthetic citation series: 14d baseline at ~1/day, 14d post at ~3/day.
    const series: UrlDailySeries = {
      url: "/locations/palo-alto",
      daily: Array.from({ length: 28 }, (_, i) => {
        const date = new Date(
          Date.parse("2026-04-03T00:00:00Z") + i * 86400000,
        )
          .toISOString()
          .slice(0, 10);
        const count = date >= "2026-04-17" ? 3 : 1;
        return { date, count };
      }),
    };
    const changelogById = new Map<string, ChangelogEntry>([[entry.id, entry]]);

    const attrs = attributeEvents({
      events,
      siteMovements: [],
      urlSeriesByUrl: { "/locations/palo-alto": series },
      dataQualityBadDates: new Set(),
      changelogById,
      asOfDate: "2026-04-30",
    });
    expect(attrs).toHaveLength(1);
    const a = attrs[0];

    // ── 7. Matched at exact specificity ─────────────────────────────────
    expect(a.evidence.matching_specificity).toBe("exact");
    expect(a.evidence.c_scope).toBe(1.0); // exact specificity → multiplier 1.0, no muddy penalty
    // Narrative mentions the schema match.
    expect(a.evidence.narrative).toContain("Schema match=exact");
    // Visible copy unchanged → no down-weighting note.
    expect(a.evidence.narrative).not.toContain("down-weighted");
  });

  it("muddy experiment: schema + visible copy BOTH change → c_scope halved", () => {
    const prev = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage"],
      schema_hash: "v1",
      content_hash: "copy-v1",
    });
    const cur = snap({
      url: "https://r.co/x",
      schema_types: ["FAQPage", "Article"],
      schema_hash: "v2",
      content_hash: "copy-v2", // copy ALSO changed
    });
    const derived = deriveSchemaChangelogFields({
      currentSnapshot: cur,
      previousSnapshot: prev,
    });
    expect(derived!.visible_copy_changed).toBe(true);

    const entry: ChangelogEntry = {
      id: "cl-muddy",
      timestamp: "2026-04-17T08:00:00Z",
      signal_type: "technical",
      asset_type: "city_page",
      url: "/x",
      asset_name: "/x",
      change_description: "Added Article schema + tweaked hero copy",
      topic_targeted: "",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "2026-04-17T08:00:00Z",
      updated_at: "2026-04-17T08:00:00Z",
      source_system: "scan_detection",
      tenant_id: "t",
      ...derived,
    };

    const events = assembleEvents({
      changelog: [entry],
      firstCitationDateByUrl: {},
      tenant_id: "t",
    });

    const series: UrlDailySeries = {
      url: "/x",
      daily: Array.from({ length: 28 }, (_, i) => {
        const date = new Date(
          Date.parse("2026-04-03T00:00:00Z") + i * 86400000,
        )
          .toISOString()
          .slice(0, 10);
        return { date, count: date >= "2026-04-17" ? 3 : 1 };
      }),
    };

    const attrs = attributeEvents({
      events,
      siteMovements: [],
      urlSeriesByUrl: { "/x": series },
      dataQualityBadDates: new Set(),
      changelogById: new Map([[entry.id, entry]]),
      asOfDate: "2026-04-30",
    });

    // exact match × 0.5 muddy penalty = 0.5
    expect(attrs[0].evidence.matching_specificity).toBe("exact");
    expect(attrs[0].evidence.c_scope).toBe(0.5);
    expect(attrs[0].evidence.narrative).toContain("down-weighted");
  });

  it("non-schema events see ZERO behavior change (guardrail 3)", () => {
    // A legacy content edit with no change_family, no structured schema fields.
    const entry: ChangelogEntry = {
      id: "cl-legacy",
      timestamp: "2026-04-17T08:00:00Z",
      signal_type: "content",
      asset_type: "city_page",
      url: "/locations/los-altos",
      asset_name: "/locations/los-altos",
      change_description: "Rewrote the H1 for clarity",
      topic_targeted: "",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "2026-04-17T08:00:00Z",
      updated_at: "2026-04-17T08:00:00Z",
      source_system: "manual",
      tenant_id: "t",
      // NO change_family / NO schema_types_* / etc.
    };
    const events = assembleEvents({
      changelog: [entry],
      firstCitationDateByUrl: {},
      tenant_id: "t",
    });
    const series: UrlDailySeries = {
      url: "/locations/los-altos",
      daily: Array.from({ length: 28 }, (_, i) => {
        const date = new Date(
          Date.parse("2026-04-03T00:00:00Z") + i * 86400000,
        )
          .toISOString()
          .slice(0, 10);
        return { date, count: 1 };
      }),
    };

    const attrs = attributeEvents({
      events,
      siteMovements: [],
      urlSeriesByUrl: { "/locations/los-altos": series },
      dataQualityBadDates: new Set(),
      changelogById: new Map([[entry.id, entry]]),
      asOfDate: "2026-04-30",
    });

    // Schema matching never ran → matching_specificity is undefined.
    expect(attrs[0].evidence.matching_specificity).toBeUndefined();
    // c_scope is the legacy 1.0 (no multiplier applied).
    expect(attrs[0].evidence.c_scope).toBe(1.0);
    // Narrative does NOT contain any schema-match language.
    expect(attrs[0].evidence.narrative).not.toContain("Schema match");
  });
});
