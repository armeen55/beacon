/**
 * Architecture invariant — Section 9 Today tile (2026-05-19).
 *
 * `EditOutcomesTile` MUST render exactly one of the locked Section
 * 9.5 customer-copy states (empty / still_gathering / healthy) on
 * every reachable input shape — including loader soft-fail
 * (`status: "data_unavailable"`) and `summary == null`. Today is a
 * denser surface than Changes detail; silence would read as broken,
 * so the data_unavailable + null states collapse to the locked
 * still-gathering copy (NOT silent).
 *
 * Pins per state:
 *   • `summary == null` → still-gathering copy
 *   • `summary.status === "data_unavailable"` → still-gathering copy
 *   • `total_recent_live_edits === 0` AND status ok → empty copy
 *   • `eligible_edits === 0` AND total > 0 → still-gathering copy
 *   • Defensive: eligible >= 1 AND sum_sessions === 0 → still-gathering
 *     (NEVER renders "0 sessions")
 *   • `eligible_edits >= 1` AND sum_sessions > 0 → healthy copy
 *
 * Source-text pins:
 *   • `data-edit-outcomes-state` attribute always present in render
 *     output for E2E hooks.
 *   • `data-today-edit-outcomes-tile="true"` marker present.
 */

import { describe, expect, it } from "vitest";
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

const EMPTY_COPY = "No post-live outcome evidence yet.";
const STILL_GATHERING_COPY =
  "Beacon is still collecting post-live traffic evidence for recent edits.";

describe("edit-outcomes-tile-suppression — state machine", () => {
  it("null summary → still-gathering copy", () => {
    const html = render(null);
    expect(html).toContain(STILL_GATHERING_COPY);
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("status: data_unavailable → still-gathering copy (NOT silent)", () => {
    const html = render(makeSummary({ status: "data_unavailable" }));
    expect(html).toContain(STILL_GATHERING_COPY);
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("total_recent_live_edits === 0 (status ok) → empty copy", () => {
    const html = render(makeSummary({ total_recent_live_edits: 0 }));
    expect(html).toContain(EMPTY_COPY);
    expect(html).toContain('data-edit-outcomes-state="empty"');
  });

  it("eligible_edits === 0 AND total > 0 → still-gathering copy", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 3,
        still_learning_edits: 2,
        ineligible_edits: 1,
        eligible_edits: 0,
      }),
    );
    expect(html).toContain(STILL_GATHERING_COPY);
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
  });

  it("defensive: eligible >= 1 AND sum_sessions === 0 → still-gathering (never '0 sessions')", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 0,
      }),
    );
    expect(html).toContain(STILL_GATHERING_COPY);
    expect(html).toContain('data-edit-outcomes-state="still_gathering"');
    expect(html).not.toContain("0 sessions");
  });

  it("eligible_edits >= 1 AND sum_sessions > 0 → healthy copy", () => {
    const html = render(
      makeSummary({
        total_recent_live_edits: 1,
        eligible_edits: 1,
        sum_post_live_sessions: 18,
      }),
    );
    expect(html).toContain(
      "1 live edit received 18 sessions from changed pages.",
    );
    expect(html).toContain('data-edit-outcomes-state="healthy"');
  });
});

describe("edit-outcomes-tile-suppression — data attributes always present", () => {
  it("every state renders data-today-edit-outcomes-tile='true'", () => {
    expect(render(null)).toContain('data-today-edit-outcomes-tile="true"');
    expect(render(makeSummary())).toContain(
      'data-today-edit-outcomes-tile="true"',
    );
    expect(
      render(
        makeSummary({
          total_recent_live_edits: 2,
          still_learning_edits: 2,
        }),
      ),
    ).toContain('data-today-edit-outcomes-tile="true"');
    expect(
      render(
        makeSummary({
          total_recent_live_edits: 1,
          eligible_edits: 1,
          sum_post_live_sessions: 18,
        }),
      ),
    ).toContain('data-today-edit-outcomes-tile="true"');
  });

  it("every state renders data-edit-outcomes-state with one of the locked values", () => {
    const states = new Set<string>();
    function collect(html: string): void {
      const m = /data-edit-outcomes-state="([^"]+)"/.exec(html);
      if (m) states.add(m[1]!);
    }
    collect(render(null));
    collect(render(makeSummary({ status: "data_unavailable" })));
    collect(render(makeSummary({ total_recent_live_edits: 0 })));
    collect(
      render(
        makeSummary({
          total_recent_live_edits: 2,
          still_learning_edits: 2,
        }),
      ),
    );
    collect(
      render(
        makeSummary({
          total_recent_live_edits: 1,
          eligible_edits: 1,
          sum_post_live_sessions: 18,
        }),
      ),
    );
    expect([...states].sort()).toEqual(
      ["empty", "healthy", "still_gathering"],
    );
  });
});
