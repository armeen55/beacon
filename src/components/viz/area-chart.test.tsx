/**
 * AreaChart — accessible data-table fallback (UX_TEARDOWN #367).
 *
 * The SVG points are mouse-only (the hover row never fires for keyboard /
 * screen-reader users), so the chart now renders a visually-hidden <table>
 * exposing every date/value pair. These tests pin:
 *   1. A sr-only data table is emitted with one column per series.
 *   2. Every label (row header) and every datum appears in the table.
 *   3. No table renders when there is nothing to plot.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AreaChart } from "./area-chart";

const SERIES = [
  { label: "You", data: [10, 20, 30], color: "stroke-accent-primary" },
  { label: "Rival", data: [5, 15, 25], color: "stroke-muted-foreground" },
];
const LABELS = ["Jun 1", "Jun 2", "Jun 3"];

describe("AreaChart accessible data table (#367)", () => {
  it("renders an sr-only data table with one column per series", () => {
    const html = renderToStaticMarkup(
      <AreaChart series={SERIES} labels={LABELS} responsive={false} />,
    );
    expect(html).toContain('data-area-chart-data-table="true"');
    expect(html).toContain("sr-only");
    // Column headers (Date + each series label).
    expect(html).toContain(">Date</th>");
    expect(html).toContain(">You</th>");
    expect(html).toContain(">Rival</th>");
  });

  it("includes every label and every datum", () => {
    const html = renderToStaticMarkup(
      <AreaChart series={SERIES} labels={LABELS} responsive={false} />,
    );
    for (const l of LABELS) {
      expect(html).toContain(`>${l}</th>`);
    }
    for (const v of [10, 20, 30, 5, 15, 25]) {
      expect(html).toContain(`>${v}</td>`);
    }
  });

  it("renders no data table when there is nothing to plot", () => {
    const html = renderToStaticMarkup(
      <AreaChart series={[]} labels={[]} responsive={false} />,
    );
    expect(html).not.toContain("data-area-chart-data-table");
  });

  it("plots repeated labels at their own indexes instead of the first match", () => {
    const html = renderToStaticMarkup(
      <AreaChart
        series={[{ label: "You", data: [10, 20, 30], color: "stroke-accent-primary" }]}
        labels={["Jun 1", "Jun 1", "Jun 2"]}
        responsive={false}
      />,
    );

    expect(html).toContain('<text x="6" y="216" text-anchor="start"');
    expect(html).toContain('<text x="200" y="216" text-anchor="middle"');
  });
});
