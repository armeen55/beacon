import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TodayMetricsDisclosure } from "./today-metrics-disclosure";

describe("TodayMetricsDisclosure SSR contract", () => {
  it("defaults to closed (no metrics children rendered)", () => {
    const html = renderToStaticMarkup(
      <TodayMetricsDisclosure>
        <div data-testid="hidden-metric">visibility chart</div>
      </TodayMetricsDisclosure>,
    );
    expect(html).toContain('data-today-metrics-disclosure="closed"');
    // SSR pre-hydration: children should be hidden.
    expect(html).not.toContain('data-today-metrics-content');
    expect(html).not.toContain("visibility chart");
  });

  it("the disclosure heading is operator-friendly", () => {
    const html = renderToStaticMarkup(
      <TodayMetricsDisclosure>
        <div />
      </TodayMetricsDisclosure>,
    );
    expect(html).toContain("Today");
    expect(html).toContain("metrics");
    expect(html).toContain("visibility");
    expect(html).toContain("competitor");
  });

  it("renders an aria-expanded button on the toggle", () => {
    const html = renderToStaticMarkup(
      <TodayMetricsDisclosure>
        <div />
      </TodayMetricsDisclosure>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('type="button"');
  });

  it("when defaultOpen=true, children render and disclosure is marked open (test-only override)", () => {
    const html = renderToStaticMarkup(
      <TodayMetricsDisclosure defaultOpen>
        <div data-testid="visible-metric">visibility chart</div>
      </TodayMetricsDisclosure>,
    );
    expect(html).toContain('data-today-metrics-disclosure="open"');
    expect(html).toContain("visibility chart");
    expect(html).toContain('data-today-metrics-content');
  });
});
