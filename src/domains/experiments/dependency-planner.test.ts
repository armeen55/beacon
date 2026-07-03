/**
 * Tests for dependency-planner (BEACON_500 N45).
 *
 * Coverage:
 *  - edge derivation per prerequisite kind (technical block, hub page, schema)
 *  - the prerequisite hold + plain sentence
 *  - NO false holds: a clean batch, an already-shipped prerequisite, a cleared
 *    block => empty edges/held (byte-identical when no dependency exists)
 *  - collapse: a candidate held by two edges is held once, most-severe reason
 *  - the hold lookup adapter
 */

import { describe, expect, it } from "vitest";
import {
  buildTechnicalBlockEdges,
  buildHubPageEdges,
  buildSchemaFirstEdges,
  planDependencies,
  heldCandidateIds,
  dependencyHoldLookup,
  normPath,
  type DependencyCandidate,
} from "./dependency-planner";

function c(overrides: Partial<DependencyCandidate> & Pick<DependencyCandidate, "id" | "url" | "actionType">): DependencyCandidate {
  return { ...overrides };
}

describe("normPath", () => {
  it("host-strips, drops trailing slash, lowercases", () => {
    expect(normPath("https://x.com/Iran-Flags/")).toBe("/iran-flags");
    expect(normPath("/A/B/")).toBe("/a/b");
    expect(normPath(null)).toBe("");
  });
});

describe("buildTechnicalBlockEdges - fix before optimize", () => {
  it("holds a content edit on a technically-blocked page, naming the queued fix", () => {
    const fix = c({ id: "fix1", url: "/iran-flags", actionType: "fix_noindex" });
    const edit = c({ id: "edit1", url: "/iran-flags", actionType: "add_h2_section", technicalBlocked: true });
    const edges = buildTechnicalBlockEdges([fix, edit]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.dependentId).toBe("edit1");
    expect(edges[0]!.prerequisiteId).toBe("fix1");
    expect(edges[0]!.kind).toBe("fix_technical_block");
    expect(edges[0]!.plainReason).toContain("Fix the indexing problem on /iran-flags first");
    expect(edges[0]!.plainReason).toContain("wastes the work");
    expect(edges[0]!.plainReason).not.toMatch(/[—–]/);
  });

  it("holds a blocked content edit even with NO fix candidate in the batch (block itself is the prerequisite)", () => {
    const edit = c({ id: "edit1", url: "/x", actionType: "edit_title", technicalBlocked: true });
    const edges = buildTechnicalBlockEdges([edit]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.prerequisiteId).toBeNull();
  });

  it("NEVER holds the technical fix itself", () => {
    const fix = c({ id: "fix1", url: "/x", actionType: "fix_noindex", technicalBlocked: true });
    expect(buildTechnicalBlockEdges([fix])).toEqual([]);
  });

  it("NO false hold: a clean (not blocked) page never holds its content edit", () => {
    const edit = c({ id: "edit1", url: "/x", actionType: "add_h2_section", technicalBlocked: false });
    expect(buildTechnicalBlockEdges([edit])).toEqual([]);
  });

  it("an already-shipped content edit is never held", () => {
    const edit = c({ id: "edit1", url: "/x", actionType: "add_h2_section", technicalBlocked: true, alreadyShipped: true });
    expect(buildTechnicalBlockEdges([edit])).toEqual([]);
  });

  it("an already-shipped fix does not serve as a pending prerequisite (block itself named instead)", () => {
    const fix = c({ id: "fix1", url: "/x", actionType: "fix_noindex", alreadyShipped: true });
    const edit = c({ id: "edit1", url: "/x", actionType: "add_faq", technicalBlocked: true });
    const edges = buildTechnicalBlockEdges([fix, edit]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.prerequisiteId).toBeNull();
  });
});

describe("buildHubPageEdges - build the hub before linking to it", () => {
  it("holds an internal link that points at a not-yet-built create_page in the batch", () => {
    const hub = c({ id: "hub1", url: "/best-persian-restaurants", actionType: "create_page" });
    const link = c({
      id: "link1",
      url: "/tehran-food",
      actionType: "add_internal_link",
      linkDestinationUrl: "/best-persian-restaurants",
    });
    const edges = buildHubPageEdges([hub, link]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.dependentId).toBe("link1");
    expect(edges[0]!.prerequisiteId).toBe("hub1");
    expect(edges[0]!.kind).toBe("build_hub_page");
    expect(edges[0]!.plainReason).toContain("Build /best-persian-restaurants first");
  });

  it("NO false hold: a link to an EXISTING page (no create_page candidate) is not held", () => {
    const link = c({
      id: "link1",
      url: "/tehran-food",
      actionType: "add_internal_link",
      linkDestinationUrl: "/an-existing-page",
    });
    expect(buildHubPageEdges([link])).toEqual([]);
  });

  it("NO false hold when the hub create_page is already shipped", () => {
    const hub = c({ id: "hub1", url: "/hub", actionType: "create_page", alreadyShipped: true });
    const link = c({ id: "link1", url: "/x", actionType: "add_internal_link", linkDestinationUrl: "/hub" });
    expect(buildHubPageEdges([hub, link])).toEqual([]);
  });
});

