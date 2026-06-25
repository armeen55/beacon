import { currentTenantId } from "@/lib/tenant-context";
import { loadTopRisingQueriesForTenant, type RisingQuery } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadDismissedKeys, opportunityKey } from "@/domains/recommendation-intelligence/opportunity-dismissal-store";
import { workbenchHref } from "@/domains/insight/workbench-route";

/**
 * today-rising-section (2026-06-25) — "Rising demand — catch it early": queries
 * gaining clicks fastest over the last 28d vs the prior 28d (the inverse of the
 * recover lens). Emerging demand is cheapest to win before competitors lock it in;
 * "new" queries are topics the site just started ranking for. GSC-grounded; self-
 * hides when nothing is rising.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  return s.split("/").filter(Boolean).pop() || url;
}

export async function TodayRisingSection() {
  let rows: RisingQuery[] = [];
  try {
    const tenantId = await currentTenantId();
    const [rising, dismissed] = await Promise.all([
      loadTopRisingQueriesForTenant(tenantId).catch(() => []),
      loadDismissedKeys(tenantId).catch(() => new Set<string>()),
    ]);
    // Honor feed dismissals globally — a "rising" opportunity dismissed on the
    // headline stays gone here too (same kind|page|query key).
    rows = rising.filter((r) => !dismissed.has(opportunityKey("rising", r.page, r.query)));
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const clicksGained = rows.reduce((s, r) => s + Math.max(0, r.recentClicks - r.priorClicks), 0);
  const newCount = rows.filter((r) => r.isNew).length;

  return (
    <section className="rounded-3xl border border-teal-200/70 bg-gradient-to-br from-teal-50/50 via-white to-emerald-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-teal-500">↗</span> Rising demand — catch it early
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Queries gaining clicks fastest right now. Emerging demand is the cheapest to win — double down
            (add depth, an answer block, internal links) before competitors notice.
            {newCount > 0 ? ` ${newCount} are brand-new topics you just started ranking for.` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-teal-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-teal-600">+{fmtNum(clicksGained)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly clicks gained</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-white/70 px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-medium text-gray-900">{r.query}</span>
              {r.isNew ? (
                <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                  New
                </span>
              ) : null}
              <span className="text-xs text-gray-400">on {slugOf(r.page)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-teal-600">
                {r.isNew ? `+${fmtNum(r.recentClicks)} new` : `+${r.gainPct}%`}
              </span>
              <span className="text-gray-500">
                {fmtNum(r.priorClicks)} → {fmtNum(r.recentClicks)}/mo · pos {r.recentPosition.toFixed(1)}
              </span>
              <a href={workbenchHref(r.page)} className="font-semibold text-violet-600 hover:text-violet-800">
                Double down →
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
