/**
 * 2026-06-09 — Durable history of sitemap-level competitor page changes
 * (tenant-scoped json store `competitor-sitemap-changes`).
 *
 * The shared `competitor-monitoring` state REPLACES `recentChanges` on
 * every crawl (Today's competitor alerts consume it that way). Move
 * detection needs a ROLLING window — a page published 6 weeks ago whose
 * citations rose is exactly the intel we want — so each refresh appends
 * this run's added/updated changes here. Dedupe key (url, type,
 * lastmod-or-detected-day) means re-crawls don't duplicate.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CompetitorPageChange } from "@/domains/competitor-monitoring/types";

const STORE_NAME = "competitor-sitemap-changes";
const MAX_ROWS = 500;

function dedupeKey(c: CompetitorPageChange): string {
  const day = (c.lastmod ?? c.detectedAt).slice(0, 10);
  return `${c.url}|${c.type}|${day}`;
}

export async function getCompetitorSitemapChangeHistory(): Promise<
  CompetitorPageChange[]
> {
  try {
    return (await readStore<CompetitorPageChange>(STORE_NAME)) ?? [];
  } catch {
    return [];
  }
}

/** Append new changes (deduped), keep the newest MAX_ROWS. Returns the
 *  count of genuinely-new rows. Removed-page changes are not history a
 *  move can be built on and are skipped. */
export async function appendCompetitorSitemapChanges(
  changes: ReadonlyArray<CompetitorPageChange>,
): Promise<number> {
  const candidates = changes.filter((c) => c.type !== "removed");
  if (candidates.length === 0) return 0;
  const existing = await getCompetitorSitemapChangeHistory();
  const seen = new Set(existing.map(dedupeKey));
  const fresh: CompetitorPageChange[] = [];
  for (const c of candidates) {
    const key = dedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }
  if (fresh.length === 0) return 0;
  const all = [...existing, ...fresh]
    .sort((a, z) => (a.detectedAt < z.detectedAt ? 1 : -1))
    .slice(0, MAX_ROWS);
  await writeStore(STORE_NAME, all);
  return fresh.length;
}
