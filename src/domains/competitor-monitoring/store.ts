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

export async function getCompetitorMonitoringState(): Promise<CompetitorMonitoringState> {
  return (await readDotDataJson<CompetitorMonitoringState>(STORE_FILE)) ?? EMPTY_STATE;
}

export async function saveCompetitorMonitoringState(
  state: CompetitorMonitoringState,
): Promise<void> {
  await writeDotDataJson(STORE_FILE, state);
}
