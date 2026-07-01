/**
 * Perf bundle 7 (2026-05-12) — source-level pin for the production
 * perf trace wiring.
 *
 * The trace is gated by `BEACON_PERF_TRACE=true` — disabled by default,
 * with zero runtime cost. This guard ensures every signed-in entry
 * point (middleware + shell layout + 7 page loaders) imports the
 * utility and calls `createPerfTrace(...)`, so when the operator
 * flips the env flag in production, EVERY request emits the
 * correlated trace lines that let us correlate middleware → layout →
 * loader latency.
 *
 * If a future edit removes the trace from any of these 9 surfaces,
 * this pin catches it before deploy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

const TRACED_FILES = [
  { rel: "src/lib/auth/supabase-middleware.ts", phase: "middleware" },
  { rel: "src/app/(shell)/layout.tsx", phase: "shell-layout" },
  { rel: "src/app/(shell)/page.tsx", phase: "loader:/" },
  // Move 5 (2026-07-01): /recommendations index is now a thin redirect to
  // /worklist?status=ready (a duplicate list of the same moves the canonical
  // Changes list already shows). A redirect has no loader latency to trace, so
  // it drops off this list. The deep per-rec brief still traces below.
  {
    rel: "src/app/(shell)/recommendations/[id]/page.tsx",
    phase: "loader:/recommendations/[id]",
  },
  // IA consolidation (2026-06-23): /changes index is now a thin redirect to
  // /proof; its heavy traced loader moved into the embedded ResultsTimeline.
  {
    rel: "src/app/(shell)/changes/results-timeline.tsx",
    phase: "loader:results-timeline",
  },
  { rel: "src/app/(shell)/changes/[id]/page.tsx", phase: "loader:/changes/[id]" },
  { rel: "src/app/(shell)/prompts/page.tsx", phase: "loader:/prompts" },
  { rel: "src/app/(shell)/prompts/[id]/page.tsx", phase: "loader:/prompts/[id]" },
  {
    rel: "src/app/(shell)/settings/prompts/page.tsx",
    phase: "loader:/settings/prompts",
  },
];

describe("Perf trace wired across signed-in entry points", () => {
  for (const { rel, phase } of TRACED_FILES) {
    describe(rel, () => {
      const src = read(rel);

      it("imports createPerfTrace from @/lib/perf-trace", () => {
        expect(src).toMatch(
          /import\s+\{[^}]*createPerfTrace[^}]*\}\s+from\s+["']@\/lib\/perf-trace["']/,
        );
      });

      it(`calls createPerfTrace with phase=${phase}`, () => {
        // Pin the phase label so the log lines are stable and greppable.
        const escaped = phase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        expect(src).toMatch(
          new RegExp(`createPerfTrace\\(\\s*["']${escaped}["']`),
        );
      });

      it("flushes the trace (trace.flush() appears at least once)", () => {
        expect(src).toMatch(/\btrace\.flush\(\s*\)/);
      });
    });
  }
});

describe("Middleware perf trace specifics", () => {
  const src = read("src/lib/auth/supabase-middleware.ts");

  it("imports PERF_TRACE_HEADER_NAME and forwards the trace ID via header when enabled", () => {
    expect(src).toMatch(
      /import\s+\{[^}]*PERF_TRACE_HEADER_NAME[^}]*\}\s+from\s+["']@\/lib\/perf-trace["']/,
    );
    expect(src).toMatch(
      /requestHeaders\.set\(\s*PERF_TRACE_HEADER_NAME\s*,\s*trace\.id\s*\)/,
    );
  });

  it("times auth.getUser via trace.time('auth.getUser', …)", () => {
    expect(src).toMatch(
      /trace\.time\(\s*["']auth\.getUser["']\s*,\s*\(\)\s*=>\s*supabase\.auth\.getUser\(\)/,
    );
  });

  it("times tenant_lookup via trace.time('tenant_lookup', …)", () => {
    expect(src).toMatch(/trace\.time\(\s*["']tenant_lookup["']/);
  });
});

describe("Shell layout perf trace specifics", () => {
  const src = read("src/app/(shell)/layout.tsx");

  it("reads trace ID from request headers via the safe helper", () => {
    // Bundle 7 (2026-05-12) — switched from a raw `headers().get(...)`
    // call to `readPerfTraceIdFromHeaders()` so test harnesses that
    // render the page outside a Next request scope (smoke tests,
    // RSC snapshot tests) don't crash.
    expect(src).toMatch(/readPerfTraceIdFromHeaders\(\s*\)/);
  });

  it("times each of the 4 parallel awaits + getWatchingUrlOutcomes", () => {
    expect(src).toMatch(/trace\.time\(\s*["']ensureUrlChangeOutcomesSeeded["']/);
    expect(src).toMatch(/trace\.time\(\s*["']getPendingFindings["']/);
    expect(src).toMatch(/trace\.time\(\s*["']hasActiveExperiment["']/);
    expect(src).toMatch(/trace\.time\(\s*["']getChangelogEntries["']/);
    expect(src).toMatch(/trace\.time\(\s*["']getWatchingUrlOutcomes["']/);
  });
});
