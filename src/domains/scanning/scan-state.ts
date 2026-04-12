import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LastScanResultPayload, ScanExitKind } from "./last-scan-result";

export type ScanPhase = "idle" | "running" | "success" | "partial" | "failed";

export type ScanTrigger = "today" | "pages" | "import" | "cli";

export type ScanStateFile = {
  schemaVersion: 1;
  phase: ScanPhase;
  updatedAt: string;
  trigger?: ScanTrigger;
  /** Last finished CLI payload (mirror of last-scan-result when orchestrator ran). */
  lastPayload?: LastScanResultPayload | null;
  message?: string;
};

const DATA_DIR = join(process.cwd(), ".data");
const SCAN_STATE_NAME = "scan-state";

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function scanStatePath() {
  return join(DATA_DIR, `${SCAN_STATE_NAME}.json`);
}

export function readScanState(): ScanStateFile | null {
  try {
    const p = scanStatePath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as ScanStateFile;
    if (raw.schemaVersion !== 1) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeScanStateFile(state: ScanStateFile): void {
  ensureDataDir();
  const path = scanStatePath();
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

export function mapExitKindToPhase(exit: ScanExitKind): Exclude<ScanPhase, "idle" | "running"> {
  if (exit === "success") return "success";
  if (exit === "partial") return "partial";
  return "failed";
}

/** Derive terminal phase from structured last-scan payload (aborted → failed). */
export function terminalPhaseFromPayload(
  p: LastScanResultPayload,
): Exclude<ScanPhase, "idle" | "running"> {
  if (p.exit === "aborted") return "failed";
  return mapExitKindToPhase(p.exit);
}

export function writeRunningScanState(trigger: ScanTrigger): void {
  writeScanStateFile({
    schemaVersion: 1,
    phase: "running",
    updatedAt: new Date().toISOString(),
    trigger,
    message: "Website scan in progress",
  });
}

export function writeIdleScanStateFromLastResult(
  trigger: ScanTrigger,
  payload: LastScanResultPayload,
): void {
  const phase = terminalPhaseFromPayload(payload);
  writeScanStateFile({
    schemaVersion: 1,
    phase,
    updatedAt: new Date().toISOString(),
    trigger,
    lastPayload: payload,
    message:
      phase === "success"
        ? "Scan completed"
        : phase === "partial"
          ? "Scan completed with some page errors"
          : "Scan failed or aborted",
  });
}
