import { describe, it, expect } from "vitest";
import { findNextActionable, isActionableRow, nextBestLine, noDeadEnd } from "./session-flow";
import type { CanonicalChange, CanonicalStatus } from "./canonical-change";

function cc(id: string, status: CanonicalStatus, over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id,
    tenantId: "t",
    pagePath: `/${id}`,
    pageUrl: `https://s.com/${id}`,
    pageLabel: id,
    opportunityType: "Capture clicks",
    changeType: "edit_meta",
    changeFamily: "meta",
    status,
    recommendation: `Fix ${id}`,
    exactInstructions: null,
    before: null,
    after: null,
    rationale: "why",
    estimatedEffortMinutes: 2,
    impactScore: 10,
    upside: null,
    expectedOutcome: null,
    riskLevel: "low",
    evidenceStrength: "directional",
    measurementMethod: "diff-in-diff",
    selectedForToday: false,
    activeExperiment: false,
    protectedControl: false,
    blockedReason: null,
    result: null,
    measurementHeadline: null,
    measurementDetail: null,
    nextCheckpoint: null,
    attributionLimited: false,
    sourceIds: [],
    alternateOpportunities: [],
    ...over,
  };
}

describe("isActionableRow", () => {
  it("treats suggested/ready/apply/verify as actionable", () => {
    expect(isActionableRow(cc("a", "suggested"))).toBe(true);
    expect(isActionableRow(cc("a", "ready"))).toBe(true);
    expect(isActionableRow(cc("a", "apply"))).toBe(true);
    expect(isActionableRow(cc("a", "verify"))).toBe(true);
  });
  it("treats measuring/result/blocked/skipped as not actionable", () => {
    expect(isActionableRow(cc("a", "measuring"))).toBe(false);
    expect(isActionableRow(cc("a", "result"))).toBe(false);
    expect(isActionableRow(cc("a", "blocked"))).toBe(false);
    expect(isActionableRow(cc("a", "skipped"))).toBe(false);
  });
});

describe("findNextActionable", () => {
  it("returns the first actionable row after the just-handled one", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready"), cc("c", "suggested")];
    const next = findNextActionable(rows, "a");
    expect(next?.id).toBe("b");
  });
  it("skips ids already excluded this session", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready"), cc("c", "suggested")];
    const next = findNextActionable(rows, "a", new Set(["b"]));
    expect(next?.id).toBe("c");
  });
  it("skips non-actionable rows (measuring/result/blocked)", () => {
    const rows = [cc("a", "suggested"), cc("b", "measuring"), cc("c", "result"), cc("d", "blocked"), cc("e", "ready")];
    const next = findNextActionable(rows, "a");
    expect(next?.id).toBe("e");
  });
  it("returns null when nothing actionable remains (honest end of queue)", () => {
    const rows = [cc("a", "suggested"), cc("b", "measuring")];
    const next = findNextActionable(rows, "a");
    expect(next).toBeNull();
  });
  it("considers the whole list when justHandledId is null", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready")];
    const next = findNextActionable(rows, null);
    expect(next?.id).toBe("a");
  });
});

describe("nextBestLine", () => {
  it("names the exact recommendation and page", () => {
    const line = nextBestLine(cc("a", "suggested", { recommendation: "Rewrite the title tag", pageLabel: "Persian Male Names" }));
    expect(line).toBe("Next best: Rewrite the title tag on Persian Male Names.");
  });
  it("is null when there is no next row", () => {
    expect(nextBestLine(null)).toBeNull();
  });
  it("never contains an em or en dash", () => {
    const line = nextBestLine(cc("a", "suggested", { recommendation: "Add an FAQ", pageLabel: "Some Page" }));
    expect(line).not.toMatch(/[–—]/);
  });
});

describe("noDeadEnd invariant", () => {
  it("holds when a next actionable row exists after every handled id", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready"), cc("c", "suggested")];
    expect(noDeadEnd(rows, new Set())).toBe(true);
    expect(noDeadEnd(rows, new Set(["a"]))).toBe(true);
    expect(noDeadEnd(rows, new Set(["a", "b"]))).toBe(true);
  });
  it("holds at the honest end of the queue (all handled or non-actionable)", () => {
    const rows = [cc("a", "suggested"), cc("b", "measuring")];
    expect(noDeadEnd(rows, new Set(["a"]))).toBe(true);
  });
  it("holds on an empty list", () => {
    expect(noDeadEnd([], new Set())).toBe(true);
  });
});
