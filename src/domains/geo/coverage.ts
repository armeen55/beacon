/**
 * Geographic Coverage Intelligence — local visibility analysis.
 *
 * Computes city-level coverage from pages, citations, and prompts.
 * Identifies gaps, concentration risk, and competitor pressure.
 *
 * Conservative: if data is thin, says so. No fake precision.
 */

import "server-only";

import type { PageEntity, CitationPageRollup } from "@/domains/pages/types";
import type { LibraryPrompt } from "@/domains/prompts/types";
import type {
  CityCoverage,
  GeoCoverageIndex,
  GeoConcentration,
  GeoGap,
  GeoHeatEntry,
  GeoHeatMap,
} from "./types";
import { normalizeCity, isRegionTerm } from "./normalize";

const MIN_COMPETITOR_PAGES_FOR_GAP = 5;
const MIN_CITATIONS_FOR_SHARE = 3;

/**
 * Compute geographic coverage index from current Beacon data.
 */
export function computeGeoCoverage(
  allPages: PageEntity[],
  citationRollups: CitationPageRollup[],
  prompts: LibraryPrompt[],
): GeoCoverageIndex {
  const cityData = new Map<string, {
    ownedPages: number;
    ownedCitations: number;
    competitorPages: number;
    competitorCitations: number;
    promptCount: number;
  }>();

  function ensureCity(city: string) {
    if (!cityData.has(city)) {
      cityData.set(city, {
        ownedPages: 0,
        ownedCitations: 0,
        competitorPages: 0,
        competitorCitations: 0,
        promptCount: 0,
      });
    }
    return cityData.get(city)!;
  }

  // Count pages by city
  for (const page of allPages) {
    const rawCity = (page.city ?? "").trim();
    if (!rawCity) continue;
    const norm = normalizeCity(rawCity);
    if (isRegionTerm(norm.canonical)) continue;

    const data = ensureCity(norm.canonical);
    if (page.is_owned) {
      data.ownedPages++;
    } else {
      data.competitorPages++;
    }
  }

  // Count citations by city via page-to-city mapping
  const pageCityMap = new Map<string, string>();
  for (const page of allPages) {
    const rawCity = (page.city ?? "").trim();
    if (!rawCity) continue;
    const norm = normalizeCity(rawCity);
    if (isRegionTerm(norm.canonical)) continue;
    pageCityMap.set(page.url.replace(/\/+$/, "").toLowerCase(), norm.canonical);
  }

  for (const rollup of citationRollups) {
    const normUrl = rollup.page_url.replace(/\/+$/, "").toLowerCase();
    const city = pageCityMap.get(normUrl);
    if (!city) continue;
    const data = ensureCity(city);
    if (rollup.is_owned) {
      data.ownedCitations += rollup.total_citations;
    } else {
      data.competitorCitations += rollup.total_citations;
    }
  }

  // Count prompts by city
  for (const p of prompts) {
    const rawCity = (p.city ?? "").trim();
    if (!rawCity) continue;
    const norm = normalizeCity(rawCity);
    if (isRegionTerm(norm.canonical)) continue;
    const data = ensureCity(norm.canonical);
    data.promptCount++;
  }

  // Build city coverage entries
  const cities: CityCoverage[] = [];
  for (const [city, data] of cityData) {
    const totalCit = data.ownedCitations + data.competitorCitations;
    const sharePct = totalCit >= MIN_CITATIONS_FOR_SHARE
      ? Math.round((data.ownedCitations / totalCit) * 100)
      : null;

    let status: CityCoverage["coverage_status"];
    if (data.ownedPages === 0 && data.ownedCitations === 0) {
      status = "absent";
    } else if (data.ownedCitations >= 50 || (sharePct !== null && sharePct >= 30)) {
      status = "strong";
    } else if (data.ownedCitations >= 10 || data.ownedPages >= 2) {
      status = "moderate";
    } else {
      status = "weak";
    }

    cities.push({
      city,
      owned_pages: data.ownedPages,
      owned_citations: data.ownedCitations,
      competitor_pages: data.competitorPages,
      competitor_citations: data.competitorCitations,
      prompt_count: data.promptCount,
      share_pct: sharePct,
      coverage_status: status,
    });
  }

  cities.sort((a, b) => b.owned_citations - a.owned_citations || b.owned_pages - a.owned_pages);

  const concentration = computeConcentration(cities);
  const gaps = computeGaps(cities);

  return {
    computed_at: new Date().toISOString(),
    total_cities: cities.length,
    cities,
    concentration,
    gaps,
  };
}

