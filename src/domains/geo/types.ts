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

