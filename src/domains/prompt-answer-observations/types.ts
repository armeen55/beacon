export type PromptAnswerObservation = {
  id: string;
  prompt_id: string;
  run_id: string;
  answer_hash: string | null;
  position: number | null;
  tracked_brand_mentioned: boolean | null;
  tracked_brand_cited: boolean | null;
  citation_count: number;
  owned_citation_count: number;
  citation_domains: string[];
  citation_categories: Partial<Record<string, number>>;
  mentions: string[];
  observed_at: string;
  platform: string;
  topic: string;
  metadata: Record<string, unknown>;
};
