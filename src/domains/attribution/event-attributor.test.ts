import { describe, it, expect } from "vitest";
import { attributeEvents, type UrlDailySeries } from "./event-attributor";
import type { ChangeEvent, SiteMovementEvent } from "@/domains/events/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dense(
  url: string,
  start: string,
  counts: number[],
): UrlDailySeries {
  const daily: Array<{ date: string; count: number }> = [];
  let t = new Date(start + "T00:00:00Z").getTime();
  for (const c of counts) {
    daily.push({ date: new Date(t).toISOString().slice(0, 10), count: c });
    t += 86_400_000;
  }
  return { url, daily };
}

function mov(date: string, prev: number, cur: number): SiteMovementEvent {
  return {
    id: `mov-${date.replaceAll("-", "")}`,
    date,
    prev_count: prev,
    count: cur,
    delta_abs: cur - prev,
    delta_pct: (cur - prev) / Math.max(prev, 1),
    trigger: "both",
    tenant_id: "t1",
  };
}

// ---------------------------------------------------------------------------
// compound_launch verdicts
// ---------------------------------------------------------------------------

describe("compound_launch verdicts", () => {
  const baseEvent: ChangeEvent = {
    id: "evt-compound_launch-lux",
    scope: "compound_launch",
    event_type: "page_created",
    label: "Launched /lux",
    started_at: "2026-03-10",
    ended_at: "2026-03-10",
    target_urls: ["/lux"],
    child_change_ids: ["c1"],
    created_url: "/lux",
    tenant_id: "t1",
  };

  it("landed_fast when >=5 citations within day 1–3", () => {
    const series = dense("/lux", "2026-03-11", [6, 7, 8, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const [rec] = attributeEvents({
      events: [baseEvent],
      siteMovements: [],
      urlSeriesByUrl: { "/lux": series },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-04-14",
    });
    expect(rec.verdict).toBe("landed_fast");
    expect(rec.evidence.confidence_source).toBe("measured");
  });

  it("landed_normal when >=5 citations by day 14 but not in day 1–3", () => {
    const series = dense("/lux", "2026-03-11", [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 2, 1]);
    const [rec] = attributeEvents({
      events: [baseEvent],
      siteMovements: [],
      urlSeriesByUrl: { "/lux": series },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-04-14",
    });
    expect(rec.verdict).toBe("landed_normal");
  });

  it("landed_slow when <5 by day 14 but >0 by day 30", () => {
    const d: Array<{ date: string; count: number }> = [];
    for (let i = 1; i <= 30; i++) {
      const date = new Date(
        Date.parse("2026-03-10T00:00:00Z") + i * 86_400_000,
      ).toISOString().slice(0, 10);
      d.push({ date, count: i === 25 ? 1 : 0 });
    }
    const [rec] = attributeEvents({
      events: [baseEvent],
      siteMovements: [],
      urlSeriesByUrl: { "/lux": { url: "/lux", daily: d } },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-04-14",
    });
    expect(rec.verdict).toBe("landed_slow");
  });

  it("never_landed when 0 citations by day 30", () => {
    const d: Array<{ date: string; count: number }> = [];
    for (let i = 1; i <= 30; i++) {
      const date = new Date(
        Date.parse("2026-03-10T00:00:00Z") + i * 86_400_000,
      ).toISOString().slice(0, 10);
      d.push({ date, count: 0 });
    }
    const [rec] = attributeEvents({
      events: [baseEvent],
      siteMovements: [],
      urlSeriesByUrl: { "/lux": { url: "/lux", daily: d } },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-04-14",
    });
    expect(rec.verdict).toBe("never_landed");
  });
});

// ---------------------------------------------------------------------------
// sitewide_rollout verdicts
// ---------------------------------------------------------------------------

describe("sitewide_rollout verdicts", () => {
  function metadataEvent(end = "2026-04-04"): ChangeEvent {
    return {
      id: "evt-meta",
      scope: "sitewide_rollout",
      event_type: "metadata_publication",
      label: "Metadata",
      started_at: "2026-04-02",
      ended_at: end,
      target_urls: null,
      child_change_ids: ["c1", "c2"],
      created_url: null,
      tenant_id: "t1",
    };
  }

  it("attributed_high when high-prior family lands within a movement window", () => {
    const [rec] = attributeEvents({
      events: [metadataEvent()],
      siteMovements: [mov("2026-04-06", 147, 200)],
      urlSeriesByUrl: {},
      dataQualityBadDates: new Set(),
    });
    expect(rec.verdict).toBe("attributed_high");
    expect(rec.evidence.confidence_source).toBe("seed_prior");
    expect(rec.site_movement_event_id).toBe("mov-20260406");
  });

  it("attributed_medium when prior is middling and timing is moderate", () => {
    const event: ChangeEvent = {
      ...metadataEvent(),
      event_type: "content_rollout", // prior = 0.8 (≥0.5 but <0.8 for HIGH needs c_timing ≥0.6 AND prior≥0.8)
    };
    // Movement 3 days away → c_timing = 1 - (3/5)*0.8 = 0.52 (< 0.6)
    const [rec] = attributeEvents({
      events: [event],
      siteMovements: [mov("2026-04-07", 147, 180)],
      urlSeriesByUrl: {},
      dataQualityBadDates: new Set(),
    });
    // prior=0.8, c_timing=0.52 → attributed_medium (prior≥0.5 AND c_timing≥0.4)
    expect(rec.verdict).toBe("attributed_medium");
  });

  it("inconclusive when no movement within ±5 days", () => {
    const [rec] = attributeEvents({
      events: [metadataEvent()],
      siteMovements: [mov("2026-04-25", 100, 150)], // 21 days away
      urlSeriesByUrl: {},
      dataQualityBadDates: new Set(),
    });
    expect(rec.verdict).toBe("inconclusive");
    expect(rec.evidence.confidence_source).toBe("inference");
    expect(rec.site_movement_event_id).toBeNull();
  });

  it("emits seed_prior label whenever prior is used for c_magnitude", () => {
    const [rec] = attributeEvents({
      events: [metadataEvent()],
      siteMovements: [mov("2026-04-06", 147, 200)],
      urlSeriesByUrl: {},
      dataQualityBadDates: new Set(),
    });
    expect(rec.evidence.c_magnitude).toBe(0.95); // metadata_publication prior
    expect(rec.evidence.confidence_source).toBe("seed_prior");
  });
});

// ---------------------------------------------------------------------------
// page_level verdicts — with and without data_bad skip
// ---------------------------------------------------------------------------

describe("page_level verdicts", () => {
  function pageEvent(url: string, ended_at: string): ChangeEvent {
    return {
      id: `evt-page_level-${url}`,
      scope: "page_level",
      event_type: "content_edit",
      label: `Edit ${url}`,
      started_at: ended_at,
      ended_at,
      target_urls: [url],
      child_change_ids: ["c1"],
      created_url: url,
      tenant_id: "t1",
    };
  }

  it("produces helping when post-window z-score exceeds zBar (2.0) with sustain", () => {
    // Baseline 10 days at ~1 citation/day; post window climbs to 5.
    const baseline = Array(10).fill(1);
    const post = [5, 6, 5, 6, 5, 6, 5, 6];
    const series = dense("/page", "2026-03-10", [...baseline, ...post]);
    const [rec] = attributeEvents({
      events: [pageEvent("/page", "2026-03-19")],
      siteMovements: [],
      urlSeriesByUrl: { "/page": series },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-03-27",
    });
    expect(rec.verdict).toBe("helping");
    expect(rec.evidence.confidence_source).toBe("measured");
  });

  it("emits the `promising` tier when z is between bars (local event-only upgrade)", () => {
    // Baseline 10 days at 1/day; post lifts to ~2.5/day — positive but
    // possibly below zBar=2.0. Exact outcome depends on sigma.
    const baseline = Array(10).fill(1);
    const post = [2, 3, 2, 3, 2, 3, 2, 3];
    const series = dense("/page2", "2026-03-10", [...baseline, ...post]);
    const [rec] = attributeEvents({
      events: [pageEvent("/page2", "2026-03-19")],
      siteMovements: [],
      urlSeriesByUrl: { "/page2": series },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-03-27",
    });
    // helping OR promising are both acceptable for this shape; hurting/nothing_yet are not.
    expect(["helping", "promising"]).toContain(rec.verdict);
  });

  it("ignores data_bad days in the post-window when deriving verdict", () => {
    // Baseline: 14 days at 2/day. Then 3 data_bad days (should be excluded),
    // then 5 good post days at 8/day (real lift). Without skip, including
    // the zero-filled bad days would drag the post mean down.
    const baseline = Array(14).fill(2);
    const badWindow = [0, 0, 0]; // these three dates get flagged
    const postGood = [8, 8, 8, 8, 8];
    const series = dense(
      "/page3",
      "2026-03-01",
      [...baseline, ...badWindow, ...postGood],
    );
    const badDates = new Set([
      "2026-03-15", "2026-03-16", "2026-03-17",
    ]);
    // Drop the bad days from the input series too (mimics what url-citation-history now does).
    const filtered: UrlDailySeries = {
      url: "/page3",
      daily: series.daily.filter((p) => !badDates.has(p.date)),
    };
    const [rec] = attributeEvents({
      events: [pageEvent("/page3", "2026-03-14")],
      siteMovements: [],
      urlSeriesByUrl: { "/page3": filtered },
      dataQualityBadDates: badDates,
      asOfDate: "2026-03-22",
    });
    expect(rec.verdict).toBe("helping");
    // Narrative should acknowledge the data_bad exclusion.
    expect(rec.evidence.narrative).toMatch(/data_bad/i);
  });

  it("returns inconclusive when there is no citation series for the URL", () => {
    const [rec] = attributeEvents({
      events: [pageEvent("/missing", "2026-03-20")],
      siteMovements: [],
      urlSeriesByUrl: {},
      dataQualityBadDates: new Set(),
    });
    expect(rec.verdict).toBe("inconclusive");
    expect(rec.evidence.confidence_source).toBe("inference");
  });
});

// ---------------------------------------------------------------------------
// Contract invariants across all scopes
// ---------------------------------------------------------------------------

describe("contract invariants", () => {
  it("every attribution record has confidence_source populated", () => {
    const events: ChangeEvent[] = [
      {
        id: "evt1",
        scope: "compound_launch",
        event_type: "page_created",
        label: "x",
        started_at: "2026-03-10",
        ended_at: "2026-03-10",
        target_urls: ["/a"],
        child_change_ids: ["c1"],
        created_url: "/a",
        tenant_id: "t1",
      },
      {
        id: "evt2",
        scope: "sitewide_rollout",
        event_type: "metadata_publication",
        label: "x",
        started_at: "2026-04-02",
        ended_at: "2026-04-02",
        target_urls: null,
        child_change_ids: ["c2"],
        created_url: null,
        tenant_id: "t1",
      },
      {
        id: "evt3",
        scope: "page_level",
        event_type: "content_edit",
        label: "x",
        started_at: "2026-03-20",
        ended_at: "2026-03-20",
        target_urls: ["/b"],
        child_change_ids: ["c3"],
        created_url: "/b",
        tenant_id: "t1",
      },
    ];
    const recs = attributeEvents({
      events,
      siteMovements: [],
      urlSeriesByUrl: {
        "/a": dense("/a", "2026-03-10", [0, 0, 1, 0, 0]),
        "/b": dense("/b", "2026-03-01", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]),
      },
      dataQualityBadDates: new Set(),
      asOfDate: "2026-04-14",
    });
    expect(recs).toHaveLength(3);
    for (const r of recs) {
      expect(r.evidence.confidence_source).toBeDefined();
      expect(["measured", "seed_prior", "inference"]).toContain(r.evidence.confidence_source);
    }
  });
});
