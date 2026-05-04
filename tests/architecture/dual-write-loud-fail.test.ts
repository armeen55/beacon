/**
 * Architecture invariant — dual-write must throw on persistent
 * Supabase errors. Pure source-scan; no DB calls.
 *
 * Background (Bug-1, 2026-05-04):
 *
 * Between May 1 ~22:00 UTC and May 4 ~20:08 UTC, the shared
 * native-poll adapter (`src/adapters/perplexity/poll.ts:591`,
 * shared by `src/adapters/openai/poll.ts` via thin wrapper) wrote
 * `competitor_descriptor_windows` into every observation row.
 * The target Supabase table did not have that column until the W4
 * Stage 7 schema migration landed at ~20:08 UTC May 4.
 *
 * For the 3 days in between, every native poll's first batch was
 * rejected by Supabase (PGRST204: "column not in schema cache").
 * `dualWriteUpsert` logged the error to console.error but did NOT
 * throw — because the throw was gated on
 * `process.env.DATA_SOURCE === "supabase"`, which the cron env
 * doesn't set. The poll-adapter then stamped `observation_runs` as
 * `status: "completed"` with `scope_label` carrying "25/25 prompts"
 * even though zero rows persisted. /today's PollHealthBlock parsed
 * the scope_label and rendered "Poll (May 4): complete · 4/4 ·
 * 100 prompts" while showing "Last observation: 2026-05-01" —
 * an internally-contradictory UI.
 *
 * The fix drops the conditional: dual-write throws on persistent
 * error regardless of DATA_SOURCE. This invariant prevents the
 * conditional from being reintroduced.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DUAL_WRITE_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/persistence/dual-write.ts"),
  "utf-8",
);

describe("dual-write — loud-fail invariant (Bug-1 fix, 2026-05-04)", () => {
  it("does NOT gate the persistent-error throw on process.env.DATA_SOURCE", () => {
    // Pre-fix code had two `if (process.env.DATA_SOURCE === "supabase")`
    // gates around `throw new Error(...)` and `throw e`. Any reintroduction
    // would re-enable the silent-fail bug.
    expect(DUAL_WRITE_SRC).not.toMatch(
      /if\s*\(\s*process\.env\.DATA_SOURCE\s*===\s*"supabase"\s*\)\s*\{[\s\S]*?throw/,
    );
  });

  it("retains the throw — both the per-chunk error AND the outer-catch re-throw", () => {
    // The function still must throw, just unconditionally.
    expect(DUAL_WRITE_SRC).toMatch(/throw new Error\(/);
    // The outer catch re-throws as well (no silent swallow).
    expect(DUAL_WRITE_SRC).toMatch(
      /catch\s*\(\s*e\s*\)\s*\{[\s\S]*?console\.error[\s\S]*?throw\s+e\s*;/,
    );
  });

  it("the inline rationale references Bug-1 + 2026-05-04 + the silent-failure pattern", () => {
    // Future maintainers MUST see why the gate was removed before
    // accidentally reintroducing it.
    expect(DUAL_WRITE_SRC).toMatch(/Bug-1/);
    expect(DUAL_WRITE_SRC).toMatch(/2026-05-04/);
    expect(DUAL_WRITE_SRC).toMatch(
      /silent(?:ly)?\s+(?:fail|swallow|completed-poll signature)/i,
    );
  });
});
