/**
 * Architecture invariant — Phase A.1 §2.16 (2026-05-13) /
 * Phase A.3 Step 4 (2026-05-14).
 *
 * The stuck-stage bridge phrase has evolved from "primary stuck-row
 * sub-line" → "graceful fallback path when the indexability loader
 * cannot run". A.3.4 introduced a per-verdict `diagnostic` field on
 * `LifecycleCopy` (computed via `renderStuckDiagnostic`) and a
 * mutually-exclusive client render path that prefers the diagnostic
 * over the bridge.
 *
 * This invariant now pins FOUR structural facts:
 *
 *   1. The exact substring "next bundle will add automated sitemap +
 *      robots checks" remains in `render-copy.ts`. Removing it
 *      without updating this invariant trips the build — the bridge
 *      phrase is the documented fallback for `target_url === null`,
 *      the `needs_new_page` sentinel, and indexability-loader
 *      exceptions.
 *
 *   2. The phrase is attached to the `STUCK_BRIDGE_PHRASE` constant
 *      declaration in `render-copy.ts`. Refactors that move the
 *      literal but lose the constant must update this invariant +
 *      the catalog row in lockstep.
 *
 *   3. The source comment documents the A.3.4 fallback role and the
 *      conditions for full retirement (Phase A.3 / fallback / "no
 *      fallback hits" note).
 *
 *   4. `LifecycleCopy` declares `diagnostic: string | null` AND
 *      `renderLifecycleCopy` calls `renderStuckDiagnostic`. The
 *      diagnostic is the primary stuck-row sub-line in A.3.4+; the
 *      bridge is the fallback.
 *
 * A former Pin 5 asserted the Changes detail v2 client rendered the
 * diagnostic preferred over the bridge at the mutual-exclusion level.
 * Retired 2026-07-20 (bounded orphan sweep) — `change-detail-v2-client.tsx`
 * was deleted as dead code once `/changes/[id]` collapsed to a
 * canonical-Results redirect (2026-07-17, commit `19d292c1`). The
 * render-copy.ts pins above (1-4) are unaffected; that module is alive
 * and still produces the diagnostic + bridge copy.
 *
 * Retirement: this invariant retires FULLY when (a) production
 * telemetry confirms zero stuck rows hit the bridge fallback path
 * for ≥ 30 sustained days, OR (b) a future step removes the
 * `needs_new_page` sentinel and the loader-throw fallback path
 * entirely (at which point `STUCK_BRIDGE_PHRASE` + `bridgeLine` can
 * be deleted). Until then, the bridge stays in source AND the
 * diagnostic-preferred render path is required.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const RENDER_COPY_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "citation-lifecycle",
  "render-copy.ts",
);

const RENDER_COPY_SRC = readFileSync(RENDER_COPY_PATH, "utf-8");

const BRIDGE_PHRASE = "next bundle will add automated sitemap + robots checks";

describe("Architecture — citation-lifecycle stuck-stage bridge phrase (Phase A.1 §2.16 / Phase A.3 §4)", () => {
  // ─────────────────────────────────────────────────────────────────
  // Pin 1: bridge phrase literal still present (fallback path)
  // ─────────────────────────────────────────────────────────────────

  it("render-copy.ts contains the exact bridge phrase substring (fallback path retained)", () => {
    expect(RENDER_COPY_SRC).toContain(BRIDGE_PHRASE);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 2: phrase attached to STUCK_BRIDGE_PHRASE constant
  // ─────────────────────────────────────────────────────────────────

  it("the phrase is attached to the STUCK_BRIDGE_PHRASE constant declaration", () => {
    expect(RENDER_COPY_SRC).toMatch(
      /STUCK_BRIDGE_PHRASE\s*=\s*[\s\S]*?next bundle will add automated sitemap \+ robots checks/,
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 3: source comment documents A.3.4 fallback role
  // ─────────────────────────────────────────────────────────────────

  it("documents the Phase A.3 fallback transition + retirement conditions in the source", () => {
    expect(RENDER_COPY_SRC).toMatch(/Phase A\.3/);
    // Either the historical REPLACE note or the new fallback note
    // (both are honest documentation of the evolution).
    expect(RENDER_COPY_SRC).toMatch(/REPLACE|fallback/i);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4 (NEW — A.3.4): LifecycleCopy declares `diagnostic` AND
  // renderLifecycleCopy calls renderStuckDiagnostic
  // ─────────────────────────────────────────────────────────────────

  it("LifecycleCopy declares diagnostic: string | null (Phase A.3 §4)", () => {
    const block = RENDER_COPY_SRC.match(
      /export\s+type\s+LifecycleCopy\s*=\s*\{[\s\S]*?\};/,
    );
    expect(block, "LifecycleCopy type block not found").toBeTruthy();
    expect(block![0]).toMatch(/diagnostic\s*:\s*string\s*\|\s*null/);
  });

  it("renderLifecycleCopy calls renderStuckDiagnostic to populate the diagnostic field", () => {
    // Comment-stripped scan so a docstring mention of the function
    // name doesn't trip the test.
    const stripped = RENDER_COPY_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    // renderStuckDiagnostic must appear inside the renderLifecycleCopy
    // function body. Cheap structural check: locate the export and
    // walk to the next `}` at module scope.
    const fnMatch = stripped.match(
      /export\s+function\s+renderLifecycleCopy\s*\([\s\S]*?\n\}/,
    );
    expect(fnMatch, "renderLifecycleCopy function body not found").toBeTruthy();
    expect(fnMatch![0]).toMatch(/renderStuckDiagnostic\s*\(/);
  });
});
