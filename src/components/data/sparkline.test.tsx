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
