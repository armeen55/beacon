import "server-only";

/**
 * Append-only audit log of adjudicator calls. Keeps the raw input packet
 * (hashed for brevity) + raw output + cost + model + timestamp for every
 * call the adjudicator makes. Useful for debugging, cost reconciliation,
 * and eventual re-runs.
 *
 * Phase v7 Commit 3 (2026-04-23).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { AdjudicatorOutput } from "./adjudicator-schema";
import type { EvidencePacket } from "./evidence-packet";

const STORE_NAME = "adjudicator-history";

export type AdjudicatorHistoryEntry = {
  timestamp: string;
  evidenceHash: string;
  stableKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Null on cache hits (we still log for audit). */
  output: AdjudicatorOutput | null;
  /** Minimal packet summary — full packet stays in cache. */
  packetSummary: {
    schemaVersion: string;
    candidate: {
      stableKey: string;
      deterministicAction: string;
      clusterLabel: string | null;
    };
    promptCount: number;
    inventoryCount: number;
    excerptCount: number;
  };
  source: "live_call" | "cache_hit" | "budget_blocked" | "error";
  errorMessage?: string;
};

/** Cap — keep the last 2000 entries on disk; older roll off. */
const HISTORY_CAP = 2000;

export async function appendHistory(entry: AdjudicatorHistoryEntry): Promise<void> {
  const rows = await readStore<AdjudicatorHistoryEntry>(STORE_NAME);
  rows.push(entry);
  if (rows.length > HISTORY_CAP) rows.splice(0, rows.length - HISTORY_CAP);
  await writeStore<AdjudicatorHistoryEntry>(STORE_NAME, rows);
}

export function summarizePacket(packet: EvidencePacket): AdjudicatorHistoryEntry["packetSummary"] {
  return {
    schemaVersion: packet.schemaVersion,
    candidate: {
      stableKey: packet.candidate.stableKey,
      deterministicAction: packet.candidate.deterministicAction,
      clusterLabel: packet.candidate.cluster.label,
    },
    promptCount: packet.affectedPrompts.length,
    inventoryCount: packet.siteInventory.pages.length,
    excerptCount: packet.sampleAnswerExcerpts.length,
  };
}
