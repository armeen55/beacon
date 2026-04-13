import "server-only";

import { getBusinessConfig } from "@/lib/business-config";
import {
  getConnectorToken,
  getGoogleConnectorToken,
  type ConnectorProvider,
} from "@/lib/connector-store";
import { BEACON_LOCAL_SURFACE_FOOTNOTE } from "@/lib/beacon-proof-copy";
import { readLocalReviews } from "@/lib/local-reviews-store";
import type { LocalSentimentBand } from "@/lib/local-reviews-types";
import { readStore } from "@/lib/persistence/json-store";
import type { ImportRun } from "@/lib/import/types";

export type LocalHealthTier = "weak" | "ok" | "strong";

export type NapField = "name" | "domain" | "phone" | "address";

export interface NapStatus {
  present: NapField[];
  missing: NapField[];
  completeness: number;
}

export interface ListingHealthComponent {
  label: string;
  weight: number;
  earned: number;
  maxPoints: number;
}

export interface ListingHealthBreakdown {
  score: number;
  tier: LocalHealthTier;
  components: ListingHealthComponent[];
}

/** Per-source last observation timestamps (ISO). No merge — projection only. */
export type ReviewSourceLastSync = {
  google: string | null;
  yelp: string | null;
  /** Latest manual Settings → Import run for Local reviews (`entity_type === "reviews"`), excluding connector audit runs. */
  manual: string | null;
};

/** Keys Beacon checks for listing completeness (read-only; no API calls). Hours omitted — not persisted in v1. */
export type ListingCompletenessFieldKey =
  | "name"
  | "address"
  | "phone"
  | "website"
  | "category";

/** Coverage of key listing fields from existing config + connector display fields only — not an SEO score. */
export type ListingCompletenessCoverage = "strong" | "partial" | "weak";

export type ListingCompletenessAudit = {
  /** Fields included in this audit (v1 fixed set). */
  checked_field_keys: ListingCompletenessFieldKey[];
  /** Human-readable labels for fields Beacon has a value for. */
  present_fields: string[];
  /** Human-readable labels for fields Beacon has no value for. */
  missing_fields: string[];
  coverage_state: ListingCompletenessCoverage;
};

export type LocalPresenceSnapshot = {
  hasListing: boolean;
  hasReviews: boolean;
  reviewCount: number | null;
  avgRating: number | null;
  /** Simple 3-tier label derived from composite listing health score. */
  healthTier: LocalHealthTier;
  /** 0–100 composite listing health score. */
  healthScore: number;
  healthBreakdown: ListingHealthBreakdown;
  nap: NapStatus;
  /** Centralized NAP consistency state — reuse this everywhere. */
  napState: NapConsistencyState;
  /** From average rating only; null when no reviews. */
  sentimentBand: LocalSentimentBand | null;
  /** ISO timestamp of last successful reviews import with at least one row. */
  lastReviewImportAt: string | null;
  /** Days since lastReviewImportAt; null if never imported. */
  reviewImportAgeDays: number | null;
  /** When each review data path was last updated — independent, not merged. */
  lastSync: ReviewSourceLastSync;
  /** Which listing-related fields Beacon has in config / GBP selection only — not live-platform verification. */
  listingCompleteness: ListingCompletenessAudit;
};

const CONNECTOR_REVIEW_SOURCE_SYSTEMS = new Set(["connector:google", "connector:yelp"]);

function lastReviewsImportCompletedAt(): string | null {
  const runs = readStore<ImportRun>("import-runs", []);
  let latest: string | null = null;
  for (const r of runs) {
    if (r.entity_type !== "reviews" || r.imported_count <= 0) continue;
    const t = Date.parse(r.completed_at);
    if (Number.isNaN(t)) continue;
    if (!latest || t > Date.parse(latest)) latest = r.completed_at;
  }
  return latest;
}

