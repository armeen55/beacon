export type GenealogyConfidence = "high" | "medium" | "low" | "unknown";

export type GenealogyMatch = {
  citation_url: string;
  matched_page_url: string;
  matched_section: string | null;
  match_type: "url_exact" | "url_path" | "title_overlap" | "faq_overlap" | "heading_overlap" | "content_signal";
  confidence: GenealogyConfidence;
  explanation: string;
  matched_terms: string[];
};

export type PageGenealogyResult = {
  page_url: string;
  total_owned_citations: number;
  matches: GenealogyMatch[];
  unmatched_count: number;
  computed_at: string;
};
