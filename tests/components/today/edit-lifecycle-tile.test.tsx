/**
 * Today "Edit lifecycle" tile render contract — Phase A.1 §2.11 +
 * Phase A.2 Step 3c (2026-05-14).
 *
 * Pins:
 *   • Populated state renders per-stage counts, freshness anchor,
 *     and the "Why these benchmarks?" tooltip trigger.
 *   • Empty state renders the calm "no edits in window" message
 *     (substituting `{windowDays}` from props) and does NOT show
 *     count rows.
 *   • Each stage row carries a stable data-attr for downstream
 *     automation.
 *   • No stage enum value appears in rendered customer copy.
 *   • Phase A.2 Step 3c boundary: the component reads labels +
 *     tooltip body + empty-state body from PROPS only. The
 *     source-side architecture invariant (`tile-no-threshold-
 *     imports.test.ts`) pins the import-side contract.
 *
 * Server-rendered via `renderToStaticMarkup`. The tooltip body is
 * gated by `useState` (client-only) so the closed initial state
 * never renders the tooltip body in this server output.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EditLifecycleTile } from "@/components/today/edit-lifecycle-tile";
import { buildTileStrings } from "@/domains/citation-lifecycle/render-copy";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";
import type { LifecycleStage } from "@/domains/citation-lifecycle/lifecycle-stage";
import type { ThresholdDecisionLike } from "@/domains/citation-lifecycle/render-copy";

const EMPTY_PER_STAGE: Record<LifecycleStage, number> = {
  live_not_yet_cited: 0,
  cited_fast: 0,
  cited_typical: 0,
  cited_late: 0,
  cited_very_late: 0,
  stuck: 0,
};

const PROFOUND_DECISION: ThresholdDecisionLike = {
  source: "profound_default",
  thresholds: T2C_THRESHOLDS,
  sample_size: 0,
  excluded_count: 0,
  percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
};

const PER_TENANT_DECISION: ThresholdDecisionLike = {
  source: "per_tenant",
  thresholds: { fast_days: 4, median_days: 11, late_days: 22 },
  sample_size: 24,
  excluded_count: 6,
  percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
};

const PROFOUND_STRINGS = buildTileStrings(PROFOUND_DECISION);
const PER_TENANT_STRINGS = buildTileStrings(PER_TENANT_DECISION);

function render(
  props: Parameters<typeof EditLifecycleTile>[0],
): string {
  return renderToStaticMarkup(<EditLifecycleTile {...props} />);
}

describe("EditLifecycleTile — populated state (Profound)", () => {
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
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
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
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
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

  it("renders the benchmark tooltip trigger but not its body when closed", () => {
    const html = render({
      perStage: { ...EMPTY_PER_STAGE, cited_fast: 1 },
      total: 1,
      latestLiveAtIso: null,
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
    });
    expect(html).toContain('data-today-tile-tooltip-trigger="true"');
    expect(html).toContain("Why these benchmarks?");
    // Tooltip body is gated by client useState; initial server
    // render must NOT contain the tooltip body.
    expect(html).not.toContain('data-today-tile-tooltip-body="true"');
    expect(html).not.toContain("starter benchmarks");
  });

  it("uses customer-vocabulary labels — no snake_case enum strings appear in visible text", () => {
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
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
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

  it("renders Profound stage labels (6 / 18 / 37) when decision source is profound_default", () => {
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
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
    });
    expect(html).toContain("cited fast (within 6 days)");
    expect(html).toContain("cited typical (within 18 days)");
    expect(html).toContain("cited late (within 37 days)");
    expect(html).toContain("stuck (past 37 days)");
  });
});

describe("EditLifecycleTile — populated state (per-tenant)", () => {
  it("renders per-tenant stage labels when decision source is per_tenant", () => {
    const html = render({
      perStage: {
        ...EMPTY_PER_STAGE,
        cited_fast: 2,
        cited_typical: 4,
        cited_late: 1,
        cited_very_late: 1,
        live_not_yet_cited: 3,
        stuck: 2,
      },
      total: 13,
      latestLiveAtIso: null,
      stageLabels: PER_TENANT_STRINGS.stage_labels,
      tooltipBody: PER_TENANT_STRINGS.tooltip_body,
      emptyStateBody: PER_TENANT_STRINGS.empty_state_body,
    });
    expect(html).toContain("cited fast (within 4 days)");
    expect(html).toContain("cited typical (within 11 days)");
    expect(html).toContain("cited late (within 22 days)");
    expect(html).toContain("cited late (past 22 days)");
    expect(html).toContain("stuck (past 22 days)");
    // Profound numbers MUST NOT appear when per-tenant decision active.
    expect(html).not.toContain("within 6 days");
    expect(html).not.toContain("within 18 days");
    expect(html).not.toContain("within 37 days");
    expect(html).not.toContain("past 37 days");
  });
});

describe("EditLifecycleTile — empty state", () => {
  it("renders the calm empty message with windowDays substituted", () => {
    const html = render({
      perStage: EMPTY_PER_STAGE,
      total: 0,
      latestLiveAtIso: null,
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
    });
    expect(html).toContain('data-today-tile-state="empty"');
    expect(html).toContain("No edits in the past 90 days");
    expect(html).toContain("Ship an edit and Beacon will start watching");
    // The {windowDays} placeholder must be substituted.
    expect(html).not.toContain("{windowDays}");
    // Empty state does NOT include the count-row data-attrs.
    expect(html).not.toContain('data-today-tile-stage="cited_fast"');
    expect(html).not.toContain('data-today-tile-freshness="true"');
  });

  it("still renders the tooltip trigger so customer can read provenance even with zero edits", () => {
    const html = render({
      perStage: EMPTY_PER_STAGE,
      total: 0,
      latestLiveAtIso: null,
      stageLabels: PROFOUND_STRINGS.stage_labels,
      tooltipBody: PROFOUND_STRINGS.tooltip_body,
      emptyStateBody: PROFOUND_STRINGS.empty_state_body,
    });
    expect(html).toContain('data-today-tile-tooltip-trigger="true"');
  });
});
