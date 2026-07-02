/**
 * ScoreboardSection (2026-07-01, FINAL PREMIUM PLAN items 1-3) - the Today hero: one beautiful
 * chart that answers "am I winning?". Daily clicks as a soft area, the 7-day average as the bold
 * line, and every shipped change marked ON the chart at its ship date (green when it won). Under
 * it, one plain sentence with the week-over-week verdict. Server component, pure SVG, no deps,
 * fail-soft (self-hides without enough history so it never renders an empty box).
 */
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadShippedChanges, type ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { buildScoreboard, buildMoneyLine, type Scoreboard } from "@/domains/scoreboard/scoreboard";
import { loadRevenueByDayForTenant } from "@/domains/revenue/load-revenue";
import { loadOwnCitationsByDay } from "@/domains/recommendation-intelligence/citations-daily";
import { currentTenantSlug } from "@/lib/tenant-context";
import { Sparkline } from "@/components/data/sparkline";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import {
  deriveMeasurementMaturity,
  detectMeasurementOverlaps,
  measurementWindowOf,
  isMatureOutcome,
  type OverlapContext,
} from "@/domains/proof-gsc/measurement-maturity";
import { buildShockWindows, overlappingShock, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import { extraSessionsFromTrafficOutcome } from "@/domains/proof-gsc/change-dollar-value";
import { PROOF_BASELINE_WINDOW_DAYS, type ProofWindowResult } from "@/domains/proof-gsc/measure";
import {
  computeLifetimeEarnings,
  type LifetimeEarningsRow,
} from "@/domains/proof-gsc/lifetime-earnings";
import {
  computePortfolioCounterfactual,
  type CounterfactualRow,
} from "@/domains/proof-gsc/portfolio-counterfactual";
import { compareShadowPortfolio } from "@/domains/proof-gsc/shadow-portfolio-drift";
import { loadShadowPortfolioMeasurement } from "@/domains/experiments/shadow-portfolio-measure";

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
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Clicks per day with your shipped changes marked" className="w-full beacon-chart-draw">
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
            <circle cx={xAt(i, n)} cy={y} r={m.count > 1 ? 5 : 4} fill={MARKER_FILL[m.tone]} stroke="var(--background)" strokeWidth="1.5">
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

/**
 * Items 40 + 41 (2026-07-02) - the shared eligibility gate for both the
 * lifetime-earnings odometer and the portfolio counterfactual. Mirrors
 * src/domains/learning/load-experiment-outcomes.ts's maturityGatedVerdict
 * EXACTLY (mature_result only, weather-quarantine and weak-comparison-
 * fallback excluded) - duplicated rather than imported because that
 * function is internal to load-experiment-outcomes.ts, the same posture
 * compute-scoreboard.ts already takes on this identical gate. Returns the
 * basis window (the longest-run window, matching summarizeVerdict) only for
 * records that clear every gate; everything else is filtered out entirely
 * rather than degraded, since both odometers need a real mature result.
 */
async function loadShockWindowsForGate(tenantId: string): Promise<ShockWindow[]> {
  try {
    const changepoints = await loadDetectedChangepoints(tenantId);
    return buildShockWindows({ dailySeries: [], priorChangepoints: changepoints });
  } catch {
    return [];
  }
}

function basisWindowOf(record: ShippedChangeRecord): ProofWindowResult | null {
  const ran = (record.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day);
  return ran[0] ?? null;
}

function isMatureAndClean(
  record: ShippedChangeRecord,
  overlap: OverlapContext | null,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
): boolean {
  const basis = basisWindowOf(record);
  const maturity = deriveMeasurementMaturity({
    shippedAt: record.shippedAt,
    now,
    latestGscDate: null,
    windows: (record.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
    verdict: record.verdict,
    controlsUsed: basis?.controlsUsed ?? 0,
    baselineImpressions: record.baseline?.impressions ?? 0,
    overlap,
    live: true,
  });
  if (!isMatureOutcome(maturity)) return false;
  const window = measurementWindowOf(record.shippedAt, record.windows ?? []);
  if (window && shockWindows.length > 0 && overlappingShock(window.start, window.end, shockWindows)) {
    return false;
  }
  if (record.controlMatchWeak === true) return false;
  return true;
}

/** Days between ship and now, floored at 0 (a backdated/clock-skewed ship
 *  never contributes a negative lifetime span). */
function daysLiveOf(shippedAt: string, now: Date): number {
  const shipped = Date.parse(shippedAt);
  if (!Number.isFinite(shipped)) return 0;
  return Math.max(0, Math.floor((now.getTime() - shipped) / 86_400_000));
}

/**
 * Item 40 - build the odometer's input rows from the measured ledger: every
 * MATURE, CLEAN, WON record contributes its current monthly rate (the SAME
 * control-adjusted extra-sessions number change-dollar-value.ts already put
 * on the row as dollarValue/trafficOutcome at measure time - never
 * re-derived here) plus its days-live for the honest proration.
 */
export function buildLifetimeEarningsRows(ledger: ShippedChangeRecord[], now: Date, shockWindows: ShockWindow[]): LifetimeEarningsRow[] {
  const overlaps = detectMeasurementOverlaps(ledger.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const rows: LifetimeEarningsRow[] = [];
  for (const r of ledger) {
    if (r.verdict !== "won") continue;
    if (!isMatureAndClean(r, overlaps.get(r.id) ?? null, now, shockWindows)) continue;
    if (!r.trafficOutcome?.ran) continue;
    const extraSessionsPerMonth = extraSessionsFromTrafficOutcome(r.trafficOutcome) / (r.trafficOutcome.windowDays || 1) * 30;
    if (!Number.isFinite(extraSessionsPerMonth) || extraSessionsPerMonth <= 0) continue;
    rows.push({
      id: r.id,
      extraSessionsPerMonth,
      usdPerMonth: r.dollarValue?.usdPerMonth ?? null,
      daysLive: daysLiveOf(r.shippedAt, now),
    });
  }
  return rows;
}

/**
 * Item 41 - build the counterfactual's input rows from the measured ledger:
 * every record that reaches deriveMeasurementMaturity's "mature_result"
 * contributes its basis window's treated/control click deltas and its own
 * pre-ship baseline, pro-rated to the basis window length (the same
 * scaledBaseline pooled-verdict-runner.ts's percentLiftOf uses). This is
 * WON and LOST rows both (the portfolio claim is about the whole settled
 * cohort, not only the wins) - an "inconclusive" 28-day read never reaches
 * mature_result at all (deriveMeasurementMaturity requires a real won/lost
 * call for sufficiency), so it is correctly excluded rather than diluting
 * the average with a null result.
 */
export function buildCounterfactualRows(ledger: ShippedChangeRecord[], now: Date, shockWindows: ShockWindow[]): CounterfactualRow[] {
  const overlaps = detectMeasurementOverlaps(ledger.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })));
  const rows: CounterfactualRow[] = [];
  for (const r of ledger) {
    if (!isMatureAndClean(r, overlaps.get(r.id) ?? null, now, shockWindows)) continue;
    const basis = basisWindowOf(r);
    if (!basis) continue;
    const baselineClicks = r.baseline?.clicks ?? 0;
    const scaledBaseline = baselineClicks * (basis.day / PROOF_BASELINE_WINDOW_DAYS);
    rows.push({
      id: r.id,
      treatedDelta: basis.treatedDelta,
      controlDelta: basis.controlDelta,
      scaledBaseline,
      controlsUsed: basis.controlsUsed,
    });
  }
  return rows;
}

