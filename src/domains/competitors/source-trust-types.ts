export type SourceTrustEntry = {
  domain: string;
  platform: string;
  citation_count: number;
  share_pct: number;
  is_owned: boolean;
  is_competitor: boolean;
  topics: string[];
};

export type PlatformTrustProfile = {
  platform: string;
  total_citations: number;
  top_sources: SourceTrustEntry[];
  owned_rank: number | null;
  owned_share_pct: number | null;
};

export type SourceTrustIndex = {
  computed_at: string;
  total_citations_analyzed: number;
  platforms: PlatformTrustProfile[];
};
