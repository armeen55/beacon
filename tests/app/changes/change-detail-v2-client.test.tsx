/**
 * /changes/[id] proof-brief — ChangeDetailV2Client render contract.
 *
 * Pins the v2 layout marker (`data-change-detail-layout="v2-proof-brief"`),
 * the 5-act structure with stable data-attrs, the back link, the
 * one-pill-per-card rule, the customer-safe hypothesis fallback, the
 * humanized evidence list, the pattern-timing rewrite, the next-action
 * CTAs, and the absence of internal vocabulary.
 *
 * Pure server-side string render via `renderToStaticMarkup` — no DOM
 * dependency.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeDetailV2Client } from "@/app/(shell)/changes/[id]/change-detail-v2-client";
import type { ChangeDetailV2Props } from "@/app/(shell)/changes/[id]/change-detail-v2-client";

function baseProps(over: Partial<ChangeDetailV2Props> = {}): ChangeDetailV2Props {
  return {
    title: "Add an FAQ section for Atherton modern home builder",
    targetUrl: "/services/modern-home-builder-atherton",
    shippedAt: "2026-05-04T00:00:00Z",
    pill: {
      kind: "helping",
      label: "Helping",
      tone: "success",
      blurb: "AI visibility responded after this shipped.",
    },
    hypothesis: null,
    hypothesisSource: null,
    patternTimingNarrative: null,
    events: [],
    sparkline: [],
    platformLabels: [],
    beaconRecommended: false,
    nextActions: [
      {
        kind: "back_to_changes",
        label: "Back to changes",
        href: "/changes",
        emphasis: "primary",
      },
    ],
    ...over,
  };
}

function render(over: Partial<ChangeDetailV2Props> = {}): string {
  return renderToStaticMarkup(<ChangeDetailV2Client {...baseProps(over)} />);
}

describe("ChangeDetailV2Client — 5-act narrative", () => {
  it("renders the v2 layout marker and the back link to /changes?v2=1", () => {
    const html = render();
    expect(html).toContain('data-change-detail-layout="v2-proof-brief"');
    expect(html).toContain('data-change-detail-back="true"');
    expect(html).toContain('href="/changes?v2=1"');
    expect(html).toContain("← Changes");
  });

  it("renders the header title + target URL + date + result pill", () => {
    const html = render();
    expect(html).toContain('data-change-detail-title="true"');
    expect(html).toContain("Add an FAQ section for Atherton modern home builder");
    expect(html).toContain('data-change-detail-url="true"');
    expect(html).toContain("/services/modern-home-builder-atherton");
    expect(html).toContain('data-change-detail-date="true"');
    // Pill rendered in the header.
    expect(html).toContain('data-changes-result-pill="helping"');
  });

  it("renders ALL 5 acts with stable data-attrs", () => {
    const html = render();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(html, `act ${n}`).toContain(`data-change-detail-act="act-${n}"`);
    }
  });

  it("Act 2 uses the calm fallback when hypothesis is null", () => {
    const html = render({ hypothesis: null });
    expect(html).toContain('data-change-detail-act2-fallback="true"');
    expect(html).toContain(
      "Beacon is using this change as a baseline for future",
    );
  });

  it("Act 2 renders the hypothesis when one exists, plus a source label", () => {
    const html = render({
      hypothesis: "Citations on Perplexity for 'modern home builder Bay Area'",
      hypothesisSource: "recommendation",
    });
    expect(html).toContain('data-change-detail-act2-hypothesis="true"');
    expect(html).toContain(
      "Citations on Perplexity for &#x27;modern home builder Bay Area&#x27;",
    );
    expect(html).toContain("From a Beacon recommendation");
  });

  it("Act 3 surfaces the pattern-timing rewrite when present", () => {
    const html = render({
      pill: {
        kind: "too_early",
        label: "Too early",
        tone: "muted",
        blurb: "Beacon is waiting for the post-change window to fill.",
      },
      patternTimingNarrative: "Similar changes usually show signal around day 7.",
    });
    expect(html).toContain('data-change-detail-act3-pattern-timing="true"');
    expect(html).toContain("Similar changes usually show signal around day 7");
  });

  it("Act 3 surfaces platform chips for tracked platforms", () => {
    const html = render({
      platformLabels: ["ChatGPT", "Perplexity"],
    });
    const chipMatches = html.match(/data-change-detail-act3-platform="true"/g) ?? [];
    expect(chipMatches.length).toBe(2);
    expect(html).toContain("ChatGPT");
    expect(html).toContain("Perplexity");
  });

  it("Act 3 renders a sparkline element when points are provided", () => {
    const html = render({
      sparkline: [
        { date: "2026-05-01", count: 0 },
        { date: "2026-05-02", count: 1 },
        { date: "2026-05-03", count: 3 },
      ],
    });
    expect(html).toContain('data-change-detail-act3-sparkline="true"');
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
  });

  it("Act 4 renders the calm 'no outcome events yet' state when events is empty", () => {
    const html = render({ events: [] });
    expect(html).toContain('data-change-detail-act4-empty="true"');
    expect(html).toContain("No outcome events linked yet");
  });

  it("Act 4 renders humanized event rows for each event (no raw enum names)", () => {
    const html = render({
      events: [
        {
          kind: "first_cited",
          label: "First time cited",
          summary:
            'Beacon saw ChatGPT cite you for "modern home builder" for the first time.',
          date: "2026-05-04",
          platformLabel: "ChatGPT",
          tone: "success",
        },
        {
          kind: "dropped_from_rankings",
          label: "Dropped from the rankings",
          summary: 'Perplexity stopped citing you for "modern home builder".',
          date: "2026-05-05",
          platformLabel: "Perplexity",
          tone: "danger",
        },
      ],
    });
    expect(html).toContain('data-change-detail-act4-events="true"');
    expect(html).toContain('data-change-detail-event-kind="first_cited"');
    expect(html).toContain('data-change-detail-event-tone="success"');
    expect(html).toContain('data-change-detail-event-kind="dropped_from_rankings"');
    expect(html).toContain('data-change-detail-event-tone="danger"');
    expect(html).toContain("First time cited");
    expect(html).toContain("Dropped from the rankings");
    // Customer labels appear; raw enum names must not.
    expect(html).not.toContain("first_appearance");
    expect(html).not.toContain("visibility_lost");
  });

  it("Act 5 renders the ordered CTAs from the resolver with emphasis attrs", () => {
    const html = render({
      pill: {
        kind: "helping",
        label: "Helping",
        tone: "success",
        blurb: "AI visibility responded after this shipped.",
      },
      nextActions: [
        {
          kind: "replicate_pattern",
          label: "Replicate this pattern",
          href: "/recommendations?source_rec=rec-1",
          emphasis: "primary",
        },
        {
          kind: "open_recommendation",
          label: "Open recommendation",
          href: "/recommendations/rec-1",
          emphasis: "secondary",
        },
        {
          kind: "open_legacy_detail",
          label: "Open the full record",
          href: "/changes/some-id?legacy=1",
          emphasis: "secondary",
        },
        {
          kind: "back_to_changes",
          label: "Back to changes",
          href: "/changes",
          emphasis: "secondary",
        },
      ],
    });
    expect(html).toContain('data-change-detail-cta="replicate_pattern"');
    expect(html).toContain('data-change-detail-cta-emphasis="primary"');
    expect(html).toContain('data-change-detail-cta="open_recommendation"');
    expect(html).toContain('data-change-detail-cta="open_legacy_detail"');
    expect(html).toContain('data-change-detail-cta="back_to_changes"');
    expect(html).toContain('href="/recommendations/rec-1"');
    expect(html).toContain('href="/changes/some-id?legacy=1"');
  });

  it("Beacon-recommended badge appears when beaconRecommended=true", () => {
    const html = render({ beaconRecommended: true });
    expect(html).toContain('data-change-detail-recommended="true"');
    expect(html).toContain("Beacon recommended");
  });

  it("never leaks forbidden internal vocabulary in the rendered HTML", () => {
    const html = render({
      pill: {
        kind: "too_early",
        label: "Too early",
        tone: "muted",
        blurb: "Beacon is waiting for the post-change window to fill.",
      },
      hypothesis:
        "We predicted Perplexity citations would climb after we shipped the FAQ.",
      hypothesisSource: "operator",
      patternTimingNarrative: "Similar changes usually show signal around day 7.",
      events: [
        {
          kind: "mentions_jumped",
          label: "Mentions jumped",
          summary: "ChatGPT mentions for \"home builders\" climbed from 1 to 5.",
          date: "2026-05-04",
          platformLabel: "ChatGPT",
          tone: "success",
        },
      ],
      sparkline: [
        { date: "2026-05-01", count: 0 },
        { date: "2026-05-04", count: 5 },
      ],
      platformLabels: ["ChatGPT"],
      beaconRecommended: true,
      nextActions: [
        {
          kind: "open_recommendation",
          label: "Open recommendation",
          href: "/recommendations/rec-1",
          emphasis: "primary",
        },
        {
          kind: "back_to_changes",
          label: "Back to changes",
          href: "/changes",
          emphasis: "secondary",
        },
      ],
    });
    const lower = html.toLowerCase();
    const banned = [
      "z-score",
      "evidence tier",
      "evidence_tier",
      "evidence_hash",
      "resolver tier",
      "resolver_tier",
      "lifecycle",
      "decision queue",
      "decision matrix",
      "pattern brain",
      "candidate cause",
      "median_landing_day",
      "first_appearance",
      "visibility_regained",
      "mention_surge",
      "visibility_lost",
      "mention_decline",
      "native observation",
    ];
    for (const term of banned) {
      expect(lower, `rendered HTML leaked '${term}'`).not.toContain(term);
    }
  });
});
