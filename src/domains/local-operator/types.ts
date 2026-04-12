/**
 * Tier 1C — Listings & reviews as operator tasks (not a listings CRM).
 */

export type LocalProof = {
  observed: string[];
  inferred: string[];
  dataGaps: string[];
  stalenessNote: string | null;
};

export type LocalPresenceSeverity = "info" | "watch" | "urgent";

export type LocalPresenceSignal = {
  id: string;
  headline: string;
  detail: string;
  severity: LocalPresenceSeverity;
  proof: LocalProof;
};

export type LocalReviewCadence = "daily" | "weekly";

export type LocalReviewTask = {
  id: string;
  headline: string;
  cadence: LocalReviewCadence;
  detail: string;
  proof: LocalProof;
};

/** Optional `.data/local-operator-surface.json` — no connector required for Beacon to boot. */
export type LocalOperatorImport = {
  listing_import_at?: string | null;
  /** Human labels e.g. "Phone mismatch on Yelp" — operator or future connector supplied */
  nap_drift_flags?: string[];
  reviews_last_import_at?: string | null;
  unresponded_reviews_estimate?: number | null;
  review_velocity_vs_prior?: "up" | "flat" | "down" | null;
};

export type LocalTodayUrgentStrip = {
  title: string;
  body: string;
  href: string;
};

export type LocalChangesHook = {
  text: string;
  href: string;
};

export type LocalOperatorSurface = {
  presenceSignals: LocalPresenceSignal[];
  reviewTasks: LocalReviewTask[];
  /** How this layer is backed (honesty). */
  dataSourceNote: string;
  /** Only set when the bar for Today interruption is met. */
  todayUrgentStrip: LocalTodayUrgentStrip | null;
  /** Optional one-liner for Changes → Outcomes when reputation + visibility move together. */
  changesOutcomesHook: LocalChangesHook | null;
};
