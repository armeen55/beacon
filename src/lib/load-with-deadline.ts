/**
 * load-with-deadline (FINISHED PRODUCT FP1, 2026-07-02) - the one shared way a
 * streamed section bounds its loader so a slow or wedged read can NEVER strand a
 * Suspense fallback (gray pulse boxes) forever or hold the HTTP stream open.
 *
 * Contract: race the loader against a deadline (default 5s). On time -> the data.
 * Past the deadline -> `{ timedOut: true }` and the section renders the honest
 * one-liner (see `src/components/honest-delay.tsx`) instead of an infinite
 * skeleton. The losing loader keeps running in the background, so caches and SWR
 * snapshots it fills still land for the next visit - which is exactly what the
 * honest copy promises.
 *
 * Rejections are NOT swallowed here: a loader that fails fast should keep hitting
 * the caller's own `.catch` / try-catch fail-soft path, same as before.
 */

export const DEFAULT_DEADLINE_MS = 5000;

type DeadlineResult<T> =
  | { timedOut: false; data: T }
  | { timedOut: true; data: null };

const TIMED_OUT = Symbol("beacon.deadline.timedOut");

/** Race `promise` against a deadline. Returns `{data}` on time, `{timedOut: true}` late. */
export async function loadWithDeadline<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_DEADLINE_MS,
): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const winner = await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
    if (winner === TIMED_OUT) {
      // The abandoned loader keeps running (it may still warm a cache); make sure
      // its eventual rejection can never surface as an unhandled crash.
      void promise.catch(() => {});
      return { timedOut: true, data: null };
    }
    return { timedOut: false, data: winner as T };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Convenience for fail-soft reads that already have a natural default: the raced
 * value on time, the given `fallback` past the deadline. Rejections still
 * propagate, so pair with `.catch()` exactly as the call site did before.
 */
export async function valueWithDeadline<T>(
  promise: Promise<T>,
  fallback: T,
  ms: number = DEFAULT_DEADLINE_MS,
): Promise<T> {
  const result = await loadWithDeadline(promise, ms);
  return result.timedOut ? fallback : result.data;
}
