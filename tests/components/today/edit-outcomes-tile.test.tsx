/**
 * 2026-05-19 — Section 9 Today tile — EditOutcomesTile render tests.
 *
 * Pins the locked customer copy + suppression rules + plural
 * awareness + K5 forbidden-vocab defense-in-depth per the Section 9
 * Today tile preflight:
 *   • Empty / still_gathering / healthy render states + their data
 *     attributes.
 *   • data_unavailable loader status collapses to still_gathering
 *     copy (preflight section F).
 *   • Defensive: eligible >= 1 but sum_sessions === 0 falls back to
 *     still_gathering (never renders "0 sessions").
 *   • Plural-awareness on N edits + N sessions.
 *   • CallRail K2-deferred: calls clause is source-present but
 *     suppressed at runtime when sum_post_live_qualified_calls === 0
 *     (NEVER renders "0 calls" in v1).
 *   • CallRail forward-compat: when sum_calls >= 1, the "and M
 *     calls" clause renders.
 *   • Section title + caption literal pins.
 *   • Data attributes for E2E hooks.
 *   • K5 forbidden-vocab + connector-name scan on rendered HTML
 *     across every variant.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { EditOutcomesTile } from "@/components/today/edit-outcomes-tile";
import type { OutcomesSummary } from "@/domains/outcome-attribution/load-outcomes-summary-for-tenant";

function render(summary: OutcomesSummary | null): string {
  const tree = EditOutcomesTile({ summary }) as ReactElement;
  return renderToStaticMarkup(tree);
}

function makeSummary(overrides: Partial<OutcomesSummary> = {}): OutcomesSummary {
  return {
    status: "ok",
    total_recent_live_edits: 0,
    eligible_edits: 0,
    still_learning_edits: 0,
    ineligible_edits: 0,
    sum_post_live_sessions: 0,
    sum_post_live_engaged_sessions: 0,
    sum_post_live_qualified_calls: 0,
    window_days: 30,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Title + caption (constant across all states)
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — title + caption", () => {
  it("renders the 'Edit outcomes' title in every state", () => {
    expect(render(makeSummary())).toContain("Edit outcomes");
    expect(
      render(
        makeSummary({
          total_recent_live_edits: 1,
          eligible_edits: 1,
          sum_post_live_sessions: 18,
        }),
      ),
    ).toContain("Edit outcomes");
    expect(render(null)).toContain("Edit outcomes");
  });

  it("renders the 'past 30 days' caption", () => {
    expect(render(makeSummary())).toContain("past 30 days");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — empty state (no recent live edits)", () => {
  it("renders the locked empty copy when total_recent_live_edits === 0 (status: ok)", () => {
    const html = render(makeSummary());
    expect(html).toContain("No post-live outcome evidence yet.");
  });

  it("carries data-edit-outcomes-state='empty'", () => {
    expect(render(makeSummary())).toContain('data-edit-outcomes-state="empty"');
  });

  it("carries data-today-edit-outcomes-tile='true'", () => {
    expect(render(makeSummary())).toContain(
      'data-today-edit-outcomes-tile="true"',
    );
  });

  it("data-edit-outcomes-total-edits is 0", () => {
    expect(render(makeSummary())).toContain('data-edit-outcomes-total-edits="0"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Still-gathering state
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — still-gathering state", () => {
  it("renders still-gathering copy when verified-live edits exist but no eligible (only still_learning)", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 2,
        still_learning_edits: 2,
        eligible_edits: 0,
      }),
    );
    expect(html).toContain(
      "Not enough post-live traffic evidence yet for recent edits. Refresh your connected data over the next week or two to gather more.",
    );
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("renders still-gathering copy when verified-live edits exist but all are ineligible", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 3,
        ineligible_edits: 3,
        eligible_edits: 0,
      }),
    );
    expect(html).toContain(
      "Not enough post-live traffic evidence yet for recent edits. Refresh your connected data over the next week or two to gather more.",
    );
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("collapses data_unavailable loader status to still-gathering copy (preflight section F)", () => {
    const html = render(
      makeSummary({
        status: "data_unavailable",
      }),
    );
    expect(html).toContain(
      "Not enough post-live traffic evidence yet for recent edits. Refresh your connected data over the next week or two to gather more.",
    );
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("collapses null summary to still-gathering copy", () => {
    const html = render(null);
    expect(html).toContain(
      "Not enough post-live traffic evidence yet for recent edits. Refresh your connected data over the next week or two to gather more.",
    );
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("defensive: eligible >= 1 AND sum_sessions === 0 falls back to still-gathering (never renders '0 sessions')", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 0,
      }),
    );
    expect(html).toContain(
      "Not enough post-live traffic evidence yet for recent edits. Refresh your connected data over the next week or two to gather more.",
    );
    expect(html).not.toContain("0 sessions");
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Healthy state — single edit
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — healthy state (single edit)", () => {
  // Ritz live state at slice ship time: 1 verified-live whole-home-
  // remodel H2 edit; 18 sessions over 21 days post-live.
  const RITZ_LIKE: OutcomesSummary = makeSummary({
    total_recent_live_edits: 1,
    eligible_edits: 1,
    sum_post_live_sessions: 18,
  });

  it("renders '1 live edit received N sessions from changed pages.'", () => {
    expect(render(RITZ_LIKE)).toContain(
      "1 live edit received 18 sessions from changed pages.",
    );
  });

  it("uses singular 'session' when sessions === 1", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 1,
      }),
    );
    expect(html).toContain("1 live edit received 1 session from changed pages.");
    expect(html).not.toContain("1 sessions");
  });

  it("carries data-edit-outcomes-state='healthy'", () => {
    expect(render(RITZ_LIKE)).toContain('data-edit-outcomes-state="healthy"');
  });

  it("carries data-edit-outcomes-eligible='1' AND data-edit-outcomes-sessions='18'", () => {
    const html = render(RITZ_LIKE);
    expect(html).toContain('data-edit-outcomes-eligible="1"');
    expect(html).toContain('data-edit-outcomes-sessions="18"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Healthy state — multiple edits
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — healthy state (multiple edits)", () => {
  it("renders 'X live edits received Y sessions from changed pages.' for N >= 2", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 5,
        eligible_edits: 5,
        sum_post_live_sessions: 142,
      }),
    );
    expect(html).toContain(
      "5 live edits received 142 sessions from changed pages.",
    );
  });

  it("uses plural 'edits' AND plural 'sessions' when both > 1", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 3,
        eligible_edits: 3,
        sum_post_live_sessions: 27,
      }),
    );
    expect(html).toContain("3 live edits received 27 sessions");
  });

  it("does not surface ineligible/still-learning edit counts in the customer copy", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 7,
        eligible_edits: 2,
        still_learning_edits: 3,
        ineligible_edits: 2,
        sum_post_live_sessions: 45,
      }),
    );
    // Healthy copy is driven by eligible_edits only.
    expect(html).toContain(
      "2 live edits received 45 sessions from changed pages.",
    );
    // No mention of still_learning/ineligible counts in customer text.
    expect(html).not.toContain("3 still");
    expect(html).not.toContain("2 ineligible");
  });
});

// ─────────────────────────────────────────────────────────────────────
// CallRail K2-deferred — calls clause suppressed in v1
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — CallRail K2-deferred behavior", () => {
  it("does NOT render 'and 0 calls' when sum_post_live_qualified_calls === 0 (v1 default)", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 18,
        sum_post_live_qualified_calls: 0,
      }),
    );
    expect(html).toContain(
      "1 live edit received 18 sessions from changed pages.",
    );
    expect(html).not.toContain("0 calls");
    expect(html).not.toContain("and 0");
  });

  it("renders 'and M calls' when sum_post_live_qualified_calls >= 1 (forward-compat for 9.B)", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 18,
        sum_post_live_qualified_calls: 3,
      }),
    );
    expect(html).toContain(
      "1 live edit received 18 sessions and 3 calls from changed pages.",
    );
  });

  it("uses singular 'call' when sum_post_live_qualified_calls === 1 (forward-compat)", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 18,
        sum_post_live_qualified_calls: 1,
      }),
    );
    expect(html).toContain("18 sessions and 1 call from changed pages");
    expect(html).not.toContain("1 calls");
  });
});

// ─────────────────────────────────────────────────────────────────────
// K5 forbidden vocab + connector-name scan
// ─────────────────────────────────────────────────────────────────────

describe("EditOutcomesTile — K5 forbidden vocab + connector-name (defense in depth)", () => {
  // Tokens that must NEVER appear in any rendered variant.
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
    "Google Analytics",
    "GA4",
    "CallRail",
  ];

  function assertClean(summary: OutcomesSummary | null): void {
    const html = render(summary);
    for (const token of FORBIDDEN_TOKENS) {
      expect(
        html.toLowerCase().includes(token.toLowerCase()),
        `Forbidden token "${token}" leaked into rendered HTML`,
      ).toBe(false);
    }
    expect(html.includes("$")).toBe(false);
  }

  it("empty state has no forbidden tokens", () => {
    assertClean(makeSummary());
  });

  it("still-gathering state has no forbidden tokens", () => {
    assertClean(
      makeSummary({ total_recent_live_edits: 3, still_learning_edits: 3 }),
    );
  });

  it("data-unavailable state has no forbidden tokens", () => {
    assertClean(makeSummary({ status: "data_unavailable" }));
  });

  it("null summary state has no forbidden tokens", () => {
    assertClean(null);
  });

  it("healthy single-edit state has no forbidden tokens", () => {
    assertClean(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 18,
      }),
    );
  });

  it("healthy multi-edit state has no forbidden tokens", () => {
    assertClean(
      makeSummary({
        total_recent_live_edits: 5,
        eligible_edits: 5,
        sum_post_live_sessions: 142,
      }),
    );
  });

  it("healthy with calls (forward-compat) has no forbidden tokens", () => {
    assertClean(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 18,
        sum_post_live_qualified_calls: 3,
      }),
    );
  });
});
