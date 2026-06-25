import { loadRisingQueriesForPage } from "@/domains/recommendation-intelligence/gsc-page-queries";
import type { QueryRise } from "@/domains/recommendation-intelligence/gsc-page-queries";

/**
 * workbench-rising-strip (2026-06-25) — emerging demand for THIS page, in the
 * per-page workspace: the queries this page is gaining clicks on (or newly ranking
 * for) over the last 28d vs prior. Pairs with the momentum strip — momentum is the
 * page's overall trajectory; this names the specific rising queries to double down
 * on. Reads just this page (bounded). Self-hides when nothing is rising.
 */

export async function WorkbenchRisingStrip({
  tenantId,
  canonUrl,
}: {
  tenantId: string;
  canonUrl: string | null;
}) {
  if (!canonUrl) return null;
  let rises: QueryRise[] = [];
  try {
    rises = await loadRisingQueriesForPage(tenantId, canonUrl).catch(() => []);
  } catch {
    return null;
  }
  if (rises.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-teal-200/60 bg-teal-50/30 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-teal-500">↗</span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-teal-700">Rising on this page — double down</span>
      </div>
      <ul className="mt-2 space-y-1">
        {rises.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-foreground">{r.query}</span>
              {r.isNew ? (
                <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                  New
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {r.priorClicks} → {r.recentClicks}/mo{r.isNew ? "" : ` (+${r.gainPct}%)`} · pos {r.recentPosition.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
