/**
 * Vitest globalSetup — hydrate `.data/` from a small synthetic fixture
 * tree when (and ONLY when) the operator's curated `.data/` is missing.
 *
 * Why this exists
 * ---------------
 * Several tests read on-disk JSON under `.data/` (the operator's
 * gitignored data directory). Locally the operator has a real Ritz
 * dogfeed copy of `.data/` and the tests pass. In CI / fresh clones
 * the directory does not exist, so the same tests either:
 *
 *   • fail on `existsSync(...)` early-returns (vitest reports
 *     "No test found in suite" because the dynamic per-tenant test
 *     registration sees zero tenant dirs), or
 *   • fail on tenant-store lookups that require `tenants.json`.
 *
 * Both failure modes are environmental — not real product bugs.
 *
 * The fix is to hydrate a minimal synthetic fixture into `.data/` at
 * test-suite start, and clean it up at teardown. The fixture is small
 * (one founder tenant, one row per per-tenant store, five synthetic
 * recommendation rows) and lives under `tests/fixtures/ci-data/`.
 *
 * The local-data guard
 * --------------------
 * This hook is opt-out by default for any developer running with a
 * real `.data/`. The presence of `.data/global/tenants.json` is the
 * sentinel: if it exists, we DO NOT touch `.data/` at all and the
 * teardown is a no-op. The operator's data is never overwritten.
 *
 * Only when `.data/global/tenants.json` is absent do we copy the
 * fixture tree into `.data/` and remove the directory at teardown.
 *
 * The hook also tracks whether IT created the directory — if a partial
 * `.data/` already exists for some reason (e.g. a CI cache), we leave
 * it alone and run no fixture hydration. Strict "absent" means the
 * sentinel isn't there.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = join(REPO_ROOT, ".data");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "ci-data");
const SENTINEL = join(DATA_DIR, "global", "tenants.json");

// Module-level so teardown sees the same flag setup wrote.
let hydratedByThisHook = false;

function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

export async function setup(): Promise<void> {
  // Local dev: real Ritz `.data/` already on disk → no-op.
  if (existsSync(SENTINEL)) {
    hydratedByThisHook = false;
    return;
  }
  // CI: fixture must exist (committed under tests/fixtures/ci-data).
  if (!existsSync(FIXTURE_DIR)) {
    throw new Error(
      `[global-fixture-hydrate] expected ${FIXTURE_DIR} to exist as the CI fixture source. ` +
        `It is committed and required when .data/global/tenants.json is missing.`,
    );
  }
  copyDirRecursive(FIXTURE_DIR, DATA_DIR);
  // Sanity: the README inside the fixture would have been copied too —
  // remove it from `.data/` so nothing thinks it's a runtime file.
  const stagedReadme = join(DATA_DIR, "README.md");
  if (existsSync(stagedReadme) && statSync(stagedReadme).isFile()) {
    rmSync(stagedReadme, { force: true });
  }
  hydratedByThisHook = true;
}

export async function teardown(): Promise<void> {
  if (!hydratedByThisHook) return;
  // Only blow away `.data/` if THIS hook created it from the fixture.
  // Local dev never reaches this branch.
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}
