export type ReportSection = {
  title: string;
  type: "stat" | "list" | "table" | "text";
  data: unknown;
};

export type BeaconReport = {
  generated_at: string;
  report_type: "visibility_snapshot" | "competitive_overview" | "full_diagnostics";
  title: string;
  sections: ReportSection[];
  data_freshness: string | null;
  confidence_note: string;
};
