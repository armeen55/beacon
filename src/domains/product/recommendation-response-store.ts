/**
 * Recommendation Response Store — persists explicit operator responses
 * to Beacon recommendations (accept / dismiss / defer).
 *
 * Provides deterministic feedback that supplements the probabilistic
 * retroactive matching in recommendation-tracker.ts.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  deleteRecommendationResponseByRecId,
  syncRecommendationResponses,
} from "@/lib/persistence/dual-write";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationResponseStatus =
  | "accepted"
  | "dismissed"
  | "deferred";

export type RecommendationResponse = {
  recId: string;
  status: RecommendationResponseStatus;
  respondedAt: string;
  /** ISO date — only set for deferred; re-show after this date */
  deferUntil: string | null;
  /** Fix 2 (2026-04-21) — auto-link context. When the rec has a target URL
   *  and/or pattern at response time, persist it here so `detect-findings`
   *  can match a later-detected change on the same URL back to this
   *  acceptance. Absent on legacy rows. */
  targetPageUrl?: string | null;
  patternId?: string | null;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORE_NAME = "recommendation-responses";
const DEFER_DAYS = 7;

// Phase 7.8b-2-c: top-level await; same module-load-tenant-capture
// caveat as canonical-store / seed-data.server. Phase 7.8e lifts to
// request-scope.
export const recommendationResponses: RecommendationResponse[] =
  await readStore<RecommendationResponse>(STORE_NAME);

// Phase 3.5C (2026-04-22): on Vercel / `DATA_SOURCE=supabase`, the module-init
// `readStore` above returns [] because `.data/*.json` doesn't exist on Vercel's
// read-only FS. `ensureRecommendationResponsesSeeded()` merges DB state into
// the module-level array on first call. Idempotent; callers that need fresh
// data should await this once per request before using `recommendationResponses`,
// `getResponse()`, or `isRecSuppressed()`.
let _dbSeeded = false;
let _dbSeedPromise: Promise<void> | null = null;

export async function ensureRecommendationResponsesSeeded(): Promise<void> {
  if (_dbSeeded) return;
  if (_dbSeedPromise) return _dbSeedPromise;
  if (process.env.DATA_SOURCE !== "supabase") {
    _dbSeeded = true;
    return;
  }
  _dbSeedPromise = (async () => {
    try {
      // Sprint 7 Phase 7.5c/1 (2026-04-25) — tenant-bound read.
      const tenantId = await currentTenantId();
      const rows = await getRepository().forTenant(tenantId).getRecommendationResponses();
      // Keep the newest response per recId (by respondedAt) across the
      // module-init array and the DB rows. Prevents a cold lambda that
      // already did one write from wiping its own fresh state.
      const byId = new Map<string, RecommendationResponse>();
      for (const r of recommendationResponses) byId.set(r.recId, r);
      for (const r of rows) {
        const cur = byId.get(r.recId);
        if (!cur || r.respondedAt > cur.respondedAt) byId.set(r.recId, r);
      }
      recommendationResponses.length = 0;
      recommendationResponses.push(...byId.values());
    } catch (e) {
      console.error("[rec-responses] DB seed failed:", e);
    } finally {
      _dbSeeded = true;
    }
  })();
  return _dbSeedPromise;
}

/** Resets the DB-seed cache. Call after a write that should be reflected on
 *  the next read in this process. */
export function invalidateRecommendationResponsesSeed(): void {
  _dbSeeded = false;
  _dbSeedPromise = null;
}

export async function persistResponses(tenantId: string): Promise<void> {
  await writeStore(STORE_NAME, recommendationResponses);
  await syncRecommendationResponses(recommendationResponses, tenantId);
}

/**
 * Sprint 6A.1.16 (2026-04-25) — Undo path helper.
 *
 * Removes a single response by `recId` from BOTH the in-memory array
 * AND the Supabase row, then re-persists the local file. Splits cleanly
 * from `persistResponses` (which is upsert-only and can't delete) so
 * Undo's intent — "this rec has no operator response" — survives across
 * Vercel lambdas.
 *
 * Returns true when an in-memory row was found + removed, false when
 * the recId wasn't present locally (still attempts the Supabase delete
 * for safety — a row could have been written by a different lambda).
 */
