import "server-only";

/**
 * recent-upkeep (Phase 4B Lane 1 fold, 2026-07-21) - the compact "Recent activity"
 * list on /settings/connectors. /activity is retired (its two customer-facing
 * value props were the latest per-source refresh receipt and a short recent-
 * refresh history - both already sourced from this same ledger). This module
 * folds that forward: read @/domains/runtime/ops/refresh-runs-store (the same store this
 * page already reads for its per-source "last pulled" strip - no new store, no
 * new write path) and render the last ~10 refresh entries as plain sentences.
 * The cron-run / error-ledger / spend rows /activity also rendered were
 * operator-ops noise, never a customer-facing surface, and are dropped rather
 * than folded (see docs plan for Phase 4B Lane 1).
 */

import {
  listRecentRefreshRuns,
  type RefreshRunRow,
  type RefreshSource,
} from "@/domains/runtime";
import { Card } from "@/components/ui/card";

/** How many of the most recent refresh entries stay visible - Beacon's daily
 *  rhythm, not a list a customer will ever page through. */
const RECENT_UPKEEP_LIMIT = 10;
/** Headroom over RECENT_UPKEEP_LIMIT so a busy multi-source day still gets
 *  deduped fairly before the slice below trims it down. */
const MAX_ROWS_FETCHED = 200;

const REFRESH_SOURCE_LABEL: Record<RefreshSource, string> = {
  gsc: "Search Console",
  ga4: "Analytics",
  clarity: "Clarity",
};

/** Plain label for a ledger row's source, or null for a historical row from
 *  a retired source. Retired-source rows are skipped by loadRecentUpkeep: a
 *  sentence like "I keep retrying" would be a false promise for a source that
 *  no longer exists, and the row still ages out of the ledger naturally. */
function refreshSourceLabel(source: string): string | null {
  return REFRESH_SOURCE_LABEL[source as RefreshSource] ?? null;
}

function shortDateLabel(dateUtc: string): string {
  const ms = Date.parse(`${dateUtc}T00:00:00Z`);
  if (!Number.isFinite(ms)) return dateUtc;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One plain first-person sentence per refresh outcome - the same voice the
 *  retired /activity page used. Exported for tests. */
export function recentUpkeepSentence(row: RefreshRunRow): string | null {
  const label = refreshSourceLabel(row.source);
  if (label === null) return null;
  const dataThrough = row.latest_data_date ? shortDateLabel(row.latest_data_date) : null;
  if (row.result === "failed") {
    return `The ${label} pull did not work. Retrying continues.`;
  }
  if (row.result === "partial") {
    return `The ${label} pull ran but found no new data${dataThrough ? ` since ${dataThrough}` : ""}.`;
  }
  if (row.rows_persisted != null && row.rows_persisted > 0) {
    const rows = row.rows_persisted.toLocaleString("en-US");
    return `Pulled fresh ${label} data: ${rows} row${row.rows_persisted === 1 ? "" : "s"}${dataThrough ? ` through ${dataThrough}` : ""}.`;
  }
  return `Checked ${label}. Nothing new${dataThrough ? ` since ${dataThrough}` : ""}.`;
}

export type RecentUpkeepEntry = {
  key: string;
  dateLabel: string;
  sentence: string;
};

/** Bounded, fail-soft read of the tenant's most recent refresh runs, collapsed
 *  to one entry per (source, day) so a source that retries several times in
 *  one day cannot spam the list, then trimmed to RECENT_UPKEEP_LIMIT newest
 *  first. Never throws - an empty list just self-hides the section. */
export async function loadRecentUpkeep(tenantId: string): Promise<RecentUpkeepEntry[]> {
  const rows = await listRecentRefreshRuns(tenantId, { limit: MAX_ROWS_FETCHED }).catch(
    () => [] as RefreshRunRow[],
  );
  const latestPerSourceDay = new Map<string, RefreshRunRow>();
  for (const row of rows) {
    if (typeof row.finished_at !== "string" || !Number.isFinite(Date.parse(row.finished_at))) {
      continue;
    }
    // Historical row from a retired source: nothing honest to say about it.
    if (refreshSourceLabel(row.source) === null) continue;
    const key = `${row.source}::${row.finished_at.slice(0, 10)}`;
    const existing = latestPerSourceDay.get(key);
    if (!existing || Date.parse(row.finished_at) > Date.parse(existing.finished_at)) {
      latestPerSourceDay.set(key, row);
    }
  }
  return Array.from(latestPerSourceDay.values())
    .sort((a, b) => (a.finished_at < b.finished_at ? 1 : a.finished_at > b.finished_at ? -1 : 0))
    .slice(0, RECENT_UPKEEP_LIMIT)
    .map((row) => ({
      key: row.id,
      dateLabel: row.finished_at.slice(0, 10),
      sentence: recentUpkeepSentence(row),
    }))
    .filter((e): e is RecentUpkeepEntry => e.sentence !== null);
}

/** Presentational: renders nothing when there is nothing to show yet (a brand
 *  new connection with no refresh history), never a hollow empty card. */
export function RecentUpkeepList({ entries }: { entries: RecentUpkeepEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sub font-semibold text-foreground">Recent activity</h2>
      <Card padding="none">
        <ul className="divide-y divide-border-subtle">
          {entries.map((e) => (
            <li
              key={e.key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5"
            >
              <span className="w-[84px] shrink-0 text-meta text-muted-foreground tabular-nums">
                {e.dateLabel}
              </span>
              <div className="min-w-0 flex-1 text-sub leading-relaxed text-foreground-secondary">
                {e.sentence}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
