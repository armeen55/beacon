import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { CitationEvidenceIndex } from "./types";

function loadFromDisk(): CitationEvidenceIndex | null {
  return readDotDataJson<CitationEvidenceIndex>("citation-evidence-index") ?? null;
}

let _cached: CitationEvidenceIndex | null = loadFromDisk();

export { _cached as citationEvidenceIndex };

/** Call after rebuilding the index (e.g. post-import) to refresh the in-memory reference. */
export function refreshCitationEvidenceStore(): void {
  _cached = loadFromDisk();
}
