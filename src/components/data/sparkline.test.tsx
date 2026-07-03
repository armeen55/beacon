// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline, type SparkPoint } from "./sparkline";

function series(days: number, start = "2026-06-01"): SparkPoint[] {
  const out: SparkPoint[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push({ date: d.toISOString().slice(0, 10), clicks: (i * 7) % 5 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("Sparkline (items 4+5)", () => {
  it("renders nothing under 5 points (no misleading micro-charts)", () => {
    expect(renderToStaticMarkup(<Sparkline points={series(4)} />)).toBe("");
  });

  it("renders a line without marker artifacts when no markerDate", () => {
    const html = renderToStaticMarkup(<Sparkline points={series(10)} />);
    expect(html).toContain("<path");
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("<rect");
  });

  it("marks a ship date inside the series with a dot + after-tint", () => {
    const html = renderToStaticMarkup(<Sparkline points={series(10)} markerDate="2026-06-05" />);
    expect(html).toContain("<circle");
    expect(html).toContain("<rect");
  });

  it("shows NO dot when the ship date is newer than the last data day (GSC lag honesty)", () => {
    const html = renderToStaticMarkup(<Sparkline points={series(10)} markerDate="2026-07-01" />);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("<rect");
  });

  it("marks the first day when the change predates the whole series", () => {
    const html = renderToStaticMarkup(<Sparkline points={series(10)} markerDate="2026-05-01" />);
    expect(html).toContain("<circle");
  });
});

// ── R14b named controls: dashed comparison series on the same chart ──

const days = (clicks: number[]): SparkPoint[] =>
  clicks.map((c, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, clicks: c }));

describe("Sparkline comparisons (R14b)", () => {
  it("renders one dashed path per comparison series and names them in the aria-label", () => {
    const html = renderToStaticMarkup(
      <Sparkline
        points={days([1, 2, 3, 4, 5, 6])}
        comparisons={[{ points: days([2, 2, 2, 2, 2, 2]) }, { points: days([1, 1, 1, 1, 1, 1]) }]}
      />,
    );
    expect(html.match(/data-comparison-series="true"/g)).toHaveLength(2);
    expect(html).toContain('stroke-dasharray="3 3"');
    expect(html).toContain("with 2 comparison pages dashed");
  });

  it("keeps the plain aria-label and no dashed paths without comparisons", () => {
    const html = renderToStaticMarkup(<Sparkline points={days([1, 2, 3, 4, 5, 6])} />);
    expect(html).not.toContain("data-comparison-series");
    expect(html).toContain("Clicks per day, last 6 days");
  });

  it("drops too-short comparison series instead of drawing misleading stubs", () => {
    const html = renderToStaticMarkup(
      <Sparkline points={days([1, 2, 3, 4, 5, 6])} comparisons={[{ points: days([9, 9]) }]} />,
    );
    expect(html).not.toContain("data-comparison-series");
  });

  it("shares one y scale: a taller comparison series rescales the main line", () => {
    const alone = renderToStaticMarkup(<Sparkline points={days([1, 1, 1, 1, 1, 10])} />);
    const withTallComparison = renderToStaticMarkup(
      <Sparkline
        points={days([1, 1, 1, 1, 1, 10])}
        comparisons={[{ points: days([20, 20, 20, 20, 20, 20]) }]}
      />,
    );
    // same data, different shared max -> the MAIN path (always rendered last,
    // after the dashed comparisons) must change its d attribute
    const mainDOf = (html: string) => [...html.matchAll(/d="(M[^"]+)"/g)].at(-1)?.[1];
    expect(mainDOf(withTallComparison)).not.toBe(mainDOf(alone));
  });
});
