export type DiscrepancyType =
  | "location_not_in_owned"
  | "service_not_in_owned"
  | "brand_omitted"
  | "competitor_overrepresented";

export type DiscrepancySeverity = "notable" | "minor";

export type Discrepancy = {
  id: string;
  type: DiscrepancyType;
  severity: DiscrepancySeverity;
  summary: string;
  detail: string;
  evidence_count: number;
  confidence: "moderate" | "limited";
};

export type DiscrepancyReport = {
  computed_at: string;
  total_answers_checked: number;
  discrepancies: Discrepancy[];
  data_note: string;
};
