import { describe, it, expect } from "vitest";
import {
  assembleEvents,
  pathOnly,
  isSitewideUrl,
  classifyEventType,
  type ChangelogRow,
} from "./assembler";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function row(partial: Partial<ChangelogRow> & { id: string; timestamp: string }): ChangelogRow {
  return {
    id: partial.id,
    timestamp: partial.timestamp,
    url: partial.url ?? null,
    change_description: partial.change_description ?? "",
    asset_type: partial.asset_type ?? null,
    tenant_id: partial.tenant_id ?? "t1",
  };
}

// ---------------------------------------------------------------------------
// pathOnly / isSitewideUrl / classifyEventType
// ---------------------------------------------------------------------------

describe("pathOnly", () => {
  it("strips scheme+host+trailing-slash and lowercases", () => {
    expect(pathOnly("https://ritzbuilders.com/Locations/Menlo-Park/"))
      .toBe("/locations/menlo-park");
  });
  it("keeps leading-slash paths as-is (with normalization)", () => {
    expect(pathOnly("/About-Us/")).toBe("/about-us");
  });
  it("returns null for non-path labels and empty values", () => {
    expect(pathOnly("Bing Places")).toBeNull();
    expect(pathOnly(null)).toBeNull();
    expect(pathOnly("")).toBeNull();
  });
});

describe("isSitewideUrl", () => {
  it("treats null and non-path labels as sitewide", () => {
    expect(isSitewideUrl(null)).toBe(true);
    expect(isSitewideUrl("Bing Places")).toBe(true);
    expect(isSitewideUrl("All Pages")).toBe(true);
  });
  it("treats .txt and .xml infra files as sitewide", () => {
    expect(isSitewideUrl("/llms.txt")).toBe(true);
    expect(isSitewideUrl("/sitemap.xml")).toBe(true);
    expect(isSitewideUrl("/robots.txt")).toBe(true);
  });
  it("treats real paths as not sitewide", () => {
    expect(isSitewideUrl("/locations/menlo-park")).toBe(false);
    expect(isSitewideUrl("/")).toBe(false);
  });
});

describe("classifyEventType", () => {
  it("matches metadata_publication from llms.txt", () => {
    expect(classifyEventType("Published static llms.txt file at root")).toBe(
      "metadata_publication",
    );
  });
  it("matches crawlability_fix from canonical", () => {
    expect(classifyEventType("Updated all canonical tags to trailing slash")).toBe(
      "crawlability_fix",
    );
  });
  it("matches performance_batch from LCP/TBT/HubSpot", () => {
    expect(classifyEventType("Delayed HubSpot script from critical rendering path")).toBe(
      "performance_batch",
    );
  });
  it("matches schema_rollout from JSON-LD", () => {
    expect(classifyEventType("Added FAQPage JSON-LD schema to every page")).toBe(
      "schema_rollout",
    );
  });
  it("returns null when no family matches", () => {
    expect(classifyEventType("Revised hero copy")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule A — compound_launch
// ---------------------------------------------------------------------------

describe("Rule A — compound_launch", () => {
  it("fires when page-creation keyword + first-citation date align (single child)", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: { "/luxury-home-builder-bay-area": "2026-03-09" },
      changelog: [
        row({
          id: "c1",
          timestamp: "2026-03-10T08:00:00+00:00",
          url: "/luxury-home-builder-bay-area",
          change_description: "Created new standalone landing page at /luxury-home-builder-bay-area",
        }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].scope).toBe("compound_launch");
    expect(events[0].created_url).toBe("/luxury-home-builder-bay-area");
    expect(events[0].child_change_ids).toEqual(["c1"]);
  });

  it("a single page-creation row with no siblings still emits one compound_launch (not gated on child count)", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: { "/new-page": "2026-03-20" },
      changelog: [
        row({
          id: "c1",
          timestamp: "2026-03-20T08:00:00Z",
          url: "/new-page",
          change_description: "Launched /new-page",
        }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].scope).toBe("compound_launch");
  });

  it("groups all same-URL rows within [F-3, F+3] as children (Ritz Mar 10 pattern)", () => {
    const input = {
      tenant_id: "t1",
      firstCitationDateByUrl: { "/luxury-home-builder-bay-area": "2026-03-09" },
      changelog: [
        row({ id: "p1", timestamp: "2026-03-10T08:00:00Z", url: "/luxury-home-builder-bay-area", change_description: "Created new standalone landing page at /luxury-home-builder-bay-area" }),
        row({ id: "p2", timestamp: "2026-03-10T08:00:00Z", url: "/luxury-home-builder-bay-area", change_description: "Added hero section" }),
        row({ id: "p3", timestamp: "2026-03-10T08:00:00Z", url: "/luxury-home-builder-bay-area", change_description: "Added process grid" }),
        row({ id: "far", timestamp: "2026-03-26T08:00:00Z", url: "/luxury-home-builder-bay-area", change_description: "Copy tweak" }),
      ],
    };
    const events = assembleEvents(input);
    const compound = events.find((e) => e.scope === "compound_launch");
    expect(compound).toBeDefined();
    expect(compound!.child_change_ids.sort()).toEqual(["p1", "p2", "p3"]);
    // Mar 26 edit falls through to page_level
    const pageLevel = events.find((e) => e.scope === "page_level");
    expect(pageLevel?.child_change_ids).toEqual(["far"]);
  });

  it("does NOT fire for an existing URL even with many same-day edits (falls to Rule C)", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {}, // URL never cited → Rule A skipped
      changelog: [
        row({ id: "c1", timestamp: "2026-03-10", url: "/about-us", change_description: "Rewrote hero" }),
        row({ id: "c2", timestamp: "2026-03-10", url: "/about-us", change_description: "Added founders grid" }),
        row({ id: "c3", timestamp: "2026-03-10", url: "/about-us", change_description: "Updated CTA" }),
      ],
    });
    for (const e of events) expect(e.scope).not.toBe("compound_launch");
    // 3 page-level fallbacks
    expect(events).toHaveLength(3);
    for (const e of events) expect(e.scope).toBe("page_level");
  });

  it("does NOT fire when the page-creation keyword row is outside [F-1, F+1]", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: { "/new-page": "2026-03-01" },
      changelog: [
        // "Published" dated Mar 15 — way past F+1.
        row({ id: "c1", timestamp: "2026-03-15", url: "/new-page", change_description: "Published /new-page" }),
      ],
    });
    // Falls through to Rule C.
    expect(events[0].scope).toBe("page_level");
  });
});

