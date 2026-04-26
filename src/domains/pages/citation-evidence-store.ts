import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CitationEvidenceIndex } from "./types";

async function loadFromDisk(): Promise<CitationEvidenceIndex | null> {
  return (await readDotDataJson<CitationEvidenceIndex>("citation-evidence-index")) ?? null;
}

// Phase 7.8b-1 (2026-04-25): top-level await so the module-load read
// flows through the new async tenant-aware routing in dotdata-json.
// Caveat — same as seed-data.server.ts: this captures the env-resolved
// tenant at module load and freezes it. Phase 7.8e will lift this to
// request-scope resolution. Until then, single-tenant production is
// unaffected because BEACON_TENANT_ID is constant per process.
let _cached: CitationEvidenceIndex | null = await loadFromDisk();

export { _cached as citationEvidenceIndex };

/** Call after rebuilding the index (e.g. post-import) to refresh the in-memory reference. */
export async function refreshCitationEvidenceStore(): Promise<void> {
  _cached = await loadFromDisk();
}
