/**
 * Session flow (Core 100K Phase 6 trim of src/domains/changes/session-flow.test.ts).
 * Pins the no-dead-end queue walk and the plain first-person progress lines
 * (concrete numbers, self-hiding when empty, no dashes, no lab words).
 */
import { describe, it, expect } from "vitest";
import {
  findNextActionable,
  isActionableRow,
  nextBestLine,
  noDeadEnd,
  sessionProgressLine,
  weeklyOutcomeLine,
} from "@/domains/changes/session-flow";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";

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
  it("suggested/ready/apply/verify are actionable; measuring/result/blocked/skipped are not", () => {
    for (const s of ["suggested", "ready", "apply", "verify"] as const) {
      expect(isActionableRow(cc("a", s))).toBe(true);
    }
    for (const s of ["measuring", "result", "blocked", "skipped"] as const) {
      expect(isActionableRow(cc("a", s))).toBe(false);
    }
  });
});

describe("findNextActionable", () => {
  it("returns the first actionable row after the just-handled one, skipping excluded and non-actionable rows", () => {
    const rows = [cc("a", "suggested"), cc("b", "measuring"), cc("c", "result"), cc("d", "ready"), cc("e", "suggested")];
    expect(findNextActionable(rows, "a")?.id).toBe("d");
    expect(findNextActionable(rows, "a", new Set(["d"]))?.id).toBe("e");
    expect(findNextActionable(rows, null)?.id).toBe("a");
  });

  it("returns null when nothing actionable remains (honest end of queue)", () => {
    const rows = [cc("a", "suggested"), cc("b", "measuring")];
    expect(findNextActionable(rows, "a")).toBeNull();
  });
});

describe("nextBestLine", () => {
  it("names the exact recommendation and page, dash-free; null when there is no next row", () => {
    const line = nextBestLine(cc("a", "suggested", { recommendation: "Rewrite the title tag", pageLabel: "Persian Male Names" }));
    expect(line).toBe("Next best: Rewrite the title tag on Persian Male Names.");
    expect(line).not.toMatch(/[\u2013\u2014]/);
    expect(nextBestLine(null)).toBeNull();
  });
});

describe("sessionProgressLine - live counter arithmetic from lifecycle counts", () => {
  it("names shipped-today, ready, and the next best page; clauses drop honestly when zero", () => {
    expect(sessionProgressLine({ shippedToday: 3, ready: 2, nextBestPage: "/iran-flags" })).toBe(
      "3 shipped today, 2 ready, next best is /iran-flags.",
    );
    expect(sessionProgressLine({ shippedToday: 1, ready: 0, nextBestPage: "/x" })).toBe("1 shipped today, next best is /x.");
    expect(sessionProgressLine({ shippedToday: 0, ready: 4, nextBestPage: "/y" })).toBe("4 ready, next best is /y.");
    expect(sessionProgressLine({ shippedToday: 2, ready: 0, nextBestPage: null })).toBe("2 shipped today.");
  });

  it("returns null when nothing has shipped and nothing is ready (strip self-hides)", () => {
    expect(sessionProgressLine({ shippedToday: 0, ready: 0, nextBestPage: null })).toBeNull();
    expect(sessionProgressLine({ shippedToday: 0, ready: 0, nextBestPage: "/z" })).toBeNull();
  });

  it("reuses only existing lifecycle words and never emits an em/en dash or a lab word", () => {
    const line = sessionProgressLine({ shippedToday: 5, ready: 3, nextBestPage: "/persian-names" });
    expect(line).not.toMatch(/[\u2013\u2014]/);
    expect(line).not.toMatch(/\b(experiment|control|baseline|treatment|reservation|SERP)\b/i);
  });
});

describe("weeklyOutcomeLine", () => {
  it("names shipped-this-week and measuring; drops the measuring clause at zero; null on a cold week", () => {
    expect(weeklyOutcomeLine({ shippedThisWeek: 5, measuring: 3 })).toBe("5 shipped this week, 3 measuring.");
    expect(weeklyOutcomeLine({ shippedThisWeek: 2, measuring: 0 })).toBe("2 shipped this week.");
    expect(weeklyOutcomeLine({ shippedThisWeek: 0, measuring: 4 })).toBeNull();
    expect(weeklyOutcomeLine({ shippedThisWeek: 9, measuring: 2 })).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("noDeadEnd invariant", () => {
  it("holds after every handled id, at the honest end of the queue, and on an empty list", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready"), cc("c", "suggested")];
    expect(noDeadEnd(rows, new Set())).toBe(true);
    expect(noDeadEnd(rows, new Set(["a", "b"]))).toBe(true);
    expect(noDeadEnd([cc("a", "suggested"), cc("b", "measuring")], new Set(["a"]))).toBe(true);
    expect(noDeadEnd([], new Set())).toBe(true);
  });
});
