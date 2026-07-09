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
import { buildShockWindows, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import {
  monthlyExtraSessionsRate,
  selectDollarRuleWins,
  selectMatureCleanResults,
} from "@/domains/proof-gsc/won-dollar-rule";
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
import { ScoreboardChartTabs, type ChartTabDef } from "./scoreboard-chart-tabs";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
// R14b (receipts everywhere) - the one-line receipt under the hero numbers: what
// data this chart reads and how far it runs, from the series ALREADY loaded.
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
// R17a (brand split, v1 265) - the non-brand growth lens: clicks from searches
// that do not mention the business name, windowed on the SAME reported days the
// headline uses. Fail-soft null -> the sub-line self-hides.
import { loadScoreboardBrandLens } from "@/domains/gsc/load-brand-split";
// R17b (v1 136 + 268) - the weekly "how you show up" lens: rich-result styling
// share + phones vs computers, from the weekly GSC dimensions store. Fail-soft
// null -> the expander self-hides.
import { loadGscWeeklyLens } from "@/domains/gsc/load-weekly-dimensions";
// R17b (v1 264) - the dotted "still settling" tail: Google's EARLY counts for
// the final-lag days the chart's final lane excludes. Opt-in read behind a 3h
// volatile cache; fail-soft null -> no tail, chart byte-identical.
import { loadGscFreshTail } from "@/domains/gsc/load-fresh-tail";
import { FRESH_TAIL_NOTE, type FreshTailPoint } from "@/domains/gsc/fresh-tail";

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

// R17b: both path helpers take an optional totalN so the final-lane shapes can
// be drawn in a wider x-space when the dotted settling tail extends the chart.
function areaPath(values: number[], max: number, totalN?: number): string {
  const n = totalN ?? values.length;
  const pts = values.map((v, i) => `${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`);
  return `M${xAt(0, n).toFixed(1)},${yAt(0, max).toFixed(1)} L${pts.join(" L")} L${xAt(values.length - 1, n).toFixed(1)},${yAt(0, max).toFixed(1)} Z`;
}
function linePath(values: Array<number | null>, max: number, totalN?: number): string {
  const n = totalN ?? values.length;
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

function Chart({ s, freshTail }: { s: Scoreboard; freshTail?: FreshTailPoint[] | null }) {
  // R17b (v1 264): the dotted settling tail extends the x-space past the last
  // FINAL day. All final-lane shapes keep their exact geometry when the tail
  // is absent (n === s.days.length -> identical to the pre-R17b chart).
  const tail = freshTail ?? [];
  const nFinal = s.days.length;
  const n = nFinal + tail.length;
  const clicks = s.days.map((d) => d.clicks);
  const max = Math.max(1, ...clicks, ...tail.map((t) => t.clicks));
  const dates = [...s.days.map((d) => d.date), ...tail.map((t) => t.date)];
  const idxByDate = new Map(s.days.map((d, i) => [d.date, i]));
  const tickIdx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  // The dotted line starts at the last FINAL point so the early counts read
  // as a continuation, never a separate series.
  const tailValues: Array<number | null> =
    tail.length > 0
      ? [...Array<null>(nFinal - 1).fill(null), clicks[nFinal - 1] ?? 0, ...tail.map((t) => t.clicks)]
      : [];
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
      <path d={areaPath(clicks, max, n)} fill="url(#sb-fill)" />
      <path d={linePath(clicks, max, n)} fill="none" stroke="#6366f1" strokeOpacity="0.35" strokeWidth="1.2" />
      {/* 7-day average, the honest trend */}
      <path d={linePath(s.rolling, max, n)} fill="none" stroke="#4f46e5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* R17b - the dotted settling tail: Google's early counts, not final */}
      {tail.length > 0 ? (
        <g>
          <path d={linePath(tailValues, max, n)} fill="none" stroke="#6366f1" strokeOpacity="0.55" strokeWidth="1.6" strokeDasharray="3 4" strokeLinecap="round" />
          {tail.map((t, j) => (
            <circle key={t.date} cx={xAt(nFinal + j, n)} cy={yAt(t.clicks, max)} r={2.5} fill="var(--background)" stroke="#6366f1" strokeOpacity="0.7" strokeWidth="1.2">
              <title>{`${monthDay(t.date)}: ${t.clicks.toLocaleString()} clicks so far (still settling)`}</title>
            </circle>
          ))}
        </g>
      ) : null}
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
          {monthDay(dates[i]!)}
        </text>
      ))}
      {/* max label */}
      <text x={PAD_L} y={PAD_T - 3} fontSize="10" fill="currentColor" fillOpacity="0.45">{max.toLocaleString()} clicks/day</text>
    </svg>
  );
}

