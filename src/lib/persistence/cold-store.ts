/**
 * Sharded cold storage — READ layer for large citation data.
 *
 * Serves benchmark-era `citation-observations` (~85k rows), sharded by
 * date under `.data/citations-by-date/`. These are never loaded at
 * startup; a date shard is read on-demand and cached in-process after
 * first access.
 *
 * WRITE PATH RETIRED (2026-07-21): the only writer of these shards was
 * the Profound CSV import orchestrator (`src/adapters/profound/`), now
 * deleted along with its unguarded Vercel file write (`writeCitationShard`)
 * and the import-only answer-texts write path (`writeAnswerTexts` /
 * `readAnswerTextsFromDisk` / `loadTenantAnswerTexts`). Live prod
 * citation evidence reads from the Supabase `prompt_answer_observations`
 * / `answer_texts` tables via `storage/canonical-store` and
 * `domains/citability/mine-answer-patterns`, not from these `.data`
 * shards; the shards are a local, pre-cutover benchmark read that the
 * regime-gated lifecycle loaders still reference.
 *
 * Path A cold-store consumers are allowlisted in
 * `tests/architecture/02-tenant-isolation-citation-lifecycle.test.ts`.
 */

import "server-only";

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".data");

// ---------------------------------------------------------------------------
// Sharded citations — one file per date in .data/citations-by-date/
// ---------------------------------------------------------------------------

import type { CitationObservation } from "@/domains/ai-visibility/citation-observations";

const CITATION_DIR = join(DATA_DIR, "citations-by-date");

const _citationShardCache = new Map<string, CitationObservation[]>();

function citationShardPath(date: string): string {
  return join(CITATION_DIR, `${date}.json`);
}

export function getCitationsForDate(date: string): CitationObservation[] {
  if (_citationShardCache.has(date)) {
    return _citationShardCache.get(date)!;
  }
  const path = citationShardPath(date);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as CitationObservation[];
  _citationShardCache.set(date, data);
  return data;
}

export function getAllCitationDates(): string[] {
  if (!existsSync(CITATION_DIR)) return [];
  return readdirSync(CITATION_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort();
}
