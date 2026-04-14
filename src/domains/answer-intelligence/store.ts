import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { AnswerIntelligenceIndex } from "./types";

/**
 * Reads the answer intelligence index fresh from disk.
 * Always returns current data — no module-level cache staleness.
 */
function loadFromDisk(): AnswerIntelligenceIndex | null {
  return readDotDataJson<AnswerIntelligenceIndex>("answer-intelligence-index") ?? null;
}

let _cached: AnswerIntelligenceIndex | null = loadFromDisk();

/**
 * Answer intelligence index. Module-level variable refreshed by `refreshAnswerIntelligenceStore()`.
 */
export { _cached as answerIntelligenceIndex };

/** Call after rebuilding the index (e.g. post-import) to refresh the in-memory reference. */
export function refreshAnswerIntelligenceStore(): void {
  _cached = loadFromDisk();
}
