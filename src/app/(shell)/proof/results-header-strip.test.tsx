/**
 * ResultsHeaderStrip (FP3, 2026-07-02) - render pins for the Results page's one-line
 * count strip. The three numbers come from the same splitLedgerLifecycle rule that
 * builds the Wins / What we learned / In flight bands, so total = decided + measuring
 * always equals the number of rows on the page.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultsHeaderStrip } from "./results-header-strip";

describe("ResultsHeaderStrip", () => {
  it("renders the shipped total, the decided count with wins, and the measuring count", () => {
    const html = renderToStaticMarkup(<ResultsHeaderStrip measuring={16} decided={9} won={3} />);
    expect(html).toContain(
      "You have shipped 25 changes. 9 have a final read (3 wins), and 16 are still measuring below.",
    );
  });

  it("handles the singular forms", () => {
    const html = renderToStaticMarkup(<ResultsHeaderStrip measuring={1} decided={1} won={1} />);
    expect(html).toContain("You have shipped 2 changes. 1 has a final read (1 win), and 1 is still measuring below.");
  });

  it("self-hides when nothing has shipped", () => {
    expect(renderToStaticMarkup(<ResultsHeaderStrip measuring={0} decided={0} won={0} />)).toBe("");
  });

  it("never emits an em or en dash", () => {
    const html = renderToStaticMarkup(<ResultsHeaderStrip measuring={4} decided={2} won={1} />);
    expect(html).not.toMatch(/[–—]/);
  });
});
