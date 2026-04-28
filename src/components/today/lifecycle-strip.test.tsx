import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayLifecycleStrip } from "./lifecycle-strip";

const ZERO = {
  liveVerified: 0,
  pendingImplementation: 0,
  needsReview: 0,
  notFoundAfter7d: 0,
};

describe("TodayLifecycleStrip", () => {
  it("always renders the live_verified chip even when count is 0", () => {
    const html = renderToStaticMarkup(<TodayLifecycleStrip counts={ZERO} />);
    expect(html).toContain('data-lifecycle-chip="liveVerified"');
    expect(html).toContain('data-lifecycle-count="0"');
    expect(html).toContain("live verified");
  });

  it("hides chips with zero count except live_verified", () => {
    const html = renderToStaticMarkup(<TodayLifecycleStrip counts={ZERO} />);
    expect(html).not.toContain('data-lifecycle-chip="pendingImplementation"');
    expect(html).not.toContain('data-lifecycle-chip="needsReview"');
    expect(html).not.toContain('data-lifecycle-chip="notFoundAfter7d"');
  });

  it("renders all chips that have non-zero counts", () => {
    const html = renderToStaticMarkup(
      <TodayLifecycleStrip
        counts={{
          liveVerified: 1,
          pendingImplementation: 3,
          needsReview: 2,
          notFoundAfter7d: 4,
        }}
      />,
    );
    expect(html).toContain('data-lifecycle-chip="liveVerified"');
    expect(html).toContain('data-lifecycle-chip="pendingImplementation"');
    expect(html).toContain('data-lifecycle-chip="needsReview"');
    expect(html).toContain('data-lifecycle-chip="notFoundAfter7d"');
    expect(html).toContain('data-lifecycle-count="1"');
    expect(html).toContain('data-lifecycle-count="3"');
    expect(html).toContain('data-lifecycle-count="2"');
    expect(html).toContain('data-lifecycle-count="4"');
  });

  it("each chip is a link to /changes (the lifecycle truth surface)", () => {
    const html = renderToStaticMarkup(
      <TodayLifecycleStrip
        counts={{
          liveVerified: 1,
          pendingImplementation: 1,
          needsReview: 1,
          notFoundAfter7d: 1,
        }}
      />,
    );
    // Count how many <a> tags target /changes — should match the
    // 4 chips rendered.
    const anchorCount = (html.match(/href="\/changes"/g) ?? []).length;
    expect(anchorCount).toBeGreaterThanOrEqual(4);
  });

  it("renders production-shaped data: H2 verified, dismissed FAQs excluded", () => {
    // After Phase 6A.1 cleanup, the only verified-live row is the H2.
    // FAQ rows are dismissed and so are NOT counted here. This fixture
    // mirrors the actual production state on 2026-04-28.
    const html = renderToStaticMarkup(
      <TodayLifecycleStrip
        counts={{
          liveVerified: 1,
          pendingImplementation: 0,
          needsReview: 0,
          notFoundAfter7d: 0,
        }}
      />,
    );
    expect(html).toContain('data-lifecycle-count="1"');
    expect(html).toContain("live verified");
  });
});
