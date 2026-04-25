/**
 * Sprint 6A.1 Phase 14 (2026-04-24) — `build-edits-for-queue` CLI.
 *
 * Loads the LIVE /recommendations queue via `loadLiveRecommendationQueue`
 * (the same orchestration the page render uses), optionally builds a
 * `SpecificEditEvidencePacket` for one or all queue items, runs the
 * deterministic provider, and persists via Phase 11's `runProviderAndPersist`.
 *
 * No LLM. No paid API calls. No hosted scan trigger. No new architecture.
 *
 * Modes:
 *   --list                      — print every queue stableKey + cluster +
 *                                 top match URL. No packets built.
 *   --rec-id=<stableKey>        — build packet for ONE queue rec.
 *   --all                       — build packets for ALL queue recs.
 *   --write                     — actually persist (default DRY-RUN).
 *
 * Output per rec (one block):
 *   stableKey, packet built?, target URL, target element count,
 *   generated edits, accepted/rejected validation counts, persisted?
 *
 * Honesty: when `page_element_inventory` is empty (production today
 * before any post-Phase-6 scan), the CLI says so loudly. The
 * deterministic generators will skip `edit_title` entirely (it
 * requires an existing title element); `add_h2_section` and `add_faq`
 * may still propose against the empty baseline — that's not a real
 * win, just an artifact of missing inventory data.
 *
 * Run with:
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --list
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --rec-id=<stableKey>
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --rec-id=<stableKey> --write
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { deterministicProvider } from "../src/domains/recommendations/providers/deterministic";
import {
  buildPacketForRec,
  loadLiveRecommendationQueue,
  type LiveRecommendationQueue,
} from "../src/domains/recommendations/load-queue";
import { runProviderAndPersist } from "../src/domains/recommendations/recommended-edits-persistence";
import type { PrioritizedRecommendation } from "../src/domains/recommendations/prioritize";
import type { PageElementInventoryRow } from "../src/domains/pages/extractors/persist";
import { getRepository } from "../src/lib/persistence/repositories";

/** tsx doesn't auto-load .env.local the way Next.js does. */
function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

type CliFlags = {
  list: boolean;
  recId: string | null;
  all: boolean;
  write: boolean;
  help: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    list: false,
    recId: null,
    all: false,
    write: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--list") flags.list = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--write") flags.write = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--rec-id=")) {
      flags.recId = arg.slice("--rec-id=".length);
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(
    [
      "Usage:",
      "  npx tsx --require ./scripts/mock-server-only.cjs \\",
      "    scripts/build-edits-for-queue.ts [mode] [--write]",
      "",
      "Modes (one required):",
      "  --list                   List every queue stableKey + cluster + top match.",
      "  --rec-id=<stableKey>     Build packet for one queue rec.",
      "  --all                    Build packet for every queue rec.",
      "",
      "Other:",
      "  --write                  Actually persist (otherwise dry-run).",
      "  --help / -h              Show this message.",
      "",
      "Default mode is DRY-RUN. Pass --write to persist.",
      "Idempotent: re-runs replace existing rows by",
      "(rec_id, action_type, target_element_key).",
    ].join("\n"),
  );
}

function topMatchUrlFor(rec: PrioritizedRecommendation): string {
  // Resolved URL is the page-intent resolver's output. May be the
  // `needs_new_page` sentinel for create-new recs.
  return rec.resolution?.targetUrl ?? "(unresolved)";
}

function reportListMode(live: LiveRecommendationQueue): void {
  console.log(`[build-edits] queue=${live.queue.length} watchlist=${live.watchlist.length}`);
  for (const e of live.errors) {
    console.warn(`[build-edits] orchestration warning: ${e}`);
  }
  for (const rec of live.queue) {
    console.log(
      `  - ${rec.stableKey}` +
        ` :: cluster="${rec.clusterLabel ?? ""}" (${rec.clusterKind ?? "n/a"})` +
        ` :: target=${topMatchUrlFor(rec)}` +
        ` :: tier=${rec.tier} rank=${rec.rank}`,
    );
  }
}

async function loadInventory(): Promise<{
  rows: PageElementInventoryRow[];
  empty: boolean;
}> {
  try {
    const rows = await getRepository().getPageElementInventory();
    return { rows, empty: rows.length === 0 };
  } catch (e) {
    console.warn(
      `[build-edits] page_element_inventory read failed: ${e instanceof Error ? e.message : String(e)} — proceeding with empty inventory`,
    );
    return { rows: [], empty: true };
  }
}

type RecReport = {
  stableKey: string;
  packetBuilt: boolean;
  targetUrl: string | null;
  targetElementCount: number;
  generated: number;
  accepted: number;
  rejected: number;
  persisted: boolean;
  /** Action-type breakdown of accepted edits. */
  actionTypeCounts: Record<string, number>;
  errors: string[];
};

