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
import {
  renderLifecycleCopy,
  type ThresholdDecisionLike,
} from "@/domains/citation-lifecycle/render-copy";

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
    threshold_decision?: ThresholdDecisionLike;
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
        threshold_decision: fields.threshold_decision,
      }),
    },
  });
}

const PER_TENANT_DECISION: ThresholdDecisionLike = {
  source: "per_tenant",
  thresholds: { fast_days: 5, median_days: 11, late_days: 22 },
  sample_size: 24,
  excluded_count: 4,
  percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
};

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

describe("ChangeDetailV2Client — per-tenant copy variants (Phase A.2 §3c)", () => {
  it("cited_fast renders the 'for this site' suffix when source is per_tenant", () => {
    const html = render(
      withStage("cited_fast", {
        days_since_live: 5,
        days_to_first_citation: 4,
        threshold_decision: PER_TENANT_DECISION,
      }),
    );
    expect(html).toContain("This page was cited 4 days");
    expect(html).toContain("fast benchmark for this site");
  });

  it("cited_typical renders the 'for this site' suffix when source is per_tenant", () => {
    const html = render(
      withStage("cited_typical", {
        days_since_live: 12,
        days_to_first_citation: 9,
        threshold_decision: PER_TENANT_DECISION,
      }),
    );
    expect(html).toContain("typical citation window for this site");
  });

  it("live_not_yet_cited per_tenant variant cites the cited-page subpopulation rather than 'first citations typically appear'", () => {
    const html = render(
      withStage("live_not_yet_cited", {
        days_since_live: 3,
        days_to_first_citation: null,
        threshold_decision: PER_TENANT_DECISION,
      }),
    );
    expect(html).toContain("on cited pages from this site");
    expect(html).toContain("first citations arrived within");
    expect(html).not.toContain("first citations typically appear");
  });

  it("stuck copy is identical regardless of threshold_decision.source", () => {
    const profoundHtml = render(
      withStage("stuck", {
        days_since_live: 41,
        days_to_first_citation: null,
      }),
    );
    const perTenantHtml = render(
      withStage("stuck", {
        days_since_live: 41,
        days_to_first_citation: null,
        threshold_decision: PER_TENANT_DECISION,
      }),
    );
    // Stuck copy never carries the "for this site" suffix — a
    // stuck page is a stuck page regardless of which benchmark
    // band defined "past late_days."
    expect(profoundHtml).toContain("Likely a discoverability issue");
    expect(perTenantHtml).toContain("Likely a discoverability issue");
    expect(profoundHtml).not.toContain("for this site");
    expect(perTenantHtml).not.toContain("for this site");
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

// ─────────────────────────────────────────────────────────────────────
// Phase A.3 Step 4 — diagnostic vs bridge mutually-exclusive rendering
// ─────────────────────────────────────────────────────────────────────

function lifecyclePropsWithCopy(
  stage: LifecycleStage,
  copyOverride: Partial<NonNullable<ChangeDetailV2Props["lifecycle"]>["copy"]>,
): ChangeDetailV2Props {
  // Build a base stuck-row lifecycle via the renderer + null diagnostic,
  // then override `copy.diagnostic` and/or `copy.bridge` to exercise
  // every render-path combination.
  const base = renderLifecycleCopy({
    stage,
    days_since_live: 41,
    days_to_first_citation: null,
    per_platform_first_citation: {
      chatgpt: null,
      perplexity: null,
      google_ai_overviews: null,
    },
    is_partial_live: false,
    was_cited_before_live: false,
  });
  return baseProps({
    lifecycle: {
      stage,
      isPartialLive: false,
      copy: { ...base, ...copyOverride },
    },
  });
}

describe("ChangeDetailV2Client — Phase A.3 §4 diagnostic vs bridge mutual exclusion", () => {
  it("renders the diagnostic sub-line under data-change-detail-act3-lifecycle-diagnostic='true' when copy.diagnostic is non-null", () => {
    const html = render(
      lifecyclePropsWithCopy("stuck", {
        diagnostic:
          "Beacon did not find this page in your sitemap.xml.",
      }),
    );
    expect(html).toContain(
      'data-change-detail-act3-lifecycle-diagnostic="true"',
    );
    expect(html).toContain(
      "Beacon did not find this page in your sitemap.xml.",
    );
  });

  it("DOES NOT render the bridge sub-line when copy.diagnostic is non-null (mutual exclusion)", () => {
    const html = render(
      lifecyclePropsWithCopy("stuck", {
        diagnostic:
          "Beacon did not find this page in your sitemap.xml.",
        // bridge is still populated in the data model — the client
        // must suppress it.
      }),
    );
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-bridge="true"',
    );
    // The literal bridge phrase must not appear either.
    expect(html).not.toContain(
      "next bundle will add automated sitemap + robots checks",
    );
  });

  it("renders the bridge fallback when copy.diagnostic is null and copy.bridge is non-null", () => {
    const html = render(
      lifecyclePropsWithCopy("stuck", {
        diagnostic: null,
        // base render-copy already populated `bridge` for stuck.
      }),
    );
    expect(html).toContain(
      'data-change-detail-act3-lifecycle-bridge="true"',
    );
    expect(html).toContain(
      "next bundle will add automated sitemap + robots checks",
    );
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-diagnostic="true"',
    );
  });

  it("renders NEITHER sub-line when both diagnostic and bridge are null", () => {
    const html = render(
      lifecyclePropsWithCopy("stuck", {
        diagnostic: null,
        bridge: null,
      }),
    );
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-diagnostic="true"',
    );
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-bridge="true"',
    );
  });

  it("does NOT render a diagnostic sub-line for non-stuck stages (cited_typical row)", () => {
    const html = render(
      lifecyclePropsWithCopy("cited_typical", {
        // Even if a caller forces a diagnostic onto a cited row's
        // copy object, the client renders it (the data-model
        // decision was already made upstream by renderLifecycleCopy,
        // which suppresses diagnostic for non-stuck stages — see
        // tests/domains/citation-lifecycle/render-copy.test.ts).
        // This test verifies the natural cited render: the
        // renderLifecycleCopy call inside lifecyclePropsWithCopy
        // produces diagnostic=null for cited_typical, so the
        // client output has no diagnostic sub-line.
      }),
    );
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-diagnostic="true"',
    );
    // Cited rows also have no bridge sub-line.
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-bridge="true"',
    );
  });
});
