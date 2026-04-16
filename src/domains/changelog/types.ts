import type { SignalType, AssetType } from "@/lib/constants";

export type ChangelogEntry = {
  id: string;
  timestamp: string;
  signal_type: SignalType;
  asset_type: AssetType;
  url: string | null;
  asset_name: string;
  change_description: string;
  topic_targeted: string;
  city_targeted: string | null;
  hypothesis: string | null;
  expected_impact_window: string | null;
  brief_id: string | null;
  opportunity_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  source_system?: string;
  import_batch_id?: string;
  /** Owning tenant. */
  tenant_id: string;
};
