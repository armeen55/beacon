/**
 * broken-competitor-alert.test.ts (BEACON_500 P9 v1 250+259).
 *
 * Pins the pure predicate's candidate-row SHAPE (create_page action, site-root
 * anchor, evidence carrying the real facts, dash-free customer copy), the
 * biggest-vacancy-first ranking, the cap, and the empty/no-root abstentions.
 * No I/O.
 */
import { describe, it, expect } from "vitest";

import { brokenCompetitorAlert } from "./broken-competitor-alert";
import type { BrokenCompetitorFinding } from "@/domains/serp/broken-competitor";

const SIGNAL_AT = "2026-07-03T05:00:00.000Z";
const ROOT = "https://iranopedia.com/";

function finding(overrides: Partial<BrokenCompetitorFinding> = {}): BrokenCompetitorFinding {
  return {
    query: "persian wedding",
    domain: "rival.com",
    bestRankWhilePresent: 3,
    lastUrl: "https://rival.com/persian-wedding",
    lastSeenAt: "2026-06-25T00:00:00.000Z",
    droppedByAt: "2026-07-02T00:00:00.000Z",
    sentence: "rival.com used to show up at #3 ...",
    ...overrides,
  };
}

describe("brokenCompetitorAlert (pure predicate)", () => {
  it("abstains when there are no findings", () => {
    expect(brokenCompetitorAlert({ tenantId: "t1", findings: [], siteRootUrl: ROOT, signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("abstains when there is no site root (queue rules require a URL)", () => {
    expect(brokenCompetitorAlert({ tenantId: "t1", findings: [finding()], siteRootUrl: null, signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("emits a create_page candidate anchored on the site root", () => {
    const rows = brokenCompetitorAlert({
      tenantId: "t1",
      findings: [finding({ bestRankWhilePresent: 5 })],
      siteRootUrl: ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action_type).toBe("create_page");
    expect(row.target_url).toBe(ROOT);
    expect(row.trigger_signal).toBe("broken_competitor");
    expect(row.generator_kind).toBe("deterministic");
    expect(row.confidence).toBe("medium");
    expect(row.evidence[0]!.detail).toContain("dropped_domain=rival.com");
    expect(row.customer_copy).toContain("persian wedding");
    expect(row.customer_copy).toContain("rival.com");
    expect(row.customer_copy).not.toMatch(/[—–]/);
    // A dropped #5 (below the top-3 band) is medium impact.
    expect(row.impact_estimate).toBe("medium");
  });

  it("marks a top-3 vacancy as high impact", () => {
    const rows = brokenCompetitorAlert({
      tenantId: "t1",
      findings: [finding({ bestRankWhilePresent: 1 })],
      siteRootUrl: ROOT,
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.impact_estimate).toBe("high");
  });

  it("ranks the biggest vacancy first and respects the cap", () => {
    const findings = [
      finding({ query: "q7", domain: "d7.com", bestRankWhilePresent: 7 }),
      finding({ query: "q1", domain: "d1.com", bestRankWhilePresent: 1 }),
      finding({ query: "q4", domain: "d4.com", bestRankWhilePresent: 4 }),
      finding({ query: "q2", domain: "d2.com", bestRankWhilePresent: 2 }),
    ];
    const rows = brokenCompetitorAlert({ tenantId: "t1", findings, siteRootUrl: ROOT, signalAt: SIGNAL_AT, maxCandidates: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.topic_cluster_label)).toEqual(["broken_competitor:q1", "broken_competitor:q2"]);
  });
});