async function processRec(args: {
  rec: PrioritizedRecommendation;
  live: LiveRecommendationQueue;
  inventory: PageElementInventoryRow[];
  inventoryEmpty: boolean;
  tenantId: string;
  dryRun: boolean;
}): Promise<RecReport> {
  const { rec, live, inventory, inventoryEmpty, tenantId, dryRun } = args;
  const report: RecReport = {
    stableKey: rec.stableKey,
    packetBuilt: false,
    targetUrl: null,
    targetElementCount: 0,
    generated: 0,
    accepted: 0,
    rejected: 0,
    persisted: false,
    actionTypeCounts: {},
    errors: [],
  };
  let packet;
  try {
    packet = buildPacketForRec({
      rec,
      context: live,
      pageElementInventory: inventory,
      tenantId,
    });
    report.packetBuilt = true;
    report.targetUrl = topMatchUrlFor(rec);
    report.targetElementCount = packet.targetPageElements.length;
  } catch (e) {
    report.errors.push(
      `packet build failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return report;
  }

  if (inventoryEmpty) {
    report.errors.push(
      "page_element_inventory is EMPTY — generators will skip element-targeted actions; outputs are not real-world signal",
    );
  }

  try {
    const result = await runProviderAndPersist({
      provider: deterministicProvider,
      packet,
      dryRun,
    });
    report.generated = result.totalGenerated;
    report.accepted = result.acceptedCount;
    report.rejected = result.rejectedCount;
    report.persisted = result.persisted;
    for (const row of result.acceptedRows) {
      report.actionTypeCounts[row.action_type] =
        (report.actionTypeCounts[row.action_type] ?? 0) + 1;
    }
    if (result.bundleErrors.length > 0) {
      for (const e of result.bundleErrors) {
        report.errors.push(`bundle: ${e.field} ${e.reason}`);
      }
    }
    if (result.rejected.length > 0) {
      for (const r of result.rejected) {
        if (!r.result.ok) {
          report.errors.push(
            `edit rejected: action=${r.edit.actionType} url=${r.edit.targetUrl} field=${r.result.field} reason=${r.result.reason}`,
          );
        }
      }
    }
  } catch (e) {
    report.errors.push(
      `provider+persist failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return report;
}

function printRecReport(report: RecReport): void {
  console.log(`  rec=${report.stableKey}`);
  console.log(`    packet_built=${report.packetBuilt}`);
  if (report.targetUrl) console.log(`    target_url=${report.targetUrl}`);
  console.log(`    target_element_count=${report.targetElementCount}`);
  console.log(
    `    generated=${report.generated} accepted=${report.accepted} rejected=${report.rejected}`,
  );
  const breakdown = Object.entries(report.actionTypeCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (breakdown) {
    console.log(`    action_types: ${breakdown}`);
  }
  console.log(`    persisted=${report.persisted}`);
  for (const e of report.errors) {
    console.warn(`    [warn] ${e}`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const flags = parseFlags(process.argv.slice(2));

  const modeCount = [flags.list, flags.recId !== null, flags.all].filter(
    Boolean,
  ).length;
  if (flags.help || modeCount === 0) {
    printHelp();
    if (!flags.help) {
      console.error("\n[build-edits] No mode provided. Pass one of --list / --rec-id=<...> / --all.");
      process.exit(1);
    }
    return;
  }
  if (modeCount > 1) {
    console.error("[build-edits] Pass only ONE mode flag (--list / --rec-id / --all).");
    process.exit(1);
  }

  const tenantId =
    process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder";
  const dryRun = !flags.write;

  console.log(
    `[build-edits] tenant=${tenantId} mode=${
      flags.list ? "LIST" : flags.recId ? `REC(${flags.recId})` : "ALL"
    } persist=${dryRun ? "DRY-RUN" : "WRITE"}`,
  );

  const live = await loadLiveRecommendationQueue();
  if (!live.matrix) {
    console.error(
      "[build-edits] decision matrix unavailable; cannot continue. Errors:",
    );
    for (const e of live.errors) console.error(`  - ${e}`);
    process.exit(2);
  }

  if (flags.list) {
    reportListMode(live);
    return;
  }

  // Build mode (rec-id or all): load inventory once.
  const { rows: inventory, empty: inventoryEmpty } = await loadInventory();
  console.log(
    `[build-edits] page_element_inventory rows=${inventory.length}` +
      (inventoryEmpty
        ? " (EMPTY — generator outputs will be limited; not a real-world signal)"
        : ""),
  );

  const targets: PrioritizedRecommendation[] = flags.recId
    ? live.queue.filter((r) => r.stableKey === flags.recId)
    : live.queue;
  if (flags.recId && targets.length === 0) {
    console.error(
      `[build-edits] No live queue rec matches stableKey "${flags.recId}".`,
    );
    console.error(
      `[build-edits] Run with --list to see what's in the queue today.`,
    );
    process.exit(3);
  }

  let totalAccepted = 0;
  let totalRejected = 0;
  let totalPersisted = 0;
  for (const rec of targets) {
    const report = await processRec({
      rec,
      live,
      inventory,
      inventoryEmpty,
      tenantId,
      dryRun,
    });
    printRecReport(report);
    totalAccepted += report.accepted;
    totalRejected += report.rejected;
    if (report.persisted) totalPersisted += 1;
  }
  console.log(
    `[build-edits] summary: recs=${targets.length} accepted=${totalAccepted} rejected=${totalRejected} persisted_recs=${totalPersisted}`,
  );

  if (totalRejected > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(
    `[build-edits] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
