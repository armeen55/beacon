import { describe, it, expect } from "vitest";
import { buildExecutionChecklist, wixInstructions } from "./execution-checklist";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ControlReservationRecord, ExperimentLever } from "./daily-plan-types";
import type { PlanExecutionState } from "./execution-state";

function exp(id: string, lever: ExperimentLever, detail: PlannedExperimentRecord["detail"]): PlannedExperimentRecord {
  return {
    id, candidateId: id, url: `https://s.com${id}`, canonicalUrl: `https://s.com${id}`, pageLabel: id, pageFamily: "f",
    lever, targetQuery: "q", currentText: "old", proposedText: "new", placement: "head", leaveUnchanged: [], rollbackText: "old",
    effortMinutes: 5, risk: "low", controls: [], influencedUrls: [], evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g", detail,
  };
}

function plan(selected: PlannedExperimentRecord[], execution?: PlanExecutionState): DailyExperimentPlanRecord {
  return {
    version: 1, id: "t::2026-07-01::abc", tenantId: "t", date: "2026-07-01", status: "accepted",
    createdAt: "t", expiresAt: "t", inputHash: "h", plannerVersion: "v",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: "t" },
    selected, backups: [], distribution: { byLever: {}, byPageFamily: {} }, estimatedMinutes: 10, execution,
  };
}

function res(experimentId: string, controlPath: string, status: ControlReservationRecord["status"]): ControlReservationRecord {
  return {
    version: 1, id: `t::p::${experimentId}::${controlPath}`, tenantId: "t", planId: "t::2026-07-01::abc",
    plannedExperimentId: experimentId, treatedUrl: "u", controlUrl: `https://s.com${controlPath}`, controlPath, status,
    reservedAt: "t", reservedUntil: "t", similarity: { score: 0.5, pageFamilyMatch: true },
  };
}

describe("wixInstructions", () => {
  it("meta names the SEO field + exact replace", () => {
    const i = wixInstructions(exp("/a", "meta", { kind: "meta", source: "p" }));
    expect(i).toContain("SEO Basics");
    expect(i).toContain("Meta description");
    expect(i).toContain("Replace exactly");
  });
  it("internal_link names the sentence + anchor + destination", () => {
    const i = wixInstructions(exp("/b", "internal_link", { kind: "internal_link", destinationUrl: "/dest", anchorText: "anchor words", wixInstructions: "", relationship: "sibling" }));
    expect(i).toContain("anchor words");
    expect(i).toContain("/dest");
  });
  it("answer_block says move below H1, do not rewrite", () => {
    const i = wixInstructions(exp("/c", "answer_block", { kind: "answer_block", question: "Q?", operation: "move", exactInstruction: "x", paragraphIndex: 3 }));
    expect(i).toContain("below the H1");
    expect(i).toContain("Do not rewrite");
  });
});

describe("buildExecutionChecklist", () => {
  const items = [
    exp("/a", "meta", { kind: "meta", source: "p" }),
    exp("/b", "internal_link", { kind: "internal_link", destinationUrl: "/dest", anchorText: "x", wixInstructions: "", relationship: "s" }),
    exp("/c", "answer_block", { kind: "answer_block", question: "Q?", operation: "move", exactInstruction: "x", paragraphIndex: 2 }),
  ];
  const execution: PlanExecutionState = {
    items: {
      "/a": { experimentId: "/a", status: "active", receipts: [], proofId: "/a::2026-07-01" },
      "/b": { experimentId: "/b", status: "gsc_submitted", receipts: [], proofId: "/b::2026-07-01" },
      "/c": { experimentId: "/c", status: "skipped", receipts: [] },
    },
    updatedAt: "t",
  };
  const reservations = [
    res("/a", "/c1", "active"), res("/a", "/c2", "active"),
    res("/b", "/c3", "active"),
    res("/c", "/c4", "released"),
  ];

  it("summarizes honestly", () => {
    const c = buildExecutionChecklist(plan(items, execution), reservations);
    expect(c.summary.accepted).toBe(3);
    expect(c.summary.active).toBe(2); // active + gsc_submitted
    expect(c.summary.submitted).toBe(1);
    expect(c.summary.skipped).toBe(1);
    expect(c.summary.left).toBe(0);
    expect(c.summary.controlsProtected).toBe(3); // active reservations only
    expect(c.planStatus).toBe("active"); // every non-skipped item is active
  });

  it("carries per-item status, proofId, and instructions", () => {
    const c = buildExecutionChecklist(plan(items, execution), reservations);
    const a = c.items.find((i) => i.experiment.id === "/a")!;
    expect(a.status).toBe("active");
    expect(a.proofId).toBe("/a::2026-07-01");
    expect(a.activeControls).toBe(2);
    expect(a.instructions).toContain("Meta description");
  });

  it("defaults items with no execution block to ready_to_apply", () => {
    const c = buildExecutionChecklist(plan(items), [res("/a", "/c1", "reserved"), res("/a", "/c2", "reserved")]);
    expect(c.items.every((i) => i.status === "ready_to_apply")).toBe(true);
    expect(c.summary.left).toBe(3);
    expect(c.summary.controlsProtected).toBe(0); // none active yet (all reserved)
    expect(c.planStatus).toBe("accepted");
  });
});
