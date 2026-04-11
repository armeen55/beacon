/**
 * Geographic View Model — transforms geo coverage into chart-ready props.
 */

import type { BarChartProps, CoverageCell, ComparisonProps, KpiProps } from "@/components/viz/chart-types";
import type { GeoCoverageIndex, CityCoverage } from "@/domains/geo/types";

export function geoKpis(coverage: GeoCoverageIndex): KpiProps[] {
  const summary = {
    strong: coverage.cities.filter((c) => c.coverage_status === "strong").length,
    moderate: coverage.cities.filter((c) => c.coverage_status === "moderate").length,
    weak: coverage.cities.filter((c) => c.coverage_status === "weak").length,
    absent: coverage.cities.filter((c) => c.coverage_status === "absent").length,
  };

  return [
    { label: "Markets", value: coverage.total_cities },
    { label: "Strong", value: summary.strong, meta: summary.moderate > 0 ? `${summary.moderate} moderate` : undefined },
    { label: "Gaps", value: coverage.gaps.length, meta: summary.absent > 0 ? `${summary.absent} absent` : undefined },
    {
      label: "Concentration",
      value: coverage.concentration.assessment === "healthy" ? "Healthy"
        : coverage.concentration.assessment === "concentrated" ? "Moderate" : "High",
      meta: coverage.concentration.top_city
        ? `${coverage.concentration.top_city}: ${coverage.concentration.top_city_pct}%`
        : undefined,
    },
  ];
}

export function cityCoverageCells(cities: CityCoverage[]): CoverageCell[] {
  return cities.map((c) => ({
    label: c.city,
    status: c.coverage_status,
    value: c.owned_citations,
    meta: `${c.owned_pages} owned, ${c.competitor_pages} competitor pages. Share: ${c.share_pct !== null ? `${c.share_pct}%` : "—"}`,
  }));
}

export function cityCitationBars(cities: CityCoverage[]): BarChartProps {
  return {
    entries: cities
      .filter((c) => c.owned_citations > 0)
      .slice(0, 8)
      .map((c) => ({
        label: c.city.replace(/\b\w/g, (ch) => ch.toUpperCase()),
        value: c.owned_citations,
        secondaryValue: c.competitor_citations,
        color: c.coverage_status === "strong" ? "bg-status-success"
          : c.coverage_status === "moderate" ? "bg-accent-primary" : "bg-status-warning",
        meta: `Share: ${c.share_pct !== null ? `${c.share_pct}%` : "—"} · ${c.owned_pages} owned · ${c.competitor_pages} competitor`,
      })),
    title: "Owned citations by city",
    subtitle: "Hover for details",
  };
}

export function cityComparisonBars(cities: CityCoverage[]): ComparisonProps {
  return {
    entries: cities
      .filter((c) => c.owned_citations > 0 || c.competitor_citations > 0)
      .slice(0, 8)
      .map((c) => ({
        label: c.city.replace(/\b\w/g, (ch) => ch.toUpperCase()),
        ownedValue: c.owned_citations,
        competitorValue: c.competitor_citations,
        meta: `${c.owned_pages} owned pages, ${c.competitor_pages} competitor pages`,
      })),
    ownedLabel: "You",
    competitorLabel: "Competitors",
  };
}
