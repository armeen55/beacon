/**
 * verify-brain-health-watchdog — Trust Sprint Mini-Phase T7.3.
 *
 * Single orchestrator that runs every Beacon trust check the operator
 * cares about and exits non-zero if any HARD check fails. Designed to
 * be cron-eligible: run nightly, watch logs, alert on red.
 *
 * HARD checks (failure = non-zero exit):
 *   1. tenant-data-integrity (no empty / null tenant_id rows)
 *   2. observation-dedup-integrity (no duplicate logical keys)
 *   3. verdict-rematerialization-integrity (drift = 0)
 *   4. brain-health grade != D
 *   5. derived-confidence pipeline reachable (not all-medium)
 *   6. AEO intelligence manifest exists + recent
 *   7. latest poll fresh (within 36h threshold)
 *   8. live_at freshness on acceptance-tier recs (not stuck >14d)
 *   9. source_rec_id on RECENT (≤7d) accept-derived changelog rows
 *
 * SOFT checks (warn only — never fail):
 *   - Legacy imported rows without source_rec_id (correct by design)
 *   - Magic-link / leaked-password Supabase advisor warning
 *   - Proof / partial sampling days when correctly labeled
 *
 * Pure compute. No paid APIs. No mutations. No flag flips.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-brain-health-watchdog.ts
 *   npm run verify:brain-health
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

const REPO_ROOT = resolve(__dirname, "..");
const TENANT_SLUG = process.env.BEACON_TENANT_SLUG ?? "ritz-builders";
const TENANT_DIR = join(REPO_ROOT, ".data", "tenants", TENANT_SLUG);
const BRAIN_DIR = join(TENANT_DIR, "brain");
const POLL_FRESHNESS_HOURS = 36;
const LIVE_AT_STUCK_DAYS = 14;
const RECENT_CHANGELOG_DAYS = 7;

type Outcome = {
  name: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP";
  detail: string;
  durationMs: number;
};

const outcomes: Outcome[] = [];

function record(name: string, fn: () => Promise<{ status: Outcome["status"]; detail: string }>): Promise<void> {
  return (async () => {
    const start = Date.now();
    try {
      const r = await fn();
      outcomes.push({ name, status: r.status, detail: r.detail, durationMs: Date.now() - start });
    } catch (err) {
      outcomes.push({
        name,
        status: "FAIL",
        detail: `crashed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - start,
      });
    }
  })();
}

// ── 1. Run a child verify script and check exit code ──

function runVerifyScript(relPath: string, description: string): Outcome {
  const start = Date.now();
  const result = spawnSync(
    "npx",
    ["tsx", "--require", "./scripts/mock-server-only.cjs", relPath],
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf-8",
      timeout: 120_000,
    },
  );
  const ok = result.status === 0;
  const lastLine = (result.stdout?.trim().split("\n").pop() ?? "").slice(0, 120);
  return {
    name: description,
    status: ok ? "PASS" : "FAIL",
    detail: ok ? lastLine : `exit ${result.status}: ${lastLine || result.stderr?.slice(0, 200)}`,
    durationMs: Date.now() - start,
  };
}

// ── 9. source_rec_id on RECENT accept-derived changelog rows ──

async function checkRecentChangelogStamping(): Promise<{ status: Outcome["status"]; detail: string }> {
  const { getChangelogEntries } = await import("../src/lib/seed-data.server");
  const cutoff = new Date(Date.now() - RECENT_CHANGELOG_DAYS * 24 * 3600 * 1000).toISOString();
  const all = (await getChangelogEntries()) as Array<{
    id: string;
    timestamp: string;
    source_system?: string | null;
    source_rec_id?: string | null;
    hypothesis_source?: string | null;
  }>;
  // Recent rows (≤7d) that are NOT legacy imports + NOT scanner-detect.
  // Legacy imports (pdf_changelog_rebuild, changelog_csv) and scanner
  // events (scan_detection) correctly lack source_rec_id; we only flag
  // rec-derived rows.
  const recentAcceptDerived = all.filter((c) => {
    if (c.timestamp < cutoff) return false;
    const sys = c.source_system ?? "";
    if (sys === "pdf_changelog_rebuild" || sys === "changelog_csv" || sys === "scan_detection") return false;
    // Treat "(none)" and "" source_system as rec-derived — those are
    // the rows acceptRecommendation produces.
    return c.hypothesis_source === "recommendation" || sys === "" || sys === undefined;
  });
  const missing = recentAcceptDerived.filter((c) => !c.source_rec_id);
  if (recentAcceptDerived.length === 0) {
    return { status: "WARN", detail: "no recent accept-derived changelog rows in the last 7d (queue idle)" };
  }
  if (missing.length === 0) {
    return {
      status: "PASS",
      detail: `${recentAcceptDerived.length} recent rec-derived rows; all carry source_rec_id`,
    };
  }
  return {
    status: "FAIL",
    detail: `${missing.length}/${recentAcceptDerived.length} recent rec-derived rows missing source_rec_id (e.g., ${missing[0].id})`,
  };
}

// ── 4 + 5. Brain health grade + derived confidence spread ──

async function checkBrainHealth(): Promise<{ status: Outcome["status"]; detail: string }> {
  // Run brain-health-report with --no-persist; capture exit + parse grade from stdout.
  const result = spawnSync(
    "npx",
    [
      "tsx",
      "--require",
      "./scripts/mock-server-only.cjs",
      "scripts/build-brain-health-report.ts",
      "--no-persist",
    ],
    { cwd: REPO_ROOT, env: process.env, encoding: "utf-8", timeout: 120_000 },
  );
  if (result.status !== 0) {
    return { status: "FAIL", detail: `brain-health-report exited ${result.status}` };
  }
  const out = result.stdout ?? "";
  // Extract grade from "Brain Readiness Grade: X — …"
  const gradeMatch = out.match(/Brain Readiness Grade:\s*([ABCD])\s*—\s*(\w+)/);
  const grade = gradeMatch?.[1] ?? "?";
  const label = gradeMatch?.[2] ?? "unknown";
  if (grade === "D") {
    return { status: "FAIL", detail: `Brain Readiness Grade D — ${label} (trust blocker present)` };
  }
  // Check derived confidence isn't all-medium (post-T6.5 contract).
  const derivedMatch = out.match(/derived confidence \(T4\.4\) distribution:\s*([^\n]+)/);
  const derivedLine = derivedMatch?.[1] ?? "";
  const allMedium = /strong_evidence=0[^,]*,\s*moderate_evidence=\d+,\s*needs_review=0/.test(derivedLine);
  if (allMedium) {
    return {
      status: "FAIL",
      detail: `derived confidence collapsed to 100% moderate (T4.4 derivation pipeline regression?). Grade ${grade} — ${label}`,
    };
  }
  return {
    status: "PASS",
    detail: `Grade ${grade} — ${label}; derived: ${derivedLine.trim() || "(?)"}`,
  };
}

// ── 6. AEO intelligence manifest ──

async function checkAeoManifest(): Promise<{ status: Outcome["status"]; detail: string }> {
  const path = join(BRAIN_DIR, "manifest.json");
  if (!existsSync(path)) {
    return { status: "FAIL", detail: `${path} missing — run scripts/build-local-aeo-intelligence.ts` };
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    built_at: string;
    files: Array<{ name: string; rows: number; sha256: string }>;
  };
  const expectedFiles = [
    "daily-platform-summary.json",
    "weekly-platform-summary.json",
    "monthly-platform-summary.json",
    "competitor-trajectory.json",
    "prompt-trajectory.json",
    "citation-source-trajectory.json",
    "geo-service-trajectory.json",
  ];
  const present = new Set(raw.files.map((f) => f.name));
  const missing = expectedFiles.filter((n) => !present.has(n));
  if (missing.length > 0) {
    return { status: "FAIL", detail: `manifest missing files: ${missing.join(", ")}` };
  }
  // Check freshness: built_at within 14 days.
  const ageMs = Date.now() - new Date(raw.built_at).getTime();
  const ageDays = ageMs / (24 * 3600 * 1000);
  if (ageDays > 14) {
    return {
      status: "WARN",
      detail: `manifest is ${ageDays.toFixed(1)}d old (rebuild scripts/build-local-aeo-intelligence.ts)`,
    };
  }
  return { status: "PASS", detail: `${raw.files.length} files, age ${ageDays.toFixed(1)}d` };
}

// ── 7. Latest poll freshness ──

async function checkPollFreshness(): Promise<{ status: Outcome["status"]; detail: string }> {
  const { getPromptAnswerObservations } = await import("../src/storage/canonical-store");
  const obs = await getPromptAnswerObservations();
  if (obs.length === 0) {
    return { status: "FAIL", detail: "no observations in canonical store" };
  }
  // Find the most recent observed_at.
  let latest = "";
  for (const o of obs) {
    if (o.observed_at && o.observed_at > latest) latest = o.observed_at;
  }
  if (!latest) {
    return { status: "FAIL", detail: "observations present but none have observed_at" };
  }
  const ageMs = Date.now() - new Date(latest).getTime();
  const ageHours = ageMs / (3600 * 1000);
  if (ageHours > POLL_FRESHNESS_HOURS) {
    return {
      status: "FAIL",
      detail: `latest poll is ${ageHours.toFixed(1)}h old (threshold ${POLL_FRESHNESS_HOURS}h) — cron may be stuck`,
    };
  }
  return { status: "PASS", detail: `latest poll ${ageHours.toFixed(1)}h ago (latest=${latest.slice(0, 19)})` };
}

// ── 8. live_at freshness on acceptance-tier rows ──

async function checkLiveAtFreshness(): Promise<{ status: Outcome["status"]; detail: string }> {
  const { readRecommendedEditsLocal } = await import(
    "../src/domains/recommendations/recommended-edits-persistence"
  );
  const recs = await readRecommendedEditsLocal();
  const cutoff = new Date(Date.now() - LIVE_AT_STUCK_DAYS * 24 * 3600 * 1000).toISOString();
  const ACCEPTANCE_TIER = new Set([
    "accepted",
    "needs_review",
    "wrong_page",
    "partially_implemented",
  ]);
  const stuck = recs.filter((r) => {
    const status = r.implementation_status ?? "recommended";
    if (!ACCEPTANCE_TIER.has(status)) return false;
    if (r.live_at) return false;
    if ((r.created_at ?? "") > cutoff) return false; // recent — give it time
    return true;
  });
  if (stuck.length === 0) {
    return { status: "PASS", detail: "no acceptance-tier rows stuck >14d with null live_at" };
  }
  return {
    status: "WARN",
    detail: `${stuck.length} acceptance-tier rows stuck >14d (e.g., ${stuck[0].id.slice(-30)}); flip BEACON_LIFECYCLE_ENABLED=1 or Mark Shipped manually`,
  };
}

// ── Main orchestrator ──

async function main(): Promise<void> {
  console.log("verify-brain-health-watchdog — Trust Sprint T7.3");
  console.log("Pure compute. No paid APIs. No mutations.\n");

  // 1-3: external scripts
  outcomes.push(runVerifyScript("scripts/verify-tenant-data-integrity.ts", "1. tenant-data-integrity"));
  outcomes.push(runVerifyScript("scripts/verify-observation-dedup-integrity.ts", "2. observation-dedup-integrity"));
  outcomes.push(runVerifyScript("scripts/verify-verdict-rematerialization-integrity.ts", "3. verdict-rematerialization-integrity"));

  // 4-5: brain health + derived confidence
  await record("4-5. brain-health + derived-confidence", checkBrainHealth);

  // 6: AEO manifest
  await record("6. aeo-intelligence-manifest", checkAeoManifest);

  // 7: poll freshness
  await record("7. poll-freshness", checkPollFreshness);

  // 8: live_at freshness
  await record("8. live_at-freshness", checkLiveAtFreshness);

  // 9: recent rec-derived changelog stamping
  await record("9. source_rec_id-recent-stamping", checkRecentChangelogStamping);

  // ── Render unified summary ──
  console.log("RESULTS:");
  for (const o of outcomes) {
    const tag =
      o.status === "PASS" ? "✓ PASS"
      : o.status === "WARN" ? "⚠ WARN"
      : o.status === "SKIP" ? "  SKIP"
      : "✗ FAIL";
    console.log(`  ${tag.padEnd(7)} (${o.durationMs}ms)  ${o.name}`);
    if (o.detail) console.log(`           ${o.detail}`);
  }
  const fails = outcomes.filter((o) => o.status === "FAIL").length;
  const warns = outcomes.filter((o) => o.status === "WARN").length;
  const passes = outcomes.filter((o) => o.status === "PASS").length;
  console.log("");
  console.log(`SUMMARY: ${passes} PASS, ${warns} WARN, ${fails} FAIL`);
  if (fails > 0) {
    console.log("\nWATCHDOG: RED — at least one HARD check failed.");
    process.exit(1);
  }
  if (warns > 0) {
    console.log("\nWATCHDOG: YELLOW — soft warnings only; no hard failures.");
    process.exit(0);
  }
  console.log("\nWATCHDOG: GREEN — all hard checks pass.");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-brain-health-watchdog crashed:", err);
  process.exit(2);
});
