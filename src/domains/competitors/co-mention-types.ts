export type CoMentionEntry = {
  domain: string;
  co_occurrence_count: number;
  total_appearances: number;
  co_mention_strength: number;
  topics: string[];
  platforms: string[];
  is_in_universe: boolean;
};

export type CoMentionMatrix = {
  owned_domain: string;
  computed_at: string;
  total_answers_analyzed: number;
  entries: CoMentionEntry[];
};
