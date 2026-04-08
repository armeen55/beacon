export type ChangeType =
  | "content"
  | "technical"
  | "page_launch"
  | "citation"
  | "review"
  | "entity_update"
  | "measurement"
  | "off_page"
  | "other";

export type ChangeSurface =
  | "website"
  | "google_business"
  | "directory"
  | "social"
  | "review_platform"
  | "other";

export type ChangeSource =
  | "operator"
  | "integration"
  | "imported";

export type Change = {
  id: string;
  account_id: string;
  date: string;
  tracked_entity_id: string | null;
  change_type: ChangeType;
  change_surface: ChangeSurface;
  topic_id: string | null;
  location_scope: string | null;
  service_scope: string | null;
  summary: string;
  details: string | null;
  url: string | null;
  hypothesis: string | null;
  expected_impact_days: number | null;
  source: ChangeSource;
  tags: string[];
  created_at: string;
};
