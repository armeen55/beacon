"use client";

/**
 * ScoreboardChartTabs (UX4 item 2, 2026-07-02) - the main clicks chart gains Google / AI
 * visibility / Visitors / Value tabs. Every tab renders a series the server ALREADY loaded for
 * the scoreboard (GSC clicks, AI citations/day, GA4 sessions/day, revenue/day) - no new heavy
 * loads happen on tab switch, this is a pure client-side view swap over data passed in as props.
 * A tab with no series data self-hides from the tab list entirely (never a dead tab that shows
 * an empty chart), and the Google tab (the richest chart: 7-day average + shipped-change
 * markers) is what a returning owner already knows, so it stays first and default-selected.
 */
import { useState } from "react";
import { ViewToggle } from "@/components/viz/view-toggle";

export type SimpleSeriesPoint = { date: string; value: number };

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
function linePath(values: number[], max: number): string {
  const n = values.length;
  const pts = values.map((v, i) => `${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`);
  return `M${pts.join(" L")}`;
}
function monthDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A simple, single-series area+line chart for the non-Google tabs (AI citations, GA4 sessions,
 *  daily revenue). Deliberately plainer than the Google chart (no rolling average, no markers) -
 *  those tabs are a supporting picture, not the primary "am I winning?" chart. */
function SimpleChart({ points, unitLabel, color }: { points: SimpleSeriesPoint[]; unitLabel: string; color: string }) {
  const n = points.length;
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values);
  const tickIdx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${unitLabel} per day`} className="w-full">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD_L} x2={W - PAD_R} y1={yAt(max * f, max)} y2={yAt(max * f, max)} stroke="currentColor" strokeOpacity="0.06" />
      ))}
      <path d={areaPath(values, max)} fill={color} fillOpacity="0.12" />
      <path d={linePath(values, max)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {tickIdx.map((i) => (
        <text key={i} x={xAt(i, n)} y={H - 6} fontSize="10" fill="currentColor" fillOpacity="0.45" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
          {points[i] ? monthDay(points[i].date) : ""}
        </text>
      ))}
      <text x={PAD_L} y={PAD_T - 3} fontSize="10" fill="currentColor" fillOpacity="0.45">{max.toLocaleString()} {unitLabel}/day</text>
    </svg>
  );
}

export type ChartTabId = "google" | "ai" | "visitors" | "value";

export type ChartTabDef = {
  id: ChartTabId;
  label: string;
  color: string;
  unitLabel: string;
  points: SimpleSeriesPoint[];
};

/**
 * The Google tab renders the caller's existing rich chart element (7-day average + shipped-
 * change markers, unchanged); the remaining tabs render a SimpleChart over their own series.
 * Tabs whose series is empty (fewer than 2 points - nothing to draw a line between) are dropped
 * from the tab list entirely, per the self-hide contract. When only the Google tab has data, no
 * tab control renders at all (the chart looks exactly as it did before this feature).
 */
export function ScoreboardChartTabs({
  googleChart,
  otherTabs,
}: {
  googleChart: React.ReactNode;
  otherTabs: ChartTabDef[];
}) {
  const visibleOtherTabs = otherTabs.filter((t) => t.points.length >= 2);
  const [active, setActive] = useState<ChartTabId>("google");

  if (visibleOtherTabs.length === 0) {
    return <div className="mt-2 text-gray-800 dark:text-neutral-200">{googleChart}</div>;
  }

  const options = [
    { value: "google" as ChartTabId, label: "Google" },
    ...visibleOtherTabs.map((t) => ({ value: t.id, label: t.label })),
  ];
  const activeTab = visibleOtherTabs.find((t) => t.id === active) ?? null;

  return (
    <div className="mt-2">
      <ViewToggle options={options} value={active} onChange={setActive} size="sm" />
      <div className="mt-2 text-gray-800 dark:text-neutral-200">
        {active === "google" || !activeTab ? googleChart : (
          <SimpleChart points={activeTab.points} unitLabel={activeTab.unitLabel} color={activeTab.color} />
        )}
      </div>
    </div>
  );
}
