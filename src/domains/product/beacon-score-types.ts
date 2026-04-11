export type DimensionStatus = "sufficient" | "partial" | "insufficient";

export type ScoreDimension = {
  key: string;
  label: string;
  value: number | null;
  max: number;
  status: DimensionStatus;
  explanation: string;
};

export type BeaconScoreResult = {
  computed_at: string;
  composite: number | null;
  composite_status: "stable" | "partial" | "unavailable";
  dimensions: ScoreDimension[];
  sufficient_count: number;
  total_dimensions: number;
  summary: string;
};
