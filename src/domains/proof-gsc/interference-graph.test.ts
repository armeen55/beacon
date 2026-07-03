import { describe, it, expect } from "vitest";
import {
  pathOf,
  pageFamilyOf,
  buildLinkedPageTreatedEdges,
  buildControlDependencyEdges,
  buildSameTemplateFamilyEdges,
  buildSitewideEventEdges,
  buildRedirectRelatedEdges,
  buildQueryOverlapEdges,
  computeInterferenceGraph,
  computeInterferenceGraphForLedger,
  significantEdges,
  interferenceSummarySentence,
  interferenceByKind,
  toPlannerHoldEntry,
  MIN_QUERY_OVERLAP_JACCARD,
  MIN_QUERIES_FOR_OVERLAP_JUDGMENT,
  type InterferenceLedgerShip,
  type PageLinkRow,
} from "./interference-graph";
import type { ShockWindow } from "./algorithm-weather";
import type { IntentCluster } from "@/domains/serp/intent-clusters";

/**
 * interference-graph.test.ts (BEACON_500 N14) - edge builders per kind, the
 * honest floors that keep a weak signal from firing, and composition through
 * computeInterferenceGraph. Mirrors control-contamination.test.ts's shape:
 * one describe per classifier concern, plain fixtures, no I/O.
 */

function ship(over: Partial<InterferenceLedgerShip> = {}): InterferenceLedgerShip {
  return {
    id: "ship_other",
    path: "/animals/fox",
    shippedAt: "2026-06-10T00:00:00Z",
    measuring: true,
    window: { start: "2026-06-10", end: "2026-07-08" },
    targetQueries: [],
    controlPages: [],
    ...over,
  };
}

function target(over: Partial<InterferenceLedgerShip> = {}): InterferenceLedgerShip {
  return {
    id: "ship_target",
    path: "/animals/lion",
    shippedAt: "2026-06-15T00:00:00Z",
    measuring: true,
    window: { start: "2026-06-15", end: "2026-07-13" },
    targetQueries: [],
    controlPages: [],
    ...over,
  };
}

describe("pathOf / pageFamilyOf", () => {
  it("strips host and query/hash", () => {
    expect(pathOf("https://example.com/animals/lion?x=1#y")).toBe("/animals/lion");
  });
  it("groups by first path segment", () => {
    expect(pageFamilyOf("/iran-animals/asiatic-cheetah")).toBe("iran-animals");
    expect(pageFamilyOf("/cities")).toBe("cities");
    expect(pageFamilyOf("/")).toBe("root");
  });
});

