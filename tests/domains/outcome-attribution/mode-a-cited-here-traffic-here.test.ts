/**
 * 2026-05-19 — Slice 9.A2α.2 — `computeModeATrafficAttribution`
 * pure-compute unit tests.
 *
 * Pins the K4 sample-size guard truth table (Section 9 Decision
 * Lock K4):
 *   • ≥ 7 days post-live AND (≥ 5 sessions OR ≥ 1 qualified call)
 *     → `eligible`.
 *   • < 7 days post-live → `still_learning_outcome:
 *     insufficient_days`.
 *   • ≥ 7 days post-live AND < 5 sessions AND < 1 call →
 *     `still_learning_outcome: insufficient_volume`.
 *   • No live_at / no target_url / `needs_new_page` sentinel / no
 *     matching traffic data → `ineligible` (with discriminator
 *     reason; `no_traffic_data` per documented decision in the
 *     module header).
 *
 * Also pins:
 *   • Canonical URL matching (case-folding, trailing slash, query
 *     fragment stripping per `canonicalizeCitationUrl`).
 *   • Pre-live + future-row filtering.
 *   • No mutation of input rows (input array reference + each row
 *     object byte-equal after compute).
 *   • Aggregation correctness across multiple matching rows.
 *
 * Mocks the canonicalize-url helper deterministically so the URL
 * matching path is testable without crossing into the citation-
 * lifecycle domain implementation details.
 */

import { describe, it, expect, vi } from "vitest";

import type { Ga4UrlTrafficRow } from "@/lib/connectors/ga4/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

vi.mock("@/domains/citation-lifecycle/canonicalize-url", () => ({
  canonicalizeCitationUrl: (url: string | null | undefined) => {
    if (url == null || url === "") return "";
    return url
      .toLowerCase()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  },
}));

import {
  computeModeATrafficAttribution,
  MODE_A_MIN_DAYS_POST_LIVE,
  MODE_A_MIN_SESSIONS,
  MODE_A_MIN_QUALIFIED_CALLS,
  __testing,
} from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";

const NOW = new Date(Date.UTC(2026, 4, 19, 12, 0, 0)); // 2026-05-19T12:00:00Z

function makeEdit(
  over: Partial<RecommendedEditRow> = {},
): Pick<RecommendedEditRow, "target_url" | "live_at"> {
  return {
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    live_at: "2026-05-01T00:00:00.000Z",
    ...over,
  };
}

