import type { Platform } from "@/lib/constants";

export type Competitor = {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source_system?: string;
  import_batch_id?: string;
};

export type CompetitorSnapshot = {
  id: string;
  competitor_id: string;
  snapshot_date: string;
  platform: Platform;
  visibility_rank: number | null;
  citation_share: number | null;
  mention_count: number | null;
  share_of_voice: number | null;
  top_cited_urls: string[];
  topics_present: string[];
  created_at: string;
};
