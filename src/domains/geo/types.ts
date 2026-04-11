export type GeoConfidence = "high" | "medium" | "low";

export type NormalizedCity = {
  canonical: string;
  variants: string[];
  metro: string | null;
  state: string | null;
  confidence: GeoConfidence;
};

export type CityCoverage = {
  city: string;
  owned_pages: number;
  owned_citations: number;
  competitor_pages: number;
  competitor_citations: number;
  prompt_count: number;
  share_pct: number | null;
  coverage_status: "strong" | "moderate" | "weak" | "absent";
};

export type GeoCoverageIndex = {
  computed_at: string;
  total_cities: number;
  cities: CityCoverage[];
  concentration: GeoConcentration;
  gaps: GeoGap[];
};

export type GeoConcentration = {
  top_city: string | null;
  top_city_pct: number | null;
  top_3_pct: number | null;
  hhi: number | null;
  assessment: "healthy" | "concentrated" | "highly_concentrated" | "insufficient_data";
  explanation: string;
};

export type GeoGap = {
  city: string;
  gap_type: "no_owned_pages" | "low_citations" | "competitor_dominated";
  competitor_pages: number;
  owned_pages: number;
  explanation: string;
};

export type GeoHeatEntry = {
  city: string;
  metro: string | null;
  owned_citations: number;
  competitor_citations: number;
  owned_pages: number;
  competitor_pages: number;
  share_pct: number | null;
  strength: "strong" | "moderate" | "weak" | "absent";
};

export type GeoHeatMap = {
  computed_at: string;
  entries: GeoHeatEntry[];
  total_owned_citations: number;
  total_competitor_citations: number;
};
