/** Vitest globalSetup: hydrate the per-run data directory (BEACON_DATA_DIR, minted by vitest.config.ts) from the synthetic fixture tree, and remove it at teardown. The operator's real `.data/` is never the target: a run that finds no BEACON_DATA_DIR refuses rather than falling back to it. */

import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "ci-data");
const dataDir = (): string => {
  const dir = process.env.BEACON_DATA_DIR?.trim();
  if (!dir || resolve(dir) === join(REPO_ROOT, ".data")) throw new Error("[global-fixture-hydrate] BEACON_DATA_DIR must name a per-run directory outside the repository's .data; vitest.config.ts mints one.");
  return dir;
};

function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);}}}

export async function setup(): Promise<void> {
  const target = dataDir();
  // The fixture is committed under tests/fixtures/ci-data and required.
  if (!existsSync(FIXTURE_DIR)) throw new Error(`[global-fixture-hydrate] expected ${FIXTURE_DIR} to exist as the fixture source.`);
  copyDirRecursive(FIXTURE_DIR, target);
  // The README inside the fixture would have been copied too; remove it so nothing thinks it is a runtime file.
  const stagedReadme = join(target, "README.md");
  if (existsSync(stagedReadme) && statSync(stagedReadme).isFile()) rmSync(stagedReadme, { force: true });}

export async function teardown(): Promise<void> {
  const target = dataDir();
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });}
