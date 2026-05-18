/**
 * 2026-05-17 A.3.b1.beta — GSC signal adapter for the indexability
 * loader.
 *
 * Thin seam between `src/lib/connectors/gsc/client.ts` (operator-
 * substrate URL Inspection client + Supabase cache) and the
 * indexability verdict pipeline.
 *
 *   loadGscSignal({ tenantId, inspectionUrl, allowFreshFetch })
 *     → IndexabilityGscSignal | null
 *
 * Two modes:
 *   • allowFreshFetch=false (cache-read only): SELECT directly from
 *     `public.gsc_url_inspections` via the Supabase admin client.
 *     NEVER triggers a Google API call. Used for URLs that aren't
 *     in the current render's fresh-fetch budget.
 *   • allowFreshFetch=true: invokes `gscUrlInspect()` which honors
 *     the 24h Supabase cache TTL — only hits the Google API on
 *     cache miss / stale entry. Used for the top-K URLs selected
 *     by the loader's prioritization rule.
 *
 * Operator-substrate posture (preserved from A.3.b1.alpha + A.3.b2):
 *   • Explicit `tenantId`. No ambient `currentTenantId()` reads.
 *   • `BEACON_GSC_SITE_URL` env var is the SOLE source of the GSC
 *     property identifier. Never hardcoded.
 *   • Returns `null` on every fail-soft scenario so callers don't
 *     need try/catch.
 *   • NO customer-surface imports. The opt-in flag on
 *     `loadIndexabilityForUrl` ensures customer-facing callers never
 *     reach this code.
 *   • Pinned by `tests/architecture/load-gsc-signal-tenant-scope.test.ts`.
 *
 * Per-render budget:
 *   `GSC_INSPECT_PER_RENDER_LIMIT = 5` exported as the locked cap.
 *   Even though A.3.b2 made the cache durable on Vercel (so cold-
 *   start quota burn is bounded by the URL count regardless), the
 *   per-render cap is the structural defense — any future caller
 *   that forgets to honor it can't melt quota.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { gscUrlInspect } from "@/lib/connectors/gsc/client";
import { log } from "@/lib/logger";

import type { IndexabilityGscSignal } from "./types";

/**
 * Locked per-render fresh-fetch cap. Caller threads a budget counter
 * through `loadIndexabilityForUrl(..., gscBudget)`; once the budget
 * hits zero, remaining URLs in the same render get `allowFreshFetch=
 * false` (cache-read only). Pinned by
 * `tests/architecture/load-gsc-signal-tenant-scope.test.ts` AND
 * `tests/domains/indexability/load-indexability.test.ts`.
 */
export const GSC_INSPECT_PER_RENDER_LIMIT = 5;

const CACHE_TABLE = "gsc_url_inspections";

/**
 * Read the operator-configured GSC property identifier. Returns null
 * when unset OR empty; adapter fail-softs to `null` signal. Never
 * hardcoded in source.
 */
function getGscSiteUrl(): string | null {
  const v = process.env.BEACON_GSC_SITE_URL;
  if (v == null) return null;
  const trimmed = v.trim();
  if (trimmed === "") return null;
  return trimmed;
}

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

// ─────────────────────────────────────────────────────────────────────
// Indexing-state mapping
// ─────────────────────────────────────────────────────────────────────

/**
 * Coverage-state regex set for the indexed-positive case. Matches
 * Google's `coverage_state` strings that imply "indexed":
 *   • "Submitted and indexed"
 *   • "Indexed, not submitted in sitemap"
 *   • "Indexed, low interest"
 *   • Any "Serving as canonical" variant
 */
const INDEXED_COVERAGE_PATTERNS = [
  /^submitted\s+and\s+indexed/i,
  /^indexed\b/i,
  /serving\s+as\s+canonical/i,
];

/** Not-indexed coverage patterns. */
const NOT_INDEXED_COVERAGE_PATTERNS = [
  /\bnot\s+indexed\b/i,
  /\bdiscovered\b[^.]*\bnot\s+indexed\b/i,
  /\bcrawled\b[^.]*\bnot\s+indexed\b/i,
];

/** `indexing_state` tokens that mean "not indexed" regardless of coverage_state. */
const NOT_INDEXED_INDEXING_STATES: ReadonlySet<string> = new Set([
  "BLOCKED_BY_ROBOTS_TXT",
  "BLOCKED_BY_NOINDEX",
  "BLOCKED_BY_OTHER_4XX",
  "NOT_INDEXED_OTHER_REASON",
]);

/**
 * Pure mapping: GSC client result → `indexed: boolean | null`.
 *
 *   • indexed=true: `indexing_state === "INDEXING_ALLOWED"` AND
 *     `coverage_state` matches an indexed-positive pattern.
 *   • indexed=false: any not-indexed `indexing_state` token, OR
 *     `coverage_state` matches a not-indexed pattern even when
 *     `indexing_state === "INDEXING_ALLOWED"`.
 *   • indexed=null: indexing_state unrecognized AND coverage_state
 *     doesn't match either set. Adapter still returns the signal
 *     (with `indexed: null`) so the operator UI can render the raw
 *     enum value for triage.
 */
