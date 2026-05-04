/**
 * W3 Step 3.11 (2026-05-03) — Query Fanout Audit runner.
 *
 * Operator scope: "We should not approve copy from vibes. Show the
 * query fanout / AI search evidence behind each generated edit."
 *
 * Reads a saved bundle (from `--save-bundle`), rebuilds the
 * SpecificEditEvidencePacket for that recId DETERMINISTICALLY (no
 * LLM, no model call), and prints `buildQueryFanoutAudit(packet, edit)`
 * for every edit in the bundle. Intended to run after
 * `build-edits-for-queue.ts --save-bundle=<path>` and BEFORE any
 * `--from-bundle --write` persist.
 *
 * Pure read path (no I/O writes, no DB writes, no telemetry). Reads
 * .data + Supabase via the repository layer the existing build-edits
 * script uses; rebuilds the packet via `buildPacketForRec`.
 *
 * Usage:
 *   BEACON_TENANT_ID=tenant-ritz-founder BEACON_TENANT_SLUG=ritz-builders \
 *     npx tsx --require ./scripts/mock-server-only.cjs \
 *     scripts/audit-saved-bundle.ts --bundle=/tmp/cupertino-bundle.json
 *
 * Flags:
 *   --bundle=<path>   Path to a saved SpecificEditBundle (required).
 *   --json            Emit a single-line JSON dump (audits[]) instead
 *                     of human-readable per-edit blocks.
 *   --help            Print help and exit.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPacketForRec,
  loadLiveRecommendationQueue,
} from "../src/domains/recommendations/load-queue";
import { looksLikeSpecificEditBundle } from "../src/domains/recommendations/providers/static-bundle";
import { buildQueryFanoutAudit } from "../src/domains/recommendations/query-fanout-audit";
import type {
  SpecificEdit,
  SpecificEditBundle,
} from "../src/domains/recommendations/specific-edit-provider";
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
  bundlePath: string | null;
  recIdOverride: string | null;
  json: boolean;
  help: boolean;
};

function parseFlags(argv: ReadonlyArray<string>): CliFlags {
  const flags: CliFlags = {
    bundlePath: null,
    recIdOverride: null,
    json: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--json") flags.json = true;
    else if (arg.startsWith("--bundle=")) flags.bundlePath = arg.slice(9);
    else if (arg.startsWith("--rec-id-override=")) {
      flags.recIdOverride = arg.slice("--rec-id-override=".length);
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(
    [
      "audit-saved-bundle.ts — Query Fanout Audit for a saved SpecificEditBundle.",
      "",
      "Usage:",
      "  BEACON_TENANT_ID=... BEACON_TENANT_SLUG=... \\",
      "    npx tsx --require ./scripts/mock-server-only.cjs \\",
      "    scripts/audit-saved-bundle.ts --bundle=<path>",
      "",
      "Flags:",
      "  --bundle=<path>            Path to saved bundle (from build-edits-for-queue.ts --save-bundle).",
      "  --rec-id-override=<key>    Audit the bundle's edits against a DIFFERENT rec's",
      "                             packet (use when the live queue churned and the",
      "                             bundle's original recId no longer exists).",
      "  --json                     Emit single-line JSON instead of human-readable blocks.",
      "  --help                     Print this and exit.",
      "",
      "Read-only. No model calls, no persistence.",
    ].join("\n"),
  );
}

function loadBundle(path: string): SpecificEditBundle {
  if (!existsSync(path)) {
    throw new Error(`bundle file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(
      `bundle file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!looksLikeSpecificEditBundle(parsed)) {
    throw new Error(
      `bundle file does not look like a SpecificEditBundle (schemaVersion / required fields missing): ${path}`,
    );
  }
  return parsed;
}

async function loadInventory(
  tenantId: string,
): Promise<ReadonlyArray<PageElementInventoryRow>> {
  try {
    return await getRepository().forTenant(tenantId).getPageElementInventory();
  } catch (e) {
    console.warn(
      `[audit] page_element_inventory read failed: ${e instanceof Error ? e.message : String(e)} — proceeding with empty inventory`,
    );
    return [];
  }
}

function formatEditAudit(
  index: number,
  total: number,
  edit: SpecificEdit,
  audit: ReturnType<typeof buildQueryFanoutAudit>,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`──── EDIT ${index + 1}/${total} ────────────────────────────────`);
  lines.push(`actionType        : ${audit.proposedEdit.actionType}`);
  lines.push(`targetUrl         : ${audit.proposedEdit.targetUrl}`);
  lines.push(`elementKey        : ${audit.proposedEdit.elementKey}`);
  lines.push(`displayLabel      : ${audit.proposedEdit.displayLabel}`);
  lines.push(`proposedText      :`);
  for (const ln of audit.proposedEdit.proposedText.split(/\r?\n/)) {
    lines.push(`  | ${ln}`);
  }
  lines.push("");
  lines.push(`coverage          : ${audit.queryFanoutCoverage}`);
  lines.push(`confidence        : ${audit.confidence}`);
  lines.push(`evidenceSources   : ${audit.evidenceSourcesUsed.join(", ") || "(none)"}`);
  lines.push(`normalizedIntent  : ${audit.normalizedIntent}`);
  lines.push(`recommendedAngle  : ${audit.recommendedSafeAngle}`);
  lines.push("");
  lines.push(`rawQueries (${audit.rawQueries.length}):`);
  if (audit.rawQueries.length === 0) {
    lines.push(`  (none — packet.aiSearchSignal.topSearchQueries is empty for this rec)`);
  } else {
    for (const q of audit.rawQueries) {
      lines.push(
        `  · "${q.query}" (count=${q.count}, platforms=${q.platforms.join("|") || "n/a"})`,
      );
    }
  }
  lines.push("");
  lines.push(`promptSnippets (${audit.promptSnippets.length}):`);
  if (audit.promptSnippets.length === 0) {
    lines.push(`  (none)`);
  } else {
    for (const t of audit.promptSnippets) {
      lines.push(`  · "${t}"`);
    }
  }
  lines.push("");
  lines.push(`transformedTerms (${audit.transformedTerms.length}):`);
  if (audit.transformedTerms.length === 0) {
    lines.push(`  (none — no forbidden modifiers in raw queries)`);
  } else {
    for (const t of audit.transformedTerms) {
      lines.push(`  raw   : "${t.rawPhrase}"`);
      lines.push(`  safe  : "${t.publicCopyPhrase}"`);
      lines.push(`  why   : ${t.reason}`);
    }
  }
  lines.push("");
  if (audit.unsafePhrasings.length === 0) {
    lines.push(`unsafePhrasings   : (none — proposed text is buyer-neutral)`);
  } else {
    lines.push(`unsafePhrasings   : ⚠️  ${audit.unsafePhrasings.join(" · ")}`);
  }
  // Edit's own evidence refs — small but useful audit trail.
  lines.push("");
  lines.push(`edit.evidence refs (${edit.evidence.length}):`);
  if (edit.evidence.length === 0) {
    lines.push(`  (none)`);
  } else {
    for (const ref of edit.evidence) {
      if (ref.type === "prompt") {
        lines.push(`  · prompt        promptId=${ref.promptId}`);
      } else if (ref.type === "owned_page") {
        lines.push(`  · owned_page    url=${ref.url}`);
      } else if (ref.type === "element") {
        lines.push(`  · element       url=${ref.url} key=${ref.elementKey}`);
      } else if (ref.type === "competitor") {
        lines.push(`  · competitor    name=${ref.competitorName}`);
      } else if (ref.type === "prior_outcome") {
        lines.push(`  · prior_outcome actionType=${ref.actionType}`);
      }
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }
  if (!flags.bundlePath) {
    printHelp();
    process.exit(1);
  }

  const bundle = loadBundle(flags.bundlePath);
  const tenantId = await currentTenantId();

  if (bundle.tenantId !== tenantId) {
    console.warn(
      `[audit] WARNING: bundle.tenantId=${JSON.stringify(bundle.tenantId)} ` +
        `!= current tenant ${JSON.stringify(tenantId)}. Packet rebuild will use the current tenant; audit may not match the bundle's original packet.`,
    );
  }

  const live = await loadLiveRecommendationQueue({ tenantId });
  const lookupKey = flags.recIdOverride ?? bundle.recId;
  const rec = live.queue.find((r) => r.stableKey === lookupKey);
  if (!rec) {
    console.error(
      `[audit] could not find rec ${JSON.stringify(lookupKey)} in live queue.\n` +
        `  bundle.recId           = ${JSON.stringify(bundle.recId)}\n` +
        `  --rec-id-override=     = ${JSON.stringify(flags.recIdOverride)}\n` +
        `Was the queue regenerated since the bundle was saved? Re-list with build-edits --list and re-run with --rec-id-override=<current key>.`,
    );
    process.exit(2);
  }
  if (flags.recIdOverride && flags.recIdOverride !== bundle.recId) {
    console.warn(
      `[audit] WARNING: --rec-id-override=${JSON.stringify(flags.recIdOverride)} ` +
        `differs from bundle.recId=${JSON.stringify(bundle.recId)}. The packet ` +
        `is rebuilt against the OVERRIDE rec — the audit reports what would ` +
        `happen if you persisted these edits today, not what the original ` +
        `generation context looked like. evidenceHash will not match.`,
    );
  }

  const inventory = await loadInventory(tenantId);
  const packet = buildPacketForRec({
    rec,
    context: live,
    pageElementInventory: inventory,
    tenantId,
  });

  if (flags.json) {
    const audits = bundle.recommendations.map((edit) =>
      buildQueryFanoutAudit(packet, edit),
    );
    console.log(JSON.stringify({ recId: bundle.recId, audits }));
    return;
  }

  console.log("");
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`Query Fanout Audit · ${bundle.recId}`);
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`bundle path          : ${flags.bundlePath}`);
  console.log(`bundle.providerName  : ${bundle.providerName}`);
  console.log(`bundle.evidenceHash  : ${bundle.evidenceHash}`);
  console.log(`packet.evidenceHash  : ${packet.evidenceHash}`);
  console.log(
    `evidenceHash match   : ${
      bundle.evidenceHash === packet.evidenceHash ? "yes" : "NO — packet drifted"
    }`,
  );
  console.log(`packet.affectedPrompts                         : ${packet.affectedPrompts.length}`);
  console.log(`packet.aiSearchSignal.topSearchQueries         : ${packet.aiSearchSignal.topSearchQueries.length}`);
  console.log(`packet.aiSearchSignal.topDescriptors           : ${packet.aiSearchSignal.topDescriptors.length}`);
  console.log(`packet.aiSearchSignal.topCompetitorCoMentions  : ${packet.aiSearchSignal.topCompetitorCoMentions.length}`);
  console.log(`packet.competitorPageBlueprints                : ${packet.competitorPageBlueprints.length}`);
  console.log(`packet.targetPageElements                      : ${packet.targetPageElements.length}`);
  console.log(`bundle.recommendations (edits)                 : ${bundle.recommendations.length}`);

  // ── packet-level fanout summary (good cross-edit context) ────────────
  console.log("");
  console.log("packet.aiSearchSignal.topSearchQueries (verbatim):");
  if (packet.aiSearchSignal.topSearchQueries.length === 0) {
    console.log("  (none)");
  } else {
    for (const q of packet.aiSearchSignal.topSearchQueries) {
      console.log(
        `  · "${q.query}" (count=${q.count}, platforms=${q.platforms.join("|") || "n/a"})`,
      );
    }
  }

  // ── per-edit audits ──────────────────────────────────────────────────
  for (let i = 0; i < bundle.recommendations.length; i++) {
    const edit = bundle.recommendations[i];
    const audit = buildQueryFanoutAudit(packet, edit);
    console.log(formatEditAudit(i, bundle.recommendations.length, edit, audit));
  }

  console.log("");
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`End of audit · ${bundle.recId}`);
  console.log(`══════════════════════════════════════════════════════════════════`);
}

main().catch((e) => {
  console.error(`[audit] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
