/**
 * ScoreboardSection (2026-07-01, FINAL PREMIUM PLAN items 1-3) - the Today hero: one beautiful
 * chart that answers "am I winning?". Daily clicks as a soft area, the 7-day average as the bold
 * line, and every shipped change marked ON the chart at its ship date (green when it won). Under
 * it, one plain sentence with the week-over-week verdict. Server component, pure SVG, no deps,
 * fail-soft (self-hides without enough history so it never renders an empty box).
 */
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { buildScoreboard, type Scoreboard } from "@/domains/scoreboard/scoreboard";
import { loadOwnCitationsByDay } from "@/domains/recommendation-intelligence/citations-daily";
import { currentTenantSlug } from "@/lib/tenant-context";
import { Sparkline } from "@/components/data/sparkline";

const W = 720;
const H = 170;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 24;

function xAt(i: number, n: number): number {
  return PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
}
function yAt(v: number, max: number): number {
  const usable = H - PAD_T - PAD_B;
  return PAD_T + (max <= 0 ? usable : usable - (v / max) * usable);
}

function areaPath(values: number[], max: number): string {
  const n = values.length;
  const pts = values.map((v, i) => `${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`);
  return `M${xAt(0, n).toFixed(1)},${yAt(0, max).toFixed(1)} L${pts.join(" L")} L${xAt(n - 1, n).toFixed(1)},${yAt(0, max).toFixed(1)} Z`;
}
function linePath(values: Array<number | null>, max: number): string {
  const n = values.length;
  let d = "";
  values.forEach((v, i) => {
    if (v == null) return;
    d += d === "" ? `M${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}` : ` L${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`;
  });
  return d;
}

const MARKER_FILL: Record<string, string> = { won: "#10b981", measuring: "#94a3b8", flat: "#f59e0b" };

function monthDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Chart({ s }: { s: Scoreboard }) {
  const n = s.days.length;
  const clicks = s.days.map((d) => d.clicks);
  const max = Math.max(1, ...clicks);
  const idxByDate = new Map(s.days.map((d, i) => [d.date, i]));
  const tickIdx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Clicks per day with your shipped changes marked" className="w-full">
      <defs>
        <linearGradient id="sb-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* soft horizontal guides */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD_L} x2={W - PAD_R} y1={yAt(max * f, max)} y2={yAt(max * f, max)} stroke="currentColor" strokeOpacity="0.06" />
      ))}
      {/* daily clicks area */}
      <path d={areaPath(clicks, max)} fill="url(#sb-fill)" />
      <path d={linePath(clicks, max)} fill="none" stroke="#6366f1" strokeOpacity="0.35" strokeWidth="1.2" />
      {/* 7-day average, the honest trend */}
      <path d={linePath(s.rolling, max)} fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* shipped-change markers */}
      {s.markers.map((m) => {
        const i = idxByDate.get(m.date);
        if (i == null) return null;
        const y = yAt(s.rolling[i] ?? clicks[i] ?? 0, max);
        return (
          <g key={m.date}>
            <line x1={xAt(i, n)} x2={xAt(i, n)} y1={y + 6} y2={H - PAD_B} stroke={MARKER_FILL[m.tone]} strokeOpacity="0.35" strokeDasharray="2 3" />
            <circle cx={xAt(i, n)} cy={y} r={m.count > 1 ? 5 : 4} fill={MARKER_FILL[m.tone]} stroke="white" strokeWidth="1.5">
              <title>{`${monthDay(m.date)}: ${m.label}`}</title>
            </circle>
          </g>
        );
      })}
      {/* x ticks */}
      {tickIdx.map((i) => (
        <text key={i} x={xAt(i, n)} y={H - 6} fontSize="10" fill="currentColor" fillOpacity="0.45" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
          {monthDay(s.days[i]!.date)}
        </text>
      ))}
      {/* max label */}
      <text x={PAD_L} y={PAD_T - 3} fontSize="10" fill="currentColor" fillOpacity="0.45">{max.toLocaleString()} clicks/day</text>
    </svg>
  );
}

export async function ScoreboardSection({ tenantId }: { tenantId: string }) {
  try {
    const [daily, ledger, slug] = await Promise.all([
      loadDailyTotalsForTenant(tenantId, 84),
      loadShippedChanges().catch(() => []),
      currentTenantSlug().catch(() => ""),
    ]);
    // Item 9 - the AI-visibility mini-scoreboard: your own domain's citations over time,
    // next to the Google chart. Fail-soft -> band self-hides.
    const citations = slug ? await loadOwnCitationsByDay(tenantId, slug).catch(() => ({ daily: [], total: 0 })) : { daily: [] as Array<{ date: string; clicks: number }>, total: 0 };
    const s = buildScoreboard(
      daily,
      ledger.map((r) => ({ path: r.path, shippedAt: r.shippedAt, actionType: r.actionType, verdict: r.verdict })),
    );
    if (!s) return null;
    const deltaTone = s.deltaPct == null ? "text-gray-500" : s.deltaPct > 2 ? "text-emerald-600" : s.deltaPct < -2 ? "text-amber-600" : "text-gray-500";
    return (
      <section aria-label="Your traffic and your changes" className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{s.last7Clicks.toLocaleString()}</span>
            <span className="text-xs text-gray-500">clicks, last 7 reported days</span>
            {s.deltaPct != null ? (
              <span className={`text-sm font-semibold tabular-nums ${deltaTone}`}>
                {s.deltaPct > 0 ? "+" : ""}{s.deltaPct}%
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-indigo-600" /> 7 day average</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> change that won</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-slate-400" /> measuring</span>
          </div>
        </div>
        <div className="mt-2 text-gray-800">
          <Chart s={s} />
        </div>
        <p className="mt-1 text-[13px] text-gray-600">{s.verdictLine}</p>
        {citations.total > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-[12px] text-gray-600 tabular-nums">
            <span className="font-semibold text-pink-700">AI recommended you {citations.total.toLocaleString()} time{citations.total === 1 ? "" : "s"} in the last 30 days.</span>
            {citations.daily.length >= 5 ? <Sparkline points={citations.daily} width={96} height={18} className="inline-block opacity-80" /> : null}
            <span className="text-[11px] text-gray-400">citations of your pages in AI answers, per day</span>
          </div>
        ) : null}
      </section>
    );
  } catch {
    return null;
  }
}
