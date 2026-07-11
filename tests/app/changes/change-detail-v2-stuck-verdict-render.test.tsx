/**
 * Phase A.3 closeout (2026-05-15), stuck-row end-to-end render proof.
 *
 * Stitches the verdict → diagnostic copy → ChangeDetailV2Client
 * render path for each of the 10 indexability verdicts. Closes the
 * implicit-composition gap between the per-layer unit tests
 * (`tests/domains/indexability/compute-indexability.test.ts`,
 * `tests/domains/citation-lifecycle/render-copy.test.ts`,
 * `tests/domains/citation-lifecycle/load-lifecycle.test.ts`,
 * `tests/app/changes/change-detail-v2-lifecycle.test.tsx`) by
 * asserting end-to-end that each verdict produces its customer-facing
 * copy in the rendered HTML, and that no internal enum literal leaks
 * through.
 *
 * Why this test exists separately from the per-layer ones.
 * As of Phase A.3 closeout no production stuck row has surfaced a
 * non-`ok` verdict (Ritz's 36 owned URLs are all healthy). The
 * customer-facing path is proven compositionally; this file makes the
 * composition explicit so a future drift in any single layer
 * (renderer, lifecycle copy assembly, component) surfaces as a
 * concrete failure here rather than requiring a real stuck row in
 * production to expose the regression.
 *
 * Companion architecture invariant
 * `tests/architecture/citation-lifecycle-stuck-bridge-phrase.test.ts`
 * pins the diagnostic-vs-bridge mutual-exclusion at the source-text
 * level; this test pins the same contract at the rendered-HTML level.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChangeDetailV2Client,
  type ChangeDetailV2Props,
} from "@/app/(shell)/changes/[id]/change-detail-v2-client";
import {
  renderLifecycleCopy,
  type StuckDiagnosticInput,
} from "@/domains/citation-lifecycle/render-copy";
import type { IndexabilityVerdict } from "@/domains/indexability/types";

// ─────────────────────────────────────────────────────────────────────
// Test scaffolding, mirrors the helpers in
// `change-detail-v2-lifecycle.test.tsx`. Re-created locally instead of
// imported so the two test files stay independent (no cross-test
// coupling) and a future refactor of the peer file can't silently
// break this proof.
// ─────────────────────────────────────────────────────────────────────

function baseProps(over: Partial<ChangeDetailV2Props> = {}): ChangeDetailV2Props {
  return {
    title: "Stuck-row verdict proof",
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

/**
 * Build a stuck-stage `ChangeDetailV2Props` whose `lifecycle.copy` is
 * produced by the real `renderLifecycleCopy`, i.e., the exact same
 * function the production loader (`load-lifecycle.ts`) calls. This
 * guarantees the test exercises the production assembly path, not a
 * hand-rolled fixture string.
 */
function stuckProps(stuckDiagnostic: StuckDiagnosticInput): ChangeDetailV2Props {
  return baseProps({
    lifecycle: {
      stage: "stuck",
      isPartialLive: false,
      copy: renderLifecycleCopy({
        stage: "stuck",
        days_since_live: 41,
        days_to_first_citation: null,
        per_platform_first_citation: {
          chatgpt: null,
          perplexity: null,
          google_ai_overviews: null,
        },
        is_partial_live: false,
        was_cited_before_live: false,
        stuck_diagnostic: stuckDiagnostic,
      }),
    },
  });
}

function render(props: ChangeDetailV2Props): string {
  return renderToStaticMarkup(<ChangeDetailV2Client {...props} />);
}

// ─────────────────────────────────────────────────────────────────────
// Per-verdict cases. Expected copy strings mirror the exact output of
// `renderStuckDiagnostic` in
// `src/domains/citation-lifecycle/render-copy.ts:593-641`. When the
// renderer wording changes, BOTH this test and
// `tests/domains/citation-lifecycle/render-copy.test.ts:1086+` must
// move in lockstep, the duplication is intentional belt-and-suspenders
// at the unit and render layers.
// ─────────────────────────────────────────────────────────────────────

type VerdictCase = {
  verdict: IndexabilityVerdict;
  context?: StuckDiagnosticInput["context"];
  expectedCopy: string;
  label: string;
};

