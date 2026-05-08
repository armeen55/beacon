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
  // Phase 1 Stage C (2026-05-09): additive tenant_id alongside account_id.
  // Optional in the type so existing in-memory rows from older callers
  // still pass type-checks; the dual-write wrapper stamps it before write
  // (via tenantizeRows) so DB rows always have a non-empty tenant_id.
  tenant_id?: string | null;
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
