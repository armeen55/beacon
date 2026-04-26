import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { AnswerIntelligenceIndex } from "./types";

/**
 * Reads the answer intelligence index fresh from disk.
 * Always returns current data — no module-level cache staleness.
 */
async function loadFromDisk(): Promise<AnswerIntelligenceIndex | null> {
  return (await readDotDataJson<AnswerIntelligenceIndex>("answer-intelligence-index")) ?? null;
}

// Phase 7.8b-1 (2026-04-25): same module-level top-level await pattern
// as citation-evidence-store and seed-data.server. Captures the env-
// resolved tenant at module load — fine for single-tenant production;
// Phase 7.8e lifts to request scope.
let _cached: AnswerIntelligenceIndex | null = await loadFromDisk();

/**
 * Answer intelligence index. Module-level variable refreshed by `refreshAnswerIntelligenceStore()`.
 */
export { _cached as answerIntelligenceIndex };

/** Call after rebuilding the index (e.g. post-import) to refresh the in-memory reference. */
export async function refreshAnswerIntelligenceStore(): Promise<void> {
  _cached = await loadFromDisk();
}
