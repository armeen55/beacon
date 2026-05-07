/**
 * verify-verdict-rematerialization-integrity — Trust Sprint Mini-Phase T5.3.
 *
 * Read-only invariant check: every URL verdict currently persisted in
 * `.data/tenants/ritz-builders/url-change-outcomes.json` must match what
 * T5.2 logic would compute right now, given the current citation history
 * + changelog + observation sampling.
 *
 * Drift = bug. Either the persisted verdict was written by a code path
 * that has since changed (legacy write), or the inputs have shifted
 * (citation shards updated, changelog edited) without a follow-up
 * rematerialization.
 *
 * Pure compute. No paid APIs. No mutation. Exits non-zero on drift.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/verify-verdict-rematerialization-integrity.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

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

type PersistedOutcome = {
  change_id: string;
  url: string;
  verdict: string;
  landing_z?: number | null;
};

type DriftRow = {
  change_id: string;
  url: string;
  persistedVerdict: string;
  computedVerdict: string;
  persistedZ: number | null;
  computedZ: number | null;
};

async function main(): Promise<void> {
  console.log("verify-verdict-rematerialization-integrity — T5.3");
  console.log("Pure compute. Read-only. No paid APIs.\n");

  if (!existsSync(OUTCOMES_PATH)) {
    console.error("No url-change-outcomes file on disk. Nothing to verify.");
    process.exit(0);
  }
  const persisted = JSON.parse(readFileSync(OUTCOMES_PATH, "utf-8")) as PersistedOutcome[];
  console.log(`Loaded ${persisted.length} persisted URL verdicts.\n`);

  console.log("Loading citation history + changelog + observations…");
  const history: UrlCitationHistory = await buildUrlCitationHistory({ ownedOnly: true });
  const changes = (await getChangelogEntries()) as ChangelogEntry[];
  let samplingStatusByDate: Awaited<ReturnType<typeof buildSamplingStatusByDate>> = new Map();
  try {
    const obs = await getPromptAnswerObservations();
    samplingStatusByDate = buildSamplingStatusByDate(obs);
  } catch (err) {
    console.warn(
      "  (could not load observations — sampling status will be back-compat 'full')",
      err instanceof Error ? err.message : err,
    );
  }
  console.log(
    `  history: ${history.distinct_urls} URLs, ${history.series.length} series rows, range ${history.date_range.first ?? "?"} → ${history.date_range.last ?? "?"}`,
  );
  console.log(`  changes: ${changes.length} (active: ${changes.filter((c) => !c.archived).length})`);
  console.log(`  samplingStatusByDate: ${samplingStatusByDate.size} dates tagged\n`);

  const useFlag = isLifecycleVerdictEnabled();
  const changeById = new Map(changes.map((c) => [c.id, c]));

  const drift: DriftRow[] = [];
  let recomputed = 0;
  let skippedNoChange = 0;
  let skippedNoSeries = 0;
  let skippedNoAnchor = 0;

  for (const row of persisted) {
    const change = changeById.get(row.change_id);
    if (!change) {
      skippedNoChange += 1;
      continue;
    }
    const anchor = resolveChangeDate(change, useFlag);
    if (!anchor) {
      skippedNoAnchor += 1;
      continue;
    }
    const entry = history.series.find(
      (e) => e.url === row.url || (e.raw_urls ?? []).includes(row.url),
    );
    if (!entry) {
      skippedNoSeries += 1;
      continue;
    }
    const range = {
      first: history.date_range.first ?? "",
      last: history.date_range.last ?? "",
    };
    if (!range.first || !range.last) {
      skippedNoSeries += 1;
      continue;
    }
    const denseRaw = denseSeries(entry, range);
    const series = stampSamplingStatus(denseRaw, samplingStatusByDate);
    const r = computeUrlVerdict({
      series,
      changeDate: anchor,
      asOfDate: history.date_range.last ?? undefined,
    });
    recomputed += 1;
    if (r.verdict !== row.verdict) {
      drift.push({
        change_id: row.change_id,
        url: row.url,
        persistedVerdict: row.verdict,
        computedVerdict: r.verdict,
        persistedZ: row.landing_z ?? null,
        computedZ: r.z,
      });
    }
  }

  console.log("Recompute summary:");
  console.log(`  recomputed:        ${recomputed}`);
  console.log(`  skipped (missing change):      ${skippedNoChange}`);
  console.log(`  skipped (no series for url):   ${skippedNoSeries}`);
  console.log(`  skipped (no resolvable anchor):${skippedNoAnchor}`);
  console.log(`  drift detected:    ${drift.length}\n`);

  if (drift.length === 0) {
    console.log("INTEGRITY OK — every persisted verdict matches T5.2 recomputation.");
    process.exit(0);
  }

  console.log("DRIFT DETAIL:");
  for (const d of drift.slice(0, 25)) {
    console.log(
      `  ${d.url.slice(-50).padEnd(50)} (change ${d.change_id.slice(-12)})  persisted=${d.persistedVerdict.padEnd(28)} computed=${d.computedVerdict.padEnd(28)} z: ${d.persistedZ?.toFixed(2) ?? "n/a"} → ${d.computedZ?.toFixed(2) ?? "n/a"}`,
    );
  }
  if (drift.length > 25) console.log(`  …and ${drift.length - 25} more.`);
  console.log("\nINTEGRITY FAIL — drift between persisted verdicts and T5.2 recomputation.");
  console.log("Run scripts/rematerialize-verdicts-t5.ts --apply to re-align, or investigate input drift.");
  process.exit(1);
}

main().catch((err) => {
  console.error("verify-verdict-rematerialization-integrity crashed:", err);
  process.exit(2);
});