export function deriveIndexedFlag(args: {
  indexing_state: string | null;
  coverage_state: string | null;
}): boolean | null {
  const { indexing_state, coverage_state } = args;
  if (indexing_state != null && NOT_INDEXED_INDEXING_STATES.has(indexing_state)) {
    return false;
  }
  if (coverage_state != null) {
    for (const pat of NOT_INDEXED_COVERAGE_PATTERNS) {
      if (pat.test(coverage_state)) return false;
    }
  }
  if (indexing_state === "INDEXING_ALLOWED" && coverage_state != null) {
    for (const pat of INDEXED_COVERAGE_PATTERNS) {
      if (pat.test(coverage_state)) return true;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Public adapter API
// ─────────────────────────────────────────────────────────────────────

export type LoadGscSignalArgs = {
  tenantId: string;
  inspectionUrl: string;
  /**
   * When true, the adapter may invoke `gscUrlInspect()` which can
   * (on cache miss) trigger a Google API call. When false, the
   * adapter reads the Supabase cache directly and NEVER calls the
   * API. Caller (loader) decides per URL based on the
   * `GSC_INSPECT_PER_RENDER_LIMIT` budget.
   */
  allowFreshFetch: boolean;
  /** Optional clock for cache-staleness math. Defaults to now. */
  now?: Date | string;
};

/**
 * Load the GSC signal for one (tenantId, inspectionUrl) pair.
 *
 * Returns `null` on every fail-soft path:
 *   • `BEACON_GSC_SITE_URL` unset / empty
 *   • `tenantId` empty or `inspectionUrl` empty
 *   • cache-read Supabase admin init failure
 *   • cache-read `42P01` (table missing — sequencing model A)
 *   • cache-read returned no row AND `allowFreshFetch=false`
 *   • `gscUrlInspect()` returned `null` (no token, missing scope,
 *     fetch failure, non-2xx)
 *
 * Returns a non-null `IndexabilityGscSignal` only when a cache row
 * was found OR a fresh inspection returned data.
 */
export async function loadGscSignal(
  args: LoadGscSignalArgs,
): Promise<IndexabilityGscSignal> {
  const { tenantId, inspectionUrl, allowFreshFetch } = args;
  if (tenantId == null || tenantId === "") return null;
  if (inspectionUrl == null || inspectionUrl === "") return null;

  const siteUrl = getGscSiteUrl();
  if (siteUrl == null) return null;

  // 1. Cache-read path — always attempted. Returns the cached entry
  // when present (regardless of TTL — the staleness gate lives inside
  // gscUrlInspect; here we just surface what's stored). When
  // allowFreshFetch=false, this is the only signal source.
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // Supabase env unset (dev). Fall through; if allowFreshFetch=true
    // gscUrlInspect will also fail-soft to null.
    admin = null;
  }

  type CacheRow = {
    indexing_state: string | null;
    coverage_state: string | null;
    last_crawl_time: string | null;
    last_checked_at: string;
  };
  let cached: CacheRow | null = null;

  if (admin != null) {
    const { data, error } = await admin
      .from(CACHE_TABLE)
      .select("indexing_state, coverage_state, last_crawl_time, last_checked_at")
      .eq("tenant_id", tenantId)
      .eq("inspection_url", inspectionUrl)
      .maybeSingle();

    if (error != null) {
      if (!isUndefinedTableError(error)) {
        log.warn("[load-gsc-signal] cache read failed; degrading", {
          tenantId,
          error: error.message ?? String(error),
        });
      }
      // 42P01 OR other read error: fall through to allowFreshFetch
      // branch (or return null if disallowed).
    } else if (data != null) {
      cached = data as CacheRow;
    }
  }

  if (cached != null && !allowFreshFetch) {
    return {
      indexed: deriveIndexedFlag(cached),
      indexing_state: cached.indexing_state,
      coverage_state: cached.coverage_state,
      last_crawl_time: cached.last_crawl_time,
      last_checked_at: cached.last_checked_at,
    };
  }

  // 2. Fresh-fetch path — only when caller permits. gscUrlInspect
  // itself honors the 24h cache TTL, so this is at most one API
  // call per (tenantId, inspectionUrl) per 24h.
  if (allowFreshFetch) {
    const result = await gscUrlInspect({
      tenantId,
      siteUrl,
      inspectionUrl,
      now: args.now,
    });
    if (result == null) {
      // gscUrlInspect fail-softed (no token, missing scope, etc.).
      // If we had a stale cache row, surface that — better than null.
      if (cached != null) {
        return {
          indexed: deriveIndexedFlag(cached),
          indexing_state: cached.indexing_state,
          coverage_state: cached.coverage_state,
          last_crawl_time: cached.last_crawl_time,
          last_checked_at: cached.last_checked_at,
        };
      }
      return null;
    }
    return {
      indexed: deriveIndexedFlag({
        indexing_state: result.indexing_state,
        coverage_state: result.coverage_state,
      }),
      indexing_state: result.indexing_state,
      coverage_state: result.coverage_state,
      last_crawl_time: result.last_crawl_time,
      last_checked_at: result.last_checked_at,
    };
  }

  // 3. allowFreshFetch=false AND no cache row → null signal.
  return null;
}

/**
 * Test-only export of internals + constants.
 */
export const __testing = {
  deriveIndexedFlag,
  getGscSiteUrl,
  CACHE_TABLE,
  GSC_INSPECT_PER_RENDER_LIMIT,
};
