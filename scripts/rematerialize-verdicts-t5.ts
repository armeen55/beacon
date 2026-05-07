/**
 * rematerialize-verdicts-t5 — Trust Sprint Mini-Phase T5.3 (2026-05-06).
 *
 * Recomputes URL verdict outcomes under the new T5.2 logic (sparse-pre-
 * window precondition + weak_signal tier) WITHOUT waiting for the next
 * 07:00 UTC cron. Pure compute path:
 *
 *   buildUrlCitationHistory()     — reads existing citation shards
 *   getChangelogEntries()         — reads changelog from .data + Supabase
 *   computeUrlVerdict()           — pure math (T5.2 logic)
 *   materializeUrlOutcomes()      — idempotent upsert by (change_id, url)
 *
 * No OpenAI. No paid polling. Reads from disk + Supabase, writes to
 * .data + Supabase via the existing dual-write path.
 *
 * Two modes:
 *   --dry-run (default): reads everything, computes new verdicts in
 *     memory, prints before/after distribution + sample changes. NO
 *     persistence.
 *   --apply: backs up the persisted url-change-outcomes file, then
 *     calls materializeUrlOutcomes which writes through the existing
 *     dual-write path. Also dumps the post-apply distribution.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/rematerialize-verdicts-t5.ts
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/rematerialize-verdicts-t5.ts --apply
 */

import { readFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

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

import { computeUrlVerdict } from "../src/domains/attribution/url-verdict";
import {
  buildUrlCitationHistory,
  denseSeries,
  type UrlCitationHistory,
} from "../src/domains/product/url-citation-history";
import {
  buildSamplingStatusByDate,
  materializeUrlOutcomes,
  resolveChangeDate,
  stampSamplingStatus,
} from "../src/domains/attribution/url-change-outcome";
import { isLifecycleVerdictEnabled } from "../src/lib/flags";
import { getChangelogEntries } from "../src/lib/seed-data.server";
import { getPromptAnswerObservations } from "../src/storage/canonical-store";
import type { ChangelogEntry } from "../src/domains/changelog/types";

const REPO_ROOT = resolve(__dirname, "..");
const OUTCOMES_PATH = join(
  REPO_ROOT,
  ".data",
  "tenants",
  "ritz-builders",
  "url-change-outcomes.json",
);

type Verdict = string;

type DryRunRow = {
  change_id: string;
  url: string;
  oldVerdict: Verdict | null;
  newVerdict: Verdict;
  oldZ: number | null;
  newZ: number | null;
  preFullPolls: number | null;
  preDays: number;
  postDays: number;
};

const APPLY = process.argv.includes("--apply");

async function loadOldOutcomes(): Promise<Array<{ change_id: string; url: string; verdict: Verdict; z: number | null }>> {
  if (!existsSync(OUTCOMES_PATH)) return [];
  const raw = JSON.parse(readFileSync(OUTCOMES_PATH, "utf-8")) as Array<{
    change_id: string;
    url: string;
    verdict: Verdict;
    landing_z?: number | null;
  }>;
  return raw.map((r) => ({
    change_id: r.change_id,
    url: r.url,
    verdict: r.verdict,
    z: r.landing_z ?? null,
  }));
}

function distribution(rows: Array<{ verdict: Verdict }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.verdict] = (out[r.verdict] ?? 0) + 1;
  return out;
}

function printDistribution(label: string, dist: Record<string, number>): void {
  console.log(`  ${label}:`);
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) console.log(`    ${k.padEnd(36)} ${String(v).padStart(4)}  (${((v / total) * 100).toFixed(1)}%)`);
  console.log(`    ${"TOTAL".padEnd(36)} ${String(total).padStart(4)}`);
}

