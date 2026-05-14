/**
 * Today "Edit lifecycle" tile — Phase A.1 §2.11 render contract.
 *
 * Pins:
 *   • Populated state renders per-stage counts, freshness anchor,
 *     and the "Why these benchmarks?" tooltip trigger.
 *   • Empty state renders the calm "no edits in window" message and
 *     does NOT show count rows.
 *   • Each stage row carries a stable data-attr for downstream
 *     automation.
 *   • No stage enum value appears in rendered customer copy.
 *
 * Server-rendered via `renderToStaticMarkup`. The tooltip body is
 * gated by `useState` (client-only) so the closed initial state
 * never renders the BORROWED DEFAULTS body in this server output.
 * That's intentional — the tooltip body open/close is exercised in
 * a future browser-side test once the surface stabilizes.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EditLifecycleTile } from "@/components/today/edit-lifecycle-tile";
import type { LifecycleStage } from "@/domains/citation-lifecycle/lifecycle-stage";

const EMPTY_PER_STAGE: Record<LifecycleStage, number> = {
  live_not_yet_cited: 0,
  cited_fast: 0,
  cited_typical: 0,
  cited_late: 0,
  cited_very_late: 0,
  stuck: 0,
};

function render(
  props: Parameters<typeof EditLifecycleTile>[0],
): string {
  return renderToStaticMarkup(<EditLifecycleTile {...props} />);
}

describe("EditLifecycleTile — populated state", () => {
  it("renders the heading, total count, and freshness anchor", () => {
    const html = render({
      perStage: {
        ...EMPTY_PER_STAGE,
        cited_fast: 3,
        cited_typical: 5,
        live_not_yet_cited: 2,
        stuck: 1,
      },
      total: 11,
      latestLiveAtIso: "2026-05-12T00:00:00Z",
    });
    expect(html).toContain('data-today-tile="edit-lifecycle"');
    expect(html).toContain('data-today-tile-state="populated"');
    expect(html).toContain('data-today-tile-total="11"');
    expect(html).toContain("Edit lifecycle");
    expect(html).toContain("past 90 days · 11 edits");
    expect(html).toContain('data-today-tile-freshness="true"');
    expect(html).toContain("Latest edit live:");
  });

  it("renders one row per stage with stage-specific data-attrs", () => {
    const html = render({
      perStage: {
        ...EMPTY_PER_STAGE,
        cited_fast: 3,
        cited_typical: 5,
        cited_late: 1,
        cited_very_late: 0,
        live_not_yet_cited: 2,
        stuck: 1,
      },
      total: 12,
      latestLiveAtIso: null,
    });
    expect(html).toContain('data-today-tile-stage="cited_fast"');
    expect(html).toContain('data-today-tile-stage-count="3"');
    expect(html).toContain('data-today-tile-stage="cited_typical"');
    expect(html).toContain('data-today-tile-stage-count="5"');
    expect(html).toContain('data-today-tile-stage="cited_late"');
    expect(html).toContain('data-today-tile-stage="cited_very_late"');
    expect(html).toContain('data-today-tile-stage="live_not_yet_cited"');
    expect(html).toContain('data-today-tile-stage="stuck"');
  });

  it("renders the borrowed-benchmark tooltip trigger but not its body when closed", () => {
    const html = render({
      perStage: { ...EMPTY_PER_STAGE, cited_fast: 1 },
      total: 1,
      latestLiveAtIso: null,
    });
    expect(html).toContain('data-today-tile-tooltip-trigger="true"');
    expect(html).toContain("Why these benchmarks?");
    // Tooltip body is gated by client useState; initial server
    // render must NOT contain the BORROWED DEFAULTS body.
    expect(html).not.toContain('data-today-tile-tooltip-body="true"');
    expect(html).not.toContain("starter benchmarks");
  });

  it("uses customer-vocabulary labels — no snake_case enum strings appear in visible text", () => {
    // Pure single-word enum values that double as English ("stuck")
    // are legitimate customer copy. The internal-vocabulary rule
    // forbids leakage of the SNAKE_CASE forms — those are operator-
    // side identifiers and would read as broken to a customer.
    const html = render({
      perStage: {
        ...EMPTY_PER_STAGE,
        cited_fast: 1,
        cited_typical: 1,
        cited_late: 1,
        cited_very_late: 1,
        live_not_yet_cited: 1,
        stuck: 1,
      },
      total: 6,
      latestLiveAtIso: null,
    });
    const visibleOnly = html.replace(/data-[a-z0-9-]+="[^"]*"/g, "");
    const snakeEnums = [
      "live_not_yet_cited",
      "cited_fast",
      "cited_typical",
      "cited_late",
      "cited_very_late",
    ] as const;
    for (const v of snakeEnums) {
      expect(visibleOnly, `enum '${v}' leaked into customer copy`).not.toContain(
        v,
      );
    }
  });

  it("renders customer-friendly stage labels keyed to the locked thresholds", () => {
    const html = render({
      perStage: {
        ...EMPTY_PER_STAGE,
        cited_fast: 1,
        cited_typical: 1,
        cited_late: 1,
        stuck: 1,
      },
      total: 4,
      latestLiveAtIso: null,
    });
    expect(html).toContain("cited fast (within 6 days)");
    expect(html).toContain("cited typical (within 18 days)");
    expect(html).toContain("cited late (within 37 days)");
    expect(html).toContain("stuck (past 37 days)");
  });
});

describe("EditLifecycleTile — empty state", () => {
  it("renders the calm empty message when total = 0", () => {
    const html = render({
      perStage: EMPTY_PER_STAGE,
      total: 0,
      latestLiveAtIso: null,
    });
    expect(html).toContain('data-today-tile-state="empty"');
    expect(html).toContain("No edits in the past 90 days");
    expect(html).toContain("Ship an edit and Beacon will start watching");
    // Empty state does NOT include the count-row data-attrs.
    expect(html).not.toContain('data-today-tile-stage="cited_fast"');
    expect(html).not.toContain('data-today-tile-freshness="true"');
  });

  it("still renders the tooltip trigger so customer can read provenance even with zero edits", () => {
    const html = render({
      perStage: EMPTY_PER_STAGE,
      total: 0,
      latestLiveAtIso: null,
    });
    expect(html).toContain('data-today-tile-tooltip-trigger="true"');
  });
});
