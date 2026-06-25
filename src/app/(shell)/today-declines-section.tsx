import Link from "next/link";
import { loadTodayMovesHeroData } from "./today-moves-data";

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
  try {
    data = await loadTodayMovesHeroData({ limit: 20 });
  } catch {
    return null;
  }

  // Flatten declines across the worklist into one ranked recovery list.
  const rows = data.moves
    .flatMap((m) =>
      m.declines.map((d) => ({
        moveId: m.id,
        page: m.pageLabel,
        targetUrl: m.targetUrl,
        query: d.query,
        dropPct: d.dropPct,
        priorClicks: d.priorClicks,
        recentClicks: d.recentClicks,
        positionSlip: d.positionSlip,
      })),
    )
    .sort((a, b) => b.priorClicks - a.priorClicks)
    .slice(0, 8);

  if (rows.length === 0) return null;

  const clicksLost = rows.reduce((s, r) => s + Math.max(0, r.priorClicks - r.recentClicks), 0);

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
              <Link href="/moves" className="font-semibold text-violet-600 hover:text-violet-800">
                Fix →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
