/**
 * Preload: hydrate process.env from .env.local for LOCAL CLI runs.
 *
 * `node --require ./scripts/load-env-local.cjs` (or via tsx). Mirrors the
 * inline loader in scripts/list-active-tenants.ts: never overrides vars
 * already set in the environment, so explicit `FOO=bar npx tsx ...`
 * invocations win over the file. CI sets env via secrets and simply
 * doesn't pass this preload (the file doesn't exist there anyway —
 * missing file is a silent no-op).
 */

const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}
