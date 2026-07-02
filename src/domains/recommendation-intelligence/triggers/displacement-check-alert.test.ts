/**
 * displacement-check-alert.test.ts (BEACON 500 item 82).
 *
 * Pins: the pure predicate's candidate-row SHAPE (watch action, page-level
 * anchor, evidence carrying the real numbers, customer copy with no em/en
 * dashes and no forbidden vocab), the worst-drop-first ranking, the
 * maxCandidates cap, and the empty-input abstention. No I/O — this file
 * never touches Supabase or runSerpQuery.
 */
import { describe, it, expect } from "vitest";

import { displacementCheckAlert } from "./displacement-check-alert";
import type { DisplacementVerdict } from "@/domains/serp/displacement-check";

function verdict(overrides: Partial<DisplacementVerdict> = {}): DisplacementVerdict {
  return {
    query: "persian rugs",
    page: "https://iranopedia.com/rugs",
    recentPosition: 8.9,
    priorPosition: 4.2,
    positionDrop: 4.7,
    clicksAtRiskPerWeek: 40,
    displacers: [{ domain: "rival.com", url: "https://rival.com/x", rank: 1, whatTheyHave: null }],
    fellOffPage: false,
    checkedAt: "2026-07-02T05:00:00.000Z",
    costUsd: 0.003,
    ...overrides,
  };
}

describe("displacementCheckAlert (pure predicate)", () => {
  it("abstains when there are no verdicts", () => {
    expect(displacementCheckAlert({ tenantId: "t1", verdicts: [], signalAt: "2026-07-02T05:00:00.000Z" })).toEqual([]);
  });

  it("skips a verdict with no page anchor (queue rules require a URL)", () => {
    const rows = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict({ page: "" })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows).toEqual([]);
  });

  it("emits a watch candidate anchored on the affected page", () => {
    const rows = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict()],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action_type).toBe("watch");
    expect(row.target_url).toBe("https://iranopedia.com/rugs");
    expect(row.trigger_signal).toBe("displacement_check");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.confidence).toBe("medium");
    expect(row.evidence.length).toBeGreaterThan(0);
    expect(row.evidence[0]!.detail).toContain("persian rugs");
    expect(row.evidence[0]!.detail).toContain("rival.com");
    expect(row.safety_flags).toEqual([]);
  });

  it("customer copy names the query, the real before/after positions, and the displacer", () => {
    const rows = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict()],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("persian rugs");
    expect(copy).toContain("4.2");
    expect(copy).toContain("8.9");
    expect(copy).toContain("rival.com");
    expect(copy).not.toMatch(/[–—]/); // no em/en dashes
  });

  it("follow-up copy offers reading the displacer's page next when no teardown is cached", () => {
    const rows = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict({ displacers: [{ domain: "rival.com", url: "https://rival.com/x", rank: 1, whatTheyHave: null }] })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows[0]!.customer_copy.toLowerCase()).toContain("read their page next");
  });

  it("names what the displacer's page has when a cached teardown exists", () => {
    const rows = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [
        verdict({
          displacers: [{ domain: "rival.com", url: "https://rival.com/x", rank: 1, whatTheyHave: "FAQ schema, answer block" }],
        }),
      ],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(rows[0]!.customer_copy).toContain("FAQ schema, answer block");
  });

  it("marks high impact for a 5+ position drop or a fell-off-page verdict", () => {
    const bigDrop = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict({ positionDrop: 5.2 })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(bigDrop[0]!.impact_estimate).toBe("high");

    const fellOff = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict({ positionDrop: 3.1, fellOffPage: true })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(fellOff[0]!.impact_estimate).toBe("high");

    const modest = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [verdict({ positionDrop: 3.1, fellOffPage: false })],
      signalAt: "2026-07-02T05:00:00.000Z",
    });
    expect(modest[0]!.impact_estimate).toBe("medium");
  });

  it("ranks worst drop first and respects maxCandidates", () => {
    const rows = displacementCheckAlert({
      tenantId: "t1",
      verdicts: [
        verdict({ query: "small drop", page: "https://iranopedia.com/a", positionDrop: 3.1 }),
        verdict({ query: "big drop", page: "https://iranopedia.com/b", positionDrop: 9.0 }),
        verdict({ query: "mid drop", page: "https://iranopedia.com/c", positionDrop: 5.0 }),
      ],
      signalAt: "2026-07-02T05:00:00.000Z",
      maxCandidates: 2,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.topic_cluster_label).toContain("big drop");
    expect(rows[1]!.topic_cluster_label).toContain("mid drop");
  });

  it("dedupe_key and cooldown_key are deterministic for the same tenant/query/page", () => {
    const rows1 = displacementCheckAlert({ tenantId: "t1", verdicts: [verdict()], signalAt: "2026-07-02T05:00:00.000Z" });
    const rows2 = displacementCheckAlert({ tenantId: "t1", verdicts: [verdict()], signalAt: "2026-07-03T05:00:00.000Z" });
    expect(rows1[0]!.dedupe_key).toBe(rows2[0]!.dedupe_key);
    expect(rows1[0]!.cooldown_key).toBe(rows2[0]!.cooldown_key);
  });
});
