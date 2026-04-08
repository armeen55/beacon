export type EntityType =
  | "brand"
  | "domain"
  | "page"
  | "competitor"
  | "directory_source";

export type TrackedEntity = {
  id: string;
  account_id: string;
  entity_type: EntityType;
  name: string;
  domain: string | null;
  url: string | null;
  location_scope: string | null;
  service_scope: string | null;
  is_owned: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
