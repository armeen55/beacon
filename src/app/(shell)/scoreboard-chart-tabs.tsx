"use client";

/**
 * ScoreboardChartTabs - the Today hero chart's Google / AI answers pair. Both tabs render a series
 * the server ALREADY loaded for the scoreboard (Search Console clicks, citations of your pages per
 * day), so a tab switch is a view swap and never a second load.
 *
 * Dream V1 Phase 7 (2026-08-02): the Visitors and Value tabs are gone. Analytics sessions and
 * dollars are MODIFIERS on a decision, never a visibility surface of their own, and Visitors never
 * had a series to draw at all, so it could only ever self-hide. Google and AI answers stay, and the
 * whole picture with its drill-downs lives on Visibility. The AI tab self-hides without at least
 * two days to join, so a tab never opens onto an empty chart.
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
function pointsOf(values: number[], max: number): string {
  return values.map((v, i) => `${xAt(i, values.length).toFixed(1)},${yAt(v, max).toFixed(1)}`).join(" L");
}
function monthDay(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The AI tab's chart: deliberately plainer than the Google one (no rolling average, no shipped
 *  change markers) because it is a supporting picture, not the primary "am I winning?" chart. */
function AiChart({ points }: { points: SimpleSeriesPoint[] }) {
  const n = points.length;
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values);
  const body = pointsOf(values, max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Citations of your pages in AI answers, per day" className="w-full">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD_L} x2={W - PAD_R} y1={yAt(max * f, max)} y2={yAt(max * f, max)} stroke="currentColor" strokeOpacity="0.06" />
      ))}
      <path d={`M${xAt(0, n).toFixed(1)},${yAt(0, max).toFixed(1)} L${body} L${xAt(n - 1, n).toFixed(1)},${yAt(0, max).toFixed(1)} Z`} fill="#db2777" fillOpacity="0.12" />
      <path d={`M${body}`} fill="none" stroke="#db2777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {[0, n - 1].map((i) => (
        <text key={i} x={xAt(i, n)} y={H - 6} fontSize="10" fill="currentColor" fillOpacity="0.45" textAnchor={i === 0 ? "start" : "end"}>
          {points[i] ? monthDay(points[i]!.date) : ""}
        </text>
      ))}
      <text x={PAD_L} y={PAD_T - 3} fontSize="10" fill="currentColor" fillOpacity="0.45">{max.toLocaleString()} citations/day</text>
    </svg>
  );
}

export function ScoreboardChartTabs({ googleChart, aiPoints }: { googleChart: React.ReactNode; aiPoints: SimpleSeriesPoint[] }) {
  const [active, setActive] = useState<"google" | "ai">("google");
  if (aiPoints.length < 2) return <div className="mt-2 text-gray-800 dark:text-neutral-200">{googleChart}</div>;
  return (
    <div className="mt-2">
      <ViewToggle
        options={[{ value: "google" as const, label: "Google" }, { value: "ai" as const, label: "AI answers" }]}
        value={active}
        onChange={setActive}
        size="sm"
      />
      <div className="mt-2 text-gray-800 dark:text-neutral-200">
        {active === "google" ? googleChart : <AiChart points={aiPoints} />}
      </div>
    </div>
  );
}
