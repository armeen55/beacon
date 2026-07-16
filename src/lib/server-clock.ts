import "server-only";

/**
 * Explicit request-time clock for dynamic server surfaces.
 *
 * Keeping the impure read behind a server-only boundary makes client render
 * functions deterministic while still letting dynamic pages timestamp honest
 * receipts and maturity windows at request time.
 */
export function serverNowMs(): number {
  return Date.now();
}
