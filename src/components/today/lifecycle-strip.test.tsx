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

  it("each chip deep-links to a /changes lifecycle tab (Phase 6A.8)", () => {
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
    // Phase 6A.8 — chips deep-link to /changes?tab=X (and live_verified
    // uses the bare default URL since live_verified is the default tab).
    expect(html).toMatch(/href="\/changes"/); // live_verified default
    expect(html).toContain('href="/changes?tab=pending_implementation"');
    expect(html).toContain('href="/changes?tab=needs_review"');
    expect(html).toContain('href="/changes?tab=all"'); // notFoundAfter7d
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
