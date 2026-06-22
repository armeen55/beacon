import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "./sparkline";

describe("Sparkline — W2 Step 2.3", () => {
  it("renders an SVG path when points have at least one finite value", () => {
    const html = renderToStaticMarkup(
      <Sparkline points={[0.1, 0.2, 0.3, 0.4]} />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
    expect(html).toContain("<circle"); // latest-point dot
  });

  it("renders a placeholder when given an empty array", () => {
    const html = renderToStaticMarkup(<Sparkline points={[]} />);
    expect(html).not.toContain("<svg");
    expect(html).toContain("-");
  });

  it("treats null entries as gaps (no path through null)", () => {
    // With null in the middle, the path should split into two M-segments.
    const html = renderToStaticMarkup(
      <Sparkline points={[0.1, null, 0.5]} width={60} height={16} />,
    );
    expect(html).toContain("<path");
    // Two move-to commands (M ...) one for each side of the gap.
    const moveCount = (html.match(/M /g) || []).length;
    expect(moveCount).toBe(2);
  });

  it("clamps values into [0, 1] (no off-canvas rendering for stray > 1)", () => {
    const html = renderToStaticMarkup(<Sparkline points={[1.5, -0.2]} />);
    // Both points should render with y at the canvas edges (0 or height),
    // never NaN / negative coords. Spot-check the path doesn't contain
    // negative numbers in coords.
    const pathMatch = html.match(/d="([^"]+)"/);
    expect(pathMatch).toBeTruthy();
    expect(pathMatch![1]).not.toMatch(/-\d/);
  });

  it("respects a custom aria-label", () => {
    const html = renderToStaticMarkup(
      <Sparkline points={[0.5]} ariaLabel="Perplexity primary rate trend" />,
    );
    expect(html).toContain("Perplexity primary rate trend");
  });
});