describe("buildLinkedPageTreatedEdges", () => {
  it("fires when target links OUT to a currently-measuring page", () => {
    const linkRows: PageLinkRow[] = [
      { sourcePath: "/animals/lion", targetHrefs: ["/animals/fox", "/animals/bear"] },
    ];
    const edges = buildLinkedPageTreatedEdges({
      targetPath: "/animals/lion",
      otherShips: [ship()],
      linkRows,
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe("linked_page_treated");
    expect(edges[0]!.otherPath).toBe("/animals/fox");
    expect(edges[0]!.strength).toBe("moderate");
    expect(edges[0]!.reason).toContain("links to");
    expect(edges[0]!.reason).not.toMatch(/[–—]/);
  });

  it("fires when target is linked FROM a currently-measuring page", () => {
    const linkRows: PageLinkRow[] = [
      { sourcePath: "/animals/fox", targetHrefs: ["/animals/lion"] },
    ];
    const edges = buildLinkedPageTreatedEdges({
      targetPath: "/animals/lion",
      otherShips: [ship()],
      linkRows,
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.reason).toContain("is linked from");
  });

  it("marks bidirectional links as strong", () => {
    const linkRows: PageLinkRow[] = [
      { sourcePath: "/animals/lion", targetHrefs: ["/animals/fox"] },
      { sourcePath: "/animals/fox", targetHrefs: ["/animals/lion"] },
    ];
    const edges = buildLinkedPageTreatedEdges({
      targetPath: "/animals/lion",
      otherShips: [ship()],
      linkRows,
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.strength).toBe("strong");
  });

  it("never fires on a page two hops away (no direct link row)", () => {
    // /animals/lion -> /animals/otter -> /animals/fox (fox is measuring), but
    // lion has no DIRECT link row to fox - only otter does.
    const linkRows: PageLinkRow[] = [
      { sourcePath: "/animals/lion", targetHrefs: ["/animals/otter"] },
      { sourcePath: "/animals/otter", targetHrefs: ["/animals/fox"] },
    ];
    const edges = buildLinkedPageTreatedEdges({
      targetPath: "/animals/lion",
      otherShips: [ship()],
      linkRows,
    });
    expect(edges).toHaveLength(0);
  });

  it("never fires when the other ship has settled (not measuring)", () => {
    const linkRows: PageLinkRow[] = [
      { sourcePath: "/animals/lion", targetHrefs: ["/animals/fox"] },
    ];
    const edges = buildLinkedPageTreatedEdges({
      targetPath: "/animals/lion",
      otherShips: [ship({ measuring: false })],
      linkRows,
    });
    expect(edges).toHaveLength(0);
  });

  it("returns empty with no link rows at all (never fabricated)", () => {
    const edges = buildLinkedPageTreatedEdges({
      targetPath: "/animals/lion",
      otherShips: [ship()],
      linkRows: [],
    });
    expect(edges).toHaveLength(0);
  });
});

describe("buildControlDependencyEdges (generalizes N13 control-contamination as a graph edge)", () => {
  it("fires when one of target's own comparison pages shipped INSIDE target's window", () => {
    // target's window is 2026-06-15..2026-07-13 (see the `target()` fixture).
    const t = target({ controlPages: ["/animals/fox", "/animals/otter"] });
    const edges = buildControlDependencyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", shippedAt: "2026-06-20T00:00:00Z", measuring: true })],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe("linked_page_treated");
    expect(edges[0]!.strength).toBe("strong");
    expect(edges[0]!.reason).toContain("comparison page for this measurement");
  });

  it("fires even when the control has already SETTLED, as long as its ship date fell inside target's window - the exact N13 gap this generalizes past", () => {
    // Mirrors the real /persian-male-names case: the control's OWN verdict
    // flipped to settled at its 7-day checkpoint, but its ship date still
    // falls inside the dependent ship's still-open window - activeTreatmentPaths
    // (measuring-only) misses this; buildControlDependencyEdges must not.
    const t = target({ controlPages: ["/animals/fox"] });
    const edges = buildControlDependencyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", shippedAt: "2026-06-20T00:00:00Z", measuring: false })],
    });
    expect(edges).toHaveLength(1);
  });

  it("mirrors the real 7-ship /persian-male-names contamination cluster shape: many ships share one settled-but-in-window control", () => {
    const control = ship({ id: "control_ship", path: "/persian-male-names", shippedAt: "2026-06-22T00:00:00Z", measuring: false });
    const dependents = ["/famous-iranian-singers", "/farsi-numbers", "/famous-iranian-comedians"].map((p) =>
      target({ id: `t_${p}`, path: p, shippedAt: "2026-06-21T00:00:00Z", window: { start: "2026-06-21", end: "2026-07-19" }, controlPages: ["/persian-male-names"] }),
    );
    for (const dep of dependents) {
      const edges = buildControlDependencyEdges({ target: dep, otherShips: [control] });
      expect(edges).toHaveLength(1);
      expect(edges[0]!.otherPath).toBe("/persian-male-names");
    }
  });

  it("never fires when the control shipped BEFORE target's window opened", () => {
    const t = target({ controlPages: ["/animals/fox"] }); // window starts 2026-06-15
    const edges = buildControlDependencyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", shippedAt: "2026-05-01T00:00:00Z" })],
    });
    expect(edges).toHaveLength(0);
  });

  it("never fires when the control shipped AFTER target's window closed", () => {
    const t = target({ controlPages: ["/animals/fox"] }); // window ends 2026-07-13
    const edges = buildControlDependencyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", shippedAt: "2026-08-01T00:00:00Z" })],
    });
    expect(edges).toHaveLength(0);
  });

  it("never fires when target has no control pages", () => {
    const t = target({ controlPages: [] });
    const edges = buildControlDependencyEdges({ target: t, otherShips: [ship()] });
    expect(edges).toHaveLength(0);
  });

  it("never fires when target has no known window yet", () => {
    const t = target({ controlPages: ["/animals/fox"], window: null });
    const edges = buildControlDependencyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", shippedAt: "2026-06-20T00:00:00Z" })],
    });
    expect(edges).toHaveLength(0);
  });

  it("never fires on a page that is not actually one of target's controls", () => {
    const t = target({ controlPages: ["/animals/otter"] });
    const edges = buildControlDependencyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", shippedAt: "2026-06-20T00:00:00Z" })],
    });
    expect(edges).toHaveLength(0);
  });
});