/**
 * Items 40 + 41 (2026-07-02) - the shared eligibility gate for both the
 * lifetime-earnings odometer and the portfolio counterfactual. R4 (2026-07-03):
 * the gate itself moved into domains/proof-gsc/won-dollar-rule.ts (THE ONE
 * DOLLAR RULE) so the cumulative outcome strip and this odometer select the
 * exact same rows - two cumulative dollar figures can never disagree on the
 * same screen again. This file only loads the shock windows and maps the
 * selected rows into each aggregator's input shape.
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

/** Days between ship and now, floored at 0 (a backdated/clock-skewed ship
 *  never contributes a negative lifetime span). */
function daysLiveOf(shippedAt: string, now: Date): number {
  const shipped = Date.parse(shippedAt);
  if (!Number.isFinite(shipped)) return 0;
  return Math.max(0, Math.floor((now.getTime() - shipped) / 86_400_000));
}

/**
 * Item 40 - build the odometer's input rows from the measured ledger: every
 * record THE ONE DOLLAR RULE selects (won + mature + clean attribution + a
 * positive measured traffic rate) contributes its current monthly rate (the
 * SAME control-adjusted extra-sessions number change-dollar-value.ts already
 * put on the row as dollarValue/trafficOutcome at measure time - never
 * re-derived here) plus its days-live for the honest proration. The selection
 * is the shared won-dollar-rule gate, so this odometer's dollar total is
 * byte-identical to the cumulative outcome strip's.
 */
