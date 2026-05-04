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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import { deterministicProvider } from "../src/domains/recommendations/providers/deterministic";
import { openaiProvider } from "../src/domains/recommendations/providers/openai";
import {
  looksLikeSpecificEditBundle,
  staticBundleProvider,
} from "../src/domains/recommendations/providers/static-bundle";
import type {
  SpecificEditBundle,
  SpecificEditProvider,
} from "../src/domains/recommendations/specific-edit-provider";
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
  /**
   * W3 §3.10 (2026-05-03) — capture the LLM bundle to disk after
   * the provider call, BEFORE persistence. Lets the operator review
   * the exact bytes once and persist the SAME bytes later via
   * `--from-bundle=<path>` without a second model call. Path is
   * created if its parent directory doesn't exist.
   */
  saveBundle: string | null;
  /**
   * W3 §3.10 (2026-05-03) — load a previously-captured bundle from
   * disk and persist it WITHOUT calling the LLM. The saved
   * `tenantId` / `recId` / `evidenceHash` must match the current
   * packet (the static-bundle provider throws on mismatch). All
   * validator gates still run against the loaded bundle.
   *
   * Mutually exclusive with --provider; the bundle's own
   * `providerName` drives telemetry.
   */
  fromBundle: string | null;
  /**
   * W3 §3.12 (2026-05-03) — graft the bundle's recId in memory so a
   * saved bundle can replay against a re-clustered queue rec. Only
   * valid alongside `--from-bundle`; cannot be combined with
   * `--rec-id` (it serves the same role for the from-bundle path).
   *
   * The on-disk file is NEVER mutated — the override is a CLI-time
   * graft, and the change is logged loudly so the audit trail still
   * shows the original bundle.recId. Tenant + evidenceHash still
   * have to be reasonable (warn on tenant mismatch; evidenceHash
   * drift is expected because the packet rebuilt against a
   * different rec scope is genuinely a different packet).
   */
  recIdOverride: string | null;
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
    saveBundle: null,
    fromBundle: null,
    recIdOverride: null,
  };
  for (const arg of argv) {
    if (arg === "--list") flags.list = true;
    else if (arg === "--all") flags.all = true;
    else if (arg === "--write") flags.write = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--rec-id-override=")) {
      flags.recIdOverride = arg.slice("--rec-id-override=".length).trim();
    } else if (arg.startsWith("--rec-id=")) {
      flags.recId = arg.slice("--rec-id=".length);
    } else if (arg.startsWith("--provider=")) {
      flags.providerRaw = arg.slice("--provider=".length).trim();
    } else if (arg.startsWith("--save-bundle=")) {
      flags.saveBundle = arg.slice("--save-bundle=".length).trim();
    } else if (arg.startsWith("--from-bundle=")) {
      flags.fromBundle = arg.slice("--from-bundle=".length).trim();
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
      "Save / replay (W3 §3.10 — operator review-and-persist path):",
      "  --save-bundle=<path>     After the provider call, write the LLM bundle",
      "                           to <path> (JSON). Lets you review exact copy",
      "                           once and persist the SAME bytes later.",
      "  --from-bundle=<path>     Replay a saved bundle: persist the EXACT bytes",
      "                           with no second model call. Mutually exclusive",
      "                           with --provider / --save-bundle. The bundle's",
      "                           tenantId/recId/evidenceHash must match the",
      "                           current packet (fail-loud on drift).",
      "  --rec-id-override=<key>  (--from-bundle only) Replay the saved bundle",
      "                           against a DIFFERENT live-queue rec. Use when",
      "                           the queue churned between save and replay",
      "                           (e.g. a single-prompt rec was promoted to a",
      "                           cluster page). The on-disk JSON is NOT",
      "                           mutated; the bundle's recId is grafted in",
      "                           memory + a loud warning is logged. Cannot be",
      "                           combined with --rec-id (the override IS the",
      "                           lookup key for the from-bundle path).",
      "",
      "Other:",
      "  --limit=N                Cap how many recs to process under --all.",
      "  --write                  Actually persist (otherwise dry-run).",
      "  --help / -h              Show this message.",
      "",
      "Default mode is DRY-RUN. Pass --write to persist.",
      "Idempotent: re-runs replace existing rows by",
      "(rec_id, action_type, target_element_key).",
      "",
      "Two-step review-and-persist flow (W3 §3.10):",
      "  1) Dry-run + save:",
      "     scripts/build-edits-for-queue.ts \\",
      "       --rec-id=<id> --provider=openai --save-bundle=/tmp/<id>.json",
      "  2) Review the saved JSON (or the stdout dump). When approved, replay:",
      "     scripts/build-edits-for-queue.ts \\",
      "       --rec-id=<id> --from-bundle=/tmp/<id>.json --write",
      "  Step 2 makes ZERO model calls; the operator-reviewed bytes ship verbatim.",
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
  /** W3 §3.10 — when set, after the provider call, write the
   *  generated bundle to this path so the operator can review +
   *  later persist it via --from-bundle. */
  saveBundle: string | null;
}): Promise<RecReport> {
  const {
    rec,
    live,
    inventory,
    inventoryEmpty,
    tenantId,
    dryRun,
    provider,
    saveBundle,
  } = args;
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
    // W3 §3.10 — capture the LLM bundle to disk for later
    // persistence via --from-bundle. We save the FULL bundle (incl.
    // rejected edits) so the operator's review file is complete;
    // validation re-runs at persist time and re-rejects the bad
    // ones, leaving only the same accepted set.
    if (saveBundle) {
      try {
        const dir = dirname(saveBundle);
        if (dir && dir !== "." && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(
          saveBundle,
          JSON.stringify(result.bundle, null, 2),
          "utf8",
        );
        console.log(
          `[build-edits] saved bundle (${result.bundle.recommendations.length} edits, $${result.bundle.totalCostUsd.toFixed(6)}) to ${saveBundle}`,
        );
      } catch (err) {
        report.errors.push(
          `--save-bundle write failed for ${saveBundle}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
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

  // W3 §3.12 — `--rec-id-override` is a from-bundle-only single-rec
  // mode. It SUBSTITUTES for `--rec-id`, so guard against pairing the
  // two before the modeCount check (otherwise the operator could
  // accidentally pass both and the second silently wins).
  if (flags.recIdOverride !== null && !flags.fromBundle) {
    console.error(
      "[build-edits] --rec-id-override requires --from-bundle (it grafts the saved bundle's recId in memory so it can replay against a re-clustered queue rec).",
    );
    process.exit(1);
  }
  if (flags.recIdOverride !== null && flags.recId !== null) {
    console.error(
      "[build-edits] --rec-id-override and --rec-id are mutually exclusive. The override IS the queue-lookup key for the from-bundle path.",
    );
    process.exit(1);
  }

  const modeCount = [
    flags.list,
    flags.recId !== null,
    flags.all,
    flags.recIdOverride !== null,
  ].filter(Boolean).length;
  if (flags.help || modeCount === 0) {
    printHelp();
    if (!flags.help) {
      console.error(
        "\n[build-edits] No mode provided. Pass one of --list / --rec-id=<...> / --all / (--from-bundle=<...> --rec-id-override=<...>).",
      );
      process.exit(1);
    }
    return;
  }
  if (modeCount > 1) {
    console.error(
      "[build-edits] Pass only ONE mode flag (--list / --rec-id / --all / --rec-id-override).",
    );
    process.exit(1);
  }
  if (flags.limit !== null && flags.limit < 1) {
    console.error(
      "[build-edits] --limit must be a positive integer (e.g. --limit=1).",
    );
    process.exit(1);
  }

  // W3 §3.10 — --from-bundle is mutually exclusive with --provider.
  // The bundle's own providerName drives telemetry; passing
  // --provider alongside would be ambiguous.
  if (flags.fromBundle && flags.providerRaw) {
    console.error(
      "[build-edits] --from-bundle and --provider are mutually exclusive. The bundle's saved providerName is authoritative.",
    );
    process.exit(1);
  }
  if (flags.fromBundle && flags.saveBundle) {
    console.error(
      "[build-edits] --from-bundle and --save-bundle are mutually exclusive. --from-bundle replays a saved bundle; there's nothing new to save.",
    );
    process.exit(1);
  }

  let providerName: "deterministic" | "openai";
  let provider: SpecificEditProvider;
  let staticBundle: SpecificEditBundle | null = null;
  if (flags.fromBundle) {
    // W3 §3.10 — replay path: load the saved bundle from disk and
    // wrap it in a static provider. Validation + persistence layers
    // run normally so brand-claim grounding, em dashes, FAQ pairing,
    // competitor leak checks all apply at persist time.
    if (!existsSync(flags.fromBundle)) {
      console.error(
        `[build-edits] --from-bundle path does not exist: ${flags.fromBundle}`,
      );
      process.exit(1);
    }
    let raw: string;
    try {
      raw = readFileSync(flags.fromBundle, "utf8");
    } catch (err) {
      console.error(
        `[build-edits] --from-bundle read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        `[build-edits] --from-bundle: file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
    if (!looksLikeSpecificEditBundle(parsed)) {
      console.error(
        `[build-edits] --from-bundle: file does not look like a SpecificEditBundle (schemaVersion / tenantId / recId / evidenceHash / providerName / recommendations / totalCostUsd required).`,
      );
      process.exit(1);
    }
    staticBundle = parsed;
    // W3 §3.12 — when --rec-id-override is set, graft the bundle's
    // recId in memory BEFORE wrapping in the static provider. The
    // provider's tenantId/recId/evidenceHash assertion runs against
    // the LIVE packet built from the override rec; tenantId still
    // has to match (we don't graft it; that's an actual mistake), and
    // evidenceHash will not match (different rec scope = different
    // packet by definition). The on-disk JSON file stays unchanged.
    if (flags.recIdOverride !== null) {
      const originalRecId = staticBundle.recId;
      console.warn(
        `[build-edits] --rec-id-override: grafting bundle.recId from ${JSON.stringify(originalRecId)} to ${JSON.stringify(flags.recIdOverride)} IN MEMORY ONLY (the saved bundle file at ${flags.fromBundle} is NOT modified).`,
      );
      // Graft recId in memory; tenantId stays as the saved bundle's
      // tenantId (a tenant mismatch IS an actual mistake — don't
      // graft it). evidenceHash difference is opted into via the
      // provider's `allowEvidenceHashDrift` option below.
      staticBundle = {
        ...staticBundle,
        recId: flags.recIdOverride,
      };
    }
    // W3 §3.12 — under --rec-id-override the saved bundle was
    // generated for a different rec scope, so its evidenceHash will
    // not match the live packet's hash. Opt the static provider into
    // hash drift; tenantId + recId equality still enforced.
    provider = staticBundleProvider(staticBundle, {
      allowEvidenceHashDrift: flags.recIdOverride !== null,
    });
    // The bundle's providerName drives telemetry. Cast back to the
    // CLI's narrow union (deterministic / openai); if the saved
    // bundle was produced by some other provider, fall back to
    // labeling it as deterministic in the summary line (the
    // persistence layer's history records the real source).
    providerName =
      staticBundle.providerName === "openai" ? "openai" : "deterministic";
  } else {
    // Sprint 6A.2e — resolve --provider. Validates OPENAI_API_KEY
    // presence for the openai path and rejects anthropic.
    const providerResolution = resolveProviderFlag(flags.providerRaw);
    if (providerResolution.kind === "error") {
      console.error(`[build-edits] ${providerResolution.message}`);
      process.exit(1);
    }
    providerName = providerResolution.name;
    provider = providerResolution.provider;
  }

  // Sprint 7 Phase 7.5d/1 (2026-04-25) — fail-loud tenant resolution.
  // No silent ritz fallback; CLI must run with BEACON_TENANT_ID set
  // (.env.local or shell env). The resolver throws a clear message
  // if neither header (CLIs have none) nor env is available.
  const tenantId = await currentTenantId();
  const dryRun = !flags.write;

  const sourceLabel = staticBundle
    ? `from-bundle:${flags.fromBundle}`
    : `provider=${providerName}`;
  const modeLabel = flags.list
    ? "LIST"
    : flags.recIdOverride
      ? `REC-OVERRIDE(${flags.recIdOverride})`
      : flags.recId
        ? `REC(${flags.recId})`
        : "ALL";
  console.log(
    `[build-edits] tenant=${tenantId} mode=${modeLabel} ${sourceLabel} persist=${dryRun ? "DRY-RUN" : "WRITE"}` +
      (flags.limit ? ` limit=${flags.limit}` : ""),
  );

  // Pre-flight cost reminder when the LLM path is engaged.
  if (providerName === "openai" && !dryRun && !staticBundle) {
    console.log(
      "[build-edits] WARNING: --provider=openai with --write will spend real money via OpenAI.",
    );
  }
  if (staticBundle && !dryRun) {
    console.log(
      `[build-edits] --from-bundle replay: persisting ${staticBundle.recommendations.length} edits from ${flags.fromBundle} (no model call, $0 spend; bundle's saved totalCostUsd=$${staticBundle.totalCostUsd.toFixed(6)} reflects the original run).`,
    );
  }
  if (flags.saveBundle) {
    console.log(
      `[build-edits] --save-bundle: will write the LLM bundle to ${flags.saveBundle} after generation.`,
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

  // W3 §3.12 — `--rec-id-override` substitutes for `--rec-id` in the
  // from-bundle path so the saved bundle can replay against a re-
  // clustered queue rec. Effective lookup key: override if set,
  // otherwise --rec-id. (Both can't be set; guarded earlier.)
  const lookupKey = flags.recIdOverride ?? flags.recId;
  const baseTargets: PrioritizedRecommendation[] = lookupKey
    ? live.queue.filter((r) => r.stableKey === lookupKey)
    : live.queue;
  if (lookupKey && baseTargets.length === 0) {
    console.error(
      `[build-edits] No live queue rec matches stableKey ${JSON.stringify(lookupKey)}.`,
    );
    if (flags.recIdOverride) {
      console.error(
        `[build-edits] (--rec-id-override was passed; the override key must match a CURRENT queue rec, not the bundle's original recId.)`,
      );
    }
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
      saveBundle: flags.saveBundle,
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
