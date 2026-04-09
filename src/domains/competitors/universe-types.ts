/**
 * Workspace-configured competitor universe (intentional tracked set).
 * Separate from imported `Competitor` entity rows and from citation-sample domains.
 */

export type ConfiguredCompetitorStatus = "active" | "inactive";

/** Persisted row in `.data/competitor-universe.json`. */
export type ConfiguredCompetitorEntry = {
  id: string;
  display_name: string;
  /** Hostname only, e.g. example.com */
  domain: string;
  status: ConfiguredCompetitorStatus;
  notes?: string | null;
  tags?: string[];
};

export type CompetitorUniverseOrigin =
  | "configured_file"
  | "demo_defaults_explicit"
  | "empty_import_mode";

/** Workspace competitor-universe pin (current or historical). */
export type CompetitorUniversePin = {
  universe_version: number | null;
  universe_fingerprint: string | null;
  /** True when file was legacy v1 without `universe_version` / fingerprint on disk. */
  legacy_unversioned_file: boolean;
  /**
   * v2 file only: recomputed fingerprint ≠ stored fingerprint (likely hand-edited JSON).
   * Beacon still uses on-disk fingerprint as the canonical pin for new runs until you save from UI.
   */
  fingerprint_mismatch?: boolean;
};

/** Resolved universe for server surfaces (Today, gap ledger, Results). */
/** Stamped onto website / visibility observation runs at persistence time. */
export type ObservationCompetitorUniverseFields = {
  competitor_universe_version: number | null;
  competitor_universe_fingerprint: string | null;
  competitor_universe_scope: "configured_file" | "demo_defaults" | "empty";
  competitor_universe_pin_status: "pinned";
};

export type CompetitorUniverseRuntime = {
  origin: CompetitorUniverseOrigin;
  /** Active entries only */
  entries: ConfiguredCompetitorEntry[];
  /** normalizeCompetitorDomain(domain) -> display_name */
  domainToLabel: Record<string, string>;
  /** Version + fingerprint for this resolved universe (or nulls for unset). */
  pin: CompetitorUniversePin;
};
