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

/** Locked retry policy on 429 (max 3 attempts; exponential backoff). */
const MAX_RETRIES_ON_429 = 3;

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