function makeRow(over: Partial<Ga4UrlTrafficRow> = {}): Ga4UrlTrafficRow {
  return {
    date: "2026-05-10",
    url: "https://ritzbuilders.com/services/whole-home-remodel",
    sessions: 10,
    engaged_sessions: 8,
    conversions: 1,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Locked thresholds (also pinned by architecture invariant)
// ─────────────────────────────────────────────────────────────────────

describe("locked K4 thresholds", () => {
  it("pins MODE_A_MIN_DAYS_POST_LIVE = 7 days", () => {
    expect(MODE_A_MIN_DAYS_POST_LIVE).toBe(7);
  });

  it("pins MODE_A_MIN_SESSIONS = 5", () => {
    expect(MODE_A_MIN_SESSIONS).toBe(5);
  });

  it("pins MODE_A_MIN_QUALIFIED_CALLS = 1", () => {
    expect(MODE_A_MIN_QUALIFIED_CALLS).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ineligible paths
// ─────────────────────────────────────────────────────────────────────

describe("computeModeATrafficAttribution — ineligible", () => {
  it("returns no_live_at when live_at is null", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: null }),
      ga4UrlTrafficRows: [makeRow()],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") {
      expect(r.reason).toBe("no_live_at");
      expect(r.canonical_target_url).toBeNull();
    }
  });

  it("returns no_live_at when live_at is empty string", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: "" }),
      ga4UrlTrafficRows: [makeRow()],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_live_at");
  });

  it("returns no_live_at when live_at is not a parseable timestamp", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: "garbage-not-a-date" }),
      ga4UrlTrafficRows: [makeRow()],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_live_at");
  });

  it("returns no_target_url when target_url is null", () => {
    const r = computeModeATrafficAttribution({
      // @ts-expect-error — testing null
      recommendedEdit: makeEdit({ target_url: null }),
      ga4UrlTrafficRows: [makeRow()],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_target_url");
  });

  it("returns no_target_url when target_url is empty string", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ target_url: "" }),
      ga4UrlTrafficRows: [makeRow()],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_target_url");
  });

  it("returns no_target_url when target_url is 'needs_new_page' sentinel", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ target_url: "needs_new_page" }),
      ga4UrlTrafficRows: [makeRow()],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_target_url");
  });

  it("returns no_traffic_data when ga4UrlTrafficRows is empty array", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit(),
      ga4UrlTrafficRows: [],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_traffic_data");
  });

  it("returns no_traffic_data when GA4 rows do not match the target URL", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit(),
      ga4UrlTrafficRows: [
        makeRow({ url: "https://different.com/path" }),
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_traffic_data");
  });

  it("returns no_traffic_data when GA4 rows are all pre-live_at", () => {
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: "2026-05-15T00:00:00.000Z" }),
      ga4UrlTrafficRows: [
        makeRow({ date: "2026-04-10" }),
        makeRow({ date: "2026-05-10" }),
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("ineligible");
    if (r.kind === "ineligible") expect(r.reason).toBe("no_traffic_data");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Still-learning paths (K4 guard)
// ─────────────────────────────────────────────────────────────────────

describe("computeModeATrafficAttribution — still_learning_outcome", () => {
  it("returns insufficient_days when days_since_live < 7", () => {
    // live_at 3 days before NOW (2026-05-16). Row dated post-live
    // (2026-05-17) so it matches; day-count guard trips.
    const liveAt = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-17", sessions: 100 })],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("still_learning_outcome");
    if (r.kind === "still_learning_outcome") {
      expect(r.reason).toBe("insufficient_days");
      expect(r.days_since_live).toBe(3);
    }
  });

  it("returns insufficient_volume when days ≥ 7 AND sessions < 5 AND calls = 0", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [
        makeRow({ date: "2026-05-10", sessions: 1 }),
        makeRow({ date: "2026-05-15", sessions: 2 }),
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("still_learning_outcome");
    if (r.kind === "still_learning_outcome") {
      expect(r.reason).toBe("insufficient_volume");
      expect(r.days_since_live).toBe(14);
      expect(r.post_live_sessions).toBe(3);
    }
  });

  it("boundary: exactly 6 days post-live → insufficient_days even with high volume + calls", () => {
    // 6 days post-live → fails the days_since_live >= 7 gate.
    const liveAt = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-14", sessions: 100 })],
      qualifiedCallCount: 5,
      now: NOW,
    });
    expect(r.kind).toBe("still_learning_outcome");
    if (r.kind === "still_learning_outcome") {
      expect(r.reason).toBe("insufficient_days");
    }
  });

  it("boundary: exactly 4 sessions + 0 calls at 14 days → insufficient_volume", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-10", sessions: 4 })],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("still_learning_outcome");
    if (r.kind === "still_learning_outcome") {
      expect(r.reason).toBe("insufficient_volume");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Eligible paths
// ─────────────────────────────────────────────────────────────────────

describe("computeModeATrafficAttribution — eligible", () => {
  it("eligible when ≥ 7 days AND ≥ 5 sessions", () => {
    const liveAt = new Date(
      NOW.getTime() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [
        makeRow({
          date: "2026-05-12",
          sessions: 3,
          engaged_sessions: 2,
          conversions: 0,
        }),
        makeRow({
          date: "2026-05-15",
          sessions: 4,
          engaged_sessions: 3,
          conversions: 1,
        }),
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.days_since_live).toBe(10);
      expect(r.post_live_sessions).toBe(7);
      expect(r.post_live_engaged_sessions).toBe(5);
      expect(r.post_live_conversions).toBe(1);
      expect(r.post_live_qualified_calls).toBe(0);
    }
  });

  it("eligible when ≥ 7 days AND < 5 sessions BUT ≥ 1 qualified call (CallRail-ready)", () => {
    const liveAt = new Date(
      NOW.getTime() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-12", sessions: 2 })],
      qualifiedCallCount: 1,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.post_live_sessions).toBe(2);
      expect(r.post_live_qualified_calls).toBe(1);
    }
  });

  it("boundary: exactly 7 days post-live + exactly 5 sessions → eligible", () => {
    const liveAt = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-13", sessions: 5 })],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
  });

  it("defaults qualifiedCallCount to 0 when omitted (CallRail K2 lock)", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-10", sessions: 10 })],
      // qualifiedCallCount intentionally omitted → defaults to 0
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.post_live_qualified_calls).toBe(0);
    }
  });

  it("sums sessions/engaged/conversions across multiple matching rows", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [
        makeRow({ date: "2026-05-10", sessions: 5, engaged_sessions: 4, conversions: 0 }),
        makeRow({ date: "2026-05-12", sessions: 7, engaged_sessions: 5, conversions: 2 }),
        makeRow({ date: "2026-05-18", sessions: 9, engaged_sessions: 7, conversions: 1 }),
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.post_live_sessions).toBe(21);
      expect(r.post_live_engaged_sessions).toBe(16);
      expect(r.post_live_conversions).toBe(3);
    }
  });

  it("excludes future-dated rows (defensive)", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [
        makeRow({ date: "2026-05-10", sessions: 5 }),
        makeRow({ date: "2026-12-31", sessions: 1000 }), // far future
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.post_live_sessions).toBe(5);
    }
  });

  it("canonicalizes target_url for matching (case + trailing slash variants)", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({
        live_at: liveAt,
        target_url: "https://Ritzbuilders.com/services/whole-home-remodel/",
      }),
      ga4UrlTrafficRows: [
        makeRow({
          date: "2026-05-10",
          url: "https://ritzbuilders.com/services/whole-home-remodel",
          sessions: 10,
        }),
      ],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.post_live_sessions).toBe(10);
      expect(r.canonical_target_url).toBe(
        "https://ritzbuilders.com/services/whole-home-remodel",
      );
    }
  });

  it("populates sample_window_start + sample_window_end in YYYY-MM-DD UTC", () => {
    const liveAt = new Date(Date.UTC(2026, 4, 1, 0, 0, 0)).toISOString();
    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-10", sessions: 10 })],
      qualifiedCallCount: 0,
      now: NOW,
    });
    expect(r.kind).toBe("eligible");
    if (r.kind === "eligible") {
      expect(r.sample_window_start).toBe("2026-05-01");
      expect(r.sample_window_end).toBe("2026-05-19");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Purity — no mutation of input rows
// ─────────────────────────────────────────────────────────────────────

describe("computeModeATrafficAttribution — purity (no input mutation)", () => {
  it("does NOT mutate the input ga4UrlTrafficRows array or any row inside", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rows: Ga4UrlTrafficRow[] = [
      makeRow({ date: "2026-05-10", sessions: 5, engaged_sessions: 4, conversions: 1 }),
      makeRow({ date: "2026-05-15", sessions: 7, engaged_sessions: 6, conversions: 2 }),
    ];
    // Deep-clone snapshot before computation.
    const beforeSnapshot = JSON.stringify(rows);
    const beforeArrayLength = rows.length;
    const beforeArrayRef = rows;

    const r = computeModeATrafficAttribution({
      recommendedEdit: makeEdit({ live_at: liveAt }),
      ga4UrlTrafficRows: rows,
      qualifiedCallCount: 0,
      now: NOW,
    });

    expect(r.kind).toBe("eligible");
    // Array reference unchanged.
    expect(rows).toBe(beforeArrayRef);
    // Array length unchanged.
    expect(rows.length).toBe(beforeArrayLength);
    // Every row's contents byte-identical.
    expect(JSON.stringify(rows)).toBe(beforeSnapshot);
  });

  it("does NOT mutate the recommendedEdit input", () => {
    const liveAt = new Date(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const edit = makeEdit({ live_at: liveAt });
    const beforeSnapshot = JSON.stringify(edit);

    computeModeATrafficAttribution({
      recommendedEdit: edit,
      ga4UrlTrafficRows: [makeRow({ date: "2026-05-10", sessions: 10 })],
      qualifiedCallCount: 0,
      now: NOW,
    });

    expect(JSON.stringify(edit)).toBe(beforeSnapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────
// isoDateUTC helper
// ─────────────────────────────────────────────────────────────────────

describe("isoDateUTC helper", () => {
  it("formats a Date as YYYY-MM-DD UTC", () => {
    expect(__testing.isoDateUTC(new Date(Date.UTC(2026, 0, 5, 12, 0, 0)))).toBe(
      "2026-01-05",
    );
    expect(__testing.isoDateUTC(new Date(Date.UTC(2026, 11, 31, 23, 0, 0)))).toBe(
      "2026-12-31",
    );
  });

  it("pads single-digit month and day with zeros", () => {
    expect(__testing.isoDateUTC(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe(
      "2026-01-01",
    );
  });
});
