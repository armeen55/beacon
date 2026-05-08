/**
 * Architecture invariant — UTC-day-anchored budget guard (2026-05-08).
 *
 * Pins the contract for the cron-skip-bug fix that landed after the
 * 2026-05-08 incident:
 *
 *   Root cause (incident): A late prior-day recovery poll completed at
 *   2026-05-07T16:11 UTC. The next scheduled cron at 2026-05-08T07:00 UTC
 *   fired only 14h49m later — within the prior rolling-20h "budget guard"
 *   window — so `defaultHasRecentRun` returned true, `runNativePoll`
 *   returned `skipped_already_ran_today`, NO paid API was called, and
 *   `verify-persistence` failed because target date 2026-05-08 had zero
 *   observations. (LLM budget SHA confirmed zero spend.)
 *
 *   Fix: the rolling 20h window is replaced with a UTC-day-anchored guard.
 *   Skip iff a completed run for `(tenant, source)` exists with
 *   `completed_at >= startOfTodayUtc`. Otherwise run.
 *
 * Negative invariants pinned here (so a future refactor can't quietly
 * regress to the rolling-window shape):
 *   - The string "BUDGET_GUARD_WINDOW_MS" is gone from run-poll.ts.
 *   - The skip-path note no longer contains "last 20 hours".
 *   - The `defaultHasRecentRun` query no longer uses a `Date.now() - <N>h`
 *     cutoff.
 *
 * Positive invariants:
 *   - `utcDayStartIso` is exported from run-poll.ts.
 *   - The guard call site passes both `source` AND `tenantId` to the
 *     deps `hasRecentCompletedRun` (multi-tenant safety).
 *   - The default-impl query uses `.gte("completed_at", utcDayStartIso())`
 *     and conditionally `.eq("tenant_id", tenantId)`.
 *   - The skip-path note contains the phrase "today (UTC)".
 *
 * Source-text invariants rather than DOM probes — this module is a
 * server-only domain layer with no React tree to render.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const RUN_POLL_PATH = join(
  REPO_ROOT,
  "src/domains/observations/run-poll.ts",
);
const RUN_POLL_SRC = readFileSync(RUN_POLL_PATH, "utf-8");

/** Strip block + line + import lines so JSDoc that documents the OLD
 *  shape ("Pre-fix this used a rolling 20h window …") doesn't false-
 *  positive against the negative regex pins. */
function stripCommentsAndImports(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "");
}

describe("UTC-day budget guard — negative invariants (no regression to rolling window)", () => {
  const code = stripCommentsAndImports(RUN_POLL_SRC);

  it("BUDGET_GUARD_WINDOW_MS constant is gone from source code", () => {
    expect(code).not.toMatch(/BUDGET_GUARD_WINDOW_MS/);
  });

  it("skip-path note no longer says 'last 20 hours'", () => {
    expect(code).not.toMatch(/last 20 hours/i);
  });

  it("default-impl query no longer uses an hours-shaped rolling cutoff", () => {
    // Pin the absence of the prior pattern (e.g. `Date.now() - 20 * 60 * 60 * 1000`).
    // Note: the SIBLING `defaultHasRecentChunk` legitimately uses a 15-MINUTE
    // rolling window (`Date.now() - CHUNK_RETRY_DEDUPE_WINDOW_MS`) for chunk
    // retry dedupe — that's intentionally kept. The hours-shaped literal
    // `\d+ * 60 * 60` only appears for HOURS-rolling windows, which is the
    // one we removed.
    expect(code).not.toMatch(/Date\.now\(\)\s*-\s*\d+\s*\*\s*60\s*\*\s*60/);
  });
});

describe("UTC-day budget guard — positive invariants (correct UTC-day shape)", () => {
  it("utcDayStartIso helper is exported from run-poll.ts", () => {
    expect(RUN_POLL_SRC).toMatch(
      /export\s+function\s+utcDayStartIso\s*\(/,
    );
  });

  it("hasRecentCompletedRun deps signature accepts (source, tenantId?: string)", () => {
    // `\s` includes newlines in JS regex. Trailing-comma after the last
    // param is optional — TypeScript / Prettier may emit either shape.
    expect(RUN_POLL_SRC).toMatch(
      /hasRecentCompletedRun\?\:\s*\(\s*source:\s*string\s*,\s*tenantId\?\:\s*string\s*,?\s*\)\s*=>\s*Promise<boolean>/,
    );
  });

  it("call site passes BOTH source AND tenantId to the guard", () => {
    expect(RUN_POLL_SRC).toMatch(
      /hasRecentRun\(\s*source\s*,\s*tenantId\s*\)/,
    );
  });

  it("default impl uses .gte('completed_at', utcDayStartIso())", () => {
    expect(RUN_POLL_SRC).toMatch(
      /\.gte\(\s*["']completed_at["']\s*,\s*startOfDay\s*\)/,
    );
    expect(RUN_POLL_SRC).toMatch(
      /const\s+startOfDay\s*=\s*utcDayStartIso\(\)/,
    );
  });

  it("default impl conditionally scopes by tenant_id when tenantId provided", () => {
    expect(RUN_POLL_SRC).toMatch(
      /if\s*\(\s*tenantId\s*\)\s*\{[\s\S]{0,200}\.eq\(\s*["']tenant_id["']\s*,\s*tenantId\s*\)/,
    );
  });

  it("skip-path note uses the new 'today (UTC)' phrasing", () => {
    expect(RUN_POLL_SRC).toMatch(/today \(UTC\)/);
  });

  it("the file documents the 2026-05-08 fix in the file-top JSDoc", () => {
    // Provenance trail — future readers see WHY the guard is UTC-day-
    // shaped instead of having to dig through git blame.
    expect(RUN_POLL_SRC).toMatch(/2026-05-08/);
    expect(RUN_POLL_SRC).toMatch(/UTC-day/i);
  });
});
