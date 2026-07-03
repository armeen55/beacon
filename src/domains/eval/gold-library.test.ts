import { describe, it, expect } from "vitest";

import { goldCases, goldCaseCount, goldDependencyCandidates } from "./gold-library";

describe("gold-library - the frozen substrate", () => {
  it("has a non-trivial set of cases and reports a stable count", () => {
    expect(goldCaseCount()).toBe(goldCases().length);
    expect(goldCaseCount()).toBeGreaterThanOrEqual(8);
  });

  it("every case id is unique (no accidental duplicate fixtures)", () => {
    const ids = goldCases().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case covers each gap bucket at least once", () => {
    const actions = new Set(goldCases().map((c) => c.expected.action));
    for (const gap of ["create_page", "edit_page", "answer_block", "fix_experience", "healthy", "low_demand"]) {
      expect(actions.has(gap as never)).toBe(true);
    }
  });

  it("no fixture text carries a banned dash", () => {
    const blob = JSON.stringify(goldCases());
    expect(blob).not.toMatch(/[‒–—―]/);
  });

  it("produces one dependency candidate per case (planner can run the whole batch)", () => {
    const deps = goldDependencyCandidates();
    expect(deps.length).toBe(goldCaseCount());
    // The technical-block case carries its real blocking shape.
    const blocked = deps.find((d) => d.id === "dependency-technical-block");
    expect(blocked?.technicalBlocked).toBe(true);
    expect(blocked?.actionType).toBe("edit_title");
  });
});
