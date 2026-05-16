/**
 * /changes/[id] proof-brief — Section 6 C6b primary-recommendation
 * evidence Act 3 render contract.
 *
 * Pins:
 *   • `primaryEvidenceLines` omitted / null / empty → NO wrapper.
 *   • Mode A pass / still_learning lines render verbatim.
 *   • Multiple lines render in array order.
 *   • Lifecycle + primary evidence both present → lifecycle first.
 *   • Lifecycle null + primary evidence present → primary still renders.
 *   • Forbidden customer vocabulary never appears INSIDE the new
 *     primary-evidence wrapper (scoped scan — not full page).
 *
 * Server-rendered via `renderToStaticMarkup`. No DOM required.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeDetailV2Client } from "@/app/(shell)/changes/[id]/change-detail-v2-client";
import type { ChangeDetailV2Props } from "@/app/(shell)/changes/[id]/change-detail-v2-client";

function baseProps(over: Partial<ChangeDetailV2Props> = {}): ChangeDetailV2Props {
  return {
    title: "Primary-evidence render test",
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
 * Extract the rendered substring INSIDE the
 * `data-change-detail-act3-primary-evidence="true"` wrapper, or `null`
 * when the wrapper is absent. Keeps the forbidden-vocab scan scoped
 * to C6b's surface and avoids false positives from unrelated page
 * copy.
 */
function extractEvidenceWrapper(html: string): string | null {
  const startTag = 'data-change-detail-act3-primary-evidence="true"';
  const startIdx = html.indexOf(startTag);
  if (startIdx < 0) return null;
  // Walk forward from the start tag, balancing <div>/</div> nesting.
  // The wrapper itself is a <div>. Find the position of the opening
  // bracket of the START tag, then walk depth-first to its matching
  // close tag.
  let openLt = html.lastIndexOf("<", startIdx);
  if (openLt < 0) return null;
  let depth = 0;
  let i = openLt;
  while (i < html.length) {
    if (html.startsWith("<div", i)) {
      depth += 1;
      const close = html.indexOf(">", i);
      if (close < 0) return null;
      i = close + 1;
      continue;
    }
    if (html.startsWith("</div>", i)) {
      depth -= 1;
      i += "</div>".length;
      if (depth === 0) {
        return html.slice(openLt, i);
      }
      continue;
    }
    i += 1;
  }
  return null;
}

