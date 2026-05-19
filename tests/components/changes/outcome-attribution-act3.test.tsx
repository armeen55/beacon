/**
 * 2026-05-19 — Slice 9.A2β — OutcomeAttributionAct3 render tests.
 *
 * Pins the locked customer copy + suppression rules + plural
 * awareness + K5 forbidden-vocab defense-in-depth per the
 * 9.A2β preflight P1–P5 decisions:
 *   • eligible (calls = 0): drop "and 0 calls" clause
 *   • insufficient_days: name the 7-day threshold explicitly
 *   • insufficient_volume: stay generic (no "5 sessions" threshold leak)
 *   • Do NOT show sample window date range in customer copy
 *   • Ineligible states render nothing
 *
 * Test categories:
 *   1. Suppression: null / ineligible × 3 → render returns null.
 *   2. Eligible (calls = 0) plural-awareness across N sessions / X days.
 *   3. Eligible (calls ≥ 1) plural-awareness across all three counts.
 *   4. still_learning_outcome / insufficient_days copy + data attribute.
 *   5. still_learning_outcome / insufficient_volume copy + data attribute.
 *   6. K5 forbidden-vocab scan on rendered HTML across every variant.
 *   7. No Section-6 cross-talk: no "Mode A" / "Mode B" / "Mode C" /
 *      "primary recommendation" tokens leaked.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { OutcomeAttributionAct3 } from "@/components/changes/outcome-attribution-act3";
import type { ModeAResult } from "@/domains/outcome-attribution/mode-a-cited-here-traffic-here";

function render(result: ModeAResult | null): string {
  const tree = OutcomeAttributionAct3({ result }) as ReactElement | null;
  if (tree == null) return "";
  return renderToStaticMarkup(tree);
}

// ─────────────────────────────────────────────────────────────────────
// Suppression
// ─────────────────────────────────────────────────────────────────────

describe("OutcomeAttributionAct3 — suppression", () => {
  it("renders null when result is null", () => {
    expect(render(null)).toBe("");
  });

  it("renders null on ineligible: no_live_at", () => {
    const html = render({
      kind: "ineligible",
      reason: "no_live_at",
      canonical_target_url: null,
    });
    expect(html).toBe("");
  });

  it("renders null on ineligible: no_target_url", () => {
    const html = render({
      kind: "ineligible",
      reason: "no_target_url",
      canonical_target_url: null,
    });
    expect(html).toBe("");
  });

  it("renders null on ineligible: no_traffic_data", () => {
    const html = render({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    });
    expect(html).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Eligible (calls = 0) — K2 CallRail-deferred default
// ─────────────────────────────────────────────────────────────────────

const ELIGIBLE_NO_CALLS_BASE: ModeAResult = {
  kind: "eligible",
  days_since_live: 21,
  post_live_sessions: 142,
  post_live_engaged_sessions: 120,
  post_live_conversions: 3,
  post_live_qualified_calls: 0,
  canonical_target_url: "https://ritzbuilders.com/services/whole-home-remodel",
  sample_window_start: "2026-04-28",
  sample_window_end: "2026-05-19",
};

describe("OutcomeAttributionAct3 — eligible (calls = 0)", () => {
  it("renders 'received N sessions in X days since going live' (no calls clause)", () => {
    const html = render(ELIGIBLE_NO_CALLS_BASE);
    expect(html).toContain(
      "This page received 142 sessions in the 21 days since going live.",
    );
    // Drop "and 0 calls" clause per P1.
    expect(html).not.toContain("0 calls");
    expect(html).not.toContain("and 0");
  });

  it("uses singular 'session' when sessions = 1", () => {
    const html = render({
      ...ELIGIBLE_NO_CALLS_BASE,
      post_live_sessions: 1,
    });
    expect(html).toContain("received 1 session in");
    expect(html).not.toContain("1 sessions");
  });

  it("uses singular 'day' when days = 1", () => {
    const html = render({
      ...ELIGIBLE_NO_CALLS_BASE,
      days_since_live: 1,
    });
    expect(html).toContain("in the 1 day since");
    expect(html).not.toContain("1 days");
  });

  it("uses plural 'sessions' AND plural 'days' when both > 1", () => {
    const html = render({
      ...ELIGIBLE_NO_CALLS_BASE,
      post_live_sessions: 5,
      days_since_live: 14,
    });
    expect(html).toContain("received 5 sessions in the 14 days since");
  });

  it("carries data-outcome-attribution-kind='eligible'", () => {
    const html = render(ELIGIBLE_NO_CALLS_BASE);
    expect(html).toContain('data-outcome-attribution-kind="eligible"');
  });

  it("carries the data-change-detail-outcome-attribution marker", () => {
    const html = render(ELIGIBLE_NO_CALLS_BASE);
    expect(html).toContain('data-change-detail-outcome-attribution="true"');
    expect(html).toContain('data-change-detail-outcome-label="true"');
    expect(html).toContain('data-change-detail-outcome-detail="true"');
  });

  it("renders the 'Outcomes' label", () => {
    const html = render(ELIGIBLE_NO_CALLS_BASE);
    expect(html).toContain("Outcomes");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Eligible (calls ≥ 1) — forward-compat for 9.B CallRail
// ─────────────────────────────────────────────────────────────────────

describe("OutcomeAttributionAct3 — eligible (calls ≥ 1, forward-compat)", () => {
  it("renders 'received N sessions and M calls in X days' when calls ≥ 1", () => {
    const html = render({
      ...ELIGIBLE_NO_CALLS_BASE,
      post_live_qualified_calls: 3,
    });
    expect(html).toContain(
      "This page received 142 sessions and 3 calls in the 21 days since going live.",
    );
  });

  it("uses singular 'call' when calls = 1", () => {
    const html = render({
      ...ELIGIBLE_NO_CALLS_BASE,
      post_live_qualified_calls: 1,
    });
    expect(html).toContain("and 1 call in");
    expect(html).not.toContain("1 calls");
  });

  it("plural-aware on all three counts simultaneously (1 session, 1 call, 1 day)", () => {
    const html = render({
      ...ELIGIBLE_NO_CALLS_BASE,
      post_live_sessions: 1,
      post_live_qualified_calls: 1,
      days_since_live: 1,
    });
    expect(html).toContain(
      "This page received 1 session and 1 call in the 1 day since going live.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// still_learning_outcome variants
// ─────────────────────────────────────────────────────────────────────

describe("OutcomeAttributionAct3 — still_learning_outcome / insufficient_days", () => {
  const STILL_LEARNING_INSUFFICIENT_DAYS: ModeAResult = {
    kind: "still_learning_outcome",
    reason: "insufficient_days",
    days_since_live: 3,
    post_live_sessions: 2,
    post_live_qualified_calls: 0,
    canonical_target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    sample_window_start: "2026-05-16",
    sample_window_end: "2026-05-19",
  };

  it("renders the locked insufficient_days copy (names the 7-day threshold)", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_DAYS);
    expect(html).toContain(
      "This page is still too newly live to attribute outcomes — Beacon needs at least 7 days of post-live traffic data.",
    );
  });

  it("carries the still_learning_insufficient_days data attribute", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_DAYS);
    expect(html).toContain(
      'data-outcome-attribution-kind="still_learning_insufficient_days"',
    );
  });

  it("does NOT show sample-window date range (P4 lock)", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_DAYS);
    expect(html).not.toContain("2026-05-16");
    expect(html).not.toContain("2026-05-19");
    expect(html).not.toContain(" → ");
  });
});

describe("OutcomeAttributionAct3 — still_learning_outcome / insufficient_volume", () => {
  // The locked Ritz whole-home-remodel state at 9.A2β manual-
  // verification time: 21 days post-live, 3 sessions, 0 calls.
  const STILL_LEARNING_INSUFFICIENT_VOLUME: ModeAResult = {
    kind: "still_learning_outcome",
    reason: "insufficient_volume",
    days_since_live: 21,
    post_live_sessions: 3,
    post_live_qualified_calls: 0,
    canonical_target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    sample_window_start: "2026-04-28",
    sample_window_end: "2026-05-19",
  };

  it("renders the locked insufficient_volume copy (stays generic, no '5 sessions' leak per P3)", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_VOLUME);
    expect(html).toContain(
      "Not enough post-live traffic evidence yet for this page.",
    );
    // P3 lock: do NOT name the 5-session threshold.
    expect(html).not.toContain("5 sessions");
    expect(html).not.toContain("at least 5");
  });

  it("carries the still_learning_insufficient_volume data attribute", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_VOLUME);
    expect(html).toContain(
      'data-outcome-attribution-kind="still_learning_insufficient_volume"',
    );
  });

  it("does NOT leak session/day counts in customer copy (P3 lock — generic)", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_VOLUME);
    // Generic copy means we don't print the raw counts.
    expect(html).not.toContain("3 sessions");
    expect(html).not.toContain("21 days");
  });

  it("does NOT show sample-window date range (P4 lock)", () => {
    const html = render(STILL_LEARNING_INSUFFICIENT_VOLUME);
    expect(html).not.toContain("2026-04-28");
    expect(html).not.toContain("2026-05-19");
  });
});

// ─────────────────────────────────────────────────────────────────────
// K5 forbidden-vocab defense-in-depth — every render variant
// ─────────────────────────────────────────────────────────────────────

describe("OutcomeAttributionAct3 — K5 forbidden vocab (defense in depth)", () => {
  const FORBIDDEN_TOKENS = [
    "drove",
    "caused",
    "generated",
    "revenue",
    "dollars",
    "ROI",
    "sales",
    "leads",
    "Mode A",
    "Mode B",
    "Mode C",
    "primary recommendation",
  ];

  function assertCleanRender(result: ModeAResult): void {
    const html = render(result);
    if (html === "") return; // suppressed render — vacuously clean.
    for (const token of FORBIDDEN_TOKENS) {
      expect(
        html.toLowerCase().includes(token.toLowerCase()),
        `K5 forbidden token "${token}" leaked into rendered HTML`,
      ).toBe(false);
    }
    // `$` check (dollar literal) — exact char, no case folding.
    expect(html.includes("$")).toBe(false);
  }

  it("eligible (calls = 0) has no forbidden tokens", () => {
    assertCleanRender(ELIGIBLE_NO_CALLS_BASE);
  });

  it("eligible (calls ≥ 1) has no forbidden tokens", () => {
    assertCleanRender({
      ...ELIGIBLE_NO_CALLS_BASE,
      post_live_qualified_calls: 3,
    });
  });

  it("still_learning insufficient_days has no forbidden tokens", () => {
    assertCleanRender({
      kind: "still_learning_outcome",
      reason: "insufficient_days",
      days_since_live: 3,
      post_live_sessions: 2,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://ritzbuilders.com/x",
      sample_window_start: "a",
      sample_window_end: "b",
    });
  });

  it("still_learning insufficient_volume has no forbidden tokens", () => {
    assertCleanRender({
      kind: "still_learning_outcome",
      reason: "insufficient_volume",
      days_since_live: 21,
      post_live_sessions: 3,
      post_live_qualified_calls: 0,
      canonical_target_url: "https://ritzbuilders.com/x",
      sample_window_start: "a",
      sample_window_end: "b",
    });
  });

  it("ineligible variants suppress completely (no tokens to leak)", () => {
    assertCleanRender({
      kind: "ineligible",
      reason: "no_live_at",
      canonical_target_url: null,
    });
    assertCleanRender({
      kind: "ineligible",
      reason: "no_target_url",
      canonical_target_url: null,
    });
    assertCleanRender({
      kind: "ineligible",
      reason: "no_traffic_data",
      canonical_target_url: "https://ritzbuilders.com/x",
    });
  });
});
