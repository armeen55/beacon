/**
 * HonestDelay (FINISHED PRODUCT FP1, 2026-07-02) - what a streamed section says
 * when its loader missed the deadline (see `src/lib/load-with-deadline.ts`).
 * One honest sentence instead of an infinite gray pulse box. The abandoned
 * loader keeps running in the background and warms the cache, so "next visit"
 * is a real promise, not a brush-off. Server component, no client JS.
 */
export function HonestDelay() {
  return (
    <p
      role="status"
      className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
    >
      This section is taking longer than it should. It will be here on your next visit.
    </p>
  );
}
