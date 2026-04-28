import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayImplementationQueue } from "./implementation-queue";

const baseRow = {
  id: "edit-test",
  rec_id: "rec-test",
  action_type: "add_faq",
  target_url: "https://ritzbuilders.com/locations/los-altos",
  display_label: 'New FAQ: "Who are the best builders…"',
  proposed_text_preview:
    'Q: Who are the best builders…\n\nA: Draft answer (operator: rewrite). Anchor on: Los Altos.',
  updated_at: "2026-04-27T09:42:58Z",
};

describe("TodayImplementationQueue — Phase 6A.8 needsRewrite badge", () => {
  it("renders 'needs rewrite' badge when row.needsRewrite=true", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[{ ...baseRow, needsRewrite: true }]}
        totalPendingCount={1}
      />,
    );
    expect(html).toContain('data-queue-needs-rewrite="true"');
    expect(html).toContain("needs rewrite");
  });

  it("hides badge when row.needsRewrite=false", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[{ ...baseRow, needsRewrite: false }]}
        totalPendingCount={1}
      />,
    );
    expect(html).toContain('data-queue-needs-rewrite="false"');
    expect(html).not.toContain("needs rewrite");
  });

  it("'+N more pending' footer deep-links to /changes?tab=pending_implementation (Phase 6A.8)", () => {
    const html = renderToStaticMarkup(
      <TodayImplementationQueue
        queue={[{ ...baseRow, needsRewrite: false }]}
        totalPendingCount={5}
      />,
    );
    expect(html).toContain("+4 more pending");
    expect(html).toContain('href="/changes?tab=pending_implementation"');
  });
});