// ---------------------------------------------------------------------------
// Rule B1 — explicit sitewide
// ---------------------------------------------------------------------------

describe("Rule B1 — explicit sitewide rows", () => {
  it("llms.txt row → sitewide_rollout event_type=metadata_publication", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: [
        row({ id: "c1", timestamp: "2026-04-02", url: "/llms.txt", change_description: "Published static llms.txt file at root" }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].scope).toBe("sitewide_rollout");
    expect(events[0].event_type).toBe("metadata_publication");
    expect(events[0].target_urls).toBeNull();
  });

  it("url=null canonical-unify row → sitewide_rollout event_type=crawlability_fix", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: [
        row({ id: "c1", timestamp: "2026-04-03", url: null, change_description: "Updated all canonical tags to trailing slash version" }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("crawlability_fix");
  });

  it("non-path label like 'bing-places' → sitewide_rollout", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: [
        row({ id: "c1", timestamp: "2026-04-03", url: "bing-places", change_description: "Created and synced Bing Places profile" }),
      ],
    });
    expect(events[0].scope).toBe("sitewide_rollout");
  });
});

// ---------------------------------------------------------------------------
// Rule B2 — multi-page clustering
// ---------------------------------------------------------------------------

describe("Rule B2 — multi-page clustered rollout", () => {
  it("5 schema rows across 3 URLs within 10 days → one schema_rollout event", () => {
    const rows: ChangelogRow[] = [
      row({ id: "s1", timestamp: "2026-04-12", url: "/a", change_description: "Removed duplicate FAQPage JSON-LD" }),
      row({ id: "s2", timestamp: "2026-04-12", url: "/b", change_description: "Removed duplicate FAQPage JSON-LD" }),
      row({ id: "s3", timestamp: "2026-04-13", url: "/c", change_description: "Consolidated JSON-LD FAQPage schema" }),
      row({ id: "s4", timestamp: "2026-04-14", url: "/a", change_description: "Removed duplicate JSON-LD schema" }),
      row({ id: "s5", timestamp: "2026-04-14", url: "/d", change_description: "Removed duplicate JSON-LD schema" }),
    ];
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: rows,
    });
    const schema = events.find((e) => e.event_type === "schema_rollout");
    expect(schema, JSON.stringify(events, null, 2)).toBeDefined();
    expect(schema!.scope).toBe("sitewide_rollout");
    expect(schema!.child_change_ids.length).toBe(5);
    expect((schema!.target_urls ?? []).length).toBe(4);
  });

  it("does NOT cluster when only 4 rows (below min 5)", () => {
    const rows: ChangelogRow[] = [
      row({ id: "s1", timestamp: "2026-04-12", url: "/a", change_description: "Removed duplicate FAQPage JSON-LD" }),
      row({ id: "s2", timestamp: "2026-04-12", url: "/b", change_description: "Removed duplicate FAQPage JSON-LD" }),
      row({ id: "s3", timestamp: "2026-04-13", url: "/c", change_description: "Consolidated JSON-LD schema" }),
      row({ id: "s4", timestamp: "2026-04-14", url: "/a", change_description: "Removed duplicate JSON-LD schema" }),
    ];
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: rows,
    });
    for (const e of events) expect(e.event_type).not.toBe("schema_rollout");
    // All 4 fall through to page_level
    expect(events.every((e) => e.scope === "page_level")).toBe(true);
  });

  it("does NOT cluster when 5 rows hit only 2 URLs (below min 3 distinct URLs)", () => {
    const rows: ChangelogRow[] = [
      row({ id: "s1", timestamp: "2026-04-12", url: "/a", change_description: "Added FAQPage JSON-LD" }),
      row({ id: "s2", timestamp: "2026-04-13", url: "/a", change_description: "Tweaked JSON-LD" }),
      row({ id: "s3", timestamp: "2026-04-14", url: "/b", change_description: "Added JSON-LD schema" }),
      row({ id: "s4", timestamp: "2026-04-15", url: "/b", change_description: "Tweaked JSON-LD" }),
      row({ id: "s5", timestamp: "2026-04-16", url: "/a", change_description: "Removed JSON-LD duplicate" }),
    ];
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: rows,
    });
    expect(events.every((e) => e.scope === "page_level")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Family anti-merger
// ---------------------------------------------------------------------------

describe("Family anti-merger — different event_types on same day stay distinct", () => {
  it("metadata_publication and performance_batch on same day do not merge", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: [
        row({ id: "m1", timestamp: "2026-04-10", url: null, change_description: "Published llms.txt at root" }),
        row({ id: "p1", timestamp: "2026-04-10", url: null, change_description: "Delayed HubSpot script from critical rendering path" }),
        row({ id: "p2", timestamp: "2026-04-10", url: null, change_description: "Added loading='lazy' to below-fold images sitewide" }),
      ],
    });
    const types = events.map((e) => e.event_type).sort();
    expect(types).toContain("metadata_publication");
    expect(types).toContain("performance_batch");
    // Both are distinct events — no merged record.
    expect(new Set(types).size).toBe(types.length);
  });
});

