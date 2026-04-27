/**
 * Sprint 6A.1 Phase 14 (2026-04-24) — `build-edits-for-queue` CLI.
 * Sprint 6A.2e (2026-04-26) — `--provider` flag + `--limit` cap.
 *
 * Loads the LIVE /recommendations queue via `loadLiveRecommendationQueue`
 * (the same orchestration the page render uses), optionally builds a
 * `SpecificEditEvidencePacket` for one or all queue items, runs a
 * provider (deterministic OR openai), and persists via Phase 11's
 * `runProviderAndPersist`.
 *
 * Default provider is deterministic. Pass `--provider=openai` to
 * dispatch to the OpenAI SpecificEditProvider (Sprint 6A.2b). The
 * OpenAI path requires `OPENAI_API_KEY` and obeys the monthly budget
 * gate shared with the page-intent adjudicator (Sprint 6A.2c).
 *
 * Anthropic is intentionally rejected at the CLI flag layer in
 * Sprint 6A.2 — the registry stub still throws `not_implemented`, but
 * here we fail loud with a clearer message than letting the orchestration
 * layer's `resolveLLMProvider` throw mid-run.
 *
 * Modes:
 *   --list                      — print every queue stableKey + cluster +
 *                                 top match URL. No packets built.
 *   --rec-id=<stableKey>        — build packet for ONE queue rec.
 *   --all                       — build packets for ALL queue recs.
 *   --provider=deterministic    — default; free; no LLM.
 *   --provider=openai           — paid; calls OpenAI; requires
 *                                 OPENAI_API_KEY; obeys the monthly
 *                                 budget gate; per-call cost recorded.
 *   --limit=N                   — cap how many recs to process under
 *                                 --all (handy with --provider=openai
 *                                 to bound cost during dogfooding).
 *   --write                     — actually persist (default DRY-RUN).
 *
 * Output per rec (one block):
 *   stableKey, packet built?, target URL, target element count,
 *   provider, model (LLM only), generated edits, accepted/rejected
 *   validation counts, costUsd (LLM only), persisted?
 *
 * Honesty: when `page_element_inventory` is empty (production today
 * before any post-Phase-6 scan), the CLI says so loudly.
 *
 * Run with:
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --list
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --rec-id=<stableKey>
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --rec-id=<stableKey> --provider=openai
 *   npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/build-edits-for-queue.ts --rec-id=<stableKey> --write
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { deterministicProvider } from "../src/domains/recommendations/providers/deterministic";
import { openaiProvider } from "../src/domains/recommendations/providers/openai";
import type { SpecificEditProvider } from "../src/domains/recommendations/specific-edit-provider";
import {
  buildPacketForRec,
  loadLiveRecommendationQueue,
  type LiveRecommendationQueue,
} from "../src/domains/recommendations/load-queue";
import { runProviderAndPersist } from "../src/domains/recommendations/recommended-edits-persistence";
import type { PrioritizedRecommendation } from "../src/domains/recommendations/prioritize";
import type { PageElementInventoryRow } from "../src/domains/pages/extractors/persist";
import { getRepository } from "../src/lib/persistence/repositories";
import { currentTenantId } from "../src/lib/tenant-context";

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
  /** Sprint 6A.2e: raw value from --provider=…; resolution + validation
   *  happens in `resolveProviderFlag`. `null` here means "use default". */
  providerRaw: string | null;
  /** Sprint 6A.2e: cap for --all targets. `null` means "no cap". */
  limit: number | null;
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    list: false,
    recId: null,
    all: false,
    write: false,
    help: false,
    providerRaw: null,
    limit: null,
  };
  for (const arg of argv) {
    if (arg === "--list") flags.list = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--write") flags.write = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--rec-id=")) {
      flags.recId = arg.slice("--rec-id=".length);
    } else if (arg.startsWith("--provider=")) {
      flags.providerRaw = arg.slice("--provider=".length).trim();
    } else if (arg.startsWith("--limit=")) {
      const raw = arg.slice("--limit=".length).trim();
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) {
        flags.limit = n;
      } else {
        // Tracked but invalid; main() reports + exits.
        flags.limit = -1;
      }
    }
  }
  return flags;
}

type ResolvedProvider =
  | { kind: "ok"; name: "deterministic" | "openai"; provider: SpecificEditProvider }
  | { kind: "error"; message: string };

/**
 * Resolve the `--provider=…` flag to a concrete `SpecificEditProvider`.
 *
 *   - default (null / unset)        → deterministic
 *   - "deterministic"               → deterministic
 *   - "openai"                      → openai (requires OPENAI_API_KEY,
 *                                     verified here so the failure
 *                                     surfaces before queue load)
 *   - "anthropic"                   → rejected explicitly. Sprint 6A.2 is
 *                                     openai-only; the registry stub
 *                                     would also throw mid-run, but a
 *                                     clear pre-flight message is more
 *                                     debuggable for the operator.
 *   - any other value               → rejected with allowed-values list
 */
