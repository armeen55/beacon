export type BeaconEntityType =
  | "brand"
  | "person"
  | "location"
  | "service";

export type EntitySource =
  | "page_snapshot"
  | "answer_mention"
  | "site_config"
  | "answer_text";

export type BeaconEntity = {
  id: string;
  name: string;
  entity_type: BeaconEntityType;
  canonical_name: string;
  is_owned: boolean;
  frequency: number;
  sources: EntitySource[];
  first_seen: string | null;
  metadata: Record<string, unknown>;
};

export type EntityIndex = {
  computed_at: string;
  entities: BeaconEntity[];
  owned_brand: string | null;
  owned_locations: string[];
  owned_services: string[];
};
