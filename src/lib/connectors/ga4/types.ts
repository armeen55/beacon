/**
 * 2026-05-18 — Slice 9.A1 — Google Analytics 4 connector type
 * contracts (pure types; no I/O, no API calls).
 *
 * Slice 9.A1 ships OAuth + property picker ONLY. The Data API (the
 * piece that produces sessions / events / conversions) is OUT OF
 * SCOPE for this slice; it lands in Slice 9.A2 alongside the Mode A
 * outcome attribution read model + migration.
 *
 * Slice 9.A2α (2026-05-19) ADDITIVE EXTENSION: adds the GA4 Data API
 * request + response + narrowed row shapes used by `data-api.ts`.
 * The 9.A1α public surface (`Ga4Property`, `Ga4PropertyListResult`,
 * `Ga4ApiFetchResult<T>`, `Ga4FailReason`) is unchanged.
 *
 * The types live here so the property-selection module + the
 * data-api module + the server actions + the settings card all
 * share a single locked shape. Pinned by:
 *   • `tests/architecture/ga4-connector-server-only.test.ts`
 *   • `tests/architecture/ga4-connector-tenant-isolation.test.ts`
 *   • `tests/architecture/ga4-data-api-tenant-isolation.test.ts`
 *     (Slice 9.A2α)
 */

import "server-only";

/**
 * A single GA4 property as surfaced by the Analytics Admin API's
 * `accountSummaries.list` endpoint. The Admin API nests property
 * summaries under account summaries; this connector flattens the
 * hierarchy so the property picker UI sees a flat list.
 */
export type Ga4Property = {
  /** Numeric property id (e.g. "123456789"). Stripped from the
   *  fully-qualified `properties/123456789` Admin API resource name. */
  id: string;
  /** Property display name as configured in GA4 (e.g.
   *  "Ritz Builders — Production"). */
  displayName: string;
  /** Numeric account id this property lives under (e.g. "987654321").
   *  Stripped from the fully-qualified `accounts/987654321` Admin
   *  API resource name. Preserved so the picker UI can group +
   *  disambiguate properties when an operator has multiple accounts. */
  accountId: string;
  /** Account display name as configured in GA4 (e.g.
   *  "Ritz Builders LLC"). Convenience only; never used for API
   *  calls. */
  accountDisplayName: string;
};

/**
 * Locked failure-reason taxonomy for the GA4 connector. Mirrors the
 * GSC client's structured fail-soft pattern — callers branch on the
 * `reason` discriminator rather than parsing exception messages.
 */
export type Ga4FailReason =
  | "no_token"
  | "token_expired"
  | "disconnected"
  | "api_error";

/**
 * Result shape for the property-selection flow. Discriminated union
 * so callers don't have to defensively destructure `.properties` on
 * a fail-soft branch.
 */
export type Ga4PropertyListResult =
  | { ok: true; properties: Ga4Property[] }
  | { ok: false; reason: Ga4FailReason; message?: string };

/**
 * Generic GA4 Admin / Data API fetch result. Slice 9.A1 only uses
 * the Admin API; the type is intentionally generic so Slice 9.A2's
 * Data API helpers can reuse the same fail-soft contract without
 * inventing a parallel shape.
 */
export type Ga4ApiFetchResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: Ga4FailReason;
      status?: number;
      message?: string;
    };

// ─────────────────────────────────────────────────────────────────────
// Slice 9.A2α (2026-05-19) — GA4 Data API shapes (additive)
// ─────────────────────────────────────────────────────────────────────

/**
 * A single narrowed row from the GA4 Data API `runReport` response,
 * keyed by `(date, url)`. The Data API returns metric values as
 * STRINGS; this shape stores them as parsed integers (defaults to 0
 * on parse failure, never throws).
 *
 * Stored verbatim into the `ga4_url_traffic` Supabase table
 * (composite PK `(tenant_id, url, date)`); customer surfaces never
 * read the raw API row.
 */
export type Ga4UrlTrafficRow = {
  /** YYYY-MM-DD UTC date the metrics are for. */
  date: string;
  /** Page path or full URL — caller is responsible for choosing the
   *  dimension name when building the request (we use `pagePath`). */
  url: string;
  /** Sessions for this (date, url) tuple. */
  sessions: number;
  /** Engaged sessions for this (date, url) tuple. */
  engaged_sessions: number;
  /** Conversion count for this (date, url) tuple. NOT shown in
   *  customer copy (K5 lock); operator-substrate only. */
  conversions: number;
};

