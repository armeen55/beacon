/**
 * Section 6 C3 — package.json `backfill:section6` script shape pin.
 *
 * The C3 backfill script imports `buildDailySnapshotsFromObservations`,
 * which begins with `import "server-only"` (the package throws at
 * runtime when loaded outside a Next.js Server Component). Every
 * operator-trigger script in the repo that transitively imports a
 * server-only module preloads `./scripts/mock-server-only.cjs` via
 * `--require` to neutralize that throw at Node start. The C3 script's
 * initial npm-script registration (commit 62aee9e) shipped without
 * that preload and failed at first invocation:
 *
 *     Error: This module cannot be imported from a Client Component module.
 *     It should only be used from a Server Component.
 *        at Object.<anonymous> (node_modules/server-only/index.js:1:7)
 *        at <anonymous> (.../build-from-observations.ts:1:8)
 *
 * This test pins the corrected script so the regression can't slip
 * back in unnoticed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const PACKAGE_JSON = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, "utf-8"),
) as { scripts?: Record<string, string> };

describe("package.json — backfill:section6 script shape", () => {
  it("declares the backfill:section6 npm script", () => {
    expect(PACKAGE_JSON.scripts).toBeDefined();
    expect(PACKAGE_JSON.scripts!["backfill:section6"]).toBeDefined();
  });

  it("preloads ./scripts/mock-server-only.cjs via --require", () => {
    const cmd = PACKAGE_JSON.scripts!["backfill:section6"]!;
    expect(cmd).toMatch(/--require\s+\.\/scripts\/mock-server-only\.cjs/);
  });

  it("invokes the canonical Section 6 C3 entry script", () => {
    const cmd = PACKAGE_JSON.scripts!["backfill:section6"]!;
    expect(cmd).toMatch(
      /scripts\/backfill-section6-primary-recommendation\.ts/,
    );
  });

  it("invokes via tsx (preserves TypeScript + ESM resolution)", () => {
    const cmd = PACKAGE_JSON.scripts!["backfill:section6"]!;
    expect(cmd).toMatch(/\btsx\b/);
  });
});
