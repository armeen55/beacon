/**
 * 2026-05-18 — Section 8 J3 — GSC quota stagger.
 *
 * Pure deterministic hash-bucketing helper that maps a `tenantId` to
 * one of six 4-hour windows within a UTC day. Background refresh
 * jobs consult this helper to decide whether NOW is the tenant's
 * scheduled GSC refresh slot, so multi-tenant deployments don't
 * stampede the Google Search Console quota at the top of the hour.
 *
 * Slot map (locked Section 8 J3 decision):
 *
 *   hash byte 0 mod 6   →   slot index (0–5)   →   UTC hour
 *   ────────────────────────────────────────────────────────
 *           0                     0                    0
 *           1                     1                    4
 *           2                     2                    8
 *           3                     3                   12
 *           4                     4                   16
 *           5                     5                   20
 *
 * "In-slot" means the current UTC hour ∈ [slotHour, slotHour + 4).
 *
 * Pure: no I/O. Uses Node `crypto.createHash("sha1")` which is sync
 * + deterministic per input. Time inputs accept Date | number for
 * test-clock injection.
 *
 * Pinned by:
 *   • `tests/lib/connectors/gsc/quota-stagger.test.ts`
 *   • `tests/architecture/gsc-quota-stagger-tenant-isolation.test.ts`
 */

import "server-only";

import { createHash } from "node:crypto";

/** Locked 4-hour window count per UTC day. */
export const STAGGER_BUCKETS = 6;

/** Locked window width in hours (24 / STAGGER_BUCKETS = 4). */
export const STAGGER_WINDOW_HOURS = 24 / STAGGER_BUCKETS;

/** Locked retry policy on 429 (max 3 attempts; exponential backoff). */
export const MAX_RETRIES_ON_429 = 3;

/**
 * Compute the tenant's deterministic stagger slot hour. Pure;
 * `tenantId` is the only input.
 *
 * Returns an integer ∈ { 0, 4, 8, 12, 16, 20 }. Same `tenantId`
 * always maps to the same slot; different `tenantId`s distribute
 * approximately uniformly across the 6 buckets by sha1 hash.
 */
export function staggerSlotHour(tenantId: string): number {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    // Empty / non-string → slot 0. Caller should not be invoking the
    // stagger without a tenant scope; surfacing 0 keeps the contract
    // total without crashing.
    return 0;
  }
  const digest = createHash("sha1").update(tenantId).digest();
  // First byte mod 6 → bucket index ∈ [0, 5]. Multiply by window
  // width to get the slot's start hour.
  const bucket = digest[0]! % STAGGER_BUCKETS;
  return bucket * STAGGER_WINDOW_HOURS;
}

/**
 * Returns `true` when `now`'s UTC hour falls within the tenant's
 * 4-hour stagger window.
 *
 * Pure. `now` defaults to invocation time only when omitted by the
 * caller; production call sites thread their own clock for tests.
 */
export function isStaggerSlotActive(args: {
  tenantId: string;
  now: Date | number;
}): boolean {
  const slotHour = staggerSlotHour(args.tenantId);
  const date =
    args.now instanceof Date ? args.now : new Date(args.now);
  const hour = date.getUTCHours();
  return hour >= slotHour && hour < slotHour + STAGGER_WINDOW_HOURS;
}

/**
 * Pure exponential-backoff schedule helper for 429 retries. Returns
 * the wait time in milliseconds for retry attempt `n` (1-based) per
 * the locked policy.
 *
 *   attempt 1 → 1000 ms
 *   attempt 2 → 2000 ms
 *   attempt 3 → 4000 ms
 *   attempt ≥ MAX_RETRIES_ON_429 → -1 (caller stops)
 */
export function backoffDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return -1;
  if (attempt > MAX_RETRIES_ON_429) return -1;
  return 1000 * Math.pow(2, attempt - 1);
}

/** Test-only export of internals. */
export const __testing = {
  STAGGER_BUCKETS,
  STAGGER_WINDOW_HOURS,
  MAX_RETRIES_ON_429,
};
