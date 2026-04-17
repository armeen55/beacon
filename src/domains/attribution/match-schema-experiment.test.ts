/**
 * Phase 1 — Tests for `matchSchemaExperiment`.
 *
 * Covers every rung of the ladder + boundary conditions:
 *   Rule 1 exact       — URL + schema_types_added == delta + ≤48h
 *   Rule 2 strong      — URL + schema_types_added ⊇ delta + ≤72h
 *   Rule 3 partial     — URL + asset_type + schema_* change_type + ≤7d
 *   Rule 4 fallback    — URL + /schema|json-ld/i text + ≤7d
 *   Rule 5 none        — nothing matches
 *
 * + Tonight's 3 pages flow through cleanly.
 * + Non-schema entries are NEVER matched (schema-specific only guardrail).
 */

import { describe, it, expect } from "vitest";
import {
  matchSchemaExperiment,
  SPECIFICITY_SCOPE_MULTIPLIER,
  confidenceSourceFromSpecificity,
} from "./match-schema-experiment";
import type { ChangelogEntry } from "@/domains/changelog/types";

function entry(
  over: Partial<ChangelogEntry> & { id: string; timestamp: string; url: string },
): ChangelogEntry {
  const base: ChangelogEntry = {
    id: over.id,
    timestamp: over.timestamp,
    signal_type: "technical",
    asset_type: "city_page",
    url: over.url,
    asset_name: over.url,
    change_description: "",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: over.timestamp,
    updated_at: over.timestamp,
    source_system: "manual",
    tenant_id: "tenant-test",
  };
  return { ...base, ...over };
}

const SCAN_TIME = "2026-04-16T12:00:00Z";
function hoursAgo(h: number): string {
  return new Date(Date.parse(SCAN_TIME) - h * 3600_000).toISOString();
}

