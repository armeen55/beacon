/**
 * Sprint 6A.1 Phase 11 (2026-04-24) — `generate-specific-edits` CLI.
 *
 * Runs the deterministic SpecificEditProvider on a SpecificEditEvidencePacket,
 * validates the output, and persists the accepted rows to
 * `.data/recommended-edits.json` + Supabase (when DUAL_WRITE=true).
 *
 * No LLM. No paid API calls. No browser / UI. Safe to run repeatedly —
 * idempotent on `(rec_id, action_type, target_element_key)`.
 *
 * Run with:
 *   # Smoke test — empty packet, exercises the pipeline, NEVER writes.
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/generate-specific-edits.ts --smoke
 *
 *   # Real packet from a JSON file (default = dry-run; pass --write to persist).
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/generate-specific-edits.ts \
 *     --packet=path/to/packet.json
 *
 *   # Same, but actually write.
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/generate-specific-edits.ts \
 *     --packet=path/to/packet.json --write
 *
 * Default mode is DRY-RUN for safety. Pass `--write` to persist. When
 * the packet has zero candidate URLs / pageElements / prompts, the
 * deterministic provider produces zero recommendations — the script
 * exits cleanly without writing anything.
 */

import { existsSync, readFileSync } from "node:fs";

import { deterministicProvider } from "../src/domains/recommendations/providers/deterministic";
import { runProviderAndPersist } from "../src/domains/recommendations/recommended-edits-persistence";
import {
  buildSpecificEditEvidencePacket,
  type SpecificEditEvidencePacket,
} from "../src/domains/recommendations/specific-edit-evidence";
import { currentTenantId } from "../src/lib/tenant-context";

type CliFlags = {
  packetPath: string | null;
  smoke: boolean;
  write: boolean;
  help: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    packetPath: null,
    smoke: false,
    write: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--smoke") flags.smoke = true;
    else if (arg === "--write") flags.write = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg.startsWith("--packet=")) {
      flags.packetPath = arg.slice("--packet=".length);
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(
    [
      "Usage:",
      "  npx tsx --require ./scripts/mock-server-only.cjs \\",
      "    scripts/generate-specific-edits.ts [options]",
      "",
      "Options:",
      "  --smoke           Build an empty packet, exercise the pipeline, never write.",
      "  --packet=<path>   Read a packet JSON file. Default: dry-run.",
      "  --write           Actually persist (otherwise dry-run).",
      "  --help / -h       Show this message.",
      "",
      "Behavior:",
      "  Default mode is DRY-RUN. Pass --write to persist.",
      "  Idempotent — re-runs replace existing rows by",
      "  (rec_id, action_type, target_element_key).",
    ].join("\n"),
  );
}

function buildSmokePacket(tenantId: string): SpecificEditEvidencePacket {
  return buildSpecificEditEvidencePacket({
    tenantId,
    recId: `smoke-${Date.now()}`,
    clusterLabel: null,
    clusterKind: null,
    affectedPromptIds: [],
    promptOpportunities: [],
    trackedPrompts: [],
    primarySummaries: [],
    ownedPageInventory: [],
    pageElementInventory: [],
    observations: [],
    singleTargetUrl: null,
  });
}

function loadPacketFromFile(path: string): SpecificEditEvidencePacket {
  if (!existsSync(path)) {
    throw new Error(`Packet file not found: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in packet file ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  // Light shape check — validation lives downstream. The packet shape
  // is locked by Phase 7's tests.
  const obj = parsed as Record<string, unknown>;
  if (
    obj.schemaVersion !== "specific-edit/v1" ||
    typeof obj.tenantId !== "string" ||
    typeof obj.recId !== "string" ||
    typeof obj.evidenceHash !== "string"
  ) {
    throw new Error(
      `Packet file does not match SpecificEditEvidencePacket shape (schemaVersion / tenantId / recId / evidenceHash missing or wrong type)`,
    );
  }
  return parsed as SpecificEditEvidencePacket;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help || (!flags.smoke && !flags.packetPath)) {
    printHelp();
    if (!flags.help) {
      console.error(
        "\n[generate-specific-edits] No --packet or --smoke provided.",
      );
      process.exit(1);
    }
    return;
  }

  // Sprint 7 Phase 7.5d/2 (2026-04-25) — fail-loud tenant resolution.
  const tenantId = await currentTenantId();
  const packet: SpecificEditEvidencePacket = flags.smoke
    ? buildSmokePacket(tenantId)
    : loadPacketFromFile(flags.packetPath!);

  // Smoke runs are ALWAYS dry-run (forced safety). Other modes default
  // to dry-run unless --write is passed.
  const dryRun = flags.smoke ? true : !flags.write;

  console.log(
    `[generate-specific-edits] tenant=${packet.tenantId} rec=${packet.recId} ` +
      `cluster="${packet.clusterLabel ?? ""}" hash=${packet.evidenceHash} ` +
      `mode=${dryRun ? "DRY-RUN" : "WRITE"}`,
  );

  const result = await runProviderAndPersist({
    provider: deterministicProvider,
    packet,
    dryRun,
  });

  console.log(
    `[generate-specific-edits] generated=${result.totalGenerated} ` +
      `accepted=${result.acceptedCount} rejected=${result.rejectedCount} ` +
      `persisted=${result.persisted}`,
  );

  if (result.bundleErrors.length > 0) {
    console.error("[generate-specific-edits] bundle-level errors:");
    for (const e of result.bundleErrors) {
      console.error(`  - ${e.field}: ${e.reason}`);
    }
  }

  if (result.rejected.length > 0) {
    console.error(
      `[generate-specific-edits] ${result.rejected.length} edit(s) rejected:`,
    );
    for (const r of result.rejected) {
      if (!r.result.ok) {
        console.error(
          `  - actionType=${r.edit.actionType} url=${r.edit.targetUrl} field=${r.result.field} reason=${r.result.reason}`,
        );
      }
    }
  }

  if (result.bundleErrors.length > 0 || result.rejectedCount > 0) {
    // Exit non-zero so CI can flag broken outputs.
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(
    `[generate-specific-edits] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