export async function ScoreboardSection({ tenantId }: { tenantId: string }) {
  try {
    const [daily, ledger, measuredLedger, slug, revenueDays] = await Promise.all([
      loadDailyTotalsForTenant(tenantId, 84),
      loadShippedChanges().catch(() => []),
      // Items 40 + 41 need dollarValue/trafficOutcome, which only exist on the
      // RE-MEASURED ledger (loadShippedChanges alone never populates them).
      // react.cache-shared with the /today page's own loadProofLedgerCached
      // call in the same request, so this is not a second heavy re-measure.
      loadProofLedgerCached(tenantId).catch(() => [] as ShippedChangeRecord[]),
      currentTenantSlug().catch(() => ""),
      // Item 3 - honest dollars from revenue_facts; fail-soft -> the line self-hides.
      loadRevenueByDayForTenant(tenantId).catch(() => []),
    ]);
    // Item 9 - the AI-visibility mini-scoreboard: your own domain's citations over time,
    // next to the Google chart. Fail-soft -> band self-hides.
    const citations = slug ? await loadOwnCitationsByDay(tenantId, slug).catch(() => ({ daily: [], total: 0 })) : { daily: [] as Array<{ date: string; clicks: number }>, total: 0 };
    const s = buildScoreboard(
      daily,
      ledger.map((r) => ({ path: r.path, shippedAt: r.shippedAt, actionType: r.actionType, verdict: r.verdict })),
    );
    if (!s) return null;
    // Item 3 - one honest money sentence. Null when no revenue_facts exist, so
    // this section renders exactly as before for tenants without dollars.
    const moneyLine = buildMoneyLine(revenueDays);

    // Items 40 + 41 - the lifetime earnings odometer and the portfolio
    // counterfactual, both computed from the SAME re-measured ledger, both
    // independently self-hiding (null when the honest minimum isn't met).
    const now = new Date();
    const shockWindows = await loadShockWindowsForGate(tenantId);
    const lifetimeEarnings = computeLifetimeEarnings(
      buildLifetimeEarningsRows(measuredLedger, now, shockWindows),
    );
    const portfolioCounterfactual = computePortfolioCounterfactual(
      buildCounterfactualRows(measuredLedger, now, shockWindows),
    );

    // Item 65 - the shadow portfolio: picks Beacon actually shipped versus the top eligible
    // candidates it considered but skipped, over matching windows. Distinct from item 41 above
    // (that line is about a SHIPPED change's own diff-in-diff comparison pages; this one is about
    // the PICKING process itself). Fail-soft and independently self-hiding - a read error or a
    // thin sample just means this line stays silent beside the others.
    const shadowMeasurement = await loadShadowPortfolioMeasurement(tenantId, now).catch(() => null);
    const shadowPortfolio = shadowMeasurement
      ? compareShadowPortfolio(shadowMeasurement.selected, shadowMeasurement.shadow)
      : null;

    const deltaTone = s.deltaPct == null ? "text-gray-500 dark:text-neutral-400" : s.deltaPct > 2 ? "text-emerald-600 dark:text-emerald-400" : s.deltaPct < -2 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-neutral-400";
    return (
      <section aria-label="Your traffic and your changes" className="rounded-2xl border border-gray-200 bg-white p-4 beacon-rise-in dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{s.last7Clicks.toLocaleString()}</span>
            <span className="text-xs text-gray-500 dark:text-neutral-400">clicks, last 7 reported days</span>
            {s.deltaPct != null ? (
              <span className={`text-sm font-semibold tabular-nums ${deltaTone}`}>
                {s.deltaPct > 0 ? "+" : ""}{s.deltaPct}%
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-neutral-500">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded bg-indigo-600" /> 7 day average</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> change that won</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-slate-400" /> measuring</span>
          </div>
        </div>
        <div className="mt-2 text-gray-800 dark:text-neutral-200">
          <Chart s={s} />
        </div>
        <p className="mt-1 text-[13px] text-gray-600 dark:text-neutral-300">{s.verdictLine}</p>
        {moneyLine ? (
          <p className="mt-1 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">{moneyLine}</p>
        ) : null}
        {lifetimeEarnings || portfolioCounterfactual || shadowPortfolio ? (
          <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-neutral-800">
            {lifetimeEarnings ? (
              <p className="text-[13px] font-medium text-indigo-700 dark:text-indigo-300">{lifetimeEarnings.sentence}</p>
            ) : null}
            {portfolioCounterfactual ? (
              <p className="text-[13px] text-gray-600 dark:text-neutral-300">{portfolioCounterfactual.sentence}</p>
            ) : null}
            {shadowPortfolio ? (
              <p className="text-[13px] text-gray-600 dark:text-neutral-300">{shadowPortfolio.sentence}</p>
            ) : null}
          </div>
        ) : null}
        {citations.total > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-[12px] text-gray-600 dark:border-neutral-800 dark:text-neutral-300 tabular-nums">
            <span className="font-semibold text-pink-700 dark:text-pink-300">AI recommended you {citations.total.toLocaleString()} time{citations.total === 1 ? "" : "s"} in the last 30 days.</span>
            {citations.daily.length >= 5 ? <Sparkline points={citations.daily} width={96} height={18} className="inline-block opacity-80" /> : null}
            <span className="text-[11px] text-gray-400 dark:text-neutral-500">citations of your pages in AI answers, per day</span>
          </div>
        ) : null}
      </section>
    );
  } catch {
    return null;
  }
}
