export type SnippetSignalType =
  | "owned_extractable_pattern"
  | "competitor_citation_context"
  | "extractability_gap"
  | "strengthening_opportunity";

export type SnippetSignal = {
  id: string;
  type: SnippetSignalType;
  page_url: string | null;
  page_title: string | null;
  summary: string;
  detail: string;
  confidence: "grounded" | "inferred";
  priority: "high" | "medium" | "low";
  competitor_domain: string | null;
  topic: string | null;
};

export type SnippetIntelligence = {
  computed_at: string;
  signals: SnippetSignal[];
  total_owned_pages_analyzed: number;
  data_note: string;
};