function computeConcentration(cities: CityCoverage[]): GeoConcentration {
  const totalOwnedCit = cities.reduce((s, c) => s + c.owned_citations, 0);
  if (totalOwnedCit < 10) {
    return {
      top_city: null,
      top_city_pct: null,
      top_3_pct: null,
      hhi: null,
      assessment: "insufficient_data",
      explanation: "Not enough owned citation data to assess geographic concentration.",
    };
  }

  const sorted = [...cities].sort((a, b) => b.owned_citations - a.owned_citations);
  const topCity = sorted[0];
  const topCityPct = Math.round((topCity.owned_citations / totalOwnedCit) * 100);
  const top3Cit = sorted.slice(0, 3).reduce((s, c) => s + c.owned_citations, 0);
  const top3Pct = Math.round((top3Cit / totalOwnedCit) * 100);

  // Herfindahl-Hirschman Index (simplified, 0-10000 scale)
  let hhi = 0;
  for (const c of cities) {
    if (c.owned_citations === 0) continue;
    const share = (c.owned_citations / totalOwnedCit) * 100;
    hhi += share * share;
  }
  hhi = Math.round(hhi);

  let assessment: GeoConcentration["assessment"];
  let explanation: string;
  if (hhi >= 5000 || topCityPct >= 70) {
    assessment = "highly_concentrated";
    explanation = `${topCityPct}% of owned citations come from ${topCity.city}. Geographic visibility is heavily concentrated.`;
  } else if (hhi >= 2500 || topCityPct >= 45) {
    assessment = "concentrated";
    explanation = `Top 3 cities account for ${top3Pct}% of owned citations. Some geographic diversification could reduce risk.`;
  } else {
    assessment = "healthy";
    explanation = `Owned citations are distributed across ${cities.filter((c) => c.owned_citations > 0).length} cities with reasonable balance.`;
  }

  return {
    top_city: topCity.city,
    top_city_pct: topCityPct,
    top_3_pct: top3Pct,
    hhi,
    assessment,
    explanation,
  };
}

function computeGaps(cities: CityCoverage[]): GeoGap[] {
  const gaps: GeoGap[] = [];

  for (const c of cities) {
    if (c.coverage_status === "absent" && c.competitor_pages >= MIN_COMPETITOR_PAGES_FOR_GAP) {
      gaps.push({
        city: c.city,
        gap_type: "no_owned_pages",
        competitor_pages: c.competitor_pages,
        owned_pages: 0,
        explanation: `${c.competitor_pages} competitor pages exist for ${c.city} but you have no owned pages there.`,
      });
    } else if (
      c.coverage_status === "weak" &&
      c.competitor_pages >= MIN_COMPETITOR_PAGES_FOR_GAP &&
      c.competitor_citations > c.owned_citations * 5
    ) {
      gaps.push({
        city: c.city,
        gap_type: "competitor_dominated",
        competitor_pages: c.competitor_pages,
        owned_pages: c.owned_pages,
        explanation: `Competitors have ${c.competitor_pages} pages and ${c.competitor_citations} citations in ${c.city} vs your ${c.owned_pages} page${c.owned_pages !== 1 ? "s" : ""} and ${c.owned_citations} citation${c.owned_citations !== 1 ? "s" : ""}.`,
      });
    }
  }

  gaps.sort((a, b) => b.competitor_pages - a.competitor_pages);
  return gaps.slice(0, 8);
}

/**
 * Build heat map data structure for future visualization.
 */
export function computeGeoHeatMap(coverage: GeoCoverageIndex): GeoHeatMap {
  const entries: GeoHeatEntry[] = coverage.cities.map((c) => ({
    city: c.city,
    metro: null, // filled by caller if needed
    owned_citations: c.owned_citations,
    competitor_citations: c.competitor_citations,
    owned_pages: c.owned_pages,
    competitor_pages: c.competitor_pages,
    share_pct: c.share_pct,
    strength: c.coverage_status === "absent" ? "absent" : c.coverage_status,
  }));

  return {
    computed_at: coverage.computed_at,
    entries,
    total_owned_citations: entries.reduce((s, e) => s + e.owned_citations, 0),
    total_competitor_citations: entries.reduce((s, e) => s + e.competitor_citations, 0),
  };
}

/**
 * Compact summary for display on Today or other surfaces.
 */
export function summarizeGeoCoverage(coverage: GeoCoverageIndex): {
  total_cities: number;
  strong: number;
  moderate: number;
  weak: number;
  absent: number;
  gap_count: number;
  top_cities: string[];
  concentration_label: string;
} {
  let strong = 0, moderate = 0, weak = 0, absent = 0;
  for (const c of coverage.cities) {
    switch (c.coverage_status) {
      case "strong": strong++; break;
      case "moderate": moderate++; break;
      case "weak": weak++; break;
      case "absent": absent++; break;
    }
  }

  const topCities = coverage.cities
    .filter((c) => c.owned_citations > 0)
    .slice(0, 3)
    .map((c) => c.city);

  return {
    total_cities: coverage.total_cities,
    strong,
    moderate,
    weak,
    absent,
    gap_count: coverage.gaps.length,
    top_cities: topCities,
    concentration_label: coverage.concentration.assessment,
  };
}
