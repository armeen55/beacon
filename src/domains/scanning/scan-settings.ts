import "server-only";

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ScanSettings } from "./types";
import { DEFAULT_SCAN_SETTINGS } from "./types";
import { readScanState } from "./scan-state";

const SETTINGS_PATH = join(process.cwd(), ".data", "scan-settings.json");

export function getScanSettings(): ScanSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...DEFAULT_SCAN_SETTINGS, ...raw };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SCAN_SETTINGS };
}

export async function updateScanSettings(
  patch: Partial<ScanSettings>,
): Promise<void> {
  const current = getScanSettings();
  const next = { ...current, ...patch };
  const tmp = SETTINGS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
  renameSync(tmp, SETTINGS_PATH);
}

/**
 * Determines whether a daily scan is overdue.
 *
 * Overdue when:
 *   - No scan has ever run, OR
 *   - Current time (in configured timezone) is past the preferred hour
 *     AND the most recent scan completed before today's preferred hour.
 */
export function isScanOverdue(
  lastScanCompletedAt: string | null | undefined,
  settings: ScanSettings,
): boolean {
  if (!settings.enabled) return false;

  const now = new Date();
  const todayInTz = toDateInTimezone(now, settings.timezone);
  const currentHourInTz = getHourInTimezone(now, settings.timezone);

  // Before the preferred hour, never trigger
  if (currentHourInTz < settings.preferredHour) return false;

  // Check scan-state.json — a scan that completed today means we're not overdue,
  // even if the observation run it created hasn't been indexed yet.
  const scanState = readScanState();
  if (scanState && (scanState.phase === "success" || scanState.phase === "partial")) {
    const scanDay = toDateInTimezone(new Date(scanState.updatedAt), settings.timezone);
    if (scanDay >= todayInTz) return false;
  }
  // If a scan is currently running, don't trigger another
  if (scanState?.phase === "running") return false;

  if (!lastScanCompletedAt) return true;

  const lastScanDate = new Date(lastScanCompletedAt);
  const lastScanDayInTz = toDateInTimezone(lastScanDate, settings.timezone);

  return lastScanDayInTz < todayInTz;
}

function toDateInTimezone(date: Date, tz: string): string {
  try {
    return date.toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return date.toLocaleDateString("en-CA");
  }
}

function getHourInTimezone(date: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    return hourPart ? parseInt(hourPart.value, 10) : date.getHours();
  } catch {
    return date.getHours();
  }
}
