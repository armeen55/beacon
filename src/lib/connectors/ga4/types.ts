/**
 * 2026-05-18 — Slice 9.A1 — Google Analytics 4 connector type
 * contracts (pure types; no I/O, no API calls).
 *
 * Slice 9.A1 ships OAuth + property picker ONLY. The Data API (the
 * piece that produces sessions / events / conversions) is OUT OF
 * SCOPE for this slice; it lands in Slice 9.A2 alongside the Mode A
 * outcome attribution read model + migration.
 *
 * The types live here so the property-selection module + the
 * server actions + the settings card all share a single locked
 * shape. Pinned by:
 *   • `tests/architecture/ga4-connector-server-only.test.ts`
 *   • `tests/architecture/ga4-connector-tenant-isolation.test.ts`
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