function resolveProviderFlag(raw: string | null): ResolvedProvider {
  if (!raw || raw === "deterministic") {
    return { kind: "ok", name: "deterministic", provider: deterministicProvider };
  }
  if (raw === "anthropic") {
    return {
      kind: "error",
      message:
        `--provider=anthropic is not supported in Sprint 6A.2 (openai-only). ` +
        `Use --provider=deterministic (default, free) or --provider=openai (paid).`,
    };
  }
  if (raw === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return {
        kind: "error",
        message:
          `--provider=openai requires OPENAI_API_KEY to be set. ` +
          `Either provide the API key (in .env.local or shell env) or use --provider=deterministic.`,
      };
    }
    return { kind: "ok", name: "openai", provider: openaiProvider };
  }
  return {
    kind: "error",
    message:
      `Invalid --provider=${JSON.stringify(raw)}. ` +
      `Allowed values: "deterministic", "openai". ` +
      `Anthropic is not supported in Sprint 6A.2.`,
  };
}

function printHelp(): void {
  console.log(
    [
      "Usage:",
      "  npx tsx --require ./scripts/mock-server-only.cjs \\",
      "    scripts/build-edits-for-queue.ts [mode] [--provider=…] [--limit=N] [--write]",
      "",
      "Modes (one required):",
      "  --list                   List every queue stableKey + cluster + top match.",
      "  --rec-id=<stableKey>     Build packet for one queue rec.",
      "  --all                    Build packet for every queue rec.",
      "",
      "Provider:",
      "  --provider=deterministic Default. Free. No LLM. Hand-written generators.",
      "  --provider=openai        Paid. Calls OpenAI SpecificEditProvider.",
      "                           Requires OPENAI_API_KEY. Obeys monthly budget cap.",
      "",
      "Other:",
      "  --limit=N                Cap how many recs to process under --all.",
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

async function loadInventory(tenantId: string): Promise<{
  rows: PageElementInventoryRow[];
  empty: boolean;
}> {
  try {
    // Sprint 7 Phase 7.5d/1 (2026-04-25) — tenant-bound read.
    const rows = await getRepository().forTenant(tenantId).getPageElementInventory();
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
  /** Sprint 6A.2e: provider name from the bundle. */
  providerName: string | null;
  /** Sprint 6A.2e: model id from the LLM bundle (null for deterministic). */
  model: string | null;
  generated: number;
  accepted: number;
  rejected: number;
  /** Sprint 6A.2e: total USD spent on this rec (LLM only). */
  costUsd: number;
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
  provider: SpecificEditProvider;
}): Promise<RecReport> {
  const { rec, live, inventory, inventoryEmpty, tenantId, dryRun, provider } = args;
  const report: RecReport = {
    stableKey: rec.stableKey,
    packetBuilt: false,
    targetUrl: null,
    targetElementCount: 0,
    providerName: null,
    model: null,
    generated: 0,
    accepted: 0,
    rejected: 0,
    costUsd: 0,
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
      provider,
      packet,
      dryRun,
    });
    report.generated = result.totalGenerated;
    report.accepted = result.acceptedCount;
    report.rejected = result.rejectedCount;
    report.persisted = result.persisted;
    report.providerName = result.bundle.providerName;
    report.costUsd = result.bundle.totalCostUsd;
    // Pull model from the first accepted edit when present (LLM only;
    // deterministic edits carry model=null).
    const firstWithModel = result.acceptedRows.find((r) => r.model);
    report.model = firstWithModel?.model ?? null;
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
          // Sprint 6A.2f pre-flight (2026-04-26) — surface the model's
          // actual output (why / proposedText) so the operator can
          // judge usefulness alongside the validator's rejection
          // reason. Truncated to 200 chars per field to keep the line
          // log-readable.
          const why = (r.edit.why ?? "").slice(0, 200);
          const proposed = (r.edit.targetElement?.proposedText ?? "").slice(0, 200);
          report.errors.push(
            `edit rejected: action=${r.edit.actionType} url=${r.edit.targetUrl} field=${r.result.field} reason=${r.result.reason}\n      why="${why}"\n      proposedText="${proposed}"`,
          );
        }
      }
    }
    // Sprint 6A.2f pre-flight — surface ACCEPTED edit content too
    // (operator-review path for the dogfood smoke). Full proposedText
    // up to 4000 chars (the validator's currentText cap; proposedText
    // capped at 2000) so the operator can read the complete edit.
    for (const row of result.acceptedRows) {
      const why = (row.why ?? "").slice(0, 1000);
      const proposed = (row.proposed_text ?? "").slice(0, 4000);
      const current = (row.current_text ?? "").slice(0, 2000);
      report.errors.push(
        `edit accepted: action=${row.action_type} url=${row.target_url} confidence=${row.confidence} difficulty=${row.difficulty}` +
          `\n      elementKey=${row.target_element_key ?? "<page-level>"}` +
          `\n      displayLabel=${JSON.stringify(row.display_label ?? "")}` +
          `\n      why=${JSON.stringify(why)}` +
          (current ? `\n      currentText=${JSON.stringify(current)}` : "") +
          `\n      proposedText=${JSON.stringify(proposed)}` +
          `\n      expectedImpact=${JSON.stringify(row.expected_impact ?? "")}` +
          `\n      measurementPlan=${JSON.stringify(row.measurement_plan ?? "")}` +
          `\n      risks=${JSON.stringify(row.risks ?? [])}`,
      );
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
  if (report.providerName) {
    console.log(
      `    provider=${report.providerName}` +
        (report.model ? ` model=${report.model}` : ""),
    );
  }
  console.log(
    `    generated=${report.generated} accepted=${report.accepted} rejected=${report.rejected}`,
  );
  if (report.costUsd > 0) {
    console.log(`    cost_usd=${report.costUsd.toFixed(6)}`);
  }
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
  if (flags.limit !== null && flags.limit < 1) {
    console.error(
      "[build-edits] --limit must be a positive integer (e.g. --limit=1).",
    );
    process.exit(1);
  }

  // Sprint 6A.2e — resolve --provider. Validates OPENAI_API_KEY presence
  // for the openai path and rejects anthropic with a clear message.
  const providerResolution = resolveProviderFlag(flags.providerRaw);
  if (providerResolution.kind === "error") {
    console.error(`[build-edits] ${providerResolution.message}`);
    process.exit(1);
  }
  const { name: providerName, provider } = providerResolution;

  // Sprint 7 Phase 7.5d/1 (2026-04-25) — fail-loud tenant resolution.
  // No silent ritz fallback; CLI must run with BEACON_TENANT_ID set
  // (.env.local or shell env). The resolver throws a clear message
  // if neither header (CLIs have none) nor env is available.
  const tenantId = await currentTenantId();
  const dryRun = !flags.write;

  console.log(
    `[build-edits] tenant=${tenantId} mode=${
      flags.list ? "LIST" : flags.recId ? `REC(${flags.recId})` : "ALL"
    } provider=${providerName} persist=${dryRun ? "DRY-RUN" : "WRITE"}` +
      (flags.limit ? ` limit=${flags.limit}` : ""),
  );

  // Pre-flight cost reminder when the LLM path is engaged.
  if (providerName === "openai" && !dryRun) {
    console.log(
      "[build-edits] WARNING: --provider=openai with --write will spend real money via OpenAI.",
    );
  }

  const live = await loadLiveRecommendationQueue({ tenantId });
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
  const { rows: inventory, empty: inventoryEmpty } = await loadInventory(tenantId);
  console.log(
    `[build-edits] page_element_inventory rows=${inventory.length}` +
      (inventoryEmpty
        ? " (EMPTY — generator outputs will be limited; not a real-world signal)"
        : ""),
  );

  const baseTargets: PrioritizedRecommendation[] = flags.recId
    ? live.queue.filter((r) => r.stableKey === flags.recId)
    : live.queue;
  if (flags.recId && baseTargets.length === 0) {
    console.error(
      `[build-edits] No live queue rec matches stableKey "${flags.recId}".`,
    );
    console.error(
      `[build-edits] Run with --list to see what's in the queue today.`,
    );
    process.exit(3);
  }
  // Sprint 6A.2e — apply --limit cap. Useful for bounding cost when
  // running --all with --provider=openai.
  const targets: PrioritizedRecommendation[] = flags.limit
    ? baseTargets.slice(0, flags.limit)
    : baseTargets;
  if (flags.limit && baseTargets.length > targets.length) {
    console.log(
      `[build-edits] --limit=${flags.limit} applied (capped from ${baseTargets.length} → ${targets.length})`,
    );
  }

  let totalAccepted = 0;
  let totalRejected = 0;
  let totalPersisted = 0;
  let totalCostUsd = 0;
  for (const rec of targets) {
    const report = await processRec({
      rec,
      live,
      inventory,
      inventoryEmpty,
      tenantId,
      dryRun,
      provider,
    });
    printRecReport(report);
    totalAccepted += report.accepted;
    totalRejected += report.rejected;
    totalCostUsd += report.costUsd;
    if (report.persisted) totalPersisted += 1;
  }
  console.log(
    `[build-edits] summary: provider=${providerName} recs=${targets.length}` +
      ` accepted=${totalAccepted} rejected=${totalRejected}` +
      ` persisted_recs=${totalPersisted}` +
      (totalCostUsd > 0 ? ` total_cost_usd=${totalCostUsd.toFixed(6)}` : ""),
  );

  if (totalRejected > 0) {
    process.exit(2);
  }
}

// Sprint 6A.2e: Vitest detection guard. Importing this module from a
// test (to exercise `parseFlags` / `resolveProviderFlag`) must NOT
// auto-run main(). At normal CLI invocation tsx sets neither VITEST
// nor anything else that would falsely positive.
if (process.env.VITEST !== "true") {
  main().catch((err) => {
    console.error(
      `[build-edits] fatal: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}

// Sprint 6A.2e: tests import these to exercise CLI flag handling.
export { parseFlags, resolveProviderFlag };
