import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";

export const LAST_SCAN_RESULT_BASENAME = "last-scan-result";

/** CLI / orchestrator exit classification (persisted). */
export type ScanExitKind = "success" | "partial" | "failed" | "aborted";

export type LastScanResultPayload = {
  schemaVersion: 1;
  finishedAt: string;
  exit: ScanExitKind;
  /** Who invoked the scan (optional, set by orchestrator when known). */
  /** Orchestrator sets today/pages/import; CLI-only runs use `cli`. */
  trigger?: "today" | "pages" | "import" | "cli";
  observationRunId: string | null;
  pagesScanned: number;
  pagesChanged: number;
  pagesWithErrors: number;
  guardrailAlertCount: number;
  dryRun?: boolean;
  abortedReason?: string;
  /** Top-level CLI or sitemap failure before a run id was minted. */
  cliError?: string;
  fetchErrors?: { url: string; error: string }[];
};

const DATA_DIR = join(process.cwd(), ".data");

function ensureDataDir() {
  if (process.env.VERCEL === "1") return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function writeLastScanResultFile(payload: LastScanResultPayload): void {
  ensureDataDir();
  const path = join(DATA_DIR, `${LAST_SCAN_RESULT_BASENAME}.json`);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tmp, path);
}

export async function readLastScanResult(): Promise<LastScanResultPayload | null> {
  const raw = await readDotDataJson<LastScanResultPayload>(LAST_SCAN_RESULT_BASENAME);
  if (!raw || raw.schemaVersion !== 1) return null;
  return raw;
}
