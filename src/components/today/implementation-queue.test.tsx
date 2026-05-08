import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayImplementationQueue } from "./implementation-queue";

function row(overrides: Partial<{
  id: string;
  rec_id: string;
  action_type: string;
  target_url: string | null;
  display_label: string | null;
  proposed_text_preview: string | null;
  updated_at: string;
}> = {}) {
  return {
    id: "edit-test",
    rec_id: "rec-test",
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    display_label: "H2: Architect-led design-build advantage",
    proposed_text_preview: "Why choose an architect-led design-build firm…",
    updated_at: "2026-04-27T00:00:00Z",
    ...overrides,
  };
}

describe("TodayImplementationQueue", () => {
  it("UX.6.2 — empty queue renders nothing (compressed away from /today)", () => {
    // Pre-UX.6.2 the empty state was a styled card ("Nothing waiting
    // on you. Accepted edits live here until the next scan finds them
    // on the page.") that took ~3 lines without driving any action.
    // The TodayLifecycleStrip already shows the "live verified" chip
    // + a "· nothing waiting" muted suffix when all pending counts
    // are zero, so this card is now noise. Drop it entirely.
    const html = renderToStaticMarkup(
      <TodayImplementationQueue queue={[]} totalPendingCount={0} />,
    );
    expect(html).toBe("");
    expect(html).not.toContain("Nothing waiting on you");
    expect(html).not.toContain("data-today-implementation-queue");
  });

  it("populated state when queue has rows", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[row({ id: "e1" }), row({ id: "e2" })]}
        totalPendingCount={2}
      />,
    );
    expect(html).toContain('data-today-implementation-queue="populated"');
    expect(html).toContain('data-implementation-queue-rows="2"');
    expect(html).toContain("Accepted edits waiting for site update");
  });

  it("each row renders the LifecycleStatusPill in 'accepted' state", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue queue={[row()]} totalPendingCount={1} />,
    );
    // The pill carries data-lifecycle-key="accepted" (Phase 6A.3 contract).
    expect(html).toContain('data-lifecycle-key="accepted"');
  });

  it("renders display_label when present", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[row({ display_label: "Custom label" })]}
        totalPendingCount={1}
      />,
    );
    expect(html).toContain("Custom label");
  });

  it("falls back to action_type when display_label is null", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[row({ display_label: null, action_type: "edit_title" })]}
        totalPendingCount={1}
      />,
    );
    expect(html).toContain("edit_title");
  });

  it("shows '+N more pending' footer when totalPendingCount exceeds queue length", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[row({ id: "e1" }), row({ id: "e2" })]}
        totalPendingCount={7}
      />,
    );
    expect(html).toContain("+5 more pending");
  });

  it("hides '+N more' footer when queue covers all pending", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[row({ id: "e1" })]}
        totalPendingCount={1}
      />,
    );
    expect(html).not.toContain("more pending");
  });
});