async function main(): Promise<void> {
  console.log(`rematerialize-verdicts-t5 — Trust Sprint T5.3 (mode: ${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log("Pure compute path. No OpenAI. No paid polling.\n");

  // ── 1. Load inputs ──
  console.log("Loading citation history + changelog + observations…");
  const history: UrlCitationHistory = await buildUrlCitationHistory({ ownedOnly: true });
  const changes = (await getChangelogEntries()) as ChangelogEntry[];
  let samplingStatusByDate: Awaited<ReturnType<typeof buildSamplingStatusByDate>> = new Map();
  try {
    const obs = await getPromptAnswerObservations();
    samplingStatusByDate = buildSamplingStatusByDate(obs);
  } catch (err) {
    console.warn("  (could not load observations for sampling-status; precondition will be back-compat no-op)", err instanceof Error ? err.message : err);
  }
  console.log(`  history: ${history.distinct_urls} URLs, ${history.series.length} series rows, range ${history.date_range.first ?? "?"} → ${history.date_range.last ?? "?"}`);
  console.log(`  changes: ${changes.length} (active: ${changes.filter((c) => !c.archived).length})`);
  console.log(`  samplingStatusByDate: ${samplingStatusByDate.size} dates tagged\n`);

  const oldOutcomes = await loadOldOutcomes();
  const oldByKey = new Map(oldOutcomes.map((o) => [`${o.change_id}::${o.url}`, o]));
  console.log(`Existing on-disk verdicts: ${oldOutcomes.length}`);
  printDistribution("PRE-T5.2 (on-disk) distribution", distribution(oldOutcomes));
  console.log();

  // ── 2. Dry-run: compute new verdicts ──
  console.log("Computing new T5.2 verdicts in memory (no persist)…");
  const useFlag = isLifecycleVerdictEnabled();
  const dryRows: DryRunRow[] = [];
  let processed = 0;
  for (const change of changes) {
    if (change.archived) continue;
    const url = change.url;
    if (!url || typeof url !== "string") continue;
    // Resolve change date (T3.2 logic): live_at when flag on, else timestamp.
    const anchor = resolveChangeDate(change, useFlag);
    if (!anchor) continue;
    // Find URL's history series (match on normalized URL + raw_urls)
    const entry = history.series.find((e) => e.url === url || (e.raw_urls ?? []).includes(url));
    if (!entry) continue;
    const range = { first: history.date_range.first ?? "", last: history.date_range.last ?? "" };
    if (!range.first || !range.last) continue;
    const denseRaw = denseSeries(entry, range);
    const series = stampSamplingStatus(denseRaw, samplingStatusByDate);
    const r = computeUrlVerdict({
      series,
      changeDate: anchor,
      asOfDate: history.date_range.last ?? undefined,
    });
    processed += 1;
    const key = `${change.id}::${url}`;
    const old = oldByKey.get(key);
    dryRows.push({
      change_id: change.id,
      url,
      oldVerdict: old?.verdict ?? null,
      newVerdict: r.verdict,
      oldZ: old?.z ?? null,
      newZ: r.z,
      preFullPolls: r.pre_full_poll_demoted?.preDaysWithFullPolls ?? null,
      preDays: r.explanation.math.baseline_days_used,
      postDays: r.post_days,
    });
  }
  console.log(`  processed: ${processed} (change, url) pairs\n`);

  printDistribution("POST-T5.2 (computed) distribution", distribution(dryRows.map((r) => ({ verdict: r.newVerdict }))));
  console.log();

  // ── 3. Per-verdict-transition counts ──
  const transitions = new Map<string, number>();
  for (const r of dryRows) {
    const key = `${r.oldVerdict ?? "(new)"} → ${r.newVerdict}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
  }
  console.log("Verdict transitions (oldVerdict → newVerdict):");
  const sortedTransitions = [...transitions.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sortedTransitions) console.log(`  ${k.padEnd(50)} ${String(v).padStart(4)}`);
  console.log();

  // ── 4. Headline T5.2 demotion + tier-emit counts ──
  const helpingDemoted = dryRows.filter((r) => r.oldVerdict === "helping" && r.newVerdict !== "helping").length;
  const newWeakSignal = dryRows.filter((r) => r.newVerdict === "weak_signal").length;
  const stillHelping = dryRows.filter((r) => r.oldVerdict === "helping" && r.newVerdict === "helping").length;
  console.log("Headline T5.2 effects:");
  console.log(`  helping rows demoted (no longer helping): ${helpingDemoted}`);
  console.log(`  new weak_signal rows: ${newWeakSignal}`);
  console.log(`  helping rows that survive (still helping): ${stillHelping}\n`);

  // ── 5. Top measured-win disappearances (most operator-visible) ──
  const disappearedTop = dryRows
    .filter((r) => r.oldVerdict === "helping" && r.newVerdict !== "helping" && (r.oldZ ?? 0) > 5)
    .sort((a, b) => (b.oldZ ?? 0) - (a.oldZ ?? 0))
    .slice(0, 10);
  if (disappearedTop.length > 0) {
    console.log("Top 10 high-z helping rows that demote (highest |oldZ| first):");
    for (const r of disappearedTop) {
      console.log(
        `  ${r.url.slice(-60).padEnd(60)} oldZ=${(r.oldZ ?? 0).toFixed(1)} → ${r.newVerdict}  (preFullPolls=${r.preFullPolls ?? "n/a"}, pre=${r.preDays}d, post=${r.postDays}d)`,
      );
    }
    console.log();
  }

  if (!APPLY) {
    console.log("DRY-RUN complete. No persistence. Re-run with --apply to write through the existing materializer.");
    process.exit(0);
  }

  // ── 6. APPLY: backup then run the official materializer ──
  console.log("APPLY mode. Backing up persisted url-change-outcomes…");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = join(REPO_ROOT, ".data", "_backups", `url-change-outcomes-pre-t5_3-${ts}.json`);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFileSync(OUTCOMES_PATH, backupPath);
  console.log(`  backup → ${backupPath}\n`);

  console.log("Running materializeUrlOutcomes (idempotent upsert by (change_id, url))…");
  const result = await materializeUrlOutcomes({
    changes,
    history,
    asOfDate: history.date_range.last ?? undefined,
  });
  console.log(`  processed: ${result.processed}, recorded: ${result.recorded}, transitions: ${result.transitions}\n`);

  // ── 7. Re-load + re-distribute to confirm
  const newOutcomes = await loadOldOutcomes();
  printDistribution("POST-APPLY distribution (on-disk)", distribution(newOutcomes));
  console.log("\nApply complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("rematerialize-verdicts-t5 crashed:", err);
  process.exit(2);
});
