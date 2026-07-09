/**
 * 2026-05-17 A.3.b2 — Google Search Console URL Inspection client
 * (operator-substrate; NOT wired into indexability or customer
 * surfaces yet). Cache layer migrated from disk to Supabase.
 *
 * Single public function: `gscUrlInspect({ tenantId, siteUrl,
 * inspectionUrl, now })`. Reads a Supabase-backed tenant-scoped cache
 * (table `public.gsc_url_inspections`) and, on cache miss / stale
 * entry, calls Google's URL Inspection API. Returns null in every
 * documented fail-soft scenario so consumers never need to wrap the
 * call in try/catch — typical for the Section 7 / Section 5
 * connector pattern.
 *
 * Locked posture (A.3.b2):
 *   • Pure read-side client + Supabase cache. NO indexability
 *     integration. NO diagnostic-page render. NO customer copy.
 *     Wiring lands in A.3.b1.beta as a separate slice.
 *   • Cache lives at `public.gsc_url_inspections` with composite PK
 *     (tenant_id, inspection_url). Tenant-isolation is enforced at
 *     the storage layer (PK + RLS). Tenant id is taken from the
 *     EXPLICIT `tenantId` parameter (NOT ambient
 *     `currentTenantSlug()`), mirroring the locked
 *     `profound-import-runs-explicit-tenant-scope` invariant pattern.
 *   • Replaces the A.3.b1.alpha disk cache at
 *     `.data/tenants/{slug}/gsc-url-inspections.json` which was inert
 *     on Vercel (lambda FS read-only post-init; `.data/` gitignored).
 *     No file I/O remains in this module.
 *   • Token read uses `getGoogleConnectorToken("gsc")` against the
 *     Supabase `connector_tokens` table — GSC scope only; a GBP-only
 *     grant never satisfies the GSC client.
 *   • Fail-soft return path returns `null` for every documented
 *     skip reason (no token, missing scope, missing site_url, etc.).
 *     Cache READS soft-fail to "no cache entry" on Supabase undefined-
 *     table (42P01) so the deploy window where code lands before the
 *     migration is harmless. Cache WRITES log + degrade — a failed
 *     write does NOT pretend a successful API call was cached.
 *   • Throws only on programmer-error conditions (e.g., crypto
 *     failures inside fetch); never on normal not-connected /
 *     not-scoped states.
 *
 * Pinned by:
 *   • `tests/architecture/gsc-client-tenant-isolation.test.ts`
 *   • `tests/architecture/gsc-cache-no-disk-write.test.ts`
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import {
  getGoogleConnectorToken,
  persistRefreshedGoogleToken,
} from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { log } from "@/lib/logger";

import { evaluateExpiry } from "./expiry-handler";
import type {
  GscInspectionCacheEntry,
  GscUrlInspectionResult,
} from "./types";

const GSC_INSPECT_ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const CACHE_TABLE = "gsc_url_inspections";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// Supabase cache I/O
// ─────────────────────────────────────────────────────────────────────

/**
 * PostgREST surfaces `code: "42P01"` on undefined_table. Used to
 * soft-fail reads during the migration window where code lands
 * before the table is created. Mirrors the connector-store helper.
 */
function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

type CacheRow = {
  tenant_id: string;
  inspection_url: string;
  site_url: string;
  indexing_state: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  last_checked_at: string;
  raw: unknown;
};

function rowToEntry(row: CacheRow): GscInspectionCacheEntry {
  return {
    url: row.inspection_url,
    site_url: row.site_url,
    indexing_state: row.indexing_state,
    coverage_state: row.coverage_state,
    last_crawl_time: row.last_crawl_time,
    // J4 (2026-05-18) — derive from the existing `raw` JSONB column.
    // No separate Supabase column is added in this slice; the
    // extractor is the single source of truth for mobile_usability
    // across fresh-fetch + cache-read paths.
    mobile_usability: extractMobileUsability(row.raw),
    last_checked_at: row.last_checked_at,
    raw: row.raw,
  };
}

/**
 * Read the cached inspection for (tenantId, inspectionUrl). Returns
 * `null` for:
 *   • table missing (42P01 — sequencing model A soft-fail);
 *   • Supabase admin init failure (env vars unset in dev);
 *   • PostgREST returned no row;
 *   • row payload shape invalid.
 *
 * Logs but does NOT throw on other Supabase errors — read-side
 * soft-fail keeps the caller's "fall through to fresh fetch" path
 * intact. Mirrors connector-store's read posture.
 */
async function readCachedInspection(args: {
  tenantId: string;
  inspectionUrl: string;
}): Promise<GscInspectionCacheEntry | null> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return null;
  }
  const { data, error } = await admin
    .from(CACHE_TABLE)
    .select(
      "tenant_id, inspection_url, site_url, indexing_state, coverage_state, last_crawl_time, last_checked_at, raw",
    )
    .eq("tenant_id", args.tenantId)
    .eq("inspection_url", args.inspectionUrl)
    .maybeSingle();

  if (error != null) {
    if (isUndefinedTableError(error)) return null;
    log.warn("[gsc-client] cache read failed; degrading to no cache", {
      tenantId: args.tenantId,
      error: error.message ?? String(error),
    });
    return null;
  }
  if (data == null) return null;
  return rowToEntry(data as CacheRow);
}

