/**
 * Dual-write engine — file-first, Supabase-second.
 *
 * When DUAL_WRITE=true, every persist call that writes to a .data/*.json
 * file store also upserts the same rows to Supabase. The Supabase write
 * is best-effort: errors are logged but never thrown, so the file-backed
 * path always succeeds.
 *
 * Phase 1F covers 7 entity tables:
 *   import_runs, results, changelog_entries, opportunities, competitors,
 *   attribution_decisions, candidate_links
 */

import "server-only";

import { getSupabaseAdmin } from "./supabase";

const CHUNK_SIZE = 500;

export function isDualWriteEnabled(): boolean {
  return process.env.DUAL_WRITE === "true";
}

export async function dualWriteUpsert(
  table: string,
  rows: Record<string, unknown>[],
  primaryKey: string,
): Promise<void> {
  if (!isDualWriteEnabled() || rows.length === 0) return;

  const sb = getSupabaseAdmin();

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error } = await sb
        .from(table)
        .upsert(chunk, { onConflict: primaryKey });
      if (error) {
        console.error(
          `[dual-write] ${table}: upsert chunk ${i}-${i + chunk.length} failed — ${error.message}`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: unexpected error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function dualWriteTruncate(table: string): Promise<void> {
  if (!isDualWriteEnabled()) return;

  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from(table).delete().gte("id", "");
    if (error) {
      console.error(
        `[dual-write] ${table}: truncate failed — ${error.message}`,
      );
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: truncate error — ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ── Typed convenience wrappers ──

import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type { EventDecision, CandidateLink } from "@/domains/attribution/types";

type AnyRow = Record<string, unknown>;

export async function syncImportRuns(runs: ImportRun[]): Promise<void> {
  await dualWriteUpsert("import_runs", runs as unknown as AnyRow[], "id");
}

export async function syncResults(rows: Result[]): Promise<void> {
  await dualWriteUpsert("results", rows as unknown as AnyRow[], "id");
}

export async function syncChangelogEntries(
  rows: ChangelogEntry[],
): Promise<void> {
  await dualWriteUpsert("changelog_entries", rows as unknown as AnyRow[], "id");
}

export async function syncOpportunities(rows: Opportunity[]): Promise<void> {
  await dualWriteUpsert("opportunities", rows as unknown as AnyRow[], "id");
}

export async function syncCompetitors(rows: Competitor[]): Promise<void> {
  await dualWriteUpsert("competitors", rows as unknown as AnyRow[], "id");
}

export async function syncEventDecisions(
  rows: EventDecision[],
): Promise<void> {
  await dualWriteUpsert(
    "attribution_decisions",
    rows as unknown as AnyRow[],
    "id",
  );
}

export async function syncCandidateLinks(
  rows: CandidateLink[],
): Promise<void> {
  await dualWriteUpsert("candidate_links", rows as unknown as AnyRow[], "id");
}

/**
 * Clear all 7 import-path tables in Supabase (used by resetExperiment).
 * Best-effort — errors logged, never thrown.
 */
export async function clearAllImportTables(): Promise<void> {
  if (!isDualWriteEnabled()) return;

  const tables = [
    "import_runs",
    "results",
    "changelog_entries",
    "opportunities",
    "competitors",
    "attribution_decisions",
    "candidate_links",
  ];

  for (const t of tables) {
    await dualWriteTruncate(t);
  }
}
