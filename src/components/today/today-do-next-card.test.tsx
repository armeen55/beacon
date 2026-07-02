import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  decideDoNext,
  TodayDoNextCard,
  type TodayDoNextCardProps,
} from "./today-do-next-card";
import type { TodayLifecycleQueueItem } from "@/app/(shell)/today-shared-types";
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

describe("decideDoNext priority rules (UX.6.2)", () => {
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

  it("UX.6.2 — topPick alone (no pending, no findings) → calm: Command Center NextBestActionCard owns this surface now", () => {
    // Pre-UX.6.2 this case fired `decide_recommendation` and rendered
    // a third copy of the rec on top of the Command Center's
    // NextBestActionCard + the Action Queue's primary ActionCard.
    // The decide_recommendation outcome was DROPPED. Do Next now
    // stays focused on cases CC doesn't already cover.
    const decision = decideDoNext({
      ...ZERO_PROPS,
      topPick: topPick(),
    });
    expect(decision.kind).toBe("calm");
  });

  it("UX.6.2 — topPick + findings → review_site_findings (findings still surface; rec is in CC)", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      topPick: topPick(),
      findingsCriticalCount: 3,
      findingsImportantCount: 0,
      findingsTotalCount: 3,
    });
    expect(decision.kind).toBe("review_site_findings");
  });

  it("review_site_findings wins when no pending AND critical/important findings exist", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      findingsCriticalCount: 2,
      findingsImportantCount: 1,
      findingsTotalCount: 3,
    });
    expect(decision.kind).toBe("review_site_findings");
  });

  it("calm when nothing is firing", () => {
    const decision = decideDoNext(ZERO_PROPS);
    expect(decision.kind).toBe("calm");
  });

  it("review_site_findings requires critical OR important — bare totalCount alone is not enough", () => {
    const decision = decideDoNext({
      ...ZERO_PROPS,
      findingsCriticalCount: 0,
      findingsImportantCount: 0,
      findingsTotalCount: 12,
    });
    // No critical/important priority means findings are background
    // noise, not Do Next material.
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

  it("UX.6.2 — topPick alone renders nothing (no decide_recommendation surface anymore)", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        topPick={topPick({ title: "My recommendation" })}
      />,
    );
    expect(html).toBe("");
    expect(html).not.toContain("My recommendation");
    expect(html).not.toContain("decide_recommendation");
  });

  it("review_site_findings renders critical-tone copy + new vocabulary when criticalCount > 0", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        findingsCriticalCount={3}
        findingsTotalCount={5}
      />,
    );
    expect(html).toContain('data-today-do-next="review_site_findings"');
    expect(html).toContain("3 critical site findings");
    expect(html).toContain("Site findings to review");
    // Old vocabulary must NOT appear.
    expect(html).not.toContain("scan diff");
    expect(html).not.toContain("Do next · review");
  });

  it("review_site_findings important-only path uses calmer neutral styling (no warning amber)", () => {
    const html = renderToStaticMarkup(
      <TodayDoNextCard
        {...ZERO_PROPS}
        findingsCriticalCount={0}
        findingsImportantCount={133}
        findingsTotalCount={775}
      />,
    );
    expect(html).toContain('data-today-do-next="review_site_findings"');
    expect(html).toContain("133 important site findings");
    // Subtitle explains the total/important relationship.
    expect(html).toContain("775 total");
    expect(html).toContain("133 important");
    // No status-warning / status-danger classes when only important.
    expect(html).not.toContain("status-warning");
    expect(html).not.toContain("status-danger");
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