/**
 * Verbatim GA4 Data API `runReport` response shape. Defensive: every
 * nested field is read via type-guarded property access by the
 * narrowing helpers. Downstream consumers MUST NOT depend on this
 * shape — the operator-substrate `Ga4UrlTrafficRow` is the locked
 * contract.
 */
export type Ga4RunReportResponseBody = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string; type?: string }>;
  rowCount?: number;
  /** GA4 echoes the property's reporting currency here for revenue reports. */
  metadata?: { currencyCode?: string; timeZone?: string };
};

// ─────────────────────────────────────────────────────────────────────
// GA4 revenue report shapes (2026-06-26, GA4 revenue migration) — additive.
// A SEPARATE report from the traffic report so a revenue-specific failure can
// never break the proven traffic sync (operator rule: keep traffic successful
// even if revenue is unavailable). Same (date, url) grain.
// ─────────────────────────────────────────────────────────────────────

/**
 * A single narrowed revenue row keyed by (date, url). Values are GA4's parsed
 * numbers; `null` when GA4 omitted that metric for the row (defensive — the
 * normalization layer treats null as "not contributing", never as 0).
 */
export type Ga4RevenueRow = {
  date: string;
  url: string;
  totalRevenue: number | null;
  purchaseRevenue: number | null;
  transactions: number | null;
};

/**
 * Revenue report failure reasons: the shared GA4 reasons PLUS
 * `revenue_unavailable` — the property exposes no usable revenue metrics
 * (e.g. a 400 naming a revenue metric). The caller treats this as "revenue
 * unknown" WITHOUT failing the traffic sync.
 */
export type Ga4RevenueFailReason = Ga4FailReason | "revenue_unavailable";

/** Discriminated result for `runGa4RevenueReport`. Mirrors the traffic union. */
export type Ga4RevenueReportResult =
  | {
      ok: true;
      rows: Ga4RevenueRow[];
      /** Property reporting currency (ISO 4217) from response metadata; null if absent. */
      currency: string | null;
      rowCount?: number;
      /** true when known-incomplete (MAX_PAGES hit or a later page errored). */
      truncated?: boolean;
    }
  | {
      ok: false;
      reason: Ga4RevenueFailReason;
      status?: number;
      message?: string;
    };

/**
 * Args for `runGa4UrlTrafficReport`. Every field is required;
 * `tenantId` threads tenant scope explicitly per the locked
 * `ga4-data-api-tenant-isolation` invariant.
 */
export type Ga4RunReportArgs = {
  /** Beacon tenant id. Explicit threading — no ambient
   *  `currentTenantSlug()` / `currentTenantId()` reads inside
   *  `data-api.ts`. */
  tenantId: string;
  /** Numeric GA4 property id (e.g. "123456789"). Read from the
   *  `google_ga4` token payload's `ga4_property_id` field. */
  propertyId: string;
  /** Inclusive start date YYYY-MM-DD UTC. */
  startDate: string;
  /** Inclusive end date YYYY-MM-DD UTC. */
  endDate: string;
};

/**
 * Result shape for `runGa4UrlTrafficReport`. Discriminated union;
 * mirrors `Ga4PropertyListResult` from 9.A1α.
 *
 * Pagination (2026-06-16 — expert audit #5/#62): the GA4 Data API caps
 * `runReport` at `GA4_PAGE_SIZE` (10k) rows per call and exposes a
 * top-level `rowCount` (total matching rows). `runGa4UrlTrafficReport`
 * now loops `offset` to gather every page (bounded by `GA4_MAX_PAGES`),
 * so the `{ ok: true }` variant gains two OPTIONAL fields:
 *   • `rowCount`  — the GA4-reported total matching rows (informational).
 *   • `truncated` — `true` when the result is KNOWN-INCOMPLETE: either
 *                   the `GA4_MAX_PAGES` ceiling was hit while more rows
 *                   remained, OR a subsequent page errored and we
 *                   returned the rows gathered so far. Falsy on the
 *                   common ≤10k path and on any fully-paginated pull.
 * Existing callers that ignore these fields keep working unchanged.
 */
export type Ga4UrlTrafficReportResult =
  | {
      ok: true;
      rows: Ga4UrlTrafficRow[];
      /** GA4-reported total matching rows (top-level `rowCount`). */
      rowCount?: number;
      /** `true` when the result is known-incomplete (MAX_PAGES cap hit
       *  or a subsequent page errored before completion). */
      truncated?: boolean;
    }
  | {
      ok: false;
      reason: Ga4FailReason;
      status?: number;
      message?: string;
    };
