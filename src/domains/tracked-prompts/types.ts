export type IntentType =
  | "informational"
  | "navigational"
  | "transactional"
  | "comparison"
  | "local_discovery"
  | "recommendation";

export type TrackedPrompt = {
  id: string;
  account_id: string;
  text: string;
  topic_id: string | null;
  location_scope: string | null;
  service_scope: string | null;
  intent_type: IntentType | null;
  platforms: string[];
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
