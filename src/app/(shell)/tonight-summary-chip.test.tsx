/**
 * TonightSummaryChip (FP5a, 2026-07-02) - render pins for the ONE line /changes
 * shows about tonight's batch, replacing the full DailyExperimentsSection that used
 * to render verbatim on BOTH / and /changes (the duplicate-home killer finding).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TonightSummaryChip } from "./tonight-summary-chip";

describe("TonightSummaryChip", () => {
  it("renders the one-line summary with both FP3 counts and the link home", () => {
    const html = renderToStaticMarkup(<TonightSummaryChip picked={6} applied={6} />);
    expect(html).toContain("Tonight: 6 picked, 6 applied.");
    expect(html).toContain("See them on Today");
    expect(html).toContain('href="/"');
  });

  it("shows a partially applied batch honestly", () => {
    const html = renderToStaticMarkup(<TonightSummaryChip picked={5} applied={2} />);
    expect(html).toContain("Tonight: 5 picked, 2 applied.");
  });

  it("self-hides when nothing is picked (no bare-zero chip)", () => {
    expect(renderToStaticMarkup(<TonightSummaryChip picked={0} applied={0} />)).toBe("");
  });

  it("never emits an em or en dash", () => {
    const html = renderToStaticMarkup(<TonightSummaryChip picked={3} applied={1} />);
    expect(html).not.toMatch(/[–—]/);
  });
});
