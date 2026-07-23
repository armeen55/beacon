import "server-only";

import { readDotDataJson } from "@/lib/persistence/dotdata-json";
import type { PageSnapshot } from "@/domains/pages/types";

/** Always reads `.data/page-snapshots.json` from disk (no import-time cache). */
export async function getPageSnapshots(): Promise<PageSnapshot[]> {
  return (await readDotDataJson<PageSnapshot[]>("page-snapshots")) ?? [];
}

/**
 * Phase 1 — reads `.data/page-snapshots-prev.json` (the pre-scan baseline
 * archived by `archivePreviousSnapshots()` in scan-owned-pages.ts).
 * Used by `deriveSchemaChangelogFields()` to compare schema_types before
 * vs after when an operator confirms a scan finding.
 *
 * Always reads from disk — no import-time cache.
 */
export async function getPreviousPageSnapshots(): Promise<PageSnapshot[]> {
  return (await readDotDataJson<PageSnapshot[]>("page-snapshots-prev")) ?? [];
}
