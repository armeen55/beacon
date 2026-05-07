/**
 * preflight-materializer-demotion — Trust Sprint Mini-Phase T6.7.
 *
 * Read-only classification of every persisted URL outcome's drift state
 * under T5.2 logic. Output:
 *   - Persisted verdict
 *   - Recomputed verdict (T5.2)
 *   - Drift class (none / terminal-demote / non-terminal-promote /
 *     weak-signal-emerge / etc.)
 *
 * Pure compute. No mutations. No paid APIs. Designed to inform the
 * preflight doc + the bounded fix decision.
 *
 * Usage:
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/preflight-materializer-demotion.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

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

import { computeUrlVerdict } from "../src/domains/attribution/url-verdict";
import {
  buildUrlCitationHistory,
  denseSeries,
} from "../src/domains/product/url-citation-history";
import {
  buildSamplingStatusByDate,
  resolveChangeDate,
  stampSamplingStatus,
  isTerminalVerdict,
  getUrlChangeOutcomes,
} from "../src/domains/attribution/url-change-outcome";
import { isLifecycleVerdictEnabled } from "../src/lib/flags";
import { getChangelogEntries } from "../src/lib/seed-data.server";
import { getPromptAnswerObservations } from "../src/storage/canonical-store";
import type { ChangelogEntry } from "../src/domains/changelog/types";

type DriftRow = {
  change_id: string;
  url: string;
  persisted: string;
  computed: string;
  driftClass:
    | "no_drift"
    | "terminal_demote_to_non_terminal"
    | "terminal_to_terminal_change"
    | "weak_signal_emerge"
    | "non_terminal_promote_to_terminal"
    | "other";
  persistedZ: number | null;
  computedZ: number | null;
  preFullPolls: number | null;
};

async function main(): Promise<void> {
  console.log("preflight-materializer-demotion — Trust Sprint T6.7");
  console.log("Read-only classification. No mutations. No paid APIs.\n");

  console.log("Loading citation history + changelog + observations + outcomes…");
  const persisted = await getUrlChangeOutcomes();
  const history = await buildUrlCitationHistory({ ownedOnly: true });
  const changes = (await getChangelogEntries()) as ChangelogEntry[];
  let samplingStatusByDate: Awaited<ReturnType<typeof buildSamplingStatusByDate>> = new Map();
  try {
    const obs = await getPromptAnswerObservations();
    samplingStatusByDate = buildSamplingStatusByDate(obs);
  } catch {
    // back-compat: untagged points → all "full"
  }
  const useFlag = isLifecycleVerdictEnabled();
  const changeById = new Map(changes.map((c) => [c.id, c]));
  console.log(
    `  persisted outcomes: ${persisted.length}, changes: ${changes.length}, history urls: ${history.distinct_urls}\n`,
  );

  const drifts: DriftRow[] = [];
  let recomputed = 0;
  let skippedNoChange = 0;
  let skippedNoSeries = 0;

  for (const row of persisted) {
    const change = changeById.get(row.change_id);
    if (!change) {
      skippedNoChange += 1;
      continue;
    }
    const anchor = resolveChangeDate(change, useFlag);
    if (!anchor) {
      skippedNoSeries += 1;
      continue;
    }
    const entry = history.series.find(
      (e) => e.url === row.url || (e.raw_urls ?? []).includes(row.url),
    );
    if (!entry) {
      skippedNoSeries += 1;
      continue;
    }
    const range = { first: history.date_range.first ?? "", last: history.date_range.last ?? "" };
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

    const persistedTerminal = isTerminalVerdict(row.verdict);
    const computedTerminal = isTerminalVerdict(r.verdict);

    let driftClass: DriftRow["driftClass"] = "no_drift";
    if (r.verdict === row.verdict) driftClass = "no_drift";
    else if (r.verdict === "weak_signal") driftClass = "weak_signal_emerge";
    else if (persistedTerminal && !computedTerminal) driftClass = "terminal_demote_to_non_terminal";
    else if (!persistedTerminal && computedTerminal) driftClass = "non_terminal_promote_to_terminal";
    else if (persistedTerminal && computedTerminal) driftClass = "terminal_to_terminal_change";
    else driftClass = "other";

    if (driftClass !== "no_drift") {
      drifts.push({
        change_id: row.change_id,
        url: row.url,
        persisted: row.verdict,
        computed: r.verdict,
        driftClass,
        persistedZ: row.landing_z ?? null,
        computedZ: r.z,
        preFullPolls: r.pre_full_poll_demoted?.preDaysWithFullPolls ?? null,
      });
    }
  }

  console.log("Recompute summary:");
  console.log(`  recomputed:                       ${recomputed}`);
  console.log(`  skipped (missing change):         ${skippedNoChange}`);
  console.log(`  skipped (no series for url):      ${skippedNoSeries}`);
  console.log(`  drift count:                      ${drifts.length}\n`);

  if (drifts.length === 0) {
    console.log("No drift detected. T6.7 implementation may be unnecessary on this snapshot — but the materializer's one-way semantics still block future demotions. Proceed with implementation under the bounded contract.");
    process.exit(0);
  }

  const byClass = new Map<string, number>();
  for (const d of drifts) byClass.set(d.driftClass, (byClass.get(d.driftClass) ?? 0) + 1);
  console.log("Drift classes:");
  for (const [k, v] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(40)} ${v}`);
  }
  console.log();

  console.log("DRIFT DETAIL:");
  for (const d of drifts) {
    console.log(
      `  ${d.url.slice(-50).padEnd(50)} change=${d.change_id.slice(-12)}  persisted=${d.persisted.padEnd(28)} computed=${d.computed.padEnd(28)} class=${d.driftClass}  z: ${d.persistedZ?.toFixed(2) ?? "n/a"} → ${d.computedZ?.toFixed(2) ?? "n/a"}  preFullPolls=${d.preFullPolls ?? "n/a"}`,
    );
  }
  console.log();

  // Honest preflight summary for the doc.
  const wouldDemote = drifts.filter((d) => d.driftClass === "terminal_demote_to_non_terminal").length;
  const wouldEmergeWeakSignal = drifts.filter((d) => d.driftClass === "weak_signal_emerge").length;
  const otherDrift = drifts.length - wouldDemote - wouldEmergeWeakSignal;

  console.log("Headline T6.7 effects after the proposed bounded fix:");
  console.log(`  rows that would demote (terminal → non-terminal):  ${wouldDemote}`);
  console.log(`  rows where weak_signal would emerge:                ${wouldEmergeWeakSignal}`);
  console.log(`  other drift (terminal-to-terminal, etc.):           ${otherDrift}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("preflight-materializer-demotion crashed:", err);
  process.exit(2);
});
