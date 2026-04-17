import { describe, it, expect } from "vitest";
import {
  buildSiteCitationTimeline,
  detectSiteMovements,
  rankMovementsByMagnitude,
  DEFAULT_MOVEMENT_THRESHOLDS,
} from "./site-citation-timeline";
import type { RawCitation } from "./data-quality";
import type { DataQualityFlag } from "@/domains/events/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function owned(domain: string, date: string, flag = true): RawCitation {
  return {
    domain,
    source_category: "owned",
    is_owned: flag,
    observed_at: date,
  };
}

function other(domain: string, date: string): RawCitation {
  return {
    domain,
    source_category: "other",
    is_owned: false,
    observed_at: date,
  };
}

function shardsFromCounts(
  counts: Record<string, number>,
): Record<string, RawCitation[]> {
  const out: Record<string, RawCitation[]> = {};
  for (const [date, n] of Object.entries(counts)) {
    out[date] = Array.from({ length: n }, () =>
      owned("ritzbuilders.com", date),
    );
    // Sprinkle a non-owned so buildSiteCitationTimeline's filter is exercised.
    out[date].push(other("competitor.com", date));
  }
  return out;
}

function ritzFlag(date: string): DataQualityFlag {
  return {
    date,
    reason_code: "is_owned_false_but_category_owned",
    narrative: "test",
    domain: "ritzbuilders.com",
  };
}

// ---------------------------------------------------------------------------
// buildSiteCitationTimeline
// ---------------------------------------------------------------------------

describe("buildSiteCitationTimeline", () => {
  it("counts only source_category=owned citations for the target domain", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({ "2026-03-05": 6 }),
      dataQualityFlags: [],
    });
    expect(t.days).toEqual([
      { date: "2026-03-05", count: 6, is_data_bad: false },
    ]);
  });

  it("ignores citations from other domains", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: {
        "2026-03-05": [
          owned("ritzbuilders.com", "2026-03-05"),
          owned("competitor.com", "2026-03-05"),
        ],
      },
      dataQualityFlags: [],
    });
    expect(t.days[0].count).toBe(1);
  });

  it("uses source_category even when is_owned is false (the override that matters)", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: {
        "2026-04-08": [
          owned("ritzbuilders.com", "2026-04-08", /* is_owned */ false),
          owned("ritzbuilders.com", "2026-04-08", /* is_owned */ false),
        ],
      },
      dataQualityFlags: [],
    });
    expect(t.days[0].count).toBe(2);
  });

  it("produces a DENSE series (fills zero-count days between first and last)", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-05": 1,
        "2026-03-07": 3,
      }),
      dataQualityFlags: [],
    });
    expect(t.days.map((d) => d.date)).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
    ]);
    expect(t.days[1].count).toBe(0);
  });

  it("marks data_quality-flagged days with is_data_bad=true", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-04-07": 165,
        "2026-04-08": 173,
      }),
      dataQualityFlags: [ritzFlag("2026-04-07"), ritzFlag("2026-04-08")],
    });
    expect(t.days.every((d) => d.is_data_bad)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectSiteMovements
// ---------------------------------------------------------------------------

describe("detectSiteMovements", () => {
  it("fires on abs delta >= 20", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-01": 50,
        "2026-03-02": 70, // +20
      }),
      dataQualityFlags: [],
    });
    const events = detectSiteMovements(t);
    expect(events).toHaveLength(1);
    expect(events[0].delta_abs).toBe(20);
    expect(["delta_abs_over_threshold", "both"]).toContain(events[0].trigger);
  });

  it("fires on pct delta >= 30% when prev >= 5", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-09": 5,
        "2026-03-10": 19, // +14 abs, +280% pct
      }),
      dataQualityFlags: [],
    });
    const events = detectSiteMovements(t);
    expect(events).toHaveLength(1);
    expect(events[0].delta_abs).toBe(14);
    expect(events[0].trigger).toBe("delta_pct_over_threshold");
  });

  it("does NOT fire on large pct when prev < 5 (tiny-baseline noise suppression)", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-06": 2,
        "2026-03-07": 6, // +4 abs, +200% pct but prev=2 < 5
      }),
      dataQualityFlags: [],
    });
    expect(detectSiteMovements(t)).toEqual([]);
  });

  it("skips data_bad days and pairs the last-good with the next-good", () => {
    // Apr 6 (good, 147) → Apr 7–12 (BAD) → Apr 13 (good, 233).
    // Expected: a single delta of +86 attributed to Apr 13.
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-04-06": 147,
        "2026-04-07": 165,
        "2026-04-08": 173,
        "2026-04-09": 179,
        "2026-04-10": 171,
        "2026-04-11": 182,
        "2026-04-12": 198,
        "2026-04-13": 233,
      }),
      dataQualityFlags: [
        ritzFlag("2026-04-07"),
        ritzFlag("2026-04-08"),
        ritzFlag("2026-04-09"),
        ritzFlag("2026-04-10"),
        ritzFlag("2026-04-11"),
        ritzFlag("2026-04-12"),
      ],
    });
    const events = detectSiteMovements(t);
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-04-13");
    expect(events[0].prev_count).toBe(147);
    expect(events[0].count).toBe(233);
    expect(events[0].delta_abs).toBe(86);
  });

  it("emits down-moves too (drops are real signals)", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-26": 142,
        "2026-03-27": 122, // -20 abs
      }),
      dataQualityFlags: [],
    });
    const events = detectSiteMovements(t);
    expect(events).toHaveLength(1);
    expect(events[0].delta_abs).toBe(-20);
  });

  it("emits events with stable `mov-YYYYMMDD` ids keyed on the observed-lift day", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-25": 103,
        "2026-03-26": 142,
      }),
      dataQualityFlags: [],
    });
    const events = detectSiteMovements(t);
    expect(events[0].id).toBe("mov-20260326");
  });

  it("thresholds are configurable (abs=10 catches a +11 move)", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-01": 50,
        "2026-03-02": 61, // +11
      }),
      dataQualityFlags: [],
    });
    expect(detectSiteMovements(t)).toHaveLength(0);
    expect(detectSiteMovements(t, { deltaAbsMin: 10 })).toHaveLength(1);
  });
});