// ---------------------------------------------------------------------------
// Rule C — page_level fallback
// ---------------------------------------------------------------------------

describe("Rule C — page_level fallback", () => {
  it("isolated title tweak on an existing URL becomes a page_level event", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: [
        row({ id: "c1", timestamp: "2026-03-22", url: "/about-us", change_description: "Updated page title" }),
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].scope).toBe("page_level");
    expect(events[0].event_type).toBe("content_edit");
    expect(events[0].target_urls).toEqual(["/about-us"]);
  });
});

// ---------------------------------------------------------------------------
// Coverage invariant
// ---------------------------------------------------------------------------

describe("Coverage invariant", () => {
  it("every input row is assigned to exactly one event (no orphan, no double-assign)", () => {
    const rows: ChangelogRow[] = [
      row({ id: "A1", timestamp: "2026-03-10", url: "/luxury-home-builder-bay-area", change_description: "Created new standalone landing page" }),
      row({ id: "A2", timestamp: "2026-03-10", url: "/luxury-home-builder-bay-area", change_description: "Hero section" }),
      row({ id: "A3", timestamp: "2026-03-10", url: "/luxury-home-builder-bay-area", change_description: "FAQ grid" }),
      row({ id: "B1", timestamp: "2026-04-02", url: "/llms.txt", change_description: "Published llms.txt" }),
      row({ id: "B2", timestamp: "2026-04-03", url: null, change_description: "Updated all canonical tags trailing slash" }),
      row({ id: "S1", timestamp: "2026-04-12", url: "/a", change_description: "Removed duplicate FAQPage JSON-LD" }),
      row({ id: "S2", timestamp: "2026-04-12", url: "/b", change_description: "Removed duplicate FAQPage JSON-LD" }),
      row({ id: "S3", timestamp: "2026-04-13", url: "/c", change_description: "Consolidated JSON-LD FAQPage schema" }),
      row({ id: "S4", timestamp: "2026-04-14", url: "/a", change_description: "Removed duplicate JSON-LD schema" }),
      row({ id: "S5", timestamp: "2026-04-14", url: "/d", change_description: "Removed duplicate JSON-LD schema" }),
      row({ id: "C1", timestamp: "2026-03-22", url: "/about-us", change_description: "Updated page title" }),
    ];
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: { "/luxury-home-builder-bay-area": "2026-03-09" },
      changelog: rows,
    });

    const allIds = new Set(rows.map((r) => r.id));
    const assigned: string[] = [];
    for (const e of events) assigned.push(...e.child_change_ids);
    const assignedSet = new Set(assigned);

    // No orphan
    for (const id of allIds) expect(assignedSet.has(id), `orphan: ${id}`).toBe(true);
    // No double-assign
    expect(assigned.length).toBe(assignedSet.size);
    // Total assigned = total rows
    expect(assigned.length).toBe(rows.length);
  });

  it("output events are sorted ascending by started_at", () => {
    const events = assembleEvents({
      tenant_id: "t1",
      firstCitationDateByUrl: {},
      changelog: [
        row({ id: "z", timestamp: "2026-04-14", url: "/a", change_description: "edit" }),
        row({ id: "a", timestamp: "2026-03-01", url: "/a", change_description: "edit" }),
        row({ id: "m", timestamp: "2026-03-20", url: "/a", change_description: "edit" }),
      ],
    });
    const dates = events.map((e) => e.started_at);
    expect(dates).toEqual([...dates].sort());
  });
});
