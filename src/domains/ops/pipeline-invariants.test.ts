/**
 * pipeline-invariants checker (2026-07-02, master plan item 10).
 *
 * Every invariant class + the clean case + the skip-over-scream rule (a failed
 * reading never fires a violation). Copy pins: first person, exact broken
 * stage named, no em or en dashes.
 */
import { describe, expect, it } from "vitest";

import {
  checkPipelineInvariants,
  describeAgeHours,
  FRESHNESS_LIMIT_HOURS,
  RECENT_WINDOW_HOURS,
  type PipelineReadings,
} from "./pipeline-invariants";

const NOW = "2026-07-02T12:00:00.000Z";
const FRESH = "2026-07-02T09:00:00.000Z"; // 3h ago
const STALE = "2026-06-29T09:00:00.000Z"; // ~75h ago

/** A fully healthy tenant: everything connected, fresh, and producing. */
function healthyReadings(over: Partial<PipelineReadings> = {}): PipelineReadings {
  return {
    tenantId: "tenant-test",
    checkedAt: NOW,
    recentWindowHours: RECENT_WINDOW_HOURS,
    connectors: {
      gsc: { connected: true, lastSyncedAt: FRESH },
      ga4: { connected: true, lastSyncedAt: FRESH },
      profound: { connected: true, lastSyncedAt: FRESH },
    },
    tables: {
      gsc_daily_rows: { recentRows: 1200, latestRowAt: FRESH },
      ga4_url_traffic: { recentRows: 300, latestRowAt: FRESH },
      ga4_ai_referral_daily: { recentRows: 4, latestRowAt: FRESH },
      profound_citation_rows: { recentRows: 900, latestRowAt: FRESH },
      prompt_answer_observations: { recentRows: 40, latestRowAt: FRESH },
    },
    dailyPlan: { hasPlan: true, candidateCount: 5, planCreatedAt: FRESH },
    demandGraph: { nodes: 214, moves: 237 },
    ...over,
  };
}

describe("checkPipelineInvariants - clean case", () => {
  it("returns no violations for a healthy tenant", () => {
    expect(checkPipelineInvariants(healthyReadings())).toEqual([]);
  });

  it("returns no violations when nothing is connected and nothing is known", () => {
    const readings = healthyReadings({
      connectors: {
        gsc: { connected: false, lastSyncedAt: null },
        ga4: { connected: false, lastSyncedAt: null },
        profound: { connected: null, lastSyncedAt: null },
      },
      tables: {
        gsc_daily_rows: { recentRows: null, latestRowAt: null },
        ga4_url_traffic: { recentRows: null, latestRowAt: null },
        ga4_ai_referral_daily: { recentRows: null, latestRowAt: null },
        profound_citation_rows: { recentRows: null, latestRowAt: null },
        prompt_answer_observations: { recentRows: null, latestRowAt: null },
      },
      dailyPlan: null,
      demandGraph: null,
    });
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });
});

describe("volume invariants (connected source wrote 0 rows)", () => {
  it("fires gsc_sync when GSC is connected, fresh, but wrote 0 rows", () => {
    const readings = healthyReadings();
    readings.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: "2026-07-01T02:00:00.000Z" };
    const violations = checkPipelineInvariants(readings);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.stage).toBe("gsc_sync");
    expect(violations[0]!.actual).toBe("0 rows");
    expect(violations[0]!.sentence).toContain("Search Console is connected but last night's sync wrote 0 rows");
    expect(violations[0]!.sentence).toContain("broken at the Search Console stage");
    expect(violations[0]!.sentence).toContain("stale, not zero");
  });

  it("GA4 0-rows-on-a-fresh-sync is INFO (quiet source), not a broken-pipe alarm", () => {
    // 2026-07-08: an OPTIONAL source that synced fine but returned 0 rows is quiet, not
    // broken. It's info-level so it never drives the "needs attention" banner.
    const readings = healthyReadings();
    readings.tables.ga4_url_traffic = { recentRows: 0, latestRowAt: "2026-07-01T02:00:00.000Z" };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["ga4_sync"]);
    expect(violations[0]!.severity).toBe("info");
    expect(violations[0]!.sentence).toContain("Google Analytics");
    expect(violations[0]!.sentence).toContain("not that anything is broken");
    expect(violations[0]!.sentence).not.toContain("broken at the");
  });

  it("the AI answer feed (Profound) 0-rows is INFO (dead/quiet source), never 'broken'", () => {
    // The exact false alarm the operator hit: a dead borrowed Profound account writes 0
    // rows every night. Connected + synced + 0 rows = quiet, not broken.
    const readings = healthyReadings();
    readings.tables.profound_citation_rows = { recentRows: 0, latestRowAt: "2026-07-01T02:00:00.000Z" };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["profound_sync"]);
    expect(violations[0]!.severity).toBe("info");
    expect(violations[0]!.sentence).not.toContain("broken at the AI answer feed stage");
    expect(violations[0]!.sentence).not.toContain("the the");
  });

  it("does NOT fire for a disconnected source with 0 rows", () => {
    const readings = healthyReadings();
    readings.connectors.gsc = { connected: false, lastSyncedAt: null };
    readings.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: null };
    // gsc_daily_rows empty also disables the daily-candidates assertion.
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });

  it("does NOT fire when the count read failed (null), only when a confirmed 0", () => {
    const readings = healthyReadings();
    readings.tables.gsc_daily_rows = { recentRows: null, latestRowAt: FRESH };
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });
});

