/**
 * Architecture invariant — poll-health partitioner recognizes the
 * direct-CLI workflow shape (2026-05-08 verify-persistence false-fail
 * fix).
 *
 * Pins the contract that the chunk-vs-whole partitioner in
 * `src/domains/observations/poll-health.ts` REQUIRES a numeric
 * `limit=\d+` in the scope_label to classify a run as chunk-mode.
 *
 * Why this invariant exists:
 *
 * The Bundle 2 direct-CLI workflow (2026-05-07) replaced the prior
 * Vercel chunked-curl path. Direct-CLI runs poll 100 prompts in a
 * SINGLE observation_run (chunk offset=0 limit=all), but the adapter's
 * scope_label template still embeds the offset/limit fields. Pre-fix
 * the partitioner regex `/chunk offset=/i` matched both real chunks
 * (limit=25) AND direct-CLI runs (limit=all), routing direct-CLI
 * runs through the chunk-mode branch where EXPECTED_CHUNKS=4 forces
 * a "1/4 partial" verdict — even when 100 obs land cleanly. On
 * 2026-05-08 this caused verify-persistence to fail RED for an hour
 * while we diagnosed.
 *
 * Post-fix the regex `/chunk offset=\d+ limit=\d+/i` requires both
 * offset AND limit to be numeric. `limit=all` falls to whole-mode and
 * reports 1/1 ok. Real chunked runs with `limit=25` are unaffected.
 *
 * Negative invariants:
 *   - The over-broad regex `/chunk offset=/i` (no limit-arity check)
 *     does NOT appear in either filter call.
 *
 * Positive invariants:
 *   - Both filters use `/chunk offset=\d+ limit=\d+/i`.
 *   - The migration provenance comment references 2026-05-08 +
 *     "direct-CLI" + "limit=all".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const POLL_HEALTH_PATH = join(
  REPO_ROOT,
  "src/domains/observations/poll-health.ts",
);
const POLL_HEALTH_SRC = readFileSync(POLL_HEALTH_PATH, "utf-8");

/** Strip block + line comments + import lines so JSDoc that documents
 *  the OLD over-broad regex doesn't false-positive against the
 *  negative pin. */
function stripCommentsAndImports(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*[^;]+;\s*$/gm, "");
}

describe("Direct-CLI classifier contract — 2026-05-08 verify-persistence fix", () => {
  it("partitioner uses the limit-arity-aware regex (numeric limit required)", () => {
    // Both partition calls — the `chunks` filter and the `wholes`
    // negation — must use the tightened regex. Source-text pin so a
    // future refactor can't quietly drop the `\d+ limit=\d+` shape.
    const matches = POLL_HEALTH_SRC.match(
      /\/chunk offset=\\d\+ limit=\\d\+\/i\.test\(r\.scope_label\)/g,
    );
    expect(matches).toBeTruthy();
    if (!matches) return;
    expect(matches.length).toBe(2);
  });

  it("over-broad /chunk offset=/i regex is gone from runtime code (comments allowed)", () => {
    const code = stripCommentsAndImports(POLL_HEALTH_SRC);
    // The over-broad form would match `chunk offset=0 limit=all` AND
    // `chunk offset=0 limit=25`. Pin its absence in runtime code.
    expect(code).not.toMatch(
      /\/chunk offset=\/i\.test\(r\.scope_label\)/,
    );
  });

  it("source documents the 2026-05-08 incident + direct-CLI shape", () => {
    // Provenance trail — future maintainers see WHY the limit-arity
    // check exists.
    expect(POLL_HEALTH_SRC).toMatch(/2026-05-08/);
    expect(POLL_HEALTH_SRC).toMatch(/direct-CLI/);
    expect(POLL_HEALTH_SRC).toMatch(/limit=all/);
  });
});