/** Latest manual Local reviews import (excludes connector-driven import-run rows). */
function lastManualReviewsImportCompletedAt(): string | null {
  const runs = readStore<ImportRun>("import-runs", []);
  let latest: string | null = null;
  for (const r of runs) {
    if (r.entity_type !== "reviews" || r.imported_count <= 0) continue;
    if (CONNECTOR_REVIEW_SOURCE_SYSTEMS.has(r.source_system)) continue;
    const t = Date.parse(r.completed_at);
    if (Number.isNaN(t)) continue;
    if (!latest || t > Date.parse(latest)) latest = r.completed_at;
  }
  return latest;
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function connectorLastSyncedAt(provider: ConnectorProvider): string | null {
  const t = getConnectorToken(provider);
  if (!t) return null;
  return t.last_synced_at ?? null;
}

/** Latest reviews data observation: manual import runs or connector last sync. */
function lastReviewsDataObservedAt(): string | null {
  const fromRuns = lastReviewsImportCompletedAt();
  let latest = maxIsoTimestamp(fromRuns, connectorLastSyncedAt("google"));
  latest = maxIsoTimestamp(latest, connectorLastSyncedAt("yelp"));
  return latest;
}

function sentimentFromAvg(avg: number): LocalSentimentBand {
  if (avg >= 4) return "positive";
  if (avg >= 3) return "mixed";
  return "concerning";
}

const ALL_NAP_FIELDS: NapField[] = ["name", "domain", "phone", "address"];

const LISTING_COMPLETENESS_KEYS: readonly ListingCompletenessFieldKey[] = [
  "name",
  "address",
  "phone",
  "website",
  "category",
] as const;

const LISTING_COMPLETENESS_LABELS: Record<ListingCompletenessFieldKey, string> = {
  name: "Business name",
  address: "Address",
  phone: "Phone",
  website: "Website (domain)",
  category: "Category (industry)",
};

/**
 * Read-only audit: which listing-related fields Beacon has in Settings → Config
 * and (for name only) the Google connector’s selected location display name.
 * Does not call APIs, does not verify live GBP, does not score for ranking.
 */
export function deriveListingCompletenessAudit(opts: {
  nameFromConfig: string;
  /** From GBP connector token when set — optional second source for “name” only. */
  nameFromGoogleLocation?: string | null;
  address: string;
  phone: string;
  domain: string;
  industry: string;
}): ListingCompletenessAudit {
  const hasName =
    Boolean(opts.nameFromConfig.trim()) || Boolean(opts.nameFromGoogleLocation?.trim());
  const hasAddress = Boolean(opts.address.trim());
  const hasPhone = Boolean(opts.phone.trim());
  const hasWebsite = Boolean(opts.domain.trim());
  const hasCategory = Boolean(opts.industry.trim());

  const present: ListingCompletenessFieldKey[] = [];
  const missing: ListingCompletenessFieldKey[] = [];

  const flags: Record<ListingCompletenessFieldKey, boolean> = {
    name: hasName,
    address: hasAddress,
    phone: hasPhone,
    website: hasWebsite,
    category: hasCategory,
  };

  for (const key of LISTING_COMPLETENESS_KEYS) {
    if (flags[key]) present.push(key);
    else missing.push(key);
  }

  const nPresent = present.length;
  let coverage_state: ListingCompletenessCoverage;
  if (nPresent >= 4) coverage_state = "strong";
  else if (nPresent === 3) coverage_state = "partial";
  else coverage_state = "weak";

  return {
    checked_field_keys: [...LISTING_COMPLETENESS_KEYS],
    present_fields: present.map((k) => LISTING_COMPLETENESS_LABELS[k]),
    missing_fields: missing.map((k) => LISTING_COMPLETENESS_LABELS[k]),
    coverage_state,
  };
}

/** One-line summary for `/local` and similar surfaces. */
export function listingCompletenessSummaryLine(audit: ListingCompletenessAudit): string {
  switch (audit.coverage_state) {
    case "strong":
      return "Most key listing fields are present.";
    case "partial":
      return "Some key listing fields are missing.";
    default:
      return "Listing data is limited.";
  }
}

/** Short trailing phrase for Market local strip; null when strong. */
export function listingCompletenessMarketPhrase(
  audit: ListingCompletenessAudit,
): string | null {
  if (audit.coverage_state === "strong") return null;
  if (audit.coverage_state === "partial") return "Listing completeness: partial";
  return "Listing completeness: limited";
}

export function checkNap(config: {
  name: string;
  domain: string;
  phone: string;
  address: string;
}): NapStatus {
  const present: NapField[] = [];
  const missing: NapField[] = [];
  for (const f of ALL_NAP_FIELDS) {
    if (config[f]?.trim()) present.push(f);
    else missing.push(f);
  }
  const completeness =
    ALL_NAP_FIELDS.length > 0
      ? Math.round((present.length / ALL_NAP_FIELDS.length) * 100)
      : 0;
  return { present, missing, completeness };
}

/**
 * Compute a 0–100 listing health score from NAP completeness, review presence,
 * and review quality. Each component is weighted; the score is a completeness
 * heuristic — not an audit, not a ranking claim, not a competitive benchmark.
 *
 * Weights (total 100):
 *   Domain configured:  25
 *   Business name set:  15
 *   Phone present:      10
 *   Address present:    10
 *   Reviews imported:   15  (binary — at least 1)
 *   Average rating:     15  (scaled: rating/5 × points)
 *   Review freshness:   10  (0 if >90d or never, 5 if >30d, 10 if ≤30d)
 */
export function computeListingHealth(opts: {
  nap: NapStatus;
  hasReviews: boolean;
  avgRating: number | null;
  reviewImportAgeDays: number | null;
}): ListingHealthBreakdown {
  const { nap, hasReviews, avgRating, reviewImportAgeDays } = opts;

  const components: ListingHealthComponent[] = [];

  const hasDomain = nap.present.includes("domain");
  components.push({
    label: "Domain configured",
    weight: 25,
    earned: hasDomain ? 25 : 0,
    maxPoints: 25,
  });

  const hasName = nap.present.includes("name");
  components.push({
    label: "Business name set",
    weight: 15,
    earned: hasName ? 15 : 0,
    maxPoints: 15,
  });

  const hasPhone = nap.present.includes("phone");
  components.push({
    label: "Phone present",
    weight: 10,
    earned: hasPhone ? 10 : 0,
    maxPoints: 10,
  });

  const hasAddress = nap.present.includes("address");
  components.push({
    label: "Address present",
    weight: 10,
    earned: hasAddress ? 10 : 0,
    maxPoints: 10,
  });

  components.push({
    label: "Reviews imported",
    weight: 15,
    earned: hasReviews ? 15 : 0,
    maxPoints: 15,
  });

  const ratingPoints =
    hasReviews && avgRating != null
      ? Math.round((avgRating / 5) * 15)
      : 0;
  components.push({
    label: "Average rating",
    weight: 15,
    earned: ratingPoints,
    maxPoints: 15,
  });

  let freshnessPoints = 0;
  if (hasReviews && reviewImportAgeDays != null) {
    if (reviewImportAgeDays <= 30) freshnessPoints = 10;
    else if (reviewImportAgeDays <= 90) freshnessPoints = 5;
  }
  components.push({
    label: "Review freshness",
    weight: 10,
    earned: freshnessPoints,
    maxPoints: 10,
  });

  const score = components.reduce((sum, c) => sum + c.earned, 0);

  let tier: LocalHealthTier;
  if (score >= 65) tier = "strong";
  else if (score >= 35) tier = "ok";
  else tier = "weak";

  return { score, tier, components };
}

/**
 * Read-only local presence snapshot (Track 1.4).
 * Listing from configured domain; reviews from manual import store when present.
 * NAP from business config fields; health from weighted composite.
 */
export function getLocalPresenceSnapshot(): LocalPresenceSnapshot {
  const config = getBusinessConfig();
  const hasListing = Boolean(config.domain?.trim());

  const reviews = readLocalReviews();
  const hasReviews = reviews.length > 0;
  const reviewCount = hasReviews ? reviews.length : null;
  let avgRating: number | null = null;
  let sentimentBand: LocalSentimentBand | null = null;

  if (hasReviews) {
    const sum = reviews.reduce((a, r) => a + r.rating, 0);
    avgRating = Math.round((sum / reviews.length) * 10) / 10;
    sentimentBand = sentimentFromAvg(avgRating);
  }

  const lastReviewImportAt = hasReviews ? lastReviewsDataObservedAt() : null;
  let reviewImportAgeDays: number | null = null;
  if (lastReviewImportAt) {
    const ms = Date.now() - Date.parse(lastReviewImportAt);
    reviewImportAgeDays = Math.floor(ms / 86_400_000);
  }

  const nap = checkNap(config);
  const healthBreakdown = computeListingHealth({
    nap,
    hasReviews,
    avgRating,
    reviewImportAgeDays,
  });

  const reviewListingNames = reviews
    .map((r) => r.listing_name)
    .filter((n): n is string => Boolean(n?.trim()));

  const napState = deriveNapConsistencyState(
    { hasListing, nap },
    { configuredName: config.name, reviewListingNames },
  );

  const lastSync: ReviewSourceLastSync = {
    google: connectorLastSyncedAt("google"),
    yelp: connectorLastSyncedAt("yelp"),
    manual: lastManualReviewsImportCompletedAt(),
  };

  const googleTok = getGoogleConnectorToken();
  const listingCompleteness = deriveListingCompletenessAudit({
    nameFromConfig: config.name,
    nameFromGoogleLocation: googleTok?.selected_location_name,
    address: config.address,
    phone: config.phone,
    domain: config.domain,
    industry: config.industry,
  });

  return {
    hasListing,
    hasReviews,
    reviewCount,
    avgRating,
    healthTier: healthBreakdown.tier,
    healthScore: healthBreakdown.score,
    healthBreakdown,
    nap,
    napState,
    sentimentBand,
    lastReviewImportAt,
    reviewImportAgeDays,
    lastSync,
    listingCompleteness,
  };
}

/**
 * Human-readable time for `/local` per-source lines — relative when recent, else calendar date.
 * Does not imply freshness scoring; display only.
 */
export function formatReviewSourceTimeForDisplay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const ms = Date.now() - t;
  if (ms < 0) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Days after last reviews import beyond which Today/Market treat imports as stale (single threshold). */
export const REVIEW_IMPORT_STALE_AFTER_DAYS = 30;

export type NapConsistencyState = "complete" | "incomplete" | "inconsistent" | "unknown";

export type ReviewImportFreshness = "fresh" | "stale" | "none";

export type TodayLocalAttention = {
  headline: string;
  facts: string[];
  href: string;
  footnote: string;
};

export type MarketLocalStripModel = {
  healthTierLabel: string;
  napState: NapConsistencyState;
  napDisplay: string;
  reviewLine: string;
  /** Subtle Market-only hint; null when listing completeness is strong. */
  listingCompletenessPhrase: string | null;
  footnote: string;
};

function napFieldDisplayName(f: NapField): string {
  if (f === "name") return "business name";
  if (f === "domain") return "domain";
  if (f === "phone") return "phone";
  if (f === "address") return "address";
  return f;
}

/** Whether imported review rows are missing or last import is missing / older than threshold. */
export function reviewsImportStale(snapshot: LocalPresenceSnapshot): boolean {
  if (!snapshot.hasReviews) return false;
  if (!snapshot.lastReviewImportAt || snapshot.reviewImportAgeDays == null) return true;
  return snapshot.reviewImportAgeDays > REVIEW_IMPORT_STALE_AFTER_DAYS;
}

export function deriveReviewImportFreshness(
  snapshot: LocalPresenceSnapshot,
): ReviewImportFreshness {
  if (!snapshot.hasReviews) return "none";
  if (!snapshot.lastReviewImportAt || snapshot.reviewImportAgeDays == null) return "stale";
  if (snapshot.reviewImportAgeDays > REVIEW_IMPORT_STALE_AFTER_DAYS) return "stale";
  return "fresh";
}

/**
 * NAP consistency state — from configured fields + imported review listing names.
 *
 * Precedence: unknown > inconsistent > incomplete > complete.
 *  - `unknown`      — no listing domain configured (not enough data to judge)
 *  - `inconsistent` — imported review listing names conflict with configured business name
 *  - `incomplete`   — one or more required NAP fields missing
 *  - `complete`     — all fields present and no detected conflicts
 *
 * Only compares data Beacon actually has. Does not invent live-directory truth.
 */
export function deriveNapConsistencyState(
  snapshot: Pick<LocalPresenceSnapshot, "hasListing" | "nap">,
  opts?: { configuredName?: string; reviewListingNames?: string[] },
): NapConsistencyState {
  if (!snapshot.hasListing) return "unknown";

  if (opts?.configuredName && opts.reviewListingNames && opts.reviewListingNames.length > 0) {
    const canonical = opts.configuredName.trim().toLowerCase();
    if (canonical) {
      const conflicting = opts.reviewListingNames.some(
        (n) => n.trim().toLowerCase() !== canonical,
      );
      if (conflicting) return "inconsistent";
    }
  }

  if (snapshot.nap.missing.length > 0) return "incomplete";
  return "complete";
}

export function napStateDisplay(n: NapConsistencyState): string {
  if (n === "unknown") return "Unknown";
  if (n === "inconsistent") return "Inconsistent";
  if (n === "incomplete") return "Incomplete";
  return "Complete";
}

export function napStateExplanation(n: NapConsistencyState): string {
  if (n === "unknown") return "Beacon does not have enough data to judge consistency.";
  if (n === "inconsistent")
    return "Imported listing records do not agree on name, address, or phone.";
  if (n === "incomplete") return "Some required identity fields are missing.";
  return "Required identity fields are complete.";
}

export function healthTierDisplay(tier: LocalHealthTier): string {
  if (tier === "weak") return "Weak";
  if (tier === "ok") return "OK";
  return "Strong";
}

export function buildMarketLocalStripModel(
  snapshot: LocalPresenceSnapshot,
): MarketLocalStripModel {
  let reviewLine: string;
  if (!snapshot.hasReviews) {
    reviewLine = "No review rows in Beacon yet";
  } else if (snapshot.reviewCount != null && snapshot.avgRating != null) {
    reviewLine = `${snapshot.reviewCount} stored review${snapshot.reviewCount === 1 ? "" : "s"}, ${snapshot.avgRating.toFixed(1)} avg (1–5)`;
  } else {
    reviewLine = `${snapshot.reviewCount ?? 0} stored reviews`;
  }
  return {
    healthTierLabel: healthTierDisplay(snapshot.healthTier),
    napState: snapshot.napState,
    napDisplay: napStateDisplay(snapshot.napState),
    reviewLine,
    listingCompletenessPhrase: listingCompletenessMarketPhrase(snapshot.listingCompleteness),
    footnote: BEACON_LOCAL_SURFACE_FOOTNOTE,
  };
}

/**
 * Hide Today local block only when listing health is Strong, NAP is complete,
 * reviews exist, and import is fresh.
 */
export function shouldShowTodayLocalAttention(snapshot: LocalPresenceSnapshot): boolean {
  const allGood =
    snapshot.healthTier === "strong" &&
    snapshot.napState === "complete" &&
    snapshot.hasReviews &&
    !reviewsImportStale(snapshot);
  return !allGood;
}

/**
 * Build Today attention strip (max two factual lines + CTA). Returns null when nothing to surface.
 */
export function buildTodayLocalAttention(
  snapshot: LocalPresenceSnapshot,
): TodayLocalAttention | null {
  if (!shouldShowTodayLocalAttention(snapshot)) return null;

  const facts: string[] = [];

  const push = (line: string) => {
    if (facts.length < 2 && !facts.includes(line)) facts.push(line);
  };

  if (snapshot.napState === "unknown") {
    push("No website domain configured — listing anchor is not set.");
  } else if (snapshot.napState === "inconsistent") {
    push("Imported listing records conflict with configured business name.");
  } else if (snapshot.napState === "incomplete") {
    const missing = snapshot.nap.missing.map(napFieldDisplayName).join(", ");
    push(`NAP fields incomplete — missing ${missing}.`);
  }

  if (!snapshot.hasReviews) {
    push("No review rows in Beacon yet.");
  } else if (reviewsImportStale(snapshot)) {
    push("Stored review data is older than 30 days (combined manual + connector clock).");
  }

  if (facts.length < 2 && snapshot.healthTier !== "strong") {
    push(
      `Listing presence score is ${snapshot.healthScore}/100 (${healthTierDisplay(snapshot.healthTier)}) based on configured identity and imports.`,
    );
  }

  // Track 1.4h–k: weak listing completeness only; skip when NAP incomplete/inconsistent dominates.
  if (
    snapshot.listingCompleteness.coverage_state === "weak" &&
    facts.length < 2 &&
    snapshot.napState !== "incomplete" &&
    snapshot.napState !== "inconsistent"
  ) {
    push(listingCompletenessSummaryLine(snapshot.listingCompleteness));
  }

  return {
    headline: "Local presence needs attention",
    facts,
    href: "/local",
    footnote: BEACON_LOCAL_SURFACE_FOOTNOTE,
  };
}
