/**
 * 2026-06-15 — AllSourceStatRow / StatSparkline render contract.
 *
 * Pins the daily-clicks momentum sparkline on the Search card:
 *   • A GSC card carrying `sparkline` renders the inline <svg> with a
 *     path and the sr-only "Daily clicks trend over 90 days" summary,
 *     and the graphic is aria-hidden (decorative).
 *   • A card WITHOUT `sparkline` renders no sparkline markup.
 *   • The SVG carries no axis text (no fake precision) and no vendor /
 *     automation copy (the today dir is honesty-guarded).
 *
 * Server-rendered via renderToStaticMarkup — the component is a server
 * component with zero client JS.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AllSourceStatRow } from "@/components/today/all-source-stat-row";
import type { SourceStatCard } from "@/domains/today-summary/build-source-stat-cards";

function gscCard(over: Partial<SourceStatCard> = {}): SourceStatCard {
  return {
    key: "gsc",
    source: "Search (Google)",
    stats: [
      { label: "Clicks (90d)", value: "1,000" },
      { label: "Impressions", value: "50K" },
    ],
    subline: null,
    ...over,
  };
}

describe("AllSourceStatRow — Search-card sparkline", () => {
  it("renders the inline sparkline svg + sr-only summary when the card carries a series", () => {
    const series = Array.from({ length: 30 }, (_, i) => 10 + i);
    const html = renderToStaticMarkup(
      <AllSourceStatRow cards={[gscCard({ sparkline: series })]} />,
    );
    expect(html).toContain('data-stat-sparkline="true"');
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
    // Decorative graphic, meaning carried by the sr-only line.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Daily clicks trend over 90 days");
  });

  it("renders NO sparkline markup when the card has no series", () => {
    const html = renderToStaticMarkup(
      <AllSourceStatRow cards={[gscCard()]} />,
    );
    expect(html).not.toContain("data-stat-sparkline");
    expect(html).not.toContain("Daily clicks trend over 90 days");
  });

  it("has no axis text and no vendor/automation copy (honest, on-brand)", () => {
    const series = Array.from({ length: 30 }, (_, i) => 10 + i);
    const html = renderToStaticMarkup(
      <AllSourceStatRow cards={[gscCard({ sparkline: series })]} />,
    );
    // The sparkline is axis-free: no <text> elements inside it.
    const sparkStart = html.indexOf('data-stat-sparkline');
    const sparkSlice = html.slice(sparkStart, sparkStart + 600);
    expect(sparkSlice).not.toContain("<text");
    // Honesty / white-label guards.
    expect(html).not.toMatch(/profound/i);
    expect(html).not.toMatch(/automat/i);
  });
});
