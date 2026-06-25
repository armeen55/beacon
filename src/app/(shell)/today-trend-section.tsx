import Link from "next/link";

import { currentTenantId } from "@/lib/tenant-context";
import { loadDailyClicksForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildWeeklyTrend } from "./today-trend-rows";
import { buildSparklinePaths } from "./sparkline";

/**
 * today-trend-section (2026-06-25) — "Your traffic trend": the site's total Google
 * clicks over the trailing weeks with a direction verdict, from the tiny accurate
 * gsc_daily_totals table (no truncation). The macro health view that frames every
 * per-page lens below it. Deterministic; self-hides without daily data.
 */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const DIRECTION: Record<string, { label: string; chip: string; stroke: string; fill: string }> = {
  growing: { label: "Growing", chip: "bg-emerald-100 text-emerald-700", stroke: "#059669", fill: "#a7f3d0" },
  flat: { label: "Holding steady", chip: "bg-slate-100 text-slate-600", stroke: "#64748b", fill: "#e2e8f0" },
  declining: { label: "Declining", chip: "bg-rose-100 text-rose-700", stroke: "#e11d48", fill: "#fecdd3" },
};

export async function TodayTrendSection() {
  let trend: ReturnType<typeof buildWeeklyTrend> = null;
  try {
    const tenantId = await currentTenantId();
    const daily = await loadDailyClicksForTenant(tenantId, 70).catch(() => []);
    trend = buildWeeklyTrend(daily, 8);
  } catch {
    return null;
  }
  if (!trend || trend.points.length < 2) return null;

  const dir = DIRECTION[trend.direction] ?? DIRECTION.flat!;
  const W = 520;
  const H = 90;
  const { line, area, x, y } = buildSparklinePaths(trend.points, W, H, 4);
  const deltaLabel = trend.deltaPct > 0 ? `+${trend.deltaPct}%` : `${trend.deltaPct}%`;

  return (
    <section className="rounded-3xl border border-gray-200/70 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-gray-400">📈</span> Your traffic trend
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            Total Google clicks per week over the last {trend.points.length} weeks.
          </p>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${dir.chip}`}>
            {dir.label} {deltaLabel}
          </span>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">
            {fmtNum(trend.latestWeekClicks)}
            <span className="ml-1 text-xs font-medium text-gray-400">clicks last week</span>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Weekly clicks trend">
        <path d={area} fill={dir.fill} opacity={0.5} />
        <path d={line} fill="none" stroke={dir.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {trend.points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.clicks)} r={2.5} fill={dir.stroke} />
        ))}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>{shortDate(trend.points[0]!.weekStart)}</span>
        <span>{shortDate(trend.points[trend.points.length - 1]!.weekStart)}</span>
      </div>

      {/* Connect the macro signal to action — don't just report it. */}
      {trend.direction === "declining" ? (
        <p className="mt-3 text-sm text-gray-600">
          Down {Math.abs(trend.deltaPct)}% over the period.{" "}
          <Link href="#sec-momentum" className="font-semibold text-rose-600 hover:text-rose-800">
            See the pages dragging it down →
          </Link>
        </p>
      ) : trend.direction === "growing" ? (
        <p className="mt-3 text-sm text-gray-600">
          Up {trend.deltaPct}% over the period.{" "}
          <Link href="#sec-opportunities" className="font-semibold text-emerald-600 hover:text-emerald-800">
            Press the advantage →
          </Link>
        </p>
      ) : (
        <p className="mt-3 text-sm text-gray-600">
          Holding steady.{" "}
          <Link href="#sec-opportunities" className="font-semibold text-violet-600 hover:text-violet-800">
            Find your next gain →
          </Link>
        </p>
      )}
    </section>
  );
}