describe("freshness invariants (48h limit for a connected source)", () => {
  it("fires gsc_freshness when the last good sync is older than 48h", () => {
    const readings = healthyReadings();
    readings.connectors.gsc = { connected: true, lastSyncedAt: STALE };
    readings.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: STALE };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["gsc_freshness"]);
    expect(violations[0]!.sentence).toContain(`past my ${FRESHNESS_LIMIT_HOURS} hour limit`);
    expect(violations[0]!.actual).toContain("day");
  });

  it("freshness subsumes volume: only ONE violation per source", () => {
    const readings = healthyReadings();
    readings.connectors.ga4 = { connected: true, lastSyncedAt: STALE };
    readings.tables.ga4_url_traffic = { recentRows: 0, latestRowAt: STALE };
    const stages = checkPipelineInvariants(readings).map((v) => v.stage);
    expect(stages).toEqual(["ga4_freshness"]);
  });

  it("a fresh table watermark saves a source whose stamp write failed", () => {
    const readings = healthyReadings();
    readings.connectors.gsc = { connected: true, lastSyncedAt: null };
    // Rows landed 3h ago: the pipe works even though the stamp is missing.
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });

  it("fires the never-synced freshness case (connected, no stamp, no rows ever)", () => {
    const readings = healthyReadings();
    readings.connectors.profound = { connected: true, lastSyncedAt: null };
    readings.tables.profound_citation_rows = { recentRows: 0, latestRowAt: null };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["profound_freshness"]);
    expect(violations[0]!.actual).toBe("no completed sync ever");
    expect(violations[0]!.sentence).toContain("never seen a completed sync");
  });
});

describe("daily candidates invariant", () => {
  it("fires when demand rows exist but the latest plan has 0 candidates", () => {
    const readings = healthyReadings();
    readings.dailyPlan = { hasPlan: true, candidateCount: 0, planCreatedAt: FRESH };
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["daily_candidates"]);
    expect(violations[0]!.sentence).toContain("0 candidates");
    expect(violations[0]!.sentence).toContain("daily planning stage");
  });

  it("does NOT fire when no plan exists yet (a normal state)", () => {
    const readings = healthyReadings();
    readings.dailyPlan = { hasPlan: false, candidateCount: 0, planCreatedAt: null };
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });

  it("does NOT fire when the plan read failed (null)", () => {
    const readings = healthyReadings({ dailyPlan: null });
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });

  it("does NOT fire when no demand rows exist", () => {
    const readings = healthyReadings();
    readings.connectors.gsc = { connected: false, lastSyncedAt: null };
    readings.tables.gsc_daily_rows = { recentRows: 0, latestRowAt: null };
    readings.dailyPlan = { hasPlan: true, candidateCount: 0, planCreatedAt: FRESH };
    expect(checkPipelineInvariants(readings)).toEqual([]);
  });
});

describe("demand-graph moves invariant", () => {
  it("fires when the graph has nodes but 0 moves", () => {
    const readings = healthyReadings({ demandGraph: { nodes: 214, moves: 0 } });
    const violations = checkPipelineInvariants(readings);
    expect(violations.map((v) => v.stage)).toEqual(["demand_graph_moves"]);
    expect(violations[0]!.actual).toBe("214 demand topics, 0 moves");
    expect(violations[0]!.sentence).toContain("214 demand topics");
    expect(violations[0]!.sentence).toContain("move building stage");
  });

  it("does NOT fire on an empty graph or a missing snapshot", () => {
    expect(checkPipelineInvariants(healthyReadings({ demandGraph: { nodes: 0, moves: 0 } }))).toEqual([]);
    expect(checkPipelineInvariants(healthyReadings({ demandGraph: null }))).toEqual([]);
  });
});

describe("copy discipline", () => {
  it("every producible sentence is first person and free of em/en dashes", () => {
    const broken = healthyReadings({
      connectors: {
        gsc: { connected: true, lastSyncedAt: FRESH },
        ga4: { connected: true, lastSyncedAt: STALE },
        profound: { connected: true, lastSyncedAt: null },
      },
      tables: {
        gsc_daily_rows: { recentRows: 0, latestRowAt: FRESH },
        ga4_url_traffic: { recentRows: 0, latestRowAt: STALE },
        ga4_ai_referral_daily: { recentRows: 0, latestRowAt: null },
        profound_citation_rows: { recentRows: 0, latestRowAt: null },
        prompt_answer_observations: { recentRows: 0, latestRowAt: null },
      },
      dailyPlan: { hasPlan: true, candidateCount: 0, planCreatedAt: FRESH },
      demandGraph: { nodes: 10, moves: 0 },
    });
    const violations = checkPipelineInvariants(broken);
    expect(violations.length).toBe(5); // one per source + planning + graph
    for (const v of violations) {
      expect(v.sentence).not.toMatch(/[–—]/);
      expect(v.expected).not.toMatch(/[–—]/);
      expect(v.actual).not.toMatch(/[–—]/);
    }
    // First person shows up in the set (I / my).
    expect(violations.some((v) => /\bI\b|\bmy\b/.test(v.sentence))).toBe(true);
  });

  it("describeAgeHours speaks plain hours then days", () => {
    expect(describeAgeHours(3)).toBe("about 3 hours");
    expect(describeAgeHours(1)).toBe("about 1 hour");
    expect(describeAgeHours(75)).toBe("about 3 days");
  });
});
