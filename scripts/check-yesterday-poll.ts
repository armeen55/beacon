/**
 * check-yesterday-poll — Poll-health canary.
 *
 * Queries Supabase for today's observation_runs and exits non-zero if any
 * platform isn't "ok" (i.e. < 4/4 chunks completed in chunk mode, or the
 * whole-mode run didn't complete successfully).
 *
 * Wired from `.github/workflows/poll-canary.yml` to run daily at 10:45 UTC
 * (45 minutes after the main poll cron at 10:00 UTC). GitHub Actions emails
 * the repo owner on any non-zero exit, turning silent pipeline failures into
 * hours-not-days alerts.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts            # checks today (UTC)
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/check-yesterday-poll.ts 2026-04-23 # checks specific date
 *
 * The mock-server-only require stubs out the `import "server-only"` guard in
 * src/domains/observations/poll-health.ts so Node CLI execution works. The
 * guard still prevents accidental client-component bundling in the Next.js
 * build.
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes:
 *   0 — all platforms ok
 *   1 — at least one platform not ok (partial / failed / pending)
 *   2 — query/runtime error (treated as alert)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Load .env.local for local runs. CI provides env vars directly.
const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import {
  fetchPollHealthForDate,
  todayISOUtc,
  type PlatformPollHealth,
} from "../src/domains/observations/poll-health";

async function main(): Promise<number> {
  const dateArg = process.argv[2];
  const date = dateArg ?? todayISOUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      `Invalid date: "${date}". Expected YYYY-MM-DD or no argument (defaults to today UTC).`,
    );
    return 2;
  }

  console.log(`Checking poll health for ${date}...`);
  let snap;
  try {
    snap = await fetchPollHealthForDate(date);
  } catch (err) {
    console.error(`Poll-health query failed: ${String(err)}`);
    return 2;
  }

  let allOk = true;
  for (const platform of snap.platforms) {
    logPlatform(platform);
    if (platform.status !== "ok") allOk = false;
  }

  if (allOk) {
    console.log(`\n✓ All platforms ok for ${date}.`);
    return 0;
  }

  console.log(
    `\n✗ One or more platforms are not ok for ${date}. See summary above.`,
  );
  return 1;
}

function logPlatform(p: PlatformPollHealth): void {
  const label = p.platform.padEnd(10, " ");
  const chunks = `${p.completedChunks}/${p.expectedChunks} chunks`;
  const obs = `${p.observationsWritten} prompts`;
  const statusGlyph =
    p.status === "ok"
      ? "✓"
      : p.status === "partial"
        ? "▲"
        : p.status === "failed"
          ? "✗"
          : "…";
  console.log(
    `  ${statusGlyph} ${label} ${p.status.padEnd(8, " ")} ${chunks}, ${obs}` +
      (p.latestRun ? `  (latest: ${p.latestRun.runId})` : ""),
  );
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("Unhandled error:", err);
    process.exit(2);
  },
);