describe("buildSameTemplateFamilyEdges", () => {
  it("fires for the exact same page shipped twice (strong, mirrors detectMeasurementOverlaps)", () => {
    const t = target();
    const edges = buildSameTemplateFamilyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/lion", measuring: true })],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.strength).toBe("strong");
    expect(edges[0]!.reason).toContain("this exact page");
  });

  it("fires for a different page in the same family that is currently measuring", () => {
    const t = target(); // /animals/lion
    const edges = buildSameTemplateFamilyEdges({
      target: t,
      otherShips: [ship({ path: "/animals/fox", measuring: true })],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe("same_template_family");
    expect(edges[0]!.strength).toBe("moderate");
  });

  it("honest floor: same family but NOT measuring and no window overlap never fires", () => {
    const t = target();
    const edges = buildSameTemplateFamilyEdges({
      target: t,
      otherShips: [
        ship({
          path: "/animals/fox",
          measuring: false,
          window: { start: "2026-01-01", end: "2026-01-08" }, // long settled, no overlap
        }),
      ],
    });
    expect(edges).toHaveLength(0);
  });

  it("honest floor: different family never fires regardless of measuring state", () => {
    const t = target(); // /animals/lion
    const edges = buildSameTemplateFamilyEdges({
      target: t,
      otherShips: [ship({ path: "/flags/achaemenid", measuring: true })],
    });
    expect(edges).toHaveLength(0);
  });
});

describe("buildSitewideEventEdges", () => {
  it("fires when the window overlaps a confirmed Google update", () => {
    const shocks: ShockWindow[] = [
      { id: "core-2026-06", start: "2026-06-01", end: "2026-06-20", kind: "confirmed", label: "the June 2026 core update" },
    ];
    const edges = buildSitewideEventEdges({ target: target(), shockWindows: shocks });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.strength).toBe("strong");
    expect(edges[0]!.reason).toContain("June 2026 core update");
  });

  it("fires as moderate for a suspected (uncomfirmed) shock", () => {
    const shocks: ShockWindow[] = [
      { id: "suspected:2026-06-16:down", start: "2026-06-13", end: "2026-06-26", kind: "suspected", label: "a sitewide shift I detected" },
    ];
    const edges = buildSitewideEventEdges({ target: target(), shockWindows: shocks });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.strength).toBe("moderate");
  });

  it("returns empty when no shock overlaps", () => {
    const shocks: ShockWindow[] = [
      { id: "old", start: "2025-01-01", end: "2025-01-10", kind: "confirmed", label: "an old update" },
    ];
    expect(buildSitewideEventEdges({ target: target(), shockWindows: shocks })).toHaveLength(0);
  });

  it("returns empty when target has no window yet", () => {
    const shocks: ShockWindow[] = [
      { id: "core", start: "2026-06-01", end: "2026-06-20", kind: "confirmed", label: "an update" },
    ];
    expect(buildSitewideEventEdges({ target: target({ window: null }), shockWindows: shocks })).toHaveLength(0);
  });
});

describe("buildRedirectRelatedEdges (honest floor: no redirect store exists)", () => {
  it("always returns empty, never fabricates a redirect edge", () => {
    expect(buildRedirectRelatedEdges()).toEqual([]);
  });
});

