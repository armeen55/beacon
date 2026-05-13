/**
 * Emergency P0 fix (2026-05-12) — granular trace labels inside
 * `loadLiveRecommendationQueue`.
 *
 * Production trace showed the function at 33 s total but no
 * sub-step breakdown. These labels let the next operator-driven
 * trace capture identify which call (canonical seed, page reads,
 * adjudicator loop, etc.) dominates the latency.
 *
 * The trace is gated by `BEACON_PERF_TRACE` (NOOP by default), so
 * adding these labels is zero-cost in production until the operator
 * briefly enables tracing for a follow-on capture.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("Emergency P0: load-queue granular trace labels", () => {
  const src = read("src/domains/recommendations/load-queue.ts");

  it("imports createPerfTrace from @/lib/perf-trace", () => {
    expect(src).toMatch(
      /import\s+\{\s*createPerfTrace\s*\}\s+from\s+["']@\/lib\/perf-trace["']/,
    );
  });

  it("creates a per-call trace inside loadLiveRecommendationQueue", () => {
    expect(src).toMatch(
      /export\s+async\s+function\s+loadLiveRecommendationQueue[\s\S]*?const\s+trace\s*=\s*createPerfTrace\(\s*["']load-queue["']/,
    );
  });

  it("times each major sub-step", () => {
    expect(src).toMatch(/trace\.time\(\s*["']seed_canonical_stores["']/);
    expect(src).toMatch(/trace\.time\(\s*["']seed_recommendation_responses["']/);
    expect(src).toMatch(/trace\.time\(\s*["']loadFreshCanonicalData["']/);
    expect(src).toMatch(/trace\.time\(\s*["']buildPromptDecisionMatrix["']/);
    expect(src).toMatch(/trace\.time\(\s*["']generateRecommendations["']/);
    expect(src).toMatch(/trace\.time\(\s*["']pages\+snapshots_parallel["']/);
    expect(src).toMatch(/trace\.time\(\s*["']tenantRepo\.getPages["']/);
    expect(src).toMatch(/trace\.time\(\s*["']tenantRepo\.getPageSnapshots["']/);
    expect(src).toMatch(/trace\.time\(\s*["']buildPageInventory["']/);
    expect(src).toMatch(/trace\.time\(\s*["']resolvePageIntent["']/);
    expect(src).toMatch(/trace\.time\(\s*["']adjudicator_loop["']/);
    expect(src).toMatch(/trace\.time\(\s*["']prioritizeRecommendations["']/);
    expect(src).toMatch(/trace\.time\(\s*["']tenantRepo\.getRecommendedEdits["']/);
    expect(src).toMatch(/trace\.time\(\s*["']getCompetitorPageSnapshotsByUrl["']/);
  });

  it("flushes the trace before returning (both early-return and success path)", () => {
    // Both the no_matrix early return AND the final return should
    // be preceded by a trace.flush() so the per-step timings always
    // emit to the log.
    const flushes = src.match(/\btrace\.flush\(\s*\)/g) ?? [];
    expect(flushes.length).toBeGreaterThanOrEqual(2);
  });

  it("records key data points (candidates_count, queue_count, adjudicated_count)", () => {
    expect(src).toMatch(/trace\.data\(\s*["']candidates_count["']/);
    expect(src).toMatch(/trace\.data\(\s*["']queue_count["']/);
    expect(src).toMatch(/trace\.data\(\s*["']adjudicated_count["']/);
  });
});
