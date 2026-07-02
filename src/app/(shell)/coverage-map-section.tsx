/**
 * CoverageMapSection (2026-07-02, master-plan item 9) - the topical coverage
 * map on Today: one compact row per topic hub with the coverage bar ("answers
 * 30 of 42"), the AI citation join ("AI picks you on 8 of 19"), and the best
 * missing page to create next. Server component, $0 cached reads only,
 * self-hides under 3 hubs, fail-soft to null. Dark-mode + 375px safe per
 * sibling sections (flex-wrap, break-words, tabular-nums).
 */
import { loadCoverageMapForTenant } from "@/domains/coverage/load-coverage-map";
import type { HubCoverageRow } from "@/domains/coverage/coverage-map";

const MIN_HUBS_TO_SHOW = 3;

function barTone(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 40) return "bg-sky-500";
  return "bg-amber-500";
}

function HubRow({ row }: { row: HubCoverageRow }) {
  const bestMissing = row.topMissing[0] ?? null;
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 break-words text-[13px] font-medium text-gray-900 dark:text-neutral-100">{row.label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-neutral-400">
          answers {row.answeredCount} of {row.totalQuestions}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-neutral-800" role="img" aria-label={`${row.coveragePercent} percent of questions answered`}>
        <div className={`h-full rounded-full ${barTone(row.coveragePercent)}`} style={{ width: `${Math.max(2, row.coveragePercent)}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-neutral-400 tabular-nums">
        <span className="font-medium text-gray-700 dark:text-neutral-300">{row.coveragePercent} percent covered</span>
        {row.aiCheckedCount > 0 ? (
          <span className="text-pink-700 dark:text-pink-300">AI picks you on {row.aiCitedCount} of {row.aiCheckedCount} checked</span>
        ) : (
          <span>no AI checks on this topic yet</span>
        )}
      </div>
      {bestMissing ? (
        <p className="mt-1 break-words text-[11px] text-gray-500 dark:text-neutral-400">
          Best next page: <span className="font-medium text-gray-700 dark:text-neutral-300">{bestMissing.text}</span>
          {bestMissing.createPage ? <span className="text-emerald-600 dark:text-emerald-400"> (already on your New Pages list)</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export async function CoverageMapSection({ tenantId }: { tenantId: string }) {
  try {
    const result = await loadCoverageMapForTenant(tenantId);
    if (!result || result.map.rows.length < MIN_HUBS_TO_SHOW) return null;
    const { map } = result;
    return (
      <section aria-label="Topic coverage" className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">How well you cover what people ask</h2>
          <span className="text-[11px] tabular-nums text-gray-400 dark:text-neutral-500">
            you answer {map.totalAnswered} of {map.totalQuestions} questions across {map.rows.length} topics
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {map.rows.map((row) => (
            <HubRow key={row.key} row={row} />
          ))}
        </div>
        {map.otherCount > 0 ? (
          <p className="mt-2 text-[11px] text-gray-400 dark:text-neutral-500">
            {map.otherCount} more one-off question{map.otherCount === 1 ? "" : "s"} did not fit a topic yet; I keep watching them.
          </p>
        ) : null}
      </section>
    );
  } catch {
    return null;
  }
}
