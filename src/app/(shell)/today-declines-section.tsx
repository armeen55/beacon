import Link from "next/link";
import { currentTenantId } from "@/lib/tenant-context";
import { workbenchHref } from "@/domains/insight/workbench-route";
import { loadTopDecliningPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { loadTodayMovesHeroData } from "./today-moves-data";
import { buildRecoveryRows, recoveryClicksLost, type RecoveryRow } from "./today-declines-rows";
import { recentlyShippedPageKeys } from "./today-recoveries-rows";

function slugOf(url: string): string {
  const s = url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "");
  const last = s.split("/").filter(Boolean).pop() ?? url;
  return last.replace(/[-_]+/g, " ").trim() || url;
}
function normUrl(url: string): string {
  return url.split("?")[0]!.split("#")[0]!.replace(/\/$/, "").toLowerCase();
}

/**
 * today-declines-section (2026-06-25) — "Recover lost ground": a focused panel of
 * the queries the tenant's worklist pages are actively LOSING (recent 28d vs prior
 * 28d, GSC-grounded). The hero headline counts them; this names them so the
 * operator can act on the bleeding directly. Reuses the request-cached
 * loadTodayMovesHeroData (no extra query) and self-hides when nothing is declining.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export async function TodayDeclinesSection() {
  let data;
  let sitewide: Awaited<ReturnType<typeof loadTopDecliningPagesForTenant>> = [];
  let shippedKeys = new Set<string>();
  try {
    const tenantId = await currentTenantId();
    const [hero, sw, shipped] = await Promise.all([
      loadTodayMovesHeroData({ limit: 20 }),
      loadTopDecliningPagesForTenant(tenantId).catch(() => []),
      loadShippedChanges().catch(() => []),
    ]);
    data = hero;
    sitewide = sw;
    // Pages with a recent shipped fix are in-flight (being measured) — don't nag
    // them as "still losing"; their outcome shows in "Pages you've turned around".
    shippedKeys = recentlyShippedPageKeys(shipped, Date.now(), normUrl);
  } catch {
    return null;
  }

  // Worklist declines first (they carry a move to act on), then ADD site-wide
  // declining pages the demand graph never queued (deduped by URL) — so a page
  // bleeding clicks surfaces here even without a competitor gap. Drop any page
  // with a recent shipped fix (in-flight → shown in the recoveries section).
  const worklistRows = buildRecoveryRows(data.moves).filter((r) => !shippedKeys.has(normUrl(r.targetUrl)));
  const seen = new Set(worklistRows.map((r) => normUrl(r.targetUrl)));
  const extraRows: RecoveryRow[] = sitewide
    .filter((dp) => !seen.has(normUrl(dp.page)) && !shippedKeys.has(normUrl(dp.page)))
    .map((dp) => ({
      moveId: "",
      page: slugOf(dp.page),
      targetUrl: dp.page,
      query: dp.topDecline.query,
      dropPct: dp.topDecline.dropPct,
      priorClicks: dp.topDecline.priorClicks,
      recentClicks: dp.topDecline.recentClicks,
      positionSlip: dp.topDecline.positionSlip,
    }));
  const rows = [...worklistRows, ...extraRows]
    .sort((a, b) => b.priorClicks - a.priorClicks)
    .slice(0, 10);
  if (rows.length === 0) return null;
  const clicksLost = recoveryClicksLost(rows);

  return (
    <section className="rounded-3xl border border-rose-200/70 bg-gradient-to-br from-rose-50/50 via-white to-amber-50/30 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-rose-500">↓</span> Recover lost ground
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Queries your pages are losing month-over-month in Google. Refreshing these pages can win the
            clicks back — they already ranked, they&apos;re just slipping.
          </p>
        </div>
        <div className="rounded-xl border border-rose-100 bg-white px-4 py-2 text-right">
          <div className="text-2xl font-semibold tracking-tight text-rose-600">~{fmtNum(clicksLost)}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">monthly clicks slipping</div>
        </div>
      </div>

      <ul className="mt-5 space-y-1.5">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-100 bg-white/70 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium text-gray-900">{r.query}</span>
              <span className="ml-2 text-xs text-gray-400">on {r.page}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-rose-600">−{r.dropPct}% clicks</span>
              <span className="text-gray-500">
                {r.priorClicks.toLocaleString()} → {r.recentClicks.toLocaleString()}/mo
                {r.positionSlip >= 1 ? ` · slipped ${r.positionSlip.toFixed(1)} pos` : ""}
              </span>
              {/* Route to the per-page Workbench — the optimizer where the operator
                  refreshes the declining page (full picture + AI analysis). */}
              <Link
                href={workbenchHref(r.targetUrl)}
                className="font-semibold text-violet-600 hover:text-violet-800"
              >
                Fix →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