describe("Section 6 C6b — primary-recommendation evidence rendering", () => {
  it("primaryEvidenceLines omitted → no wrapper", () => {
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client {...baseProps()} />,
    );
    expect(html).not.toContain("data-change-detail-act3-primary-evidence");
  });

  it("primaryEvidenceLines=null → no wrapper", () => {
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: null })}
      />,
    );
    expect(html).not.toContain("data-change-detail-act3-primary-evidence");
  });

  it("primaryEvidenceLines=[] → no wrapper", () => {
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: [] })}
      />,
    );
    expect(html).not.toContain("data-change-detail-act3-primary-evidence");
  });

  it("single Mode A pass line renders verbatim", () => {
    const line =
      "In 5 of 8 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: [line] })}
      />,
    );
    expect(html).toContain('data-change-detail-act3-primary-evidence="true"');
    expect(html).toContain('data-change-detail-act3-primary-evidence-line="0"');
    expect(html).toContain(line);
  });

  it("single Mode A still_learning line renders verbatim", () => {
    const line =
      "This page has been cited a few times since it went live — not enough answers yet to read primary-recommendation evidence.";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: [line] })}
      />,
    );
    expect(html).toContain(line);
  });

  it("two lines render in array order with stable line indices", () => {
    const lineA =
      "In 5 of 8 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.";
    const lineB =
      "On ChatGPT, primary-recommendation share on the prompts this change targeted was up 20 points in the first 14 days after going live versus the prior 14 (50% → 70%).";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: [lineA, lineB] })}
      />,
    );
    const idxA = html.indexOf(lineA);
    const idxB = html.indexOf(lineB);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
    expect(html).toContain('data-change-detail-act3-primary-evidence-line="0"');
    expect(html).toContain('data-change-detail-act3-primary-evidence-line="1"');
  });

  it("three lines render in array order", () => {
    const lineA =
      "In 5 of 8 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.";
    const lineB =
      "On ChatGPT, primary-recommendation share on the prompts this change targeted was up 20 points in the first 14 days after going live versus the prior 14 (50% → 70%).";
    const lineC =
      "On Perplexity, primary-recommendation share on the prompts this change targeted was up 15 points in the first 14 days after going live versus the prior 14 (40% → 55%).";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: [lineA, lineB, lineC] })}
      />,
    );
    const idxA = html.indexOf(lineA);
    const idxB = html.indexOf(lineB);
    const idxC = html.indexOf(lineC);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);
    expect(html).toContain('data-change-detail-act3-primary-evidence-line="2"');
  });

  it("single collapsed Mode B still_learning line renders without leaking 'Mode B'", () => {
    const line =
      "Beacon is still gathering 14 days of post-launch evidence on the prompts this change targeted.";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: [line] })}
      />,
    );
    const wrapper = extractEvidenceWrapper(html);
    expect(wrapper).not.toBeNull();
    expect(wrapper!).toContain(line);
    expect(wrapper!).not.toContain("Mode B");
  });

  it("lifecycle present + primaryEvidenceLines present → lifecycle renders first, primary evidence below", () => {
    const lifecycleProp: ChangeDetailV2Props["lifecycle"] = {
      stage: "cited_typical",
      isPartialLive: false,
      copy: {
        primary: "Cited 8 days after going live — within Beacon's typical window.",
        per_platform: null,
        diagnostic: null,
        bridge: null,
        before_live_note: null,
      },
    };
    const evidenceLine =
      "In 5 of 8 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({
          lifecycle: lifecycleProp,
          primaryEvidenceLines: [evidenceLine],
        })}
      />,
    );
    const lifecycleIdx = html.indexOf("data-change-detail-act3-lifecycle=");
    const evidenceIdx = html.indexOf(
      "data-change-detail-act3-primary-evidence=",
    );
    expect(lifecycleIdx).toBeGreaterThanOrEqual(0);
    expect(evidenceIdx).toBeGreaterThan(lifecycleIdx);
  });

  it("lifecycle null + primaryEvidenceLines present → primary evidence still renders", () => {
    const evidenceLine =
      "In 5 of 8 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.";
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({
          lifecycle: null,
          primaryEvidenceLines: [evidenceLine],
        })}
      />,
    );
    expect(html).not.toContain("data-change-detail-act3-lifecycle=");
    expect(html).toContain('data-change-detail-act3-primary-evidence="true"');
    expect(html).toContain(evidenceLine);
  });

  it("forbidden customer vocabulary never appears INSIDE the primary-evidence wrapper", () => {
    // Build a wrapper rendered from the four representative copy
    // shapes the C6a renderer can emit. The scan extracts ONLY the
    // wrapper substring (not the full page) so it can't false-
    // positive on unrelated existing page copy.
    const lines = [
      "In 5 of 8 answers that cited this page, the AI selected Ritz Builders as the main recommended option since this went live.",
      "This page has been cited a few times since it went live — not enough answers yet to read primary-recommendation evidence.",
      "On ChatGPT, primary-recommendation share on the prompts this change targeted was up 20 points in the first 14 days after going live versus the prior 14 (50% → 70%).",
      "On Perplexity, primary-recommendation share on the prompts this change targeted was up 15 points in the first 14 days after going live versus the prior 14 (40% → 55%).",
      "Beacon is still gathering 14 days of post-launch evidence on the prompts this change targeted.",
    ];
    const html = renderToStaticMarkup(
      <ChangeDetailV2Client
        {...baseProps({ primaryEvidenceLines: lines })}
      />,
    );
    const wrapper = extractEvidenceWrapper(html);
    expect(wrapper).not.toBeNull();
    const FORBIDDEN: ReadonlyArray<string> = [
      "drove",
      "caused",
      "generated",
      " made ",
      "led to",
      "revenue",
      "dollars",
      "$",
      "sales",
      "leads",
      "Mode A",
      "Mode B",
      "Mode C",
      "primary_recommendation_count",
      "total_possible",
      "scope_type",
      "claimable",
      "still_learning",
    ];
    const lowered = wrapper!.toLowerCase();
    for (const phrase of FORBIDDEN) {
      expect(
        lowered.includes(phrase.toLowerCase()),
        `Forbidden phrase "${phrase}" leaked into the primary-evidence wrapper`,
      ).toBe(false);
    }
  });
});
