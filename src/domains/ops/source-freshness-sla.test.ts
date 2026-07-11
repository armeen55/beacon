/**
 * source-freshness-sla (Wave 3A D5 pin, 2026-07-10) - THE pin for the "5 healthy while AI is
 * 2 weeks old" leak. Health is judged against a per-source DATA-age SLA, not connection status:
 * overall is healthy ONLY when every REQUIRED source is inside its own SLA. GA4 is a removed
 * source (excluded from the tally); Wix is optional (never blocks).
 */
import { describe, it, expect } from "vitest";

import {
  classifySourceFreshness,
  overallFreshness,
  sourceFreshnessLine,
  SOURCE_SLA,
  CONNECTION_LIVENESS_STALE_DAYS,
  type SourceFreshness,
} from "./source-freshness";

const NOW = new Date("2026-07-15T12:00:00Z");
/** A YYYY-MM-DD `days` before NOW. */
const ago = (days: number): string =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);

describe("SOURCE_SLA - the reconciled per-source data-age table", () => {
  it("gsc 3d, profound 21d, clarity 7d are required; ga4 removed; wix optional with no SLA", () => {
    expect(SOURCE_SLA.gsc).toEqual({ slaMaxDataAgeDays: 3, required: true, removed: false });
    expect(SOURCE_SLA.profound).toEqual({ slaMaxDataAgeDays: 21, required: true, removed: false });
    expect(SOURCE_SLA.clarity).toEqual({ slaMaxDataAgeDays: 7, required: true, removed: false });
    expect(SOURCE_SLA.ga4.removed).toBe(true);
    expect(SOURCE_SLA.ga4.required).toBe(false);
    expect(SOURCE_SLA.wix).toEqual({ slaMaxDataAgeDays: null, required: false, removed: false });
    // The connection-liveness (sync-age) threshold is distinct from the data-age SLAs.
    expect(CONNECTION_LIVENESS_STALE_DAYS).toBe(14);
  });
});

describe("classifySourceFreshness - each source against its own SLA", () => {
  it("gsc data 1 day old is healthy; 13 days old is stale", () => {
    expect(classifySourceFreshness({ source: "gsc", dataThroughDate: ago(1) }, NOW).state).toBe("healthy");
    expect(classifySourceFreshness({ source: "gsc", dataThroughDate: ago(13) }, NOW).state).toBe("stale");
  });

  it("profound tolerates 20 days (SLA 21) but not 22", () => {
    expect(classifySourceFreshness({ source: "profound", dataThroughDate: ago(20) }, NOW).state).toBe("healthy");
    expect(classifySourceFreshness({ source: "profound", dataThroughDate: ago(22) }, NOW).state).toBe("stale");
  });

  it("clarity tolerates 7 days but not 8", () => {
    expect(classifySourceFreshness({ source: "clarity", dataThroughDate: ago(7) }, NOW).state).toBe("healthy");
    expect(classifySourceFreshness({ source: "clarity", dataThroughDate: ago(8) }, NOW).state).toBe("stale");
  });

  it("ga4 is always removed, even with fresh data", () => {
    expect(classifySourceFreshness({ source: "ga4", dataThroughDate: ago(0) }, NOW).state).toBe("removed");
  });

  it("wix has no data SLA - any data reads healthy", () => {
    expect(classifySourceFreshness({ source: "wix", dataThroughDate: ago(100) }, NOW).state).toBe("healthy");
  });

  it("a source with no data reads no_data", () => {
    expect(classifySourceFreshness({ source: "gsc", dataThroughDate: null }, NOW).state).toBe("no_data");
  });
});

const cls = (source: Parameters<typeof classifySourceFreshness>[0]["source"], dataThroughDate: string | null): SourceFreshness =>
  classifySourceFreshness({ source, dataThroughDate }, NOW);

describe("overallFreshness - healthy only when every required source is in SLA", () => {
  it("all required sources within SLA -> healthy, worst-through is the oldest required data date", () => {
    const overall = overallFreshness([
      cls("gsc", ago(1)),
      cls("profound", ago(10)),
      cls("clarity", ago(2)),
      cls("ga4", ago(0)), // removed - excluded
      cls("wix", ago(30)), // optional - never blocks
    ]);
    expect(overall.healthy).toBe(true);
    expect(overall.stale).toHaveLength(0);
    expect(overall.worstThrough).toBe(ago(10)); // profound is the oldest required source
  });

  it("a 13-day-stale GSC makes overall NOT healthy", () => {
    const overall = overallFreshness([
      cls("gsc", ago(13)),
      cls("profound", ago(2)),
      cls("clarity", ago(1)),
    ]);
    expect(overall.healthy).toBe(false);
    expect(overall.stale.map((s) => s.source)).toContain("gsc");
  });

  it("a removed GA4 with ancient data never blocks health, and never appears in the stale list", () => {
    const overall = overallFreshness([
      cls("gsc", ago(1)),
      cls("profound", ago(2)),
      cls("clarity", ago(1)),
      cls("ga4", ago(999)),
    ]);
    expect(overall.healthy).toBe(true);
    expect(overall.stale.map((s) => s.source)).not.toContain("ga4");
  });

  it("a required source with no data is not healthy", () => {
    const overall = overallFreshness([
      cls("gsc", ago(1)),
      cls("profound", null),
      cls("clarity", ago(1)),
    ]);
    expect(overall.healthy).toBe(false);
    expect(overall.stale.map((s) => s.source)).toContain("profound");
  });
});

describe("sourceFreshnessLine - names the worst required data-through, never a bare count", () => {
  it("healthy line names the oldest through date", () => {
    const overall = overallFreshness([cls("gsc", ago(1)), cls("profound", ago(3)), cls("clarity", ago(2))]);
    expect(sourceFreshnessLine(overall, "Jul 12")).toBe(
      "Your key sources are current. The oldest data runs through Jul 12.",
    );
  });

  it("unhealthy line names the gap and the worst through date, no em or en dash", () => {
    const overall = overallFreshness([cls("gsc", ago(13)), cls("profound", ago(2)), cls("clarity", ago(1))]);
    const line = sourceFreshnessLine(overall, "Jul 2");
    expect(line).toContain("key source");
    expect(line).toContain("need");
    expect(line).toContain("Jul 2");
    // Unicode escapes (en dash, em dash) so this file itself carries no literal dash character.
    expect(/[\u2013\u2014]/.test(line)).toBe(false);
  });
});
