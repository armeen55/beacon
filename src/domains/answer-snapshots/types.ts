import type { CitationRef } from "@/lib/querying/types";

export type { CitationRef };

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
