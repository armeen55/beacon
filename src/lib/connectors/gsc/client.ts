/**
 * 2026-05-16 A.3.b1.alpha — Google Search Console URL Inspection
 * client (operator-substrate; NOT wired into indexability or customer
 * surfaces yet).
 *
 * Single public function: `gscUrlInspect({ tenantId, siteUrl,
 * inspectionUrl, now })`. Resolves the tenant slug from the explicit
 * `tenantId`, reads/writes a tenant-scoped disk cache, and (when
 * needed) calls Google's URL Inspection API. Returns null in every
 * documented fail-soft scenario so consumers never need to wrap the
 * call in try/catch — typical for the Section 7 / Section 5
 * connector pattern.
 *
 * Locked posture (A.3.b1.alpha):
 *   • Pure read-side client + cache. NO indexability integration.
 *     NO diagnostic-page render. NO customer copy. Wiring lands in
 *     A.3.b1.beta as a separate slice.
 *   • Cache is path-tenant-scoped via `getDataDir(slug)`. Tenant
 *     slug is resolved from the EXPLICIT `tenantId` parameter (NOT
 *     ambient `currentTenantSlug()`), mirroring the locked
 *     `profound-import-runs-explicit-tenant-scope` invariant pattern.
 *     The cache file path is `.data/tenants/{slug}/gsc-url-
 *     inspections.json`.
 *   • Token read uses the existing `getGoogleConnectorToken()` helper
 *     which currently reads from the flat `.data/connector-tokens.json`
 *     path (Section 7 multi-tenant prerequisite is parked; connector
 *     tokens are process-shared today). When that prerequisite lands,
 *     the token-read seam updates without touching this file.
 *   • Fail-soft return path returns `null` for every documented
 *     skip reason (no token, missing scope, missing site_url, etc.).
 *     Throws only on programmer-error conditions (e.g., crypto
 *     failures inside fetch); never on normal not-connected /
 *     not-scoped states.
 *
 * Pinned by `tests/architecture/gsc-client-tenant-isolation.test.ts`.
 */

import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getDataDir } from "@/lib/tenant";
import { getTenant } from "@/domains/tenants/store";
import { getGoogleConnectorToken } from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { log } from "@/lib/logger";

import type {
  GscInspectionCacheEntry,
  GscInspectionCacheFile,
  GscUrlInspectionResult,
} from "./types";

const GSC_INSPECT_ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const CACHE_FILE_NAME = "gsc-url-inspections.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// Tenant slug resolver — explicit tenantId only
// ─────────────────────────────────────────────────────────────────────

/**
 * Mirror of `tenant-repo.ts:resolveSlugForTenant`. Inlined here to
 * avoid cross-file coupling (the repo helper is unexported and
 * importing it would force a wider invariant scope). Operator-
 * bootstrap fallback fires ONLY when the explicit `tenantId`
 * matches `BEACON_TENANT_ID` AND `BEACON_TENANT_SLUG` is set.
 */
async function resolveSlugForTenant(tenantId: string): Promise<string | null> {
  const tenant = await getTenant(tenantId);
  if (tenant) return tenant.slug;
  const envId = process.env.BEACON_TENANT_ID;
  const envSlug = process.env.BEACON_TENANT_SLUG;
  if (envId && envSlug && envId === tenantId) return envSlug;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Cache I/O
// ─────────────────────────────────────────────────────────────────────

function cacheFilePathForSlug(slug: string): string {
  return join(getDataDir(slug), CACHE_FILE_NAME);
}

function readCacheForSlug(slug: string): GscInspectionCacheFile {
  const filePath = cacheFilePathForSlug(slug);
  if (!existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as GscInspectionCacheFile;
}

function writeCacheForSlug(slug: string, cache: GscInspectionCacheFile): void {
  // `getDataDir(slug)` already calls `mkdirSync(..., { recursive: true })`
  // on non-Vercel; defensive recreation here covers Vercel writes that
  // succeed in-memory (lambda FS is read-only post-init, so a real-disk
  // write throws — wrap and degrade quietly).
  const dir = getDataDir(slug);
  try {
    if (process.env.VERCEL !== "1" && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (process.env.VERCEL === "1") {
      // Vercel: lambda FS is read-only post-init; cache write would
      // throw EROFS. Skip silently. Future A.3.b2 slice migrates to
      // Supabase durable storage.
      return;
    }
    writeFileSync(cacheFilePathForSlug(slug), JSON.stringify(cache, null, 2));
  } catch (e) {
    log.warn("[gsc-client] cache write failed; continuing without persisted cache", {
      slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }
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
 * the API, writes the result to the tenant-scoped disk cache, and
 * returns the new result. Returns `null` on any fail-soft skip:
 *
 *   • no `tenantId` → unreachable (parameter is required)
 *   • slug unresolvable for the given tenantId
 *   • no Google token connected
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

  if (siteUrl == null || siteUrl === "") return null;
  if (inspectionUrl == null || inspectionUrl === "") return null;

  const slug = await resolveSlugForTenant(tenantId);
  if (slug == null) return null;

  // 1. Cache check — return fresh entry without touching the API.
  const cache = readCacheForSlug(slug);
  const existing = cache[inspectionUrl];
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
  const token = await getGoogleConnectorToken("gsc");
  if (token == null) return null;
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return null;
  }

  // 3. Resolve access token. Refresh if expired (or about to expire
  // within 60s); the existing google-auth helper handles the OAuth
  // refresh wire-up.
  let accessToken = token.access_token;
  const nowMs = nowDate.getTime();
  if (typeof token.expires_at === "number" && token.expires_at - 60_000 <= nowMs) {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token);
      accessToken = refreshed.access_token;
      // Best-effort persistence is the connector-store's job; this
      // client doesn't mutate the token store directly to keep its
      // surface read-only. The next caller's token lookup will hit
      // the still-valid (un-rotated on disk) token, retry refresh,
      // and get a fresh access_token. Acceptable cold-path cost.
    } catch (e) {
      log.warn("[gsc-client] token refresh failed; skipping inspection", {
        slug,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
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
      slug,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  if (!response.ok) {
    log.warn("[gsc-client] non-2xx response from GSC URL Inspection API", {
      slug,
      status: response.status,
    });
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    log.warn("[gsc-client] response body parse failed", {
      slug,
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

  // 5. Persist cache.
  const updatedCache: GscInspectionCacheFile = { ...cache, [inspectionUrl]: result };
  writeCacheForSlug(slug, updatedCache);

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
 * Test-only export of cache helpers. Mirrors the
 * `citation-lifecycle/load-lifecycle.ts:__testing` pattern.
 */
export const __testing = {
  cacheFilePathForSlug,
  readCacheForSlug,
  writeCacheForSlug,
  resolveSlugForTenant,
  REQUIRED_SCOPE,
  CACHE_TTL_MS,
};

export type { GscUrlInspectionResult } from "./types";