describe("rankMovementsByMagnitude", () => {
  it("sorts by abs(delta_abs) descending", () => {
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts({
        "2026-03-01": 100,
        "2026-03-02": 150, // +50
        "2026-03-03": 135, // -15
        "2026-03-04": 110, // -25
        "2026-03-05": 190, // +80
      }),
      dataQualityFlags: [],
    });
    const events = detectSiteMovements(t);
    const ranked = rankMovementsByMagnitude(events);
    expect(ranked.map((e) => e.date)).toEqual([
      "2026-03-05", // 80
      "2026-03-02", // 50
      "2026-03-04", // 25
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration fixture: the full Ritz dataset (from the dry-run table)
// ---------------------------------------------------------------------------

describe("Ritz fixture — top movement windows cover all 4 target spikes ±1", () => {
  it("includes Mar 10, Mar 13, Mar 26, and Apr 13 within ±1 day in the top windows", () => {
    // Counts lifted from the run-data-quality dry-run table.
    const counts: Record<string, number> = {
      "2026-03-05": 6, "2026-03-06": 2, "2026-03-07": 6, "2026-03-08": 4,
      "2026-03-09": 5, "2026-03-10": 19, "2026-03-11": 39, "2026-03-12": 50,
      "2026-03-13": 67, "2026-03-14": 77, "2026-03-15": 70, "2026-03-16": 76,
      "2026-03-17": 75, "2026-03-18": 79, "2026-03-19": 91, "2026-03-20": 98,
      "2026-03-21": 105, "2026-03-22": 110, "2026-03-23": 98, "2026-03-24": 115,
      "2026-03-25": 103, "2026-03-26": 142, "2026-03-27": 122, "2026-03-28": 135,
      "2026-03-29": 128, "2026-03-30": 125, "2026-03-31": 136, "2026-04-01": 138,
      "2026-04-02": 152, "2026-04-03": 157, "2026-04-04": 163, "2026-04-05": 152,
      "2026-04-06": 147, "2026-04-07": 165, "2026-04-08": 173, "2026-04-09": 179,
      "2026-04-10": 171, "2026-04-11": 182, "2026-04-12": 198, "2026-04-13": 233,
      "2026-04-14": 234,
    };
    const t = buildSiteCitationTimeline({
      tenant_id: "t1",
      domain: "ritzbuilders.com",
      citationsByDate: shardsFromCounts(counts),
      dataQualityFlags: [
        ritzFlag("2026-04-07"), ritzFlag("2026-04-08"),
        ritzFlag("2026-04-09"), ritzFlag("2026-04-10"),
        ritzFlag("2026-04-11"), ritzFlag("2026-04-12"),
      ],
    });

    const events = detectSiteMovements(t);
    const ranked = rankMovementsByMagnitude(events);
    const topDates = ranked.map((e) => e.date);

    const targets = ["2026-03-10", "2026-03-13", "2026-03-26", "2026-04-13"];
    for (const target of targets) {
      const hit = topDates.some((d) => withinOneDay(d, target));
      expect(hit, `target ${target} not matched in ${topDates.join(", ")}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ±1 day helper
// ---------------------------------------------------------------------------

function withinOneDay(a: string, b: string): boolean {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.abs(da - db) <= 24 * 60 * 60 * 1000;
}

describe("DEFAULT_MOVEMENT_THRESHOLDS", () => {
  it("are the locked Phase 0 defaults", () => {
    expect(DEFAULT_MOVEMENT_THRESHOLDS).toEqual({
      deltaAbsMin: 20,
      deltaPctMin: 0.3,
      minPrevForPctRule: 5,
    });
  });
});