export function buildLifetimeEarningsRows(ledger: ShippedChangeRecord[], now: Date, shockWindows: ShockWindow[]): LifetimeEarningsRow[] {
  return selectDollarRuleWins(ledger, now, shockWindows).map((r) => ({
    id: r.id,
    extraSessionsPerMonth: monthlyExtraSessionsRate(r),
    usdPerMonth: r.dollarValue?.usdPerMonth ?? null,
    daysLive: daysLiveOf(r.shippedAt, now),
  }));
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
  const rows: CounterfactualRow[] = [];
  for (const r of selectMatureCleanResults(ledger, now, shockWindows)) {
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

/** Plain "Jul 2" style date label for the A1 honest-staleness suffix, Pacific time
 *  to match the rest of Today's date formatting. Null input (bad/missing timestamp)
 *  renders nothing, never a garbled date. */
function staleDateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

export async function ScoreboardSection({
  tenantId,
  stale = false,
  staleCheckedAt = null,
}: {
  tenantId: string;
  /** A1 (operator-experience fix batch) - true when last night's sync hit a pipeline
   *  invariant violation (e.g. wrote 0 rows). The citations stat then carries an honest
   *  "numbers last updated" suffix instead of implying the count is current. */
  stale?: boolean;
  /** ISO timestamp of the last pipeline health check, for the suffix date. */
  staleCheckedAt?: string | null;
}) {
  try {
    // FP1 (2026-07-02) - deadline-bounded so the hero chart's pulse skeleton can
    // never strand; past the deadline the section says so in one honest line.
    const raced = await loadWithDeadline(
      Promise.all([
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
      ] as const),
    );
    if (raced.timedOut) return <HonestDelay />;
    const [daily, ledger, measuredLedger, slug, revenueDays] = raced.data;
    // Item 9 - the AI-visibility mini-scoreboard: your own domain's citations over time,
    // next to the Google chart. Fail-soft -> band self-hides. Deadline-bounded like the
    // reads above so one slow follow-up read cannot re-strand the section.
    const citations = slug
      ? await valueWithDeadline(
          loadOwnCitationsByDay(tenantId, slug).catch(() => ({ daily: [] as Array<{ date: string; clicks: number }>, total: 0 })),
          { daily: [] as Array<{ date: string; clicks: number }>, total: 0 },
        )
      : { daily: [] as Array<{ date: string; clicks: number }>, total: 0 };
    const s = buildScoreboard(
      daily,
      ledger.map((r) => ({ path: r.path, shippedAt: r.shippedAt, actionType: r.actionType, verdict: r.verdict })),
    );
    if (!s) return null;
    // Item 3 - one honest money sentence. Null when no revenue_facts exist, so
    // this section renders exactly as before for tenants without dollars.
    const moneyLine = buildMoneyLine(revenueDays);

    // R17a (brand split, v1 265) - the non-brand lens over the SAME reported
    // days the headline just summed. Deadline-bounded + fail-soft: no brand
    // config, no query rows, or a slow read just means no sub-line.
    const brandLens = await valueWithDeadline(
      loadScoreboardBrandLens(tenantId, s.days.map((d) => d.date)).catch(() => null),
      null,
    );

    // R17b (v1 136 + 268) - the weekly "how you show up" lens (rich styling +
    // devices, $0 store read) and (v1 264) the dotted settling tail (one
    // bounded fresh read behind a 3h cache). Both deadline-bounded +
    // fail-soft: a miss just means no expander / no tail.
    const [weeklyLens, freshTail] = await Promise.all([
      valueWithDeadline(loadGscWeeklyLens(tenantId).catch(() => null), null),
      valueWithDeadline(
        loadGscFreshTail(tenantId, s.days[s.days.length - 1]?.date ?? null).catch(() => null),
        null,
      ),
    ]);

    // UX4 item 2 - the chart's Google/AI visibility/Value tabs, built from series ALREADY loaded
    // above for this same section (citations.daily, revenueDays) - no new reads. A GA4 sessions
    // day-series loader does not exist yet, so Visitors passes an empty series and the tab
    // self-hides rather than inventing a load or a fake chart.
    const chartTabs: ChartTabDef[] = [
      { id: "ai", label: "AI visibility", color: "#db2777", unitLabel: "citations", points: citations.daily.map((d) => ({ date: d.date, value: d.clicks })) },
      { id: "visitors", label: "Visitors", color: "#0891b2", unitLabel: "sessions", points: [] },
      { id: "value", label: "Value", color: "#059669", unitLabel: "dollars", points: revenueDays.filter((d) => d.revenueUsd > 0).map((d) => ({ date: d.day, value: d.revenueUsd })) },
    ];

    // Items 40 + 41 - the lifetime earnings odometer and the portfolio
    // counterfactual, both computed from the SAME re-measured ledger, both
    // independently self-hiding (null when the honest minimum isn't met).
    const now = new Date();
    const shockWindows = await valueWithDeadline(loadShockWindowsForGate(tenantId), []);
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
    const shadowMeasurement = await valueWithDeadline(
      loadShadowPortfolioMeasurement(tenantId, now).catch(() => null),
      null,
    );
    const shadowPortfolio = shadowMeasurement
      ? compareShadowPortfolio(shadowMeasurement.selected, shadowMeasurement.shadow)
      : null;

    const deltaTone = s.deltaPct == null ? "text-gray-500 dark:text-neutral-400" : s.deltaPct > 2 ? "text-emerald-600 dark:text-emerald-400" : s.deltaPct < -2 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-neutral-400";
    return (
      <section id="scoreboard-section" aria-label="Your traffic and your changes" className="rounded-2xl border border-gray-200 bg-white p-4 beacon-rise-in dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{s.last7Clicks.toLocaleString()}</span>
            {/* R17a - the headline names its lens (every search) whenever the
                non-brand sub-line below gives the other lens a voice. */}
            <span className="text-xs text-gray-500 dark:text-neutral-400">
              {brandLens ? "clicks, last 7 reported days, every search counted" : "clicks, last 7 reported days"}
            </span>
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
        <ScoreboardChartTabs
          googleChart={
            <>
              <Chart s={s} freshTail={freshTail} />
              {/* R17b - the tail's honest label, only when a tail rendered. */}
              {freshTail && freshTail.length > 0 ? (
                <p className="text-meta text-muted-foreground">{FRESH_TAIL_NOTE}</p>
              ) : null}
            </>
          }
          otherTabs={chartTabs}
        />
        <p className="mt-1 text-[13px] text-gray-600 dark:text-neutral-300">{s.verdictLine}</p>
        {/* R17a (brand split) - the growth lens: clicks from searches that do
            not mention your name, the number an SEO change can actually move.
            Self-hides without brand config or visible query rows. */}
        {brandLens ? (
          <p className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">{brandLens.subLine}</p>
        ) : null}
        {/* R14b (receipts everywhere) - where these clicks come from and how far the
            data runs, from the same series the chart just drew. No new reads. */}
        <ReceiptLine
          className="mt-0.5"
          line={buildReceiptLine({
            source: "your Search Console data",
            through: s.days[s.days.length - 1]?.date ?? null,
            nowMs: Date.now(),
            note: "Google reports a few days behind.",
          })}
        />
        {/* R17b (v1 136 + 268) - the weekly "how you show up" expander: rich
            styling share + phones vs computers, receipt-styled lines from the
            weekly store. Self-hides when no weekly snapshot exists yet. */}
        {weeklyLens ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-meta text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
              How you show up on Google
            </summary>
            <div className="mt-1 space-y-0.5">
              {weeklyLens.deviceLine ? (
                <p className="text-meta text-muted-foreground tabular-nums">{weeklyLens.deviceLine}</p>
              ) : null}
              {/* R17c item 428 - which markets your Google traffic comes from,
                  from the weekly country pull. Self-hides without country grain. */}
              {weeklyLens.countryLine ? (
                <p className="text-meta text-muted-foreground tabular-nums">{weeklyLens.countryLine}</p>
              ) : null}
              {weeklyLens.appearanceLine ? (
                <p className="text-meta text-muted-foreground tabular-nums">{weeklyLens.appearanceLine}</p>
              ) : null}
              {weeklyLens.appearanceDropLine ? (
                <p className="text-meta text-muted-foreground tabular-nums">{weeklyLens.appearanceDropLine}</p>
              ) : null}
              <ReceiptLine
                line={buildReceiptLine({
                  source: "your Search Console data",
                  through: weeklyLens.weekEnd,
                  checkedAt: weeklyLens.pulledAt,
                  nowMs: Date.now(),
                  note: "I check this once a week.",
                })}
              />
            </div>
          </details>
        ) : null}
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
            <span className="font-semibold text-pink-700 dark:text-pink-300">AI cited your pages {citations.total.toLocaleString()} time{citations.total === 1 ? "" : "s"} in the last 30 days.</span>
            {citations.daily.length >= 5 ? <Sparkline points={citations.daily} width={96} height={18} className="inline-block opacity-80" /> : null}
            <span className="text-[11px] text-gray-400 dark:text-neutral-500">citations of your pages in AI answers, per day</span>
            {/* R14b (receipts everywhere) - the AI count's own receipt, from the same
                citation series just rendered. No new reads. */}
            <ReceiptLine
              line={buildReceiptLine({
                source: "your AI answer tracking",
                through: citations.daily[citations.daily.length - 1]?.date ?? null,
                nowMs: Date.now(),
              })}
            />
            {/* A1 - honest badge when last night's sync hit a data-pipe problem: this count
                may not include last night, so say so instead of reading as fully current. */}
            {stale ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                numbers last updated {staleDateLabel(staleCheckedAt) ?? "recently"}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  } catch {
    return null;
  }
}
