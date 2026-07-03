import { describe, expect, it } from "vitest";

import {
  termCoverageGap,
  MIN_POSITION,
  MAX_POSITION,
  COVERAGE_FLOOR,
  MIN_IMPRESSIONS_90D,
  type TermCoverageGapItem,
} from "./term-coverage-gap";
import type { CoverageGrade } from "@/domains/linkgraph/term-coverage";

const SIGNAL_AT = "2026-07-03T10:00:00Z";

function grade(over: Partial<CoverageGrade> = {}): CoverageGrade {
  return {
    coverage: 0.2,
    expectedCount: 5,
    coveredCount: 1,
    missingTopLabels: ["visa fees", "processing time", "required documents"],
    missingAll: [
      { label: "visa fees", source: "consensus", weight: 100 },
      { label: "processing time", source: "consensus", weight: 90 },
      { label: "required documents", source: "question", weight: 300 },
    ],
    ...over,
  };
}

function item(over: Partial<TermCoverageGapItem> = {}): TermCoverageGapItem {
  return {
    url: "https://x.com/iran-visa",
    query: "iran visa",
    position: 8,
    impressions: 500,
    grade: grade(),
    ...over,
  };
}

describe("termCoverageGap", () => {
  it("emits add_h2_section naming the top missing subtopics", () => {
    const rows = termCoverageGap({ tenantId: "t", items: [item()], signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action_type).toBe("add_h2_section");
    expect(rows[0]!.trigger_signal).toBe("term_coverage_gap");
    expect(rows[0]!.target_url).toBe("https://x.com/iran-visa");
    expect(rows[0]!.customer_copy).toContain("iran visa");
    expect(rows[0]!.customer_copy).toContain("visa fees");
    expect(rows[0]!.customer_copy).toContain("processing time");
    expect(rows[0]!.customer_copy).toContain("required documents");
    expect(rows[0]!.customer_copy).toContain("the pages beating you all cover");
    // No lab words / dashes.
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("serp");
    expect(rows[0]!.customer_copy.toLowerCase()).not.toContain("coverage score");
    expect(rows[0]!.customer_copy).not.toMatch(/[—–]/);
  });

  it("RANKING BAND GATE: a #1 page never fires", () => {
    expect(termCoverageGap({ tenantId: "t", items: [item({ position: 1 })], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("RANKING BAND GATE: a page ranked far back never fires", () => {
    expect(termCoverageGap({ tenantId: "t", items: [item({ position: MAX_POSITION + 5 })], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("fires at the band edges", () => {
    expect(termCoverageGap({ tenantId: "t", items: [item({ position: MIN_POSITION })], signalAt: SIGNAL_AT })).toHaveLength(1);
    expect(termCoverageGap({ tenantId: "t", items: [item({ position: MAX_POSITION })], signalAt: SIGNAL_AT })).toHaveLength(1);
  });

  it("COVERAGE FLOOR: a well-covered page never fires", () => {
    const wellCovered = item({ grade: grade({ coverage: COVERAGE_FLOOR + 0.1 }) });
    expect(termCoverageGap({ tenantId: "t", items: [wellCovered], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("UNKNOWN RUBRIC: coverage=null never fires (never grade off no data)", () => {
    const unknown = item({ grade: grade({ coverage: null, missingTopLabels: [] }) });
    expect(termCoverageGap({ tenantId: "t", items: [unknown], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("no named gaps never fires (nothing concrete to ask for)", () => {
    const noGaps = item({ grade: grade({ coverage: 0.2, missingTopLabels: [] }) });
    expect(termCoverageGap({ tenantId: "t", items: [noGaps], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("DEMAND GATE: a low-impressions page never fires", () => {
    expect(termCoverageGap({ tenantId: "t", items: [item({ impressions: MIN_IMPRESSIONS_90D - 1 })], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("BYTE-IDENTICAL EMPTY: no items yields []", () => {
    expect(termCoverageGap({ tenantId: "t", items: [], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("ranks highest-demand first and caps emissions", () => {
    const items = Array.from({ length: 8 }, (_, i) => item({ url: `https://x.com/p${i}`, impressions: 200 + i }));
    const rows = termCoverageGap({ tenantId: "t", items, signalAt: SIGNAL_AT, maxEmissions: 3 });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.target_url).toBe("https://x.com/p7");
  });

  it("is deterministic", () => {
    const args = { tenantId: "t", items: [item()], signalAt: SIGNAL_AT };
    expect(JSON.stringify(termCoverageGap(args))).toBe(JSON.stringify(termCoverageGap(args)));
  });
});
