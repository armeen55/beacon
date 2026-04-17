import { describe, it, expect } from "vitest";
import type { ChangelogEntry } from "./types";
import { extractEditTokens, findDuplicatePairs } from "./dedupe";

function makeEntry(overrides: Partial<ChangelogEntry>): ChangelogEntry {
  return {
    id: overrides.id ?? "cl-x",
    timestamp: overrides.timestamp ?? "2026-03-10T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: overrides.url ?? null,
    asset_name: overrides.asset_name ?? "",
    change_description: overrides.change_description ?? "",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: overrides.timestamp ?? "2026-03-10T00:00:00Z",
    updated_at: overrides.timestamp ?? "2026-03-10T00:00:00Z",
    source_system: overrides.source_system,
    tenant_id: "",
    ...overrides,
  };
}

describe("extractEditTokens", () => {
  it("detects title changes", () => {
    expect(extractEditTokens("Set title tag to 'Foo'")).toContain("title_change");
    expect(extractEditTokens("Title changed from X to Y")).toContain("title_change");
    expect(extractEditTokens("Updated meta title")).toContain("title_change");
  });

  it("detects page creation", () => {
    expect(extractEditTokens("Created new standalone landing page at /foo")).toContain("page_created");
    expect(extractEditTokens("Published new Luxury Home Builder Bay Area landing page")).toContain("page_created");
    expect(extractEditTokens("Complete page reconstruction: updated AEO metadata/schema")).toContain("page_created");
  });

  it("detects schema additions", () => {
    const tokens = extractEditTokens(
      "Added Article + Service + FAQPage + BreadcrumbList JSON-LD schemas",
    );
    expect(tokens).toContain("schema_added");
  });

  it("detects FAQ changes", () => {
    expect(extractEditTokens("Added 12-question AEO-optimized FAQ section")).toContain("faq_added");
  });

  it("returns empty set for empty description", () => {
    expect(extractEditTokens("")).toEqual(new Set());
  });
});

describe("findDuplicatePairs", () => {
  it("pairs CSV summary with PDF granular when URL + date + tokens subset match", () => {
    const entries = [
      makeEntry({
        id: "pdf-1",
        url: "/luxury-home-builder-bay-area",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Created new standalone landing page at /luxury-home-builder-bay-area",
      }),
      makeEntry({
        id: "pdf-2",
        url: "/luxury-home-builder-bay-area",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Set title tag to 'Luxury Home Builder Bay Area'",
      }),
      makeEntry({
        id: "csv-1",
        url: "/luxury-home-builder-bay-area",
        timestamp: "2026-03-10T05:05:21Z",
        source_system: "changelog_csv",
        change_description: "Published new Luxury Home Builder Bay Area landing page",
      }),
    ];

    const pairs = findDuplicatePairs(entries);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].archiveCandidate.id).toBe("csv-1");
    // Closest keeper by time is pdf-1 (also page_created).
    expect(pairs[0].keeper.id).toBe("pdf-1");
    expect(pairs[0].sharedTokens).toContain("page_created");
  });

  it("skips pairs outside the max-days window", () => {
    const entries = [
      makeEntry({
        id: "pdf-1",
        url: "/foo",
        timestamp: "2026-03-01T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Set title tag to Foo",
      }),
      makeEntry({
        id: "csv-1",
        url: "/foo",
        timestamp: "2026-03-20T00:00:00Z",
        source_system: "changelog_csv",
        change_description: "Title changed on Foo page",
      }),
    ];
    expect(findDuplicatePairs(entries)).toHaveLength(0);
  });

  it("does not pair CSV entries that have edit tokens the PDF lacks", () => {
    // CSV says "Added new hero AND FAQ"; PDF only mentions title change on same day.
    const entries = [
      makeEntry({
        id: "pdf-1",
        url: "/foo",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Set title tag to Foo",
      }),
      makeEntry({
        id: "csv-1",
        url: "/foo",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "changelog_csv",
        change_description: "Added new hero and added FAQ section",
      }),
    ];
    expect(findDuplicatePairs(entries)).toHaveLength(0);
  });

  it("keeps CSV entries with no PDF on the same URL unpaired", () => {
    const entries = [
      makeEntry({
        id: "csv-gbp",
        url: "Google Business Profile",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "changelog_csv",
        change_description: "Updated business description on GBP",
      }),
    ];
    expect(findDuplicatePairs(entries)).toHaveLength(0);
  });

  it("ignores already-archived entries", () => {
    const entries = [
      makeEntry({
        id: "pdf-1",
        url: "/foo",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Set title tag to Foo",
      }),
      makeEntry({
        id: "csv-1",
        url: "/foo",
        timestamp: "2026-03-10T00:00:00Z",
        source_system: "changelog_csv",
        change_description: "Updated title on Foo",
        archived: true,
      }),
    ];
    expect(findDuplicatePairs(entries)).toHaveLength(0);
  });

  it("returns pairs in deterministic order (oldest keeper first)", () => {
    const entries = [
      makeEntry({
        id: "pdf-a",
        url: "/a",
        timestamp: "2026-03-20T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Set title",
      }),
      makeEntry({
        id: "pdf-b",
        url: "/b",
        timestamp: "2026-03-01T00:00:00Z",
        source_system: "pdf_changelog_rebuild",
        change_description: "Set title",
      }),
      makeEntry({
        id: "csv-a",
        url: "/a",
        timestamp: "2026-03-20T00:00:00Z",
        source_system: "changelog_csv",
        change_description: "Title changed",
      }),
      makeEntry({
        id: "csv-b",
        url: "/b",
        timestamp: "2026-03-01T00:00:00Z",
        source_system: "changelog_csv",
        change_description: "Title changed",
      }),
    ];
    const pairs = findDuplicatePairs(entries);
    expect(pairs.map((p) => p.keeper.id)).toEqual(["pdf-b", "pdf-a"]);
  });
});
