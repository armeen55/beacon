import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  decideDoNext,
  TodayDoNextCard,
  type TodayDoNextCardProps,
} from "./today-do-next-card";
import type { TodayLifecycleQueueItem } from "@/app/(shell)/today-data";
import type { TopPickSummary } from "./top-pick-card";

function queueItem(
  overrides: Partial<TodayLifecycleQueueItem> = {},
): TodayLifecycleQueueItem {
  return {
    id: "edit-test",
    rec_id: "rec-test",
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/locations/los-altos",
    display_label: "H2 heading: Los Altos",
    proposed_text_preview: "Why teams choose us…",
    updated_at: "2026-04-27T09:42:58Z",
    needsRewrite: false,
    ...overrides,
  };
}

function topPick(overrides: Partial<TopPickSummary> = {}): TopPickSummary {
  return {
    stableKey: "rec-test",
    type: "owned_page" as never,
    title: "Strengthen homepage for service prompts",
    reasoning: "Top-ranked rec from the prioritizer",
    tier: "now",
    action: "strengthen_existing_page" as never,
    resolvedUrl: "https://ritzbuilders.com/",
    ...overrides,
  };
}

const ZERO_PROPS: TodayDoNextCardProps = {
  pendingQueue: [],
  pendingCount: 0,
  topPick: null,
  findingsCriticalCount: 0,
  findingsImportantCount: 0,
  findingsTotalCount: 0,
};

describe("decideDoNext priority rules", () => {
  it("ship_pending wins when pending queue is non-empty", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      pendingQueue: [queueItem()],
      pendingCount: 1,
      topPick: topPick(),
      findingsCriticalCount: 5,
      findingsImportantCount: 5,
      findingsTotalCount: 10,
    });
    expect(decision.kind).toBe("ship_pending");
  });

  it("decide_recommendation wins when no pending and topPick exists", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      topPick: topPick(),
      findingsCriticalCount: 3,
      findingsImportantCount: 0,
      findingsTotalCount: 3,
    });
    expect(decision.kind).toBe("decide_recommendation");
  });

  it("review_scan_diffs wins only when no pending AND no topPick", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      findingsCriticalCount: 2,
      findingsImportantCount: 1,
      findingsTotalCount: 3,
    });
    expect(decision.kind).toBe("review_scan_diffs");
  });

  it("calm when nothing is firing", () => {
    const decision = decideDoNext(ZERO_PROPS);
    expect(decision.kind).toBe("calm");
  });

  it("review_scan_diffs requires critical OR important — bare totalCount alone is not enough", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      findingsCriticalCount: 0,
      findingsImportantCount: 0,
      findingsTotalCount: 12,
    });
    // No critical/important means scan diffs is not "do next" worthy.
    expect(decision.kind).toBe("calm");
  });
});

describe("TodayDoNextCard rendering", () => {
  it("ship_pending renders the top edit's display_label + Open recommendation link", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        pendingQueue={[queueItem({ display_label: "Custom label" })]}
        pendingCount={1}
      />,
    );
    expect(html).toContain('data-today-do-next="ship_pending"');
    expect(html).toContain("Custom label");
    expect(html).toContain("Open recommendation");
    expect(html).toContain("Do next · ship this");
  });

  it("ship_pending shows 'pending total' when more than one is queued", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        pendingQueue={[queueItem({ id: "e1" })]}
        pendingCount={5}
      />,
    );
    expect(html).toContain("5 pending total");
    expect(html).toContain("View all pending");
  });

  it("ship_pending shows 'Operator rewrite required' when top edit needsRewrite", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        pendingQueue={[queueItem({ needsRewrite: true })]}
        pendingCount={1}
      />,
    );
    expect(html).toContain("Operator rewrite required");
  });

  it("decide_recommendation renders the topPick title", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        topPick={topPick({ title: "My recommendation" })}
      />,
    );
    expect(html).toContain('data-today-do-next="decide_recommendation"');
    expect(html).toContain("My recommendation");
  });

  it("review_scan_diffs renders critical-tone copy when criticalCount > 0", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        findingsCriticalCount={3}
        findingsTotalCount={5}
      />,
    );
    expect(html).toContain('data-today-do-next="review_scan_diffs"');
    expect(html).toContain("3 critical scan diff");
  });

  it("calm state renders nothing", () => {
    const html = renderToStaticMarkup(<TodayDoNextCard {...ZERO_PROPS} />);
    expect(html).toBe("");
  });

  it("Phase 6A.1 Los Altos production fixture → ship_pending with H2 label", () => {
    // Mirrors the actual production state — 5 pending edits, top is the H2.
    const losAltosH2 = queueItem({
      id: "create_cluster_page:geo:Los Altos__add_h2_section__h2[new]:c75a1120a6aa",
      display_label: 'H2 heading (new): "Why teams choose us over De Mattei Construction"',
      target_url: "https://ritzbuilders.com/locations/los-altos",
      needsRewrite: false,
    });
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        pendingQueue={[losAltosH2]}
        pendingCount={5}
      />,
    );
    expect(html).toContain("Why teams choose us over De Mattei Construction");
    expect(html).toContain("5 pending total");
  });
});
