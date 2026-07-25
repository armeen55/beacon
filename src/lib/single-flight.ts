import "server-only";

/**
 * single-flight (W2-B, 2026-07-10) - collapse concurrent background rebuilds of
 * the same keyed job to ONE in-flight run.
 *
 * The SWR surfaces (/results measured ledger, /changes fused list) schedule a
 * background rebuild via next/after() whenever the served snapshot is stale. With
 * no guard, two requests that both observe the same stale snapshot in the same
 * lambda each schedule a full rebuild - two overlapping full-ledger re-measures /
 * two demand-graph fuses doing identical work and racing to write the same blob.
 *
 * This keeps a process-level map of the in-flight promise per job key. A second
 * caller with the same key while one is running joins the existing promise instead
 * of starting a second run; the key clears when the run settles so the NEXT stale
 * observation can refresh again. In-process only (each Vercel lambda has its own
 * map) - which is exactly the scope of these in-memory-warmed SWR caches; it does
 * not, and does not need to, dedupe across instances.
 */

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Run `fn` under `key`, or join the run already in flight for that key. The
 * returned promise resolves/rejects with the shared run. The key is always
 * cleared when the run settles (success or failure), so the next request can
 * trigger a fresh rebuild.
 */
export function runSingleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const run = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

/** True when a run is currently in flight for `key`. (Diagnostics / tests.) */
/** Number of distinct keys currently in flight. (Diagnostics / tests.) */
/** Clear all in-flight state. TEST-ONLY reset between cases. */