const VERDICT_CASES: ReadonlyArray<VerdictCase> = [
  {
    verdict: "ok",
    expectedCopy:
      "This page appears discoverable. Beacon is watching for AI to pick it up.",
    label: "ok, discoverable, watching",
  },
  {
    verdict: "not_in_sitemap",
    expectedCopy: "Beacon did not find this page in your sitemap.xml.",
    label: "not_in_sitemap",
  },
  {
    verdict: "blocked_by_robots_for_googlebot",
    expectedCopy:
      "Your robots.txt appears to block Googlebot from this page.",
    label: "blocked_by_robots_for_googlebot",
  },
  {
    verdict: "blocked_by_robots_for_ai",
    context: { blocked_ai_bots: ["GPTBot", "PerplexityBot"] },
    expectedCopy:
      "Your robots.txt appears to block GPTBot, PerplexityBot from this page.",
    label: "blocked_by_robots_for_ai (with bot names)",
  },
  {
    verdict: "noindex_meta",
    expectedCopy:
      "This page declares noindex in its meta robots tag. AI crawlers will skip it.",
    label: "noindex_meta",
  },
  {
    verdict: "bad_status_code",
    context: { http_status: 404 },
    expectedCopy:
      "This page returns HTTP 404. It may no longer serve content.",
    label: "bad_status_code (HTTP 404)",
  },
  {
    verdict: "canonical_elsewhere",
    context: { canonical_url: "https://ritzbuilders.com/alt-page" },
    expectedCopy:
      "This page declares a canonical to https://ritzbuilders.com/alt-page. Citations may credit that page instead.",
    label: "canonical_elsewhere (with target URL)",
  },
  {
    verdict: "unknown",
    expectedCopy:
      "Beacon has not yet confirmed whether this page is discoverable.",
    label: "unknown",
  },
  // Reserved-for-GSC verdicts. `computeIndexability` does NOT yet
  // produce these (Phase A.3.b1 / GSC integration deferred per Section
  // 4 F-block lock); the renderer carries the forward-compat copy
  // today. This proof asserts the render path works the moment GSC
  // wiring flips them on.
  {
    verdict: "not_indexed_in_gsc",
    expectedCopy:
      "Google Search Console does not confirm this page is indexed.",
    label: "not_indexed_in_gsc (reserved for GSC)",
  },
  {
    verdict: "indexed_but_not_cited",
    expectedCopy:
      "This page is indexed in Google. Beacon is still watching for AI to pick it up.",
    label: "indexed_but_not_cited (reserved for GSC)",
  },
];

// Snake_case verdict enums that MUST NOT appear in rendered customer
// copy. `"ok"` and `"unknown"` are intentionally omitted: both are
// common English words and flagging them would false-positive on
// legitimate prose. The remaining 8 are unambiguous internal
// identifiers that have no excuse to surface in customer-facing text.
const FORBIDDEN_ENUM_TOKENS: ReadonlyArray<string> = [
  "not_in_sitemap",
  "blocked_by_robots_for_ai",
  "blocked_by_robots_for_googlebot",
  "noindex_meta",
  "bad_status_code",
  "canonical_elsewhere",
  "not_indexed_in_gsc",
  "indexed_but_not_cited",
];

// ─────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────

describe("ChangeDetailV2Client, stuck-row diagnostic end-to-end render (Phase A.3 closeout)", () => {
  for (const { verdict, context, expectedCopy, label } of VERDICT_CASES) {
    it(`verdict '${verdict}' renders the expected diagnostic copy (${label})`, () => {
      const html = render(stuckProps({ verdict, context }));
      expect(html).toContain(
        'data-change-detail-act3-lifecycle-diagnostic="true"',
      );
      expect(html).toContain(expectedCopy);
    });
  }
});

describe("ChangeDetailV2Client, stuck-row diagnostic suppresses the bridge sub-line (Phase A.3 closeout)", () => {
  // Pinned at the source level by
  // `tests/architecture/citation-lifecycle-stuck-bridge-phrase.test.ts`;
  // re-pinned here at the rendered-HTML level. A representative non-ok
  // verdict is sufficient, the bridge fallback path is governed by
  // `copy.diagnostic === null`, not by which verdict produced the
  // non-null diagnostic.
  it("renders no bridge sub-line when a verdict diagnostic is rendered", () => {
    const html = render(stuckProps({ verdict: "not_in_sitemap" }));
    expect(html).not.toContain(
      'data-change-detail-act3-lifecycle-bridge="true"',
    );
    expect(html).not.toContain(
      "next bundle will add automated sitemap + robots checks",
    );
  });
});

describe("ChangeDetailV2Client, customer-vocabulary guardrail across all 10 verdicts (Phase A.3 closeout)", () => {
  for (const { verdict, context, label } of VERDICT_CASES) {
    it(`verdict '${verdict}' (${label}) leaks no internal enum identifiers in visible copy`, () => {
      const html = render(stuckProps({ verdict, context }));
      // Strip `data-*` attribute VALUES before scanning. The component
      // emits `data-change-detail-act3-lifecycle-diagnostic="true"`
      // and similar operator-side attributes whose values do not
      // reflect customer-visible text. Removing them isolates the
      // visible-prose surface, which is what the customer-vocab
      // contract actually constrains.
      const visibleOnly = html.replace(/data-[a-z0-9-]+="[^"]*"/g, "");
      for (const token of FORBIDDEN_ENUM_TOKENS) {
        expect(
          visibleOnly,
          `verdict '${verdict}' render leaked internal enum '${token}' in visible copy`,
        ).not.toContain(token);
      }
    });
  }
});