describe("buildQueryOverlapEdges", () => {
  it("fires from a SERP-proven conflict cluster when the other own page is measuring", () => {
    const clusters: Array<Pick<IntentCluster, "clusterId" | "ownPagesInCluster" | "conflict">> = [
      {
        clusterId: "intent_cluster_1",
        conflict: true,
        ownPagesInCluster: [
          { url: "https://example.com/animals/lion", bestRank: 3, queries: ["lion facts"] },
          { url: "https://example.com/animals/fox", bestRank: 5, queries: ["lion facts"] },
        ],
      },
    ];
    const edges = buildQueryOverlapEdges({ target: target(), otherShips: [ship()], intentClusters: clusters });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.strength).toBe("strong");
    expect(edges[0]!.reason).toContain("Google's own search results");
  });

  it("does not fire from a cluster with conflict:false", () => {
    const clusters: Array<Pick<IntentCluster, "clusterId" | "ownPagesInCluster" | "conflict">> = [
      {
        clusterId: "intent_cluster_1",
        conflict: false,
        ownPagesInCluster: [{ url: "https://example.com/animals/lion", bestRank: 3, queries: ["lion facts"] }],
      },
    ];
    const edges = buildQueryOverlapEdges({ target: target(), otherShips: [ship()], intentClusters: clusters });
    expect(edges).toHaveLength(0);
  });

  it("fires from ledger-native targetQueries overlap with no SERP data at all", () => {
    const t = target({ targetQueries: ["lion facts", "lion habitat", "lion diet"] });
    const o = ship({ targetQueries: ["lion facts", "lion habitat", "fox facts"] });
    const edges = buildQueryOverlapEdges({ target: t, otherShips: [o] });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe("query_overlap");
    expect(edges[0]!.reason).toContain("overlapping searches");
  });

  it("honest floor: a single shared query never fires (MIN_QUERIES_FOR_OVERLAP_JUDGMENT)", () => {
    const t = target({ targetQueries: ["lion facts"] });
    const o = ship({ targetQueries: ["lion facts"] });
    expect(MIN_QUERIES_FOR_OVERLAP_JUDGMENT).toBeGreaterThanOrEqual(2);
    const edges = buildQueryOverlapEdges({ target: t, otherShips: [o] });
    expect(edges).toHaveLength(0);
  });

  it("honest floor: overlap below MIN_QUERY_OVERLAP_JACCARD never fires", () => {
    const t = target({ targetQueries: ["lion facts", "lion habitat", "lion diet", "lion pride"] });
    const o = ship({ targetQueries: ["lion facts", "fox facts", "fox habitat", "fox diet"] });
    // shared=1, union=7 -> jaccard ~0.14, well under 1/3
    const edges = buildQueryOverlapEdges({ target: t, otherShips: [o] });
    expect(edges).toHaveLength(0);
  });

  it("never double-counts a ship already matched via an intent cluster", () => {
    const t = target({ targetQueries: ["lion facts", "lion habitat"] });
    const o = ship({ targetQueries: ["lion facts", "lion habitat"] });
    const clusters: Array<Pick<IntentCluster, "clusterId" | "ownPagesInCluster" | "conflict">> = [
      {
        clusterId: "intent_cluster_1",
        conflict: true,
        ownPagesInCluster: [
          { url: "https://example.com/animals/lion", bestRank: 3, queries: ["lion facts"] },
          { url: "https://example.com/animals/fox", bestRank: 5, queries: ["lion facts"] },
        ],
      },
    ];
    const edges = buildQueryOverlapEdges({ target: t, otherShips: [o], intentClusters: clusters });
    expect(edges).toHaveLength(1); // not 2 - same ship, one edge
  });
});

