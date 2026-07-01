/**
 * scoreboard (2026-07-01, FINAL PREMIUM PLAN items 1-3) - PURE math for the Today hero chart:
 * the one picture that answers "am I winning?". Takes the property's daily GSC totals + the
 * shipped-change ledger and produces a render-ready model:
 *   - daily click points + a 7-day rolling average (the honest trend line)
 *   - change markers placed on the chart at each ship date (won = green, measuring = neutral,
 *     no lift = amber) so cause and effect live in one picture
 *   - a one-sentence verdict comparing the last 7 FULL days of data vs the prior 7, plus how
 *     many changes are measuring and when the next verdicts land
 * No I/O, no LLM. GSC reports with a ~3 day lag; the caller passes whatever rows exist and the
 * math uses the latest REPORTED date as "now" so a lag never fakes a decline. Pinned by
 * scoreboard.test.ts.
 */

export type ScoreboardDay = { date: string; clicks: number; impressions: number };

export type ScoreboardLedgerRow = {
  path: string;
  shippedAt: string;
  actionType: string;
  verdict: string; // measuring | won | lost | inconclusive | insufficient_data
};

export type ScoreboardMarker = {
  date: string; // yyyy-mm-dd
  /** Count of changes shipped that day. */
  count: number;
  tone: "won" | "measuring" | "flat";
  /** Plain one-liner for the tooltip: "2 changes shipped (measuring)". */
  label: string;
};

export type Scoreboard = {
  days: ScoreboardDay[];
  /** 7-day rolling average of clicks, aligned to `days` (null until 7 days exist). */
  rolling: Array<number | null>;
  markers: ScoreboardMarker[];
  /** Sum of clicks over the last 7 reported days. */
  last7Clicks: number;
  /** Percent change vs the prior 7 reported days (null when prior window is empty). */
  deltaPct: number | null;
  /** Sum of impressions over the last 7 reported days. */
  last7Impressions: number;
  /** Latest date GSC has reported (the chart's honest right edge). */
  reportedThrough: string;
  measuringCount: number;
  /** yyyy-mm-dd of the soonest first-read checkpoint among measuring changes, or null. */
  nextVerdictDate: string | null;
  /** The one-line verdict sentence, plain language, no jargon, no dashes. */
  verdictLine: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function buildScoreboard(
  daysIn: ScoreboardDay[],
  ledger: ScoreboardLedgerRow[],
  now: Date = new Date(),
): Scoreboard | null {
  const days = [...daysIn]
    .filter((d) => d.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (days.length < 14) return null; // not enough history to say anything honest

  const reportedThrough = days[days.length - 1]!.date;

  // 7-day rolling average of clicks.
  const rolling: Array<number | null> = days.map((_, i) => {
    if (i < 6) return null;
    let sum = 0;
    for (let j = i - 6; j <= i; j++) sum += days[j]!.clicks;
    return Math.round((sum / 7) * 10) / 10;
  });

  // Last 7 reported days vs the prior 7.
  const last7 = days.slice(-7);
  const prior7 = days.slice(-14, -7);
  const last7Clicks = last7.reduce((s, d) => s + d.clicks, 0);
  const prior7Clicks = prior7.reduce((s, d) => s + d.clicks, 0);
  const last7Impressions = last7.reduce((s, d) => s + d.impressions, 0);
  const deltaPct = prior7Clicks > 0 ? Math.round(((last7Clicks - prior7Clicks) / prior7Clicks) * 100) : null;

  // Markers: group ledger rows by ship DAY, only within the charted range.
  const first = days[0]!.date;
  const byDay = new Map<string, ScoreboardLedgerRow[]>();
  for (const r of ledger) {
    const d = (r.shippedAt ?? "").slice(0, 10);
    if (!d || d < first || d > reportedThrough) continue;
    const arr = byDay.get(d) ?? [];
    arr.push(r);
    byDay.set(d, arr);
  }
  const markers: ScoreboardMarker[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rows]) => {
      const won = rows.some((r) => r.verdict === "won");
      const measuring = rows.some((r) => r.verdict === "measuring");
      const tone: ScoreboardMarker["tone"] = won ? "won" : measuring ? "measuring" : "flat";
      const label =
        rows.length === 1
          ? `1 change shipped (${won ? "won" : measuring ? "measuring" : "no clear lift"})`
          : `${rows.length} changes shipped (${won ? "includes a win" : measuring ? "measuring" : "no clear lift"})`;
      return { date, count: rows.length, tone, label };
    });

  // Measuring count + the soonest upcoming first-read (ship + 7 days, in the future of `now`).
  const measuringRows = ledger.filter((r) => r.verdict === "measuring");
  const nowMs = now.getTime();
  let nextMs = Number.POSITIVE_INFINITY;
  for (const r of measuringRows) {
    const ship = Date.parse(r.shippedAt);
    if (!Number.isFinite(ship)) continue;
    for (const windowDays of [7, 14, 28]) {
      const checkpoint = ship + windowDays * DAY_MS;
      if (checkpoint >= nowMs && checkpoint < nextMs) nextMs = checkpoint;
    }
  }
  const nextVerdictDate = Number.isFinite(nextMs) ? iso(nextMs) : null;

  const direction =
    deltaPct == null ? "" : deltaPct > 2 ? `, up ${deltaPct}% vs the week before` : deltaPct < -2 ? `, down ${Math.abs(deltaPct)}% vs the week before` : ", about even with the week before";
  const friendlyNext = nextVerdictDate
    ? new Date(nextVerdictDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
    : null;
  const measuringPart =
    measuringRows.length > 0
      ? ` ${measuringRows.length} change${measuringRows.length === 1 ? "" : "s"} measuring${friendlyNext ? `, next reads around ${friendlyNext}` : ""}.`
      : "";
  const verdictLine = `Last 7 reported days: ${last7Clicks.toLocaleString()} clicks${direction}.${measuringPart}`;

  return {
    days,
    rolling,
    markers,
    last7Clicks,
    deltaPct,
    last7Impressions,
    reportedThrough,
    measuringCount: measuringRows.length,
    nextVerdictDate,
    verdictLine,
  };
}
