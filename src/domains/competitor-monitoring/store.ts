/**
 * Competitor Monitoring Store — persists sitemap snapshots and detected changes.
 */

import { readDotDataJson, writeDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CompetitorMonitoringState } from "./types";

const STORE_FILE = "competitor-monitoring";

const EMPTY_STATE: CompetitorMonitoringState = {
  lastCrawlAt: null,
  snapshots: [],
  recentChanges: [],
};

export function getCompetitorMonitoringState(): CompetitorMonitoringState {
  return readDotDataJson<CompetitorMonitoringState>(STORE_FILE) ?? EMPTY_STATE;
}

export function saveCompetitorMonitoringState(
  state: CompetitorMonitoringState,
): void {
  writeDotDataJson(STORE_FILE, state);
}