/**
 * Upsert the freshly-fetched inspection result into Supabase. On
 * failure, logs and surfaces a boolean — the caller already has the
 * result in memory; a failed write means "no durable cache yet"
 * (return the result regardless), NOT "pretend the fetch never
 * happened." Quota burn already occurred.
 */
async function writeCachedInspection(args: {
  tenantId: string;
  inspection: GscUrlInspectionResult;
}): Promise<{ ok: boolean }> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    log.warn("[gsc-client] cache write skipped; Supabase admin unavailable", {
      tenantId: args.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false };
  }
  const row: CacheRow & { updated_at: string } = {
    tenant_id: args.tenantId,
    inspection_url: args.inspection.url,
    site_url: args.inspection.site_url,
    indexing_state: args.inspection.indexing_state,
    coverage_state: args.inspection.coverage_state,
    last_crawl_time: args.inspection.last_crawl_time,
    last_checked_at: args.inspection.last_checked_at,
    raw: args.inspection.raw,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from(CACHE_TABLE)
    .upsert(row, { onConflict: "tenant_id,inspection_url" });
  if (error != null) {
    log.warn("[gsc-client] cache upsert failed; quota burned but not cached", {
      tenantId: args.tenantId,
      inspectionUrl: args.inspection.url,
      error: error.message ?? String(error),
      code: (error as { code?: unknown }).code,
    });
    return { ok: false };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export type GscUrlInspectArgs = {
  tenantId: string;
  siteUrl: string;
  inspectionUrl: string;
  now?: Date | string;
};

/**
 * Inspect a single URL via Google Search Console. Returns cached
 * result when fresh (< 24h since `last_checked_at`); otherwise calls
 * the API, upserts the result to the tenant-scoped Supabase cache,
 * and returns the new result. Returns `null` on any fail-soft skip:
 *
 *   • no `tenantId` → unreachable (parameter is required)
 *   • `tenantId` empty
 *   • no Google token connected (gsc scope)
 *   • token lacks `webmasters.readonly` scope
 *   • `siteUrl` empty
 *   • `inspectionUrl` empty
 *   • API responds non-2xx
 *   • fetch throws
 *
 * Throws ONLY for programmer-error paths (e.g., a thrown crypto
 * failure inside `refreshGoogleAccessToken` that escapes its own
 * try/catch). Never throws on normal not-connected / not-scoped
 * states.
 */
export async function gscUrlInspect(
  args: GscUrlInspectArgs,
): Promise<GscUrlInspectionResult | null> {
  const { tenantId, siteUrl, inspectionUrl } = args;
  const now = args.now ?? new Date();
  const nowDate = now instanceof Date ? now : new Date(now);

  if (tenantId == null || tenantId === "") return null;
  if (siteUrl == null || siteUrl === "") return null;
  if (inspectionUrl == null || inspectionUrl === "") return null;

  // 1. Cache check — return fresh entry without touching the API.
  const existing = await readCachedInspection({ tenantId, inspectionUrl });
  if (existing != null) {
    const lastCheckedMs = Date.parse(existing.last_checked_at);
    if (
      Number.isFinite(lastCheckedMs) &&
      nowDate.getTime() - lastCheckedMs < CACHE_TTL_MS
    ) {
      return existing;
    }
  }

  // 2. Token check — fail-soft if missing or wrong-scoped.
  // Read the GSC-scoped grant explicitly. Post-scope-split (2026-05-16)
  // GSC and GBP live under separate provider keys (google_gsc /
  // google_gbp); a GBP-only token never satisfies the GSC client.
  const token = await getGoogleConnectorToken("gsc", tenantId);
  if (token == null) return null;
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return null;
  }

  // J5 (2026-05-18) — soft disconnect. When the operator clicked
  // "Disconnect GSC" the token row stays in `connector_tokens` with
  // `disconnected_at` set. Treat as if no token: do NOT refresh,
  // do NOT call the API, return the cached entry (regardless of
  // TTL) if any. The UI shows "Last refreshed at X days ago" copy
  // from the existing cache.
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return existing ?? null;
  }

  // J2 (2026-05-18) — expiry classifier. Three-state status drives
  // the refresh decision:
  //   • fresh           → use access_token directly
  //   • stale_under_7d  → attempt OAuth refresh (existing path)
  //   • stale_over_7d   → DO NOT refresh; surface cached entry +
  //                       prompt operator to reconnect on the
  //                       /settings/connectors surface
  const expiryStatus = evaluateExpiry({ token, now: nowDate });
  if (expiryStatus === "stale_over_7d") {
    log.info("[gsc-client] token stale >7d; surfacing cached entry", {
      tenantId,
      inspectionUrl,
    });
    return existing ?? null;
  }

  // 3. Resolve access token. Refresh if expired (or about to expire
  // within 60s); the existing google-auth helper handles the OAuth
  // refresh wire-up.
  let accessToken = token.access_token;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_gsc",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): this client used to persist
      // nothing (read-only surface). That was safe for the ACCESS token, but
      // if Google ROTATES the refresh token on this refresh, dropping it means
      // the next refresh uses an OLD token Google may have invalidated →
      // invalid_grant → a dead grant. Persist best-effort (fail-soft, changed
      // fields only) so rotation self-heals without bricking GSC.
      await persistRefreshedGoogleToken("google_gsc", refreshed, tenantId);
    } catch (e) {
      log.warn("[gsc-client] token refresh failed; skipping inspection", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return existing ?? null;
    }
  }

  // 4. Call GSC URL Inspection API.
  let response: Response;
  try {
    response = await fetch(GSC_INSPECT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inspectionUrl, siteUrl }),
    });
  } catch (e) {
    log.warn("[gsc-client] fetch threw; degrading to null", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  if (!response.ok) {
    log.warn("[gsc-client] non-2xx response from GSC URL Inspection API", {
      tenantId,
      status: response.status,
    });
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    log.warn("[gsc-client] response body parse failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  const result = mapInspectionResponse({
    body,
    siteUrl,
    inspectionUrl,
    nowIso: nowDate.toISOString(),
  });

  // 5. Persist cache. Write failures are logged but do not change
  // the return value — quota has been burned regardless of whether
  // the cache durably persists.
  await writeCachedInspection({ tenantId, inspection: result });

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Response mapper (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────

/**
 * Map Google's response body into the narrowed
 * `GscUrlInspectionResult` shape. Defensive: every field is
 * extracted via type-guarded property access; missing or
 * non-string values default to `null` so the result type stays
 * stable.
 */
export function mapInspectionResponse(args: {
  body: unknown;
  siteUrl: string;
  inspectionUrl: string;
  nowIso: string;
}): GscUrlInspectionResult {
  const { body, siteUrl, inspectionUrl, nowIso } = args;
  const indexStatus = readIndexStatusResult(body);
  return {
    url: inspectionUrl,
    site_url: siteUrl,
    indexing_state: readStringOrNull(indexStatus, "indexingState"),
    coverage_state: readStringOrNull(indexStatus, "coverageState"),
    last_crawl_time: readStringOrNull(indexStatus, "lastCrawlTime"),
    // J4 (2026-05-18) — extract from the fresh-fetch response body.
    // The cache-read path mirrors this via `rowToEntry(row)` so both
    // entry shapes agree without a separate schema column.
    mobile_usability: extractMobileUsability(body),
    last_checked_at: nowIso,
    raw: body,
  };
}

function readIndexStatusResult(body: unknown): Record<string, unknown> | null {
  if (body == null || typeof body !== "object") return null;
  const ir = (body as Record<string, unknown>).inspectionResult;
  if (ir == null || typeof ir !== "object") return null;
  const indexStatus = (ir as Record<string, unknown>).indexStatusResult;
  if (indexStatus == null || typeof indexStatus !== "object") return null;
  return indexStatus as Record<string, unknown>;
}

function readStringOrNull(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  if (obj == null) return null;
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * J4 (2026-05-18) — derive `mobile_usability: boolean | null` from
 * the verbatim GSC API response body OR a cached `raw` payload.
 *
 * Path: `inspectionResult.mobileUsabilityResult.verdict`.
 *
 * Mapping:
 *   • "MOBILE_FRIENDLY"                                  → true
 *   • "NON_MOBILE_FRIENDLY" / "MOBILE_USABILITY_FAILED"  → false
 *   • "VERDICT_UNSPECIFIED" / absent / non-string        → null
 *
 * Pure: no I/O, deterministic on input. Same helper feeds both the
 * fresh-fetch path (`mapInspectionResponse`) and the cache-read path
 * (`rowToEntry`) so the two views agree by construction.
 */
export function extractMobileUsability(raw: unknown): boolean | null {
  if (raw == null || typeof raw !== "object") return null;
  const ir = (raw as Record<string, unknown>).inspectionResult;
  if (ir == null || typeof ir !== "object") return null;
  const mu = (ir as Record<string, unknown>).mobileUsabilityResult;
  if (mu == null || typeof mu !== "object") return null;
  const verdict = (mu as Record<string, unknown>).verdict;
  if (typeof verdict !== "string") return null;
  if (verdict === "MOBILE_FRIENDLY") return true;
  if (verdict === "VERDICT_UNSPECIFIED") return null;
  // Any other concrete verdict ("NON_MOBILE_FRIENDLY",
  // "MOBILE_USABILITY_FAILED", future variants) → not mobile-friendly.
  return false;
}

/**
 * Test-only export of cache helpers + constants. Mirrors the
 * `citation-lifecycle/load-lifecycle.ts:__testing` pattern.
 */
export const __testing = {
  readCachedInspection,
  writeCachedInspection,
  extractMobileUsability,
  CACHE_TABLE,
  REQUIRED_SCOPE,
  CACHE_TTL_MS,
};

export type { GscUrlInspectionResult } from "./types";