describe("buildSchemaFirstEdges - schema before rich results", () => {
  it("holds a schema-dependent edit on a page that also has a pending add_schema", () => {
    const schema = c({ id: "s1", url: "/compare", actionType: "add_schema" });
    const table = c({ id: "t1", url: "/compare", actionType: "add_table" });
    const edges = buildSchemaFirstEdges([schema, table]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.dependentId).toBe("t1");
    expect(edges[0]!.prerequisiteId).toBe("s1");
    expect(edges[0]!.kind).toBe("add_schema_first");
    expect(edges[0]!.plainReason).toContain("Add the schema on /compare first");
  });

  it("NO false hold: a schema-dependent edit on a page WITHOUT a schema candidate is free", () => {
    const table = c({ id: "t1", url: "/compare", actionType: "add_table" });
    expect(buildSchemaFirstEdges([table])).toEqual([]);
  });

  it("a schema-dependent edit on a DIFFERENT page than the schema is not held", () => {
    const schema = c({ id: "s1", url: "/a", actionType: "add_schema" });
    const table = c({ id: "t1", url: "/b", actionType: "add_table" });
    expect(buildSchemaFirstEdges([schema, table])).toEqual([]);
  });
});

describe("planDependencies - composition, collapse, byte-identical", () => {
  it("BYTE-IDENTICAL when no dependency exists: empty edges + empty held", () => {
    const batch = [
      c({ id: "a", url: "/a", actionType: "add_h2_section" }),
      c({ id: "b", url: "/b", actionType: "edit_title" }),
      c({ id: "d", url: "/d", actionType: "create_page" }),
    ];
    const plan = planDependencies(batch);
    expect(plan.edges).toEqual([]);
    expect(plan.held).toEqual([]);
  });

  it("collapses two edges on one dependent to ONE hold, keeping the most severe (technical > schema)", () => {
    // /compare is technically blocked AND has a pending schema; add_faq depends
    // on both. The technical block is the more severe hold and must win.
    const batch = [
      c({ id: "fix", url: "/compare", actionType: "fix_noindex" }),
      c({ id: "schema", url: "/compare", actionType: "add_schema" }),
      c({ id: "faq", url: "/compare", actionType: "add_faq", technicalBlocked: true }),
    ];
    const plan = planDependencies(batch);
    // edges: technical(faq) + schema(faq) both derived
    expect(plan.edges.filter((e) => e.dependentId === "faq")).toHaveLength(2);
    // held: exactly one entry for faq, the technical one
    const faqHolds = plan.held.filter((h) => h.id === "faq");
    expect(faqHolds).toHaveLength(1);
    expect(faqHolds[0]!.kind).toBe("fix_technical_block");
  });

  it("derives all three kinds together in one batch", () => {
    const batch = [
      c({ id: "fix", url: "/a", actionType: "fix_noindex" }),
      c({ id: "opt", url: "/a", actionType: "edit_title", technicalBlocked: true }),
      c({ id: "hub", url: "/hub", actionType: "create_page" }),
      c({ id: "link", url: "/b", actionType: "add_internal_link", linkDestinationUrl: "/hub" }),
      c({ id: "schema", url: "/c", actionType: "add_schema" }),
      c({ id: "table", url: "/c", actionType: "add_table" }),
    ];
    const plan = planDependencies(batch);
    expect(new Set(plan.held.map((h) => h.kind))).toEqual(
      new Set(["fix_technical_block", "build_hub_page", "add_schema_first"]),
    );
    expect(heldCandidateIds(plan)).toEqual(new Set(["opt", "link", "table"]));
  });
});

describe("dependencyHoldLookup - the adapter for the planner wire-in", () => {
  it("keys held id -> plain reason", () => {
    const batch = [
      c({ id: "fix", url: "/a", actionType: "fix_noindex" }),
      c({ id: "opt", url: "/a", actionType: "add_h2_section", technicalBlocked: true }),
    ];
    const lookup = dependencyHoldLookup(planDependencies(batch));
    expect(lookup.get("opt")).toContain("Fix the indexing problem on /a first");
    expect(lookup.has("fix")).toBe(false);
  });

  it("is empty for a clean batch", () => {
    const lookup = dependencyHoldLookup(planDependencies([c({ id: "a", url: "/a", actionType: "edit_title" })]));
    expect(lookup.size).toBe(0);
  });
});
