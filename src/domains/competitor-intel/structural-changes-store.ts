/**
 * 2026-06-09 — Detected competitor structural changes (tenant-scoped
 * json store `competitor-structural-changes`).
 *
 * The competitor-page-snapshots store keeps only the LATEST shape per
 * URL, so a structural change exists only at the instant a fresh fetch
 * is diffed against the stored snapshot. This store makes those
 * moments durable so move detection can join them with citation
 * aftermath days/weeks later.
 *
 * Append-only with dedupe (same url+kind+detail+capture-day is the
 * same change re-observed) and a hard cap — newest kept.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CompetitorStructuralChange } from "./types";

const STORE_NAME = "competitor-structural-changes";
const MAX_ROWS = 300;

function dedupeKey(c: CompetitorStructuralChange): string {
  return `${c.url}|${c.kind}|${c.detail}|${c.capturedAt.slice(0, 10)}`;
}

export async function getCompetitorStructuralChanges(): Promise<
  CompetitorStructuralChange[]
> {
  try {
    return (await readStore<CompetitorStructuralChange>(STORE_NAME)) ?? [];
  } catch {
    return [];
  }
}

/**
 * Append new changes (deduped against existing + each other), keep the
 * newest MAX_ROWS. Returns how many genuinely-new rows were added.
 */
export async function appendCompetitorStructuralChanges(
  changes: ReadonlyArray<CompetitorStructuralChange>,
): Promise<number> {
  if (changes.length === 0) return 0;
  const existing = await getCompetitorStructuralChanges();
  const seen = new Set(existing.map(dedupeKey));
  const fresh: CompetitorStructuralChange[] = [];
  for (const c of changes) {
    const key = dedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }
  if (fresh.length === 0) return 0;
  const all = [...existing, ...fresh]
    .sort((a, z) => (a.capturedAt < z.capturedAt ? 1 : -1))
    .slice(0, MAX_ROWS);
  await writeStore(STORE_NAME, all);
  return fresh.length;
}
