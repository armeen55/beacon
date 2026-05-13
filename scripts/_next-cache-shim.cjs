// CLI-only shim for `next/cache`. Loaded by `mock-next-cache-cli.cjs`
// via `--require` when running diagnostic / backfill scripts outside
// the Next runtime. Production code path uses the real `next/cache`.
//
// • unstable_cache(fn, key, opts) → returns fn (passthrough; no
//   caching, no Next runtime needed).
// • revalidateTag, updateTag, revalidatePath → no-ops.
// • cache (React) → re-exported from "react" so consumers see the
//   real per-request memoization.

function unstable_cache(fn /*, key, opts */) {
  return (...args) => fn(...args);
}

function revalidateTag(/* tag, profile */) {}
function updateTag(/* tag */) {}
function revalidatePath(/* path, type */) {}
function unstable_noStore() {}

module.exports = {
  unstable_cache,
  revalidateTag,
  updateTag,
  revalidatePath,
  unstable_noStore,
};
