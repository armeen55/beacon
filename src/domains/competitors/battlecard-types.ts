export type BattlecardDimension =
  | "citation_share"
  | "topic_pressure"
  | "co_mention_frequency"
  | "geographic_presence"
  | "platform_reliance";

export type DimensionComparison = {
  dimension: BattlecardDimension;
  label: string;
  owned_value: number | null;
  competitor_value: number | null;
  advantage: "owned" | "competitor" | "even" | "insufficient";
  explanation: string;
};

export type CompetitorBattlecard = {
  competitor_domain: string;
  competitor_name: string | null;
  overall_threat: "high" | "moderate" | "low";
  total_citations: number;
  owned_citations: number;
  dimensions: DimensionComparison[];
  pressure_topics: string[];
  pressure_cities: string[];
  key_insight: string;
};

export type BattlecardIndex = {
  computed_at: string;
  cards: CompetitorBattlecard[];
  top_threat: string | null;
  data_note: string;
};
