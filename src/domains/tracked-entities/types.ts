export type EntityType =
  | "brand"
  | "domain"
  | "page"
  | "competitor"
  | "directory_source";

export type TrackedEntity = {
  id: string;
  account_id: string;
  // Phase 1 Stage C (2026-05-09): additive tenant_id alongside account_id.
  // Optional in the type so existing in-memory rows from older callers
  // still pass type-checks; the dual-write wrapper stamps it before write
  // (via tenantizeRows) so DB rows always have a non-empty tenant_id.
  tenant_id?: string | null;
  entity_type: EntityType;
  name: string;
  /**
   * Optional known-name variants. Used by poll adapters for alias-aware
   * matching: an entity is considered mentioned if the answer contains `name`
   * OR any string in `aliases`. Optional in the TS type so legacy JSON records
   * without the field are safe; the DB column is NOT NULL DEFAULT '{}'.
   */
  aliases?: string[];
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
