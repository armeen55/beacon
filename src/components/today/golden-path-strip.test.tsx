/**
 * MAX_SEO_AEO Phase 6 (final) — Golden Path strip render test.
 *
 * Pins the presentational contract (renderToStaticMarkup, no behavior to
 * drive): all five steps render in loop order, the CURRENT step is marked +
 * highlighted and carries a primary CTA that links to the existing control,
 * non-current steps carry NO CTA, done shows a check, blocked shows the amber
 * treatment, and the step details render verbatim from the composed state.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { GoldenPathStrip } from "./golden-path-strip";
import type { GoldenPathState } from "@/domains/today/golden-path";

function stateWithCurrent(currentStepKey: GoldenPathState["currentStepKey"]): GoldenPathState {
  return {
    connectedAnySource: true,
    currentStepKey,
    steps: [
      {
        key: "refresh",
        label: "Refresh",
        status: "done",
        detail: "Your data is up to date.",
      },
      {
        key: "review",
        label: "Review",
        status: "current",
        detail: "3 recommendations to review.",
        count: 3,
      },
      {
        key: "approve",
        label: "Approve",
        status: "upcoming",
        detail: "Approved changes you publish show up here.",
        count: 0,
      },
      {
        key: "verify",
        label: "Verify",
        status: "upcoming",
        detail: "Published changes confirm live here.",
        count: 0,
      },
      {
        key: "learn",
        label: "Learn",
        status: "upcoming",
        detail: "Proof appears after your changes go live.",
      },
    ],
  };
}

describe("GoldenPathStrip", () => {
  it("renders all five steps in loop order with their labels + details", () => {
    const html = renderToStaticMarkup(
      <GoldenPathStrip state={stateWithCurrent("review")} />,
    );
    for (const label of ["Refresh", "Review", "Approve", "Verify", "Learn"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("3 recommendations to review.");
    // Loop order: refresh's marker precedes learn's in the document.
    expect(html.indexOf('data-golden-path-step="refresh"')).toBeLessThan(
      html.indexOf('data-golden-path-step="learn"'),
    );
  });

  it("marks the current step + gives it a CTA linking to the existing control", () => {
    const html = renderToStaticMarkup(
      <GoldenPathStrip state={stateWithCurrent("review")} />,
    );
    expect(html).toContain('data-golden-path-current="true"');
    // The current step (review) deep-links to the review queue.
    expect(html).toContain('href="/recommendations"');
    expect(html).toContain("Review recommendations");
  });

  it("does not render a CTA for non-current steps", () => {
    const html = renderToStaticMarkup(
      <GoldenPathStrip state={stateWithCurrent("review")} />,
    );
    // Only ONE current marker → only one CTA link in the strip.
    const ctaCount = (html.match(/→<\/a>|→ *<\/a>/g) ?? []).length;
    // The header arrow is plain text, not an anchor; count anchor CTAs.
    const anchorCount = (html.match(/<a /g) ?? []).length;
    expect(anchorCount).toBe(1);
    expect(ctaCount).toBeGreaterThanOrEqual(0); // arrow presence is incidental
  });

  it("shows a check for done steps", () => {
    const html = renderToStaticMarkup(
      <GoldenPathStrip state={stateWithCurrent("review")} />,
    );
    // refresh is done → its badge renders ✓ (not its number).
    const refreshIdx = html.indexOf('data-golden-path-step="refresh"');
    // The badge glyph follows the badge span's class attributes, so slice
    // generously to the next step's marker.
    const reviewIdx = html.indexOf('data-golden-path-step="review"');
    const refreshSlice = html.slice(refreshIdx, reviewIdx);
    expect(refreshSlice).toContain("✓");
  });

  it("renders the blocked step with a status marker and the connect detail", () => {
    const blocked = stateWithCurrent("refresh");
    blocked.steps[0] = {
      key: "refresh",
      label: "Refresh",
      status: "blocked",
      detail: "Connect a data source to begin.",
    };
    blocked.connectedAnySource = false;
    const html = renderToStaticMarkup(<GoldenPathStrip state={blocked} />);
    expect(html).toContain('data-golden-path-status="blocked"');
    expect(html).toContain("Connect a data source to begin.");
    // The blocked refresh is the focus → it carries the refresh CTA.
    expect(html).toContain('href="/settings/connectors"');
  });

  it("links each step's CTA to its built control when current", () => {
    const cases: Array<[GoldenPathState["currentStepKey"], string]> = [
      ["refresh", "/settings/connectors"],
      ["review", "/recommendations"],
      ["approve", "/recommendations?status=accepted"],
      ["verify", "/changes"],
      ["learn", "/changes"],
    ];
    for (const [key, href] of cases) {
      const state = stateWithCurrent(key);
      // Make the chosen step actually current.
      state.steps = state.steps.map((s) =>
        s.key === key
          ? { ...s, status: "current" as const }
          : { ...s, status: "upcoming" as const },
      );
      const html = renderToStaticMarkup(<GoldenPathStrip state={state} />);
      expect(html).toContain(`href="${href}"`);
    }
  });
});