// ---------------------------------------------------------------------------
// Rule 1 — exact
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — Rule 1 exact", () => {
  it("matches when schema_types_added == delta AND scan within 48h", () => {
    const c = entry({
      id: "cl-exact",
      timestamp: hoursAgo(12),
      url: "/locations/palo-alto",
      asset_type: "city_page",
      change_family: "schema_experiment",
      change_type: "schema_added",
      schema_types_added: ["BreadcrumbList", "HomeAndConstructionBusiness", "WebPage"],
      schema_types_before: ["FAQPage"],
      schema_types_after: ["BreadcrumbList", "FAQPage", "HomeAndConstructionBusiness", "WebPage"],
    });
    const result = matchSchemaExperiment({
      url: "https://ritzbuilders.com/locations/palo-alto",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [
        "HomeAndConstructionBusiness",
        "WebPage",
        "BreadcrumbList",
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.specificity).toBe("exact");
    expect(result!.entry.id).toBe("cl-exact");
  });

  it("rejects when scan outside the 48h window", () => {
    const c = entry({
      id: "cl-old",
      timestamp: hoursAgo(49),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A"],
    });
    // Rule 1 rejects; may fall to another rung — verify it's NOT exact.
    expect(r?.specificity).not.toBe("exact");
  });

  it("rejects when schema_types_added differs by any element", () => {
    const c = entry({
      id: "cl-mismatch",
      timestamp: hoursAgo(12),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A", "B"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A"],
    });
    expect(r?.specificity).not.toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — strong (superset, 72h)
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — Rule 2 strong", () => {
  it("matches when schema_types_added is a proper SUPERSET of the page delta + scan within 72h", () => {
    const c = entry({
      id: "cl-strong",
      timestamp: hoursAgo(60), // inside 72h, past 48h
      url: "/x",
      change_family: "schema_experiment",
      // Operator claimed to add A, B, C; scan only saw A, B (maybe a caching hiccup).
      schema_types_added: ["A", "B", "C"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A", "B"],
    });
    expect(r?.specificity).toBe("strong");
  });

  it("rejects when strictly-equal (exact wins instead)", () => {
    // If the superset == the delta, rule 1 fires. Rule 2 must not double-match.
    const c = entry({
      id: "cl-eq",
      timestamp: hoursAgo(12),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A", "B"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A", "B"],
    });
    expect(r?.specificity).toBe("exact");
  });

  it("rejects when delta includes a type not in schema_types_added (subset violation)", () => {
    const c = entry({
      id: "cl-sub",
      timestamp: hoursAgo(12),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A", "B"], // Entry claims A; scan saw A + B
    });
    expect(r?.specificity).not.toBe("exact");
    expect(r?.specificity).not.toBe("strong");
  });

  it("rejects when outside 72h window", () => {
    const c = entry({
      id: "cl-too-old",
      timestamp: hoursAgo(73),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A", "B", "C"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A", "B"],
    });
    expect(r?.specificity).not.toBe("strong");
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — partial
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — Rule 3 partial", () => {
  it("matches schema_* change_type on same URL + asset_type within 7d", () => {
    const c = entry({
      id: "cl-partial",
      timestamp: hoursAgo(3 * 24), // 3 days ago
      url: "/x",
      asset_type: "city_page",
      change_type: "schema_added",
      // schema_types_added intentionally absent — simulates a legacy entry
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [],
    });
    expect(r?.specificity).toBe("partial");
  });

  it("rejects when asset_type differs even if change_type matches", () => {
    const c = entry({
      id: "cl-wrong-asset",
      timestamp: hoursAgo(3 * 24),
      url: "/x",
      asset_type: "service_page",
      change_type: "schema_added",
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [],
    });
    expect(r?.specificity).not.toBe("partial");
  });

  it("rejects when outside 7d window", () => {
    const c = entry({
      id: "cl-old",
      timestamp: hoursAgo(8 * 24),
      url: "/x",
      asset_type: "city_page",
      change_type: "schema_added",
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [],
    });
    expect(r?.specificity).not.toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — fallback
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — Rule 4 fallback (legacy free-text)", () => {
  it('matches free-text "schema" in description for legacy entries', () => {
    const c = entry({
      id: "cl-legacy",
      timestamp: hoursAgo(3 * 24),
      url: "/x",
      change_description: "Added FAQPage schema to the page.",
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [],
    });
    expect(r?.specificity).toBe("fallback");
  });

  it('matches "JSON-LD" / "json-ld" / "jsonld" variants', () => {
    for (const desc of [
      "Added JSON-LD block for ProfessionalService",
      "Deployed json-ld updates across pages",
      "jsonld refinements",
    ]) {
      const c = entry({
        id: "cl-" + desc.slice(0, 5),
        timestamp: hoursAgo(2 * 24),
        url: "/x",
        change_description: desc,
      });
      const r = matchSchemaExperiment({
        url: "https://r.co/x",
        assetType: "city_page",
        changelog: [c],
        scanTimestamp: SCAN_TIME,
        schemaTypesAddedOnPage: [],
      });
      expect(r?.specificity).toBe("fallback");
    }
  });

  it("rejects descriptions without schema/json-ld keyword", () => {
    const c = entry({
      id: "cl-irrelevant",
      timestamp: hoursAgo(3 * 24),
      url: "/x",
      change_description: "Rewrote the H1 for better clarity.",
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [],
    });
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — none
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — Rule 5 none", () => {
  it("returns null when no entry matches any rule", () => {
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A"],
    });
    expect(r).toBeNull();
  });

  it("returns null when only non-schema entries exist for the URL", () => {
    const c = entry({
      id: "cl-other",
      timestamp: hoursAgo(1),
      url: "/x",
      change_description: "Updated hero copy.",
      // No change_family, no schema keywords, no schema_* change_type.
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A"],
    });
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Precedence ordering — most-specific wins
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — precedence (most-specific wins)", () => {
  it("picks exact over strong when both could fire", () => {
    const strong = entry({
      id: "cl-strong",
      timestamp: hoursAgo(12),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A", "B", "C"],
    });
    const exact = entry({
      id: "cl-exact",
      timestamp: hoursAgo(12),
      url: "/x",
      change_family: "schema_experiment",
      schema_types_added: ["A", "B"],
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [strong, exact],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["A", "B"],
    });
    expect(r?.specificity).toBe("exact");
    expect(r?.entry.id).toBe("cl-exact");
  });

  it("picks partial over fallback when partial qualifies", () => {
    const fb = entry({
      id: "cl-fb",
      timestamp: hoursAgo(24),
      url: "/x",
      change_description: "Added FAQPage schema to the page.",
    });
    const partial = entry({
      id: "cl-partial",
      timestamp: hoursAgo(24),
      url: "/x",
      asset_type: "city_page",
      change_type: "schema_added",
    });
    const r = matchSchemaExperiment({
      url: "https://r.co/x",
      assetType: "city_page",
      changelog: [fb, partial],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: [],
    });
    expect(r?.specificity).toBe("partial");
    expect(r?.entry.id).toBe("cl-partial");
  });
});

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — URL normalization", () => {
  it("matches full URL against path-stored changelog entry", () => {
    const c = entry({
      id: "cl-url",
      timestamp: hoursAgo(12),
      url: "/locations/palo-alto",
      change_family: "schema_experiment",
      schema_types_added: ["WebPage"],
    });
    const r = matchSchemaExperiment({
      url: "https://ritzbuilders.com/locations/palo-alto/", // full URL w/ trailing slash
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["WebPage"],
    });
    expect(r?.specificity).toBe("exact");
  });

  it("is case-insensitive for path matching", () => {
    const c = entry({
      id: "cl-case",
      timestamp: hoursAgo(12),
      url: "/Locations/Palo-Alto",
      change_family: "schema_experiment",
      schema_types_added: ["WebPage"],
    });
    const r = matchSchemaExperiment({
      url: "https://ritzbuilders.com/locations/palo-alto",
      assetType: "city_page",
      changelog: [c],
      scanTimestamp: SCAN_TIME,
      schemaTypesAddedOnPage: ["WebPage"],
    });
    expect(r?.specificity).toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// Tonight's 3 pages — end-to-end matcher verification
// ---------------------------------------------------------------------------

describe("matchSchemaExperiment — tonight's 3 pages flow through", () => {
  const SCAN_TOMORROW = "2026-04-18T03:00:00Z";

  it("/locations/palo-alto → exact match", () => {
    const entry_: ChangelogEntry = entry({
      id: "cl-palo-tonight",
      timestamp: "2026-04-17T02:30:00Z",
      url: "/locations/palo-alto",
      asset_type: "city_page",
      change_family: "schema_experiment",
      change_type: "schema_added",
      schema_types_added: ["BreadcrumbList", "HomeAndConstructionBusiness", "WebPage"],
      change_description:
        "Palo Alto city page — added HomeAndConstructionBusiness + WebPage + BreadcrumbList JSON-LD",
    });
    const r = matchSchemaExperiment({
      url: "https://ritzbuilders.com/locations/palo-alto/",
      assetType: "city_page",
      changelog: [entry_],
      scanTimestamp: SCAN_TOMORROW,
      schemaTypesAddedOnPage: [
        "HomeAndConstructionBusiness",
        "WebPage",
        "BreadcrumbList",
      ],
    });
    expect(r?.specificity).toBe("exact");
    expect(r?.entry.id).toBe("cl-palo-tonight");
  });

  it("/our-process → exact match", () => {
    const entry_ = entry({
      id: "cl-process-tonight",
      timestamp: "2026-04-17T02:35:00Z",
      url: "/our-process",
      asset_type: "process_page",
      change_family: "schema_experiment",
      change_type: "schema_added",
      schema_types_added: ["HowTo"],
    });
    const r = matchSchemaExperiment({
      url: "https://ritzbuilders.com/our-process",
      assetType: "process_page",
      changelog: [entry_],
      scanTimestamp: SCAN_TOMORROW,
      schemaTypesAddedOnPage: ["HowTo"],
    });
    expect(r?.specificity).toBe("exact");
  });

  it("/explore-projects/riverside-way → exact match", () => {
    const entry_ = entry({
      id: "cl-riverside-tonight",
      timestamp: "2026-04-17T02:40:00Z",
      url: "/explore-projects/riverside-way",
      asset_type: "project_page",
      change_family: "schema_experiment",
      change_type: "schema_added",
      schema_types_added: ["Article", "BreadcrumbList"],
    });
    const r = matchSchemaExperiment({
      url: "https://ritzbuilders.com/explore-projects/riverside-way",
      assetType: "project_page",
      changelog: [entry_],
      scanTimestamp: SCAN_TOMORROW,
      schemaTypesAddedOnPage: ["Article", "BreadcrumbList"],
    });
    expect(r?.specificity).toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// Specificity → attribution mapping
// ---------------------------------------------------------------------------

describe("SPECIFICITY_SCOPE_MULTIPLIER", () => {
  it("maps exact=1.0, strong=0.85, partial=0.65, fallback=0.4", () => {
    expect(SPECIFICITY_SCOPE_MULTIPLIER.exact).toBe(1.0);
    expect(SPECIFICITY_SCOPE_MULTIPLIER.strong).toBe(0.85);
    expect(SPECIFICITY_SCOPE_MULTIPLIER.partial).toBe(0.65);
    expect(SPECIFICITY_SCOPE_MULTIPLIER.fallback).toBe(0.4);
    expect(SPECIFICITY_SCOPE_MULTIPLIER.none).toBe(0);
  });
});

describe("confidenceSourceFromSpecificity", () => {
  it('returns "measured" for exact + strong', () => {
    expect(confidenceSourceFromSpecificity("exact")).toBe("measured");
    expect(confidenceSourceFromSpecificity("strong")).toBe("measured");
  });

  it('returns "inference" for partial + fallback + none', () => {
    expect(confidenceSourceFromSpecificity("partial")).toBe("inference");
    expect(confidenceSourceFromSpecificity("fallback")).toBe("inference");
    expect(confidenceSourceFromSpecificity("none")).toBe("inference");
  });
});
