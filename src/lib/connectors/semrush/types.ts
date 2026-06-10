/**
 * 2026-06-09 — Semrush Analytics API connector types.
 *
 * Beacon consumes a deliberately small slice of the Semrush Analytics
 * (SEO) API — the cheapest, most AEO-relevant reports — keyed by the
 * operator's API key (stored per-tenant in `connector_tokens`). All
 * shapes here are the NORMALIZED form (numbers parsed, null when
 * absent); the raw CSV column codes are mapped in `domain-reports.ts`.
 *
 * Pure types. No I/O.
 */

/** `domain_ranks` — one-row domain overview. Columns: Db,Dn,Rk,Or,Ot,Oc,Ad. */
export type SemrushDomainOverview = {
  /** Regional database the figures are from (e.g. "us"). */
  database: string;
  /** Domain queried (Dn). */
  domain: string;
  /** Semrush domain rank (Rk). Lower = stronger. */
  rank: number | null;
  /** Organic keyword count (Or). */
  organicKeywords: number | null;
  /** Estimated monthly organic traffic (Ot). */
  organicTraffic: number | null;
  /** Estimated monthly organic traffic cost in USD (Oc). */
  organicCostUsd: number | null;
  /** Paid (AdWords) keyword count (Ad). */
  adwordsKeywords: number | null;
};

/** `domain_organic_organic` — an organic competitor row. Columns: Dn,Cr,Np,Or,Ot,Oc. */
export type SemrushOrganicCompetitor = {
  /** Competitor domain (Dn). */
  domain: string;
  /** Competition level vs the queried domain, 0..1 (Cr). */
  competitionLevel: number | null;
  /** Keywords in common with the queried domain (Np). */
  commonKeywords: number | null;
  /** Competitor's total organic keyword count (Or). */
  organicKeywords: number | null;
  /** Competitor's estimated organic traffic (Ot). */
  organicTraffic: number | null;
};

/** Why a fetch produced no rows — surfaced honestly to the operator. */
export type SemrushFetchFailReason =
  | "no_key" // operator hasn't connected Semrush
  | "disconnected" // soft-disconnected; cached data only
  | "api_error" // non-2xx, ERROR body, or network fault
  | "empty"; // 2xx but no data rows for the domain

export type SemrushFetchResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: SemrushFetchFailReason; detail?: string };

/** Persisted snapshot of a domain's Semrush metrics (cache table row). */
export type SemrushDomainMetricsSnapshot = {
  tenant_id: string;
  domain: string;
  database: string;
  fetched_at: string; // ISO
  overview: SemrushDomainOverview | null;
  organic_competitors: ReadonlyArray<SemrushOrganicCompetitor>;
};
