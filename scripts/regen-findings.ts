/**
 * Regenerate scan-findings against the CURRENT page-snapshots + previous
 * page-snapshots-prev. Use after `scan-owned-pages.ts` (which writes
 * snapshots but not findings) to feed the detection pipeline.
 *
 * Usage:
 *   npx tsx scripts/regen-findings.ts
 */

// Stub modules that can't run outside Next.js — same pattern as run-import.ts.
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/cache") return { revalidatePath: () => {}, unstable_cache: (fn: unknown) => fn };
  if (request === "next/headers") return { cookies: () => ({ get: () => null }), headers: () => new Map() };
  if (request.endsWith("seed-data.server") || request.includes("seed-data.server")) {
    return {
      importRuns: [],
      hasActiveExperiment: () => false,
      results: [],
      changelogEntries: [],
      opportunities: [],
      competitors: [],
      briefs: [],
      competitorSnapshots: [],
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageSnapshot } from "../src/domains/pages/types";
import type { GuardrailAlert } from "../src/domains/pages/guardrails";

const DATA = join(process.cwd(), ".data");

function readJSON<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA, name + ".json"), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  // Lazy-require so the Module._load hook above is in effect when this loads.
  const { regenerateScanFindings } = require("../src/domains/scanning/orchestrate-scan");

  const previousSnapshots = readJSON<PageSnapshot[]>("page-snapshots-prev", []);
  const previousGuardrails = readJSON<GuardrailAlert[]>(
    "page-guardrails-prev",
    [],
  );

  let scanRunId: string;
  try {
    const state = readJSON<{
      lastPayload?: { observationRunId?: string };
    }>("scan-state", {});
    scanRunId = state.lastPayload?.observationRunId ?? `obs-regen-${Date.now()}`;
  } catch {
    scanRunId = `obs-regen-${Date.now()}`;
  }

  console.log(
    `Regenerating findings against ${previousSnapshots.length} prev snapshots (scanRunId=${scanRunId})...`,
  );
  const added = await regenerateScanFindings({
    previousSnapshots,
    previousGuardrails,
    scanRunId,
  });
  console.log(`Done. ${added} findings emitted.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
