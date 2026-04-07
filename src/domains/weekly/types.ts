export type WeeklySummary = {
  id: string;
  week_start: string;
  week_end: string;
  title: string;
  status: "draft" | "published";
  highlights: string;
  lowlights: string | null;
  changes_count: number;
  key_metric_deltas: Record<string, number>;
  top_opportunities: string[];
  recommendations: string | null;
  created_at: string;
  updated_at: string;
};
