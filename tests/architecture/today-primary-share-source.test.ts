/**
 * Architecture invariant — Section 6 C4b customer-visible source-swap
 * (2026-05-15).
 *
 * Pins the Today hero's primary-recommendation pct source contract:
 *   1. `src/app/(shell)/today-v2-data.ts` imports
 *      `computeTodayPrimaryShare` from the C4a helper module.
 *   2. `today-v2-data.ts` invokes `computeTodayPrimaryShare(`
 *      EXACTLY ONCE (one call site per render path).
 *   3. The active production client
 *      `src/app/(shell)/today-v2-visibility-group-client.tsx` does NOT
 *      contain the legacy `platformPrimaryPct` closure body.
 *   4. The active production client does NOT read
 *      `sparkline.points[i].primaryRate` for the hero pct values.
 *      `sampleStatus` reads remain allowed — they are a separate
 *      signal from primary share.
 *
 * Companion runtime tests:
 *   - `tests/components/today/today-v2-visibility-group-client-primary-share-source.test.tsx`
 *     (renders the prop verbatim; doesn't read sparkline primaryRate)
 *   - `tests/domains/today/today-primary-share-equivalence.test.ts`
 *     (math equivalence between OLD path and NEW path)
 *
 * Legacy `today-client.tsx` and `today-v2-client.tsx` are NOT pinned
 * by this invariant per J2 — they're not on the production hot path
 * and retain their closure to minimize blast radius. If those files
 * are ever re-activated, the swap + pin should land in the same
 * commit.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

const TODAY_V2_DATA = read("src/app/(shell)/today-v2-data.ts");
const TODAY_V2_CLIENT = read(
  "src/app/(shell)/today-v2-visibility-group-client.tsx",
);

// Strip block + line comments from the client source so the "no
// platformPrimaryPct closure" + "no primaryRate read" assertions
// can't be tripped by prose that documents the prior closure for
// historical context.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TODAY_V2_CLIENT_ACTIVE = stripComments(TODAY_V2_CLIENT);

describe("Architecture — Today v2 hero primary-share source (Section 6 C4b)", () => {
  it("today-v2-data.ts imports computeTodayPrimaryShare from the C4a helper module", () => {
    expect(TODAY_V2_DATA).toMatch(
      /import\s*\{[^}]*\bcomputeTodayPrimaryShare\b[^}]*\}\s*from\s*["']@\/domains\/daily-metric-snapshots\/today-primary-share["']/,
    );
  });

  it("today-v2-data.ts invokes computeTodayPrimaryShare exactly once", () => {
    const matches = TODAY_V2_DATA.match(/computeTodayPrimaryShare\s*\(/g);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("today-v2-visibility-group-client.tsx does NOT contain the legacy platformPrimaryPct closure", () => {
    // The closure was: `const platformPrimaryPct = (platform: string)`.
    // Forbid any assignment named `platformPrimaryPct` in the active
    // (comment-stripped) source.
    expect(TODAY_V2_CLIENT_ACTIVE).not.toMatch(
      /\bplatformPrimaryPct\s*=/,
    );
    // Belt-and-suspenders: forbid invocation too.
    expect(TODAY_V2_CLIENT_ACTIVE).not.toMatch(
      /\bplatformPrimaryPct\s*\(/,
    );
  });

  it("today-v2-visibility-group-client.tsx does NOT read sparkline primaryRate for hero values", () => {
    // The OLD-path closure traversed `sparkline.points[i].primaryRate`.
    // Forbid the pattern entirely in active source. `sampleStatus`
    // reads remain allowed (separate per-platform signal); the
    // assertion below explicitly permits those.
    expect(TODAY_V2_CLIENT_ACTIVE).not.toMatch(/\.points\[[^\]]+\]\.primaryRate/);
    expect(TODAY_V2_CLIENT_ACTIVE).not.toMatch(/\.primaryRate/);
  });

  it("today-v2-visibility-group-client.tsx still reads sampleStatus (defense — separate signal)", () => {
    // Confirm that the sampleStatus read at line ~158 was NOT
    // accidentally removed alongside the primaryPct swap. Without
    // this assertion, a future drive-by could delete the wrong block.
    expect(TODAY_V2_CLIENT_ACTIVE).toMatch(/sampleStatus/);
  });

  it("today-v2-visibility-group-client.tsx consumes primaryShare.* prop fields", () => {
    expect(TODAY_V2_CLIENT_ACTIVE).toMatch(
      /chatgptPrimaryPct\s*:\s*primaryShare\.chatgptPrimaryPct/,
    );
    expect(TODAY_V2_CLIENT_ACTIVE).toMatch(
      /perplexityPrimaryPct\s*:\s*primaryShare\.perplexityPrimaryPct/,
    );
  });
});
