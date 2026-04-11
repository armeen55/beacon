export type FounderPresenceStatus =
  | "configured_not_observed"
  | "observed_lightly"
  | "observed_repeatedly"
  | "not_configured";

export type FounderProfile = {
  name: string;
  configured: boolean;
  mention_count: number;
  mention_sources: string[];
  presence_status: FounderPresenceStatus;
  assessment: string;
};

export type FounderAuthorityResult = {
  computed_at: string;
  founders: FounderProfile[];
  has_configured_founder: boolean;
  data_note: string;
};
