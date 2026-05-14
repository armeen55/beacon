/**
 * /changes/[id] proof-brief — Phase A.1 §2.10 lifecycle line render.
 *
 * Pins the per-stage Act 3 lifecycle insertion contract:
 *
 *   • The lifecycle block renders only when `lifecycle` prop is set.
 *   • Each of the 6 stages renders its data-attr + the expected
 *     primary copy line.
 *   • Per-platform divergence renders only on cited-* stages when
 *     exactly one platform has cited.
 *   • Stuck-stage bridge phrase ("next bundle will add automated
 *     sitemap + robots checks") renders inside Act 3.
 *   • No stage enum value ever appears in rendered customer copy.
 *
 * Server-rendered via `renderToStaticMarkup` — no DOM needed.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeDetailV2Client } from "@/app/(shell)/changes/[id]/change-detail-v2-client";
import type { ChangeDetailV2Props } from "@/app/(shell)/changes/[id]/change-detail-v2-client";
import type { LifecycleStage } from "@/domains/citation-lifecycle/lifecycle-stage";
import { renderLifecycleCopy } from "@/domains/citation-lifecycle/render-copy";

function baseProps(over: Partial<ChangeDetailV2Props> = {}): ChangeDetailV2Props {
  return {
    title: "Lifecycle render test",
    fullDescription: null,
    targetUrl: "/services/whole-home-remodel",
    shippedAt: "2026-05-04T00:00:00Z",
    pill: {
      kind: "live",
      label: "Live",
      tone: "muted",
      blurb: "Beacon is watching.",
    },
    hypothesis: null,
    hypothesisSource: null,
    patternTimingNarrative: null,
    events: [],
    sparkline: [],
    platformLabels: [],
    beaconRecommended: false,
    nextActions: [],
    lifecycle: null,
    ...over,
  };
}

function withStage(
  stage: LifecycleStage,
  fields: {
    days_since_live: number;
    days_to_first_citation: number | null;
    per_platform?: { chatgpt: string | null; perplexity: string | null };
  },
): ChangeDetailV2Props {
  return baseProps({
    lifecycle: {
      stage,
      isPartialLive: false,
      copy: renderLifecycleCopy({
        stage,
        days_since_live: fields.days_since_live,
        days_to_first_citation: fields.days_to_first_citation,
        per_platform_first_citation: {
          chatgpt: fields.per_platform?.chatgpt ?? null,
          perplexity: fields.per_platform?.perplexity ?? null,
          google_ai_overviews: null,
        },
        is_partial_live: false,
        was_cited_before_live: false,
      }),
    },
  });
}

function render(props: ChangeDetailV2Props): string {
  return renderToStaticMarkup(<ChangeDetailV2Client {...props} />);
}

const STAGES: LifecycleStage[] = [
  "live_not_yet_cited",
  "cited_fast",
  "cited_typical",
  "cited_late",
  "cited_very_late",
  "stuck",
];

describe("ChangeDetailV2Client — lifecycle prop is optional", () => {
  it("omits the lifecycle block when lifecycle is null", () => {
    const html = render(baseProps({ lifecycle: null }));
    expect(html).not.toContain('data-change-detail-act3-lifecycle');
  });
});

describe("ChangeDetailV2Client — per-stage Act 3 lifecycle copy (Section 2.10)", () => {
  it("live_not_yet_cited renders the watching copy line", () => {
    const html = render(
      withStage("live_not_yet_cited", {
        days_since_live: 3,
        days_to_first_citation: null,
      }),
    );
    expect(html).toContain(
      'data-change-detail-act3-lifecycle="live_not_yet_cited"',
    );
    expect(html).toContain("Live 3 days ago");
    expect(html).toContain("Beacon is watching");
  });

  it("cited_fast renders 'This page was cited N days after the edit went live — within Beacon's fast benchmark'", () => {
    const html = render(
      withStage("cited_fast", {
        days_since_live: 5,
        days_to_first_citation: 4,
      }),
    );
    expect(html).toContain('data-change-detail-act3-lifecycle="cited_fast"');
    expect(html).toContain("This page was cited 4 days");
    expect(html).toContain("after the edit went live");
    expect(html).toContain("fast benchmark");
  });

  it("cited_typical renders 'This page was cited N days after the edit went live — within Beacon's typical citation window'", () => {
    const html = render(
      withStage("cited_typical", {
        days_since_live: 13,
        days_to_first_citation: 12,
      }),
    );
    expect(html).toContain('data-change-detail-act3-lifecycle="cited_typical"');
    expect(html).toContain("This page was cited");
    expect(html).toContain("after the edit went live");
    expect(html).toContain("typical citation window");
  });

  it("cited_late renders 'This page was cited N days after the edit went live — past Beacon's typical window but within the late threshold'", () => {
    const html = render(
      withStage("cited_late", {
        days_since_live: 29,
        days_to_first_citation: 28,
      }),
    );
    expect(html).toContain('data-change-detail-act3-lifecycle="cited_late"');
    expect(html).toContain("This page was cited");
    expect(html).toContain("after the edit went live");
    expect(html).toContain("past Beacon");
    expect(html).toContain("late threshold");
  });

  it("cited_very_late renders 'This page was cited N days after the edit went live — late, but the page is in Beacon's rotation'", () => {
    const html = render(
      withStage("cited_very_late", {
        days_since_live: 46,
        days_to_first_citation: 45,
      }),
    );
    expect(html).toContain(
      'data-change-detail-act3-lifecycle="cited_very_late"',
    );
    expect(html).toContain("This page was cited");
    expect(html).toContain("after the edit went live");
    expect(html).toContain("late, but the page is in Beacon");
  });

  it("stuck renders the discoverability line AND the bridge phrase inside Act 3", () => {
    const html = render(
      withStage("stuck", {
        days_since_live: 41,
        days_to_first_citation: null,
      }),
    );
    expect(html).toContain('data-change-detail-act3-lifecycle="stuck"');
    expect(html).toContain("Likely a discoverability issue");
    expect(html).toContain(
      'data-change-detail-act3-lifecycle-bridge="true"',
    );
    expect(html).toContain(
      "next bundle will add automated sitemap + robots checks",
    );
  });
});

describe("ChangeDetailV2Client — per-platform divergence sub-line", () => {
  it("renders 'First cited on Perplexity, not yet on ChatGPT' when only Perplexity cited", () => {
    const html = render(
      withStage("cited_typical", {
        days_since_live: 10,
        days_to_first_citation: 8,
        per_platform: { chatgpt: null, perplexity: "2026-05-08" },
      }),
    );
    expect(html).toContain(
      'data-change-detail-act3-lifecycle-per-platform="true"',
    );
    expect(html).toContain(
      "First cited on Perplexity, not yet on ChatGPT.",
    );
  });

  it("renders 'First cited on ChatGPT, not yet on Perplexity' when only ChatGPT cited", () => {
    const html = render(
      withStage("cited_fast", {
        days_since_live: 3,
        days_to_first_citation: 2,
        per_platform: { chatgpt: "2026-05-08", perplexity: null },
      }),
    );
    expect(html).toContain(
      "First cited on ChatGPT, not yet on Perplexity.",
    );
  });

  it("does not render the per-platform sub-line when both platforms cited", () => {
    const html = render(
      withStage("cited_typical", {
        days_since_live: 10,
        days_to_first_citation: 8,
        per_platform: { chatgpt: "2026-05-08", perplexity: "2026-05-09" },
      }),
    );
    expect(html).not.toContain(
      "data-change-detail-act3-lifecycle-per-platform",
    );
  });
});

describe("ChangeDetailV2Client — customer-vocabulary contract", () => {
  it("none of the 6 stage enum values appear as visible text in any stage render", () => {
    for (const stage of STAGES) {
      const html = render(
        withStage(stage, {
          days_since_live: 10,
          days_to_first_citation:
            stage === "live_not_yet_cited" || stage === "stuck" ? null : 8,
        }),
      );
      // Strip the data-attr instances (those are operator-side
      // and don't render in the visible DOM) by removing
      // data-* attribute values from the HTML before checking.
      const visibleOnly = html.replace(/data-[a-z0-9-]+="[^"]*"/g, "");
      for (const otherStage of STAGES) {
        expect(
          visibleOnly,
          `stage ${stage} render contains the raw enum '${otherStage}' in visible copy`,
        ).not.toContain(otherStage);
      }
    }
  });
});
