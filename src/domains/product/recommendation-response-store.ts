/**
 * Recommendation Response Store — persists explicit operator responses
 * to Beacon recommendations (accept / dismiss / defer).
 *
 * Provides deterministic feedback that supplements the probabilistic
 * retroactive matching in recommendation-tracker.ts.
 */

import "server-only";

import { cache } from "react";

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

// Sprint 7 Phase 7.8e-3 (2026-04-26): module-level top-level await replaced
// with cached async getter. Phase 3.5C DB-merge logic preserved verbatim —
// runs on first getter call when DATA_SOURCE=supabase. Mutators
// (`recordResponse`, `deleteResponseByRecId`) became async; helpers
// (`getResponse`, `isRecSuppressed`) became async.
let _state: RecommendationResponse[] | null = null;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== null) return;
  _state = await readStore<RecommendationResponse>(STORE_NAME);

  // Phase 3.5C (2026-04-22): on Vercel / DATA_SOURCE=supabase the disk read
  // returned [] because the JSON file doesn't exist on the read-only FS.
  // Merge from `recommendation_responses` table so getters see real data.
  if (process.env.DATA_SOURCE === "supabase") {
    try {
      const tenantId = await currentTenantId();
      const rows = await getRepository().forTenant(tenantId).getRecommendationResponses();
      const byId = new Map<string, RecommendationResponse>();
      for (const r of _state) byId.set(r.recId, r);
      for (const r of rows) {
        const cur = byId.get(r.recId);
        if (!cur || r.respondedAt > cur.respondedAt) byId.set(r.recId, r);
      }
      _state.length = 0;
      _state.push(...byId.values());
    } catch (e) {
      console.error("[rec-responses] DB seed failed:", e);
    }
  }
});

export const getRecommendationResponses = cache(
  async (): Promise<RecommendationResponse[]> => {
    await ensureLoaded();
    return _state!;
  },
);

/**
 * Backwards-compat shim. Pre-7.8e-3 callers chained
 * `ensureRecommendationResponsesSeeded()` to force the DB merge. Post-7.8e-3
 * the merge runs automatically on first getter call.
 */
export async function ensureRecommendationResponsesSeeded(): Promise<void> {
  await ensureLoaded();
}

/** Resets the seed cache. Call after a write that should be reflected on
 *  the next read in this process. */
export function invalidateRecommendationResponsesSeed(): void {
  _state = null;
}

export async function persistResponses(tenantId: string): Promise<void> {
  const recommendationResponses = await getRecommendationResponses();
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
 */
export async function deleteResponseByRecId(
  recId: string,
  tenantId: string,
): Promise<boolean> {
  const recommendationResponses = await getRecommendationResponses();
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

export async function getResponse(
  recId: string,
): Promise<RecommendationResponse | undefined> {
  return (await getRecommendationResponses()).find((r) => r.recId === recId);
}

/**
 * Returns true if this recommendation should be hidden from the operator
 * right now (dismissed, or deferred and not yet due).
 */
export async function isRecSuppressed(recId: string): Promise<boolean> {
  const resp = await getResponse(recId);
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
 * Render paths that need durable truth fetch
 * `getRepository().getRecommendationResponses()` fresh per request and
 * use these pure helpers to decorate / suppress recs. Non-render callers
 * use the module-reading variants above.
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
export async function recordResponse(
  recId: string,
  status: RecommendationResponseStatus,
  context?: { targetPageUrl?: string | null; patternId?: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  const recommendationResponses = await getRecommendationResponses();
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