export async function deleteResponseByRecId(
  recId: string,
  tenantId: string,
): Promise<boolean> {
  const idx = recommendationResponses.findIndex((r) => r.recId === recId);
  let removed = false;
  if (idx >= 0) {
    recommendationResponses.splice(idx, 1);
    removed = true;
  }
  await writeStore(STORE_NAME, recommendationResponses);
  await deleteRecommendationResponseByRecId(recId, tenantId);
  return removed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getResponse(
  recId: string,
): RecommendationResponse | undefined {
  return recommendationResponses.find((r) => r.recId === recId);
}

/**
 * Returns true if this recommendation should be hidden from the operator
 * right now (dismissed, or deferred and not yet due).
 */
export function isRecSuppressed(recId: string): boolean {
  const resp = getResponse(recId);
  if (!resp) return false;
  if (resp.status === "dismissed") return true;
  if (resp.status === "deferred" && resp.deferUntil) {
    return new Date(resp.deferUntil).getTime() > Date.now();
  }
  return false;
}

/**
 * Phase 4.3 (Sprint 4, 2026-04-24) — pure fresh-map variants.
 *
 * The module-level `recommendationResponses` array suffers cross-lambda
 * staleness (a write on lambda B is invisible on lambda A whose
 * `_dbSeeded=true` is already cached). Render paths that need durable truth
 * must fetch `getRepository().getRecommendationResponses()` fresh per request
 * and use these pure helpers to decorate / suppress recs. Non-render
 * callers (replication-engine) continue to use the module-reading variants
 * above until Sprint 5's MEDIUM sweep.
 */
export function getResponseFromMap(
  recId: string,
  responsesByRecId: Map<string, RecommendationResponse>,
): RecommendationResponse | undefined {
  return responsesByRecId.get(recId);
}

export function isRecSuppressedFromMap(
  recId: string,
  responsesByRecId: Map<string, RecommendationResponse>,
  now: number = Date.now(),
): boolean {
  const resp = responsesByRecId.get(recId);
  if (!resp) return false;
  if (resp.status === "dismissed") return true;
  if (resp.status === "deferred" && resp.deferUntil) {
    return new Date(resp.deferUntil).getTime() > now;
  }
  return false;
}

/**
 * Record an operator response to a recommendation.
 * Upserts — a new response for the same recId replaces the old one.
 *
 * Fix 2 (2026-04-21) — accepts optional `context` carrying `targetPageUrl`
 * and `patternId` so `detect-findings` can auto-link a later-detected change
 * on that URL back to this acceptance. Non-blocking: callers that don't
 * know the context can omit it.
 */
export function recordResponse(
  recId: string,
  status: RecommendationResponseStatus,
  context?: { targetPageUrl?: string | null; patternId?: string | null },
): void {
  const now = new Date().toISOString();
  const existing = recommendationResponses.findIndex(
    (r) => r.recId === recId,
  );

  // Preserve existing context on status updates (e.g. acceptance recorded
  // with URL, then later toggled to deferred) — don't clobber with
  // undefined if the new call omitted context.
  const prior = existing >= 0 ? recommendationResponses[existing] : undefined;

  const entry: RecommendationResponse = {
    recId,
    status,
    respondedAt: now,
    deferUntil:
      status === "deferred"
        ? new Date(Date.now() + DEFER_DAYS * 86_400_000).toISOString()
        : null,
    targetPageUrl: context?.targetPageUrl ?? prior?.targetPageUrl ?? null,
    patternId: context?.patternId ?? prior?.patternId ?? null,
  };

  if (existing >= 0) {
    recommendationResponses[existing] = entry;
  } else {
    recommendationResponses.push(entry);
  }
}
