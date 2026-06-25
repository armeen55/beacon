import { loadDailyClicksByPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildWeeklyTrend, type WeekPoint } from "../today-trend-rows";

/**
 * workbench-momentum-strip (2026-06-25) — carries the cockpit's per-page momentum
 * INTO the per-page workspace: an 8-week clicks sparkline + direction verdict at
 * the top of the Workbench, so an operator who drilled in from "pages slipping"
 * sees the page's trajectory in context. Reads the canonical URL (already resolved
 * by loadWorkbench) against the per-page-per-day totals. Deterministic; self-hides
 * without ≥2 weeks of data.
 */

const DIR: Record<string, { label: string; chip: string; stroke: string; fill: string }> = {
  growing: { label: "Gaining", chip: "bg-emerald-100 text-emerald-700", stroke: "#059669", fill: "#a7f3d0" },
  flat: { label: "Holding steady", chip: "bg-slate-100 text-slate-600", stroke: "#64748b", fill: "#e2e8f0" },
  declining: { label: "Slipping", chip: "bg-rose-100 text-rose-700", stroke: "#e11d48", fill: "#fecdd3" },
};

function paths(points: WeekPoint[], w: number, h: number, pad = 3) {
  const max = Math.max(1, ...points.map((p) => p.clicks));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (c: number) => h - pad - (c / max) * (h - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.clicks).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)} L${x(0).toFixed(1)},${(h - pad).toFixed(1)} Z`;
  return { line, area };
}

export async function WorkbenchMomentumStrip({
  tenantId,
  canonUrl,
}: {
  tenantId: string;
  canonUrl: string | null;
}) {
  if (!canonUrl) return null;
  let trend: ReturnType<typeof buildWeeklyTrend> = null;
  try {
    const byPage = await loadDailyClicksByPagesForTenant(tenantId, [canonUrl], 70).catch(
      () => new Map<string, never>(),
    );
    trend = buildWeeklyTrend(byPage.get(canonUrl) ?? [], 8);
  } catch {
    return null;
  }
  if (!trend || trend.points.length < 2) return null;

  const dir = DIR[trend.direction] ?? DIR.flat!;
  const W = 180;
  const H = 36;
  const { line, area } = paths(trend.points, W, H);
  const deltaLabel = trend.deltaPct > 0 ? `+${trend.deltaPct}%` : `${trend.deltaPct}%`;

  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${dir.chip}`}>
          {dir.label} {deltaLabel}
        </span>
        <span className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{trend.latestWeekClicks.toLocaleString()}</span> clicks last week
          <span className="ml-1 text-xs">· {trend.points.length}-week trend</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-44 shrink-0" preserveAspectRatio="none" aria-label="Weekly clicks trend for this page">
        <path d={area} fill={dir.fill} opacity={0.5} />
        <path d={line} fill="none" stroke={dir.stroke} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