describe("computeInterferenceGraph (composition)", () => {
  it("composes multiple edge kinds and flags hasSignificantInterference", () => {
    const linkRows: PageLinkRow[] = [{ sourcePath: "/animals/lion", targetHrefs: ["/animals/fox"] }];
    const result = computeInterferenceGraph({
      target: target(),
      otherShips: [ship()],
      linkRows,
    });
    expect(result.targetPath).toBe("/animals/lion");
    expect(result.hasSignificantInterference).toBe(true);
    // Both linked_page_treated AND same_template_family should fire (fox is
    // linked AND shares the animals family).
    const kinds = result.edges.map((e) => e.kind).sort();
    expect(kinds).toContain("linked_page_treated");
    expect(kinds).toContain("same_template_family");
  });

  it("excludes the target's own ledger row from otherShips by id", () => {
    const t = target();
    const result = computeInterferenceGraph({
      target: t,
      otherShips: [t], // caller accidentally included target itself
    });
    expect(result.edges).toHaveLength(0);
  });

  it("returns no significant interference on a clean ledger", () => {
    const result = computeInterferenceGraph({
      target: target(),
      otherShips: [ship({ path: "/unrelated/page", measuring: false })],
    });
    expect(result.hasSignificantInterference).toBe(false);
    expect(significantEdges(result)).toHaveLength(0);
  });
});

describe("interferenceSummarySentence / interferenceByKind", () => {
  it("returns null when there is nothing significant", () => {
    const result = computeInterferenceGraph({ target: target(), otherShips: [] });
    expect(interferenceSummarySentence(result)).toBeNull();
    expect(interferenceByKind(result)).toEqual([]);
  });

  it("summarizes the strongest edge first, dash-clean", () => {
    const linkRows: PageLinkRow[] = [{ sourcePath: "/animals/lion", targetHrefs: ["/animals/fox"] }];
    const result = computeInterferenceGraph({ target: target(), otherShips: [ship()], linkRows });
    const sentence = interferenceSummarySentence(result);
    expect(sentence).not.toBeNull();
    expect(sentence).not.toMatch(/[–—]/);
  });

  it("groups significant edges by kind with a plain label", () => {
    const linkRows: PageLinkRow[] = [{ sourcePath: "/animals/lion", targetHrefs: ["/animals/fox"] }];
    const result = computeInterferenceGraph({ target: target(), otherShips: [ship()], linkRows });
    const groups = interferenceByKind(result);
    expect(groups.every((g) => g.edges.length > 0)).toBe(true);
    expect(groups.every((g) => typeof g.label === "string" && g.label.length > 0)).toBe(true);
  });
});

describe("toPlannerHoldEntry (selection-time adapter)", () => {
  it("holds with the summary sentence when interference is significant", () => {
    const linkRows: PageLinkRow[] = [{ sourcePath: "/animals/lion", targetHrefs: ["/animals/fox"] }];
    const result = computeInterferenceGraph({ target: target(), otherShips: [ship()], linkRows });
    const entry = toPlannerHoldEntry(result);
    expect(entry.hold).toBe(true);
    expect(entry.reason.length).toBeGreaterThan(0);
    expect(entry.reason).not.toMatch(/[–—]/);
  });

  it("never holds on a clean graph, with an empty reason", () => {
    const result = computeInterferenceGraph({ target: target(), otherShips: [] });
    const entry = toPlannerHoldEntry(result);
    expect(entry.hold).toBe(false);
    expect(entry.reason).toBe("");
  });
});

describe("computeInterferenceGraphForLedger (batch entry point)", () => {
  it("computes one graph per ship, keyed by host-stripped path", () => {
    const t = target();
    const o = ship();
    const linkRows: PageLinkRow[] = [{ sourcePath: t.path, targetHrefs: [o.path] }];
    const byPath = computeInterferenceGraphForLedger({ ships: [t, o], linkRows });
    expect(byPath.size).toBe(2);
    expect(byPath.get("/animals/lion")!.hasSignificantInterference).toBe(true);
  });

  it("excludes each ship's own row from its own otherShips", () => {
    const t = target();
    const byPath = computeInterferenceGraphForLedger({ ships: [t] });
    expect(byPath.get("/animals/lion")!.edges).toHaveLength(0);
  });

  it("returns an empty map for an empty ledger", () => {
    expect(computeInterferenceGraphForLedger({ ships: [] }).size).toBe(0);
  });
});

describe("copy guard - dash-clean, no em or en dashes in source", () => {
  it("the interference-graph.ts source contains no em or en dashes", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(path.join(__dirname, "interference-graph.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
