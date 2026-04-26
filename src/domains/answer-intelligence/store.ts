import "server-only";

import { cache } from "react";
import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { AnswerIntelligenceIndex } from "./types";

/**
 * Reads the answer intelligence index fresh from disk.
 * Always returns current data — no module-level cache staleness.
 */
async function loadFromDisk(): Promise<AnswerIntelligenceIndex | null> {
  return (await readDotDataJson<AnswerIntelligenceIndex>("answer-intelligence-index")) ?? null;
}

// Phase 7.8e-4b (2026-04-26): request-scope conversion. The previous
// module-level `let _cached = await loadFromDisk()` froze the env-resolved
// tenant at module load (caveat documented in 7.8b-1). Pattern A here
// hydrates lazily on first call within a process; React.cache layers
// per-render-tree memoization on top.
//
// Sentinel:
//   undefined = not loaded yet
//   null      = loaded, no index on disk
let _state: AnswerIntelligenceIndex | null | undefined = undefined;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== undefined) return;
  _state = await loadFromDisk();
});

export const getAnswerIntelligenceIndex = cache(
  async (): Promise<AnswerIntelligenceIndex | null> => {
    await ensureLoaded();
    return _state ?? null;
  },
);

/** Call after rebuilding the index (e.g. post-import) to refresh the in-memory reference. */
export async function refreshAnswerIntelligenceStore(): Promise<void> {
  _state = await loadFromDisk();
}

/** Test-only reset hook. */
export function _resetAnswerIntelligenceForTests(): void {
  _state = undefined;
}
