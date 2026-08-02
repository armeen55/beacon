/**
 * 2026-05-18 — Slice 9.A1 — Google Analytics 4 property listing
 * (Analytics Admin API `accountSummaries.list`).
 *
 * Operator-substrate only. Used exclusively by the property picker
 * on `/settings/connectors` to enumerate GA4 properties the
 * authenticated operator can read. The connector does NOT call the
 * Data API in this slice; sessions / events / conversions land in
 * Slice 9.A2 alongside the Mode A outcome attribution read model.
 *
 * Posture (locked):
 *   • Server-only. Cannot bundle into client components.
 *   • Tenant-scoped via the explicit `tenantId` parameter; no
 *     ambient reads.
 *   • Fail-soft: returns a discriminated `Ga4PropertyListResult`
 *     for every documented skip path.
 *   • Defensive flattening: the Admin API nests property summaries
 *     under account summaries; this module flattens to a single
 *     array and caps at 100 entries so a misbehaving response can't
 *     blow the picker UI.
 *   • Stop condition (per Section 9 prerequisites): if the API
 *     returns a hierarchy deeper than `accountSummaries[*].
 *     propertySummaries[*]`, this module FLATTENS only the two
 *     documented levels and ignores deeper nesting.
 *
 * Pinned by:
 *   • `tests/architecture/ga4-connector-server-only.test.ts`
 *   • `tests/architecture/ga4-connector-tenant-isolation.test.ts`
 *   • `tests/lib/connectors/ga4/property-selection.test.ts`
 */

import "server-only";

import { ga4ApiFetch } from "./client";
import type { Ga4Property, Ga4PropertyListResult } from "./types";

/** Analytics Admin API endpoint for account + property summaries. */
const ACCOUNT_SUMMARIES_URL =
  "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";

/** Defensive cap: a single tenant should never have > 100 properties
 *  in practice; capping protects the picker UI from a pathological
 *  response shape. */
const MAX_PROPERTIES = 100;

/** Raw Admin API shape we depend on. Defensive; every nested field
 *  is read via type-guarded property access. */
type AccountSummariesResponse = {
  accountSummaries?: AdminAccountSummary[];
  nextPageToken?: string;
};

type AdminAccountSummary = {
  /** "accounts/123456789" */
  account?: string;
  displayName?: string;
  propertySummaries?: AdminPropertySummary[];
};

type AdminPropertySummary = {
  /** "properties/987654321" */
  property?: string;
  displayName?: string;
};

/**
 * List GA4 properties the operator can read. Returns a flattened
 * array of `Ga4Property`. Fail-soft on every documented skip path.
 */
export async function listGa4PropertiesForTenant(
  tenantId: string,
): Promise<Ga4PropertyListResult> {
  const result = await ga4ApiFetch<AccountSummariesResponse>({
    tenantId,
    url: ACCOUNT_SUMMARIES_URL,
    init: { method: "GET" },
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.message != null ? { message: result.message } : {}),
    };
  }
  const properties = flattenAccountSummaries(result.data);
  return { ok: true, properties };
}

/**
 * Flatten the Admin API account-summaries response into a flat
 * `Ga4Property[]`. Defensive: silently drops malformed entries
 * (missing `property` resource name, missing `displayName`, etc.).
 * Caps at `MAX_PROPERTIES` to bound the picker UI.
 *
 * Exported for unit testing.
 */
function flattenAccountSummaries(
  body: AccountSummariesResponse | null | undefined,
): Ga4Property[] {
  if (body == null || typeof body !== "object") return [];
  const accounts = Array.isArray(body.accountSummaries)
    ? body.accountSummaries
    : [];
  const out: Ga4Property[] = [];
  for (const account of accounts) {
    if (account == null || typeof account !== "object") continue;
    const accountResource =
      typeof account.account === "string" ? account.account : null;
    const accountDisplayName =
      typeof account.displayName === "string" ? account.displayName : null;
    if (accountResource == null || accountDisplayName == null) continue;
    const accountId = accountResource.startsWith("accounts/")
      ? accountResource.slice("accounts/".length)
      : accountResource;
    const propertySummaries = Array.isArray(account.propertySummaries)
      ? account.propertySummaries
      : [];
    for (const prop of propertySummaries) {
      if (prop == null || typeof prop !== "object") continue;
      const propResource =
        typeof prop.property === "string" ? prop.property : null;
      const propDisplayName =
        typeof prop.displayName === "string" ? prop.displayName : null;
      if (propResource == null || propDisplayName == null) continue;
      const propId = propResource.startsWith("properties/")
        ? propResource.slice("properties/".length)
        : propResource;
      out.push({
        id: propId,
        displayName: propDisplayName,
        accountId,
        accountDisplayName,
      });
      if (out.length >= MAX_PROPERTIES) return out;
    }
  }
  return out;
}

