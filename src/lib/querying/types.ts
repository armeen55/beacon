import "server-only";

export type CitationRef = {
  url: string;
  domain: string;
  title: string | null;
  position: number | null;
};

export type AnswerSnapshot = {
  id: string;
  prompt_id: string;
  prompt_text: string;
  platform: string;
  model: string;
  answer_text: string;
  citations: CitationRef[];
  entities_mentioned: string[];
  sampled_at: string;
  run_id: string;
  source_system: "beacon_native" | "profound_import";
};

export type SamplingRunConfig = {
  max_prompts: number;
  concurrency: number;
  delay_ms: number;
  platform: string;
  model: string;
};

export type SamplingRunResult = {
  run_id: string;
  started_at: string;
  completed_at: string;
  prompts_sampled: number;
  snapshots_created: number;
  errors: number;
};

export interface QueryClient {
  platform: string;
  model: string;
  sample(prompt: string): Promise<{
    answer_text: string;
    citations: CitationRef[];
    model: string;
  }>;
}

export const DEFAULT_SAMPLING_CONFIG: SamplingRunConfig = {
  max_prompts: 100,
  concurrency: 2,
  delay_ms: 1000,
  platform: "perplexity",
  model: "sonar",
};
