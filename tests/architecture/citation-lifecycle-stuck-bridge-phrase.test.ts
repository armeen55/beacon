/**
 * Architecture invariant — Phase A.1 §2.16 (2026-05-13).
 *
 * The stuck-stage bridge phrase Phase A.3 (indexability + GSC) is
 * expected to retire.
 *
 * Section 2.16 of the maximum-depth plan locks the stuck-stage copy
 * line — "The next bundle will add automated sitemap + robots checks
 * here." — as a forward-compatible promise the customer reads on a
 * `stuck` Changes detail today. Phase A.3 (Section 4.8) is the bundle
 * that retires this phrase by replacing it with the per-verdict copy
 * (`indexed_but_not_cited` / `not_in_sitemap` / `blocked_by_robots` /
 * etc.).
 *
 * This invariant pins:
 *   1. The exact substring "next bundle will add automated sitemap +
 *      robots checks" is present in `render-copy.ts`. Removing it
 *      without updating this invariant trips the build.
 *   2. The stuck-stage tests in `render-copy.test.ts` reference the
 *      same substring so the renderer's output stays in lockstep.
 *   3. When Phase A.3 ships, this test SHOULD be retired together
 *      with the bridge phrase. The catalog entry in
 *      docs/ARCHITECTURE_INVARIANTS_CATALOG.md (Section 12 N1)
 *      documents that transition.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RENDER_COPY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "citation-lifecycle",
  "render-copy.ts",
);

const SRC = readFileSync(RENDER_COPY_PATH, "utf-8");

const BRIDGE_PHRASE = "next bundle will add automated sitemap + robots checks";

describe("Architecture — citation-lifecycle stuck-stage bridge phrase (Phase A.1 §2.16)", () => {
  it("render-copy.ts contains the exact bridge phrase substring", () => {
    expect(SRC).toContain(BRIDGE_PHRASE);
  });

  it("the phrase is on the stuck-stage code path only", () => {
    // Cheap structural check: the phrase appears inside the
    // STUCK_BRIDGE_PHRASE constant declaration. If a future
    // refactor moves the literal but loses the constant, the
    // catalog entry must be updated.
    expect(SRC).toMatch(
      /STUCK_BRIDGE_PHRASE\s*=\s*[\s\S]*?next bundle will add automated sitemap \+ robots checks/,
    );
  });

  it("documents the Phase A.3 retirement transition in the source comment", () => {
    // The bridge phrase comes with a "Phase A.3 will REPLACE" note
    // so the next operator who lands here knows the exit path.
    expect(SRC).toMatch(/Phase A\.3/);
    expect(SRC).toMatch(/REPLACE/i);
  });
});
