import { cache } from "react";
import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CitationEvidenceIndex } from "./types";

async function loadFromDisk(): Promise<CitationEvidenceIndex | null> {
  return (await readDotDataJson<CitationEvidenceIndex>("citation-evidence-index")) ?? null;
}

// Phase 7.8e-4a (2026-04-26): request-scope conversion. The previous
// module-level `let _cached = await loadFromDisk()` froze the env-resolved
// tenant at module load (caveat documented in 7.8b-1). Pattern A here
// hydrates lazily on first call within a process, and React.cache layers
// per-render-tree memoization on top.
//
// Sentinel:
//   undefined = not loaded yet
//   null      = loaded, no index on disk
let _state: CitationEvidenceIndex | null | undefined = undefined;

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state !== undefined) return;
  _state = await loadFromDisk();
});

export const getCitationEvidenceIndex = cache(
  async (): Promise<CitationEvidenceIndex | null> => {
    await ensureLoaded();
    return _state ?? null;
  },
);

/** Call after rebuilding the index (e.g. post-import) to refresh the in-memory reference. */
export async function refreshCitationEvidenceStore(): Promise<void> {
  _state = await loadFromDisk();
}

/** Test-only reset hook. */
export function _resetCitationEvidenceForTests(): void {
  _state = undefined;
}
