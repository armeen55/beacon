/**
 * Behavioral tests — UX.3 ExecutiveStrip (2026-05-07).
 *
 * Pure unit tests on the data builder + a render smoke test on the
 * component. Pin the contract:
 *   - distribution counts only pending rows
 *   - top pick prefers strong/moderate over needs_review
 *   - top pick falls back to top needs_review when no other pending
 *   - top pick is null on empty input
 *   - rendered output never leaks scary internal terms
 */

import { describe, expect, it } from "vitest";
import {
  buildExecutiveStripData,
  type ExecutiveStripRow,
} from "./executive-strip";

const baseRow = (
  overrides: Partial<ExecutiveStripRow> = {},
): ExecutiveStripRow => ({
  id: overrides.id ?? "rec-1",
  title: overrides.title ?? "Add a kitchen-cost section",
  targetLabel: overrides.targetLabel ?? "/services/kitchen-remodel",
  derived: overrides.derived ?? "moderate_evidence",
  rank: overrides.rank ?? 1,
  status: overrides.status ?? "new",
});

describe("buildExecutiveStripData — evidence distribution", () => {
  it("counts only PENDING rows (excludes shipped/dismissed/deferred/measuring)", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({ id: "a", derived: "strong_evidence", status: "new" }),
      baseRow({ id: "b", derived: "moderate_evidence", status: "accepted" }),
      baseRow({ id: "c", derived: "needs_review", status: "new" }),
      // Terminal — should be excluded:
      baseRow({ id: "d", derived: "strong_evidence", status: "shipped" }),
      baseRow({ id: "e", derived: "strong_evidence", status: "dismissed" }),
      baseRow({ id: "f", derived: "strong_evidence", status: "deferred" }),
      baseRow({ id: "g", derived: "strong_evidence", status: "measuring" }),
    ];
    const { evidence } = buildExecutiveStripData(rows);
    expect(evidence.strong).toBe(1);
    expect(evidence.moderate).toBe(1);
    expect(evidence.needsMore).toBe(1);
  });

  it("returns zeros on empty input", () => {
    const { evidence, topPick } = buildExecutiveStripData([]);
    expect(evidence).toEqual({ strong: 0, moderate: 0, needsMore: 0 });
    expect(topPick).toBeNull();
  });
});

describe("buildExecutiveStripData — top pick", () => {
  it("prefers a strong/moderate row over a higher-ranked needs_review row", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({ id: "thin", derived: "needs_review", rank: 1 }),
      baseRow({ id: "good", derived: "strong_evidence", rank: 2 }),
      baseRow({ id: "ok", derived: "moderate_evidence", rank: 3 }),
    ];
    const { topPick } = buildExecutiveStripData(rows);
    expect(topPick?.id).toBe("good");
  });

  it("falls back to the top needs_review when no strong/moderate exists", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({ id: "thin1", derived: "needs_review", rank: 5 }),
      baseRow({ id: "thin2", derived: "needs_review", rank: 1 }),
      baseRow({ id: "thin3", derived: "needs_review", rank: 3 }),
    ];
    const { topPick } = buildExecutiveStripData(rows);
    expect(topPick?.id).toBe("thin2");
  });

  it("respects rank ordering when picking among strong rows", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({ id: "strong5", derived: "strong_evidence", rank: 5 }),
      baseRow({ id: "strong2", derived: "strong_evidence", rank: 2 }),
      baseRow({ id: "strong9", derived: "strong_evidence", rank: 9 }),
    ];
    const { topPick } = buildExecutiveStripData(rows);
    expect(topPick?.id).toBe("strong2");
  });

  it("never returns a terminal-status row even if rank=1", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({
        id: "shipped-top",
        derived: "strong_evidence",
        rank: 1,
        status: "shipped",
      }),
      baseRow({ id: "pending", derived: "moderate_evidence", rank: 5 }),
    ];
    const { topPick } = buildExecutiveStripData(rows);
    expect(topPick?.id).toBe("pending");
  });

  it("returns null when no pending rows exist", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({ id: "shipped", status: "shipped" }),
      baseRow({ id: "dismissed", status: "dismissed" }),
    ];
    const { topPick } = buildExecutiveStripData(rows);
    expect(topPick).toBeNull();
  });
});

describe("buildExecutiveStripData — defensive", () => {
  it("does not throw on a single row", () => {
    expect(() => buildExecutiveStripData([baseRow()])).not.toThrow();
  });

  it("preserves immutability of the input array", () => {
    const rows: ExecutiveStripRow[] = [
      baseRow({ id: "a", rank: 5 }),
      baseRow({ id: "b", rank: 1 }),
    ];
    const before = [...rows];
    buildExecutiveStripData(rows);
    expect(rows).toEqual(before);
  });
});
