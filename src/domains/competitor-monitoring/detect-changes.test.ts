/**
 * Tests for competitor change detection and alert generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectCompetitorChanges, generateCompetitorAlerts } from "./detect-changes";
import type { CompetitorSitemapSnapshot, CompetitorPageChange } from "./types";

// Fix time for deterministic detectedAt
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-03-15T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function makeSnapshot(
  domain: string,
  displayName: string,
  entries: { loc: string; lastmod?: string | null }[],
  error: string | null = null,
): CompetitorSitemapSnapshot {
  return {
    domain,
    displayName,
    crawledAt: "2024-03-15T10:00:00Z",
    pageCount: entries.length,
    entries: entries.map((e) => ({
      loc: e.loc,
      lastmod: e.lastmod ?? null,
    })),
    error,
  };
}

// ---------------------------------------------------------------------------
// detectCompetitorChanges
// ---------------------------------------------------------------------------

describe("detectCompetitorChanges", () => {
  it("returns empty for first crawl (no previous)", () => {
    const current = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
        { loc: "https://a.com/page-2" },
      ]),
    ];
    const previous: CompetitorSitemapSnapshot[] = [];

    expect(detectCompetitorChanges(current, previous)).toEqual([]);
  });

  it("detects added pages", () => {
    const previous = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
        { loc: "https://a.com/page-2" },
        { loc: "https://a.com/page-3" },
      ]),
    ];

    const changes = detectCompetitorChanges(current, previous);

    expect(changes).toHaveLength(2);
    expect(changes[0].type).toBe("added");
    expect(changes[0].url).toBe("https://a.com/page-2");
    expect(changes[0].path).toBe("/page-2");
    expect(changes[1].type).toBe("added");
    expect(changes[1].url).toBe("https://a.com/page-3");
  });

  it("detects removed pages", () => {
    const previous = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
        { loc: "https://a.com/page-2" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
      ]),
    ];

    const changes = detectCompetitorChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("removed");
    expect(changes[0].url).toBe("https://a.com/page-2");
  });

  it("detects updated pages (lastmod changed)", () => {
    const previous = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1", lastmod: "2024-01-01" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1", lastmod: "2024-03-10" },
      ]),
    ];

    const changes = detectCompetitorChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("updated");
    expect(changes[0].lastmod).toBe("2024-03-10");
    expect(changes[0].previousLastmod).toBe("2024-01-01");
  });

  it("ignores pages with no lastmod on both sides", () => {
    const previous = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
      ]),
    ];

    expect(detectCompetitorChanges(current, previous)).toEqual([]);
  });

  it("normalizes URLs (trailing slash, case)", () => {
    const previous = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/Page-1/" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
      ]),
    ];

    // Same URL normalized — no changes
    expect(detectCompetitorChanges(current, previous)).toEqual([]);
  });

  it("skips errored current crawls", () => {
    const previous = [
      makeSnapshot("a.com", "A", [
        { loc: "https://a.com/page-1" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [], "HTTP 500"),
    ];

    // Errored crawl is skipped — no false removals
    expect(detectCompetitorChanges(current, previous)).toEqual([]);
  });

  it("handles multiple competitors independently", () => {
    const previous = [
      makeSnapshot("a.com", "A", [{ loc: "https://a.com/p1" }]),
      makeSnapshot("b.com", "B", [{ loc: "https://b.com/p1" }]),
    ];
    const current = [
      makeSnapshot("a.com", "A", [{ loc: "https://a.com/p1" }, { loc: "https://a.com/p2" }]),
      makeSnapshot("b.com", "B", []),
    ];

    const changes = detectCompetitorChanges(current, previous);

    const aChanges = changes.filter((c) => c.domain === "a.com");
    const bChanges = changes.filter((c) => c.domain === "b.com");

    expect(aChanges).toHaveLength(1);
    expect(aChanges[0].type).toBe("added");
    expect(bChanges).toHaveLength(1);
    expect(bChanges[0].type).toBe("removed");
  });

  it("sets detectedAt and domain/displayName on changes", () => {
    const previous = [
      makeSnapshot("a.com", "Acme Corp", [
        { loc: "https://a.com/old" },
      ]),
    ];
    const current = [
      makeSnapshot("a.com", "Acme Corp", [
        { loc: "https://a.com/old" },
        { loc: "https://a.com/new" },
      ]),
    ];

    const changes = detectCompetitorChanges(current, previous);

    expect(changes[0].domain).toBe("a.com");
    expect(changes[0].displayName).toBe("Acme Corp");
    expect(changes[0].detectedAt).toBe("2024-03-15T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// generateCompetitorAlerts
// ---------------------------------------------------------------------------

describe("generateCompetitorAlerts", () => {
  it("returns empty for no changes", () => {
    expect(generateCompetitorAlerts([])).toEqual([]);
  });

  it("creates individual alerts for added pages", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "added",
        url: "https://a.com/adu-construction",
        path: "/adu-construction",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].headline).toBe("Acme added /adu-construction");
    expect(alerts[0].changeType).toBe("added");
  });

  it("creates batch alert for removed pages", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "removed",
        url: "https://a.com/old-1",
        path: "/old-1",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
      {
        domain: "a.com",
        displayName: "Acme",
        type: "removed",
        url: "https://a.com/old-2",
        path: "/old-2",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].headline).toBe("Acme removed 2 pages");
    expect(alerts[0].detail).toContain("/old-1");
    expect(alerts[0].detail).toContain("/old-2");
  });

  it("uses singular form for 1 removed page", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "removed",
        url: "https://a.com/gone",
        path: "/gone",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);
    expect(alerts[0].headline).toBe("Acme removed 1 page");
  });

  it("infers topic from path for contextual alerts", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "added",
        url: "https://a.com/services/kitchen-remodel",
        path: "/services/kitchen-remodel",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);

    expect(alerts[0].detail).toContain("Kitchen");
    expect(alerts[0].detail).toContain("Kitchen");
    expect(alerts[0].detail).toContain("targeting");
  });

  it("infers location topic from path", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "added",
        url: "https://a.com/locations/palo-alto",
        path: "/locations/palo-alto",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);
    expect(alerts[0].detail).toContain("Palo Alto");
  });

  it("sorts added before removed", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "removed",
        url: "https://a.com/old",
        path: "/old",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
      {
        domain: "a.com",
        displayName: "Acme",
        type: "added",
        url: "https://a.com/new",
        path: "/new",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);

    expect(alerts[0].changeType).toBe("added");
    expect(alerts[1].changeType).toBe("removed");
  });

  it("truncates removed page list when > 3", () => {
    const changes: CompetitorPageChange[] = Array.from({ length: 5 }, (_, i) => ({
      domain: "a.com",
      displayName: "Acme",
      type: "removed" as const,
      url: `https://a.com/page-${i}`,
      path: `/page-${i}`,
      lastmod: null,
      previousLastmod: null,
      detectedAt: "2024-03-15T10:00:00Z",
    }));

    const alerts = generateCompetitorAlerts(changes);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].detail).toContain("+ 2 more");
  });

  it("handles multiple domains separately", () => {
    const changes: CompetitorPageChange[] = [
      {
        domain: "a.com",
        displayName: "Acme",
        type: "added",
        url: "https://a.com/new-a",
        path: "/new-a",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
      {
        domain: "b.com",
        displayName: "Beta",
        type: "added",
        url: "https://b.com/new-b",
        path: "/new-b",
        lastmod: null,
        previousLastmod: null,
        detectedAt: "2024-03-15T10:00:00Z",
      },
    ];

    const alerts = generateCompetitorAlerts(changes);

    expect(alerts).toHaveLength(2);
    const domains = alerts.map((a) => a.domain);
    expect(domains).toContain("a.com");
    expect(domains).toContain("b.com");
  });
});
