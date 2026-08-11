/**
 * ScoreboardSection (2026-07-01, FINAL PREMIUM PLAN items 1-3) - the Today hero: one beautiful
 * chart that answers "am I winning?". Daily clicks as a soft area, the 7-day average as the bold
 * line, and every shipped change marked ON the chart at its ship date (green when it won). Under
 * it, one plain sentence with the week-over-week verdict. Server component, pure SVG, no deps,
 * fail-soft (self-hides without enough history so it never renders an empty box).
 */
import Link from "next/link";
import { loadDailyTotalsForTenant } from "@/domains/decision";
import { loadShippedChanges } from "@/domains/measurement";
import { buildScoreboard, buildMoneyLine, type Scoreboard } from "@/domains/measurement";
import { loadRevenueByDayForTenant } from "@/domains/measurement";
import { loadOwnCitationsByDay } from "@/domains/decision";
import { currentTenantSlug } from "@/lib/tenant-context";
import { ScoreboardChartTabs } from "./scoreboard-chart-tabs";
import { loadWithDeadline, valueWithDeadline } from "@/lib/load-with-deadline";
import { HonestDelay } from "@/components/honest-delay";
// R14b (receipts everywhere) - the one-line receipt under the hero numbers: what
// data this chart reads and how far it runs, from the series ALREADY loaded.
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
// R17a (brand split, v1 265) - the non-brand growth lens: clicks from searches
// that do not mention the business name, windowed on the SAME reported days the
// headline uses. Fail-soft null -> the sub-line self-hides.
import { loadScoreboardBrandLens } from "@/domains/evidence";
// R17b (v1 264) - the dotted "still settling" tail: Google's EARLY counts for
// the final-lag days the chart's final lane excludes. Opt-in read behind a 3h
// volatile cache; fail-soft null -> no tail, chart byte-identical.
import { readGscFreshTailCached, refreshGscFreshTail } from "@/domains/evidence";
import { FRESH_TAIL_NOTE, type FreshTailPoint } from "@/domains/evidence";
import { after } from "next/server";

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

export async function ScoreboardSection({ tenantId }: { tenantId: string }) {
  try {
    // FP1 (2026-07-02) - deadline-bounded so the hero chart's pulse skeleton can
    // never strand; past the deadline the section says so in one honest line.
    const raced = await loadWithDeadline(
      Promise.all([
        loadDailyTotalsForTenant(tenantId, 84),
        loadShippedChanges().catch(() => []),
        currentTenantSlug().catch(() => ""),
        // Item 3 - honest dollars from revenue_facts; fail-soft -> the line self-hides.
        loadRevenueByDayForTenant(tenantId).catch(() => []),
      ] as const),
    );
    if (raced.timedOut) return <HonestDelay />;
    const [daily, ledger, slug, revenueDays] = raced.data;
    // Item 9 - your own domain's citations per day, the chart's AI tab. Deadline-bounded like the
    // reads above so one slow follow-up read cannot re-strand the section; fail-soft to no tab.
    const none = { daily: [] as Array<{ date: string; clicks: number }>, total: 0 };
    const citations = slug ? await valueWithDeadline(loadOwnCitationsByDay(tenantId, slug).catch(() => none), none) : none;
    // Wave 3A: pass the FULL ledger rows (windows + baseline), not a slim verdict-string
    // projection, so buildScoreboard tones each chart marker through the canonical lifecycle
    // rule (splitLedgerLifecycle). The measuring count and next-read date are NOT read here:
    // Today's proof strip owns both. ShippedChangeRecord satisfies ScoreboardLedgerRow.
    const s = buildScoreboard(daily, ledger);
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

    // R17b (v1 264) - the dotted settling tail: a CACHE-ONLY read on the render path, with the one
    // bounded live searchanalytics.query moved to the after() refresh below, so the render serves
    // the last cached tail instantly and warms the next one in the background.
    const lastReportedDate = s.days[s.days.length - 1]?.date ?? null;
    const freshTailCached = await valueWithDeadline(
      readGscFreshTailCached(tenantId, lastReportedDate).catch(() => null),
      null,
    );
    const freshTail = freshTailCached?.points ?? null;
    // Warm the settling tail OFF the render path: schedule the live refresh when
    // there is no cached window yet, or the cached one is past its 3h TTL. The
    // current render still serves whatever was cached (SWR); the next visit sees
    // the refreshed tail. Fire-and-forget + fail-soft.
    if (lastReportedDate && (!freshTailCached || freshTailCached.stale)) {
      after(async () => {
        await refreshGscFreshTail(tenantId, lastReportedDate).catch(() => {});
      });
    }

    // The chart's Google / AI answers pair, from the citation series ALREADY loaded above: no new
    // reads. Visitors and Value are gone (Phase 7): sessions and dollars modify a decision, they are
    // not a visibility surface, and the deep read lives on Visibility now.
    const aiPoints = citations.daily.map((d) => ({ date: d.date, value: d.clicks }));

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
            {/* Fail-closed calibration quarantine (2026-07-11): the green "won" key
                shows only when a real (calibrated) win marker is on the chart.
                Uncalibrated wins render as neutral measured markers (scoreboard.ts
                reads the gated splitLedgerLifecycle), so the legend never promises a
                green dot the chart cannot honestly show. */}
            {s.markers.some((m) => m.tone === "won") ? (
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> a change that won more clicks</span>
            ) : null}
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-slate-400" /> a change not judged yet</span>
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
          aiPoints={aiPoints}
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
        {/* Phase 7: the weekly "how you show up" expander and the AI citation strip moved to Visibility,
            which owns the deep read. Today keeps the compact overview: chart, verdict, lens, receipt. */}
        {moneyLine ? (
          <p className="mt-1 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">{moneyLine}</p>
        ) : null}
        <Link href="/visibility" className="mt-1 inline-block text-[12px] font-medium text-accent-primary underline underline-offset-2">
          See where you stand in Google and AI answers
        </Link>
      </section>
    );
  } catch {
    return null;
  }
}
