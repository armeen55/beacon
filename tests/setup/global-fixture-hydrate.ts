/** Vitest globalSetup — hydrate `.data/` from the synthetic fixture tree ONLY when the operator's real `.data/` is absent (sentinel: .data/global/ tenants.json). CI gets a deterministic substrate; a real local data dir is never touched or
 *  overwritten, and teardown removes only what this created. */

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
  // Local dev: real Harborview `.data/` already on disk → no-op.
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
  // Sanity: the README inside the fixture would have been copied too — remove it from `.data/` so nothing thinks it's a runtime file.
  const stagedReadme = join(DATA_DIR, "README.md");
  if (existsSync(stagedReadme) && statSync(stagedReadme).isFile()) {
    rmSync(stagedReadme, { force: true });
  }
  hydratedByThisHook = true;
}

export async function teardown(): Promise<void> {
  if (!hydratedByThisHook) return;
  // Only blow away `.data/` if THIS hook created it from the fixture. Local dev never reaches this branch.
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
}
