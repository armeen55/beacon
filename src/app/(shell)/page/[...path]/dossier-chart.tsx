"use client";

import { AreaChart, type AreaEvent } from "@/components/viz/area-chart";
import type { DailyClicks } from "@/domains/recommendation-intelligence/gsc-page-queries";

/**
 * DossierChart (BEACON_500 item 54) - the page dossier's clicks-over-time band with
 * ship markers. Thin client wrapper around the shared AreaChart so the ship dates
 * (from the proof ledger) render as dashed guidelines with a "Shipped" label, the
 * same event-annotation contract AreaChart already supports.
 */
export function DossierChart({ daily, shipMarkers }: { daily: DailyClicks[]; shipMarkers: string[] }) {
  if (daily.length < 5) return null;

  const labels = daily.map((d) => d.date.slice(5));
  const shipSet = new Set(shipMarkers);
  const events: AreaEvent[] = [];
  daily.forEach((d, i) => {
    if (shipSet.has(d.date)) events.push({ index: i, tone: "success", label: `Shipped ${d.date}` });
  });

  return (
    <AreaChart
      series={[{ label: "Clicks", data: daily.map((d) => d.clicks), color: "stroke-accent-primary", fillColor: "fill-accent-primary/10" }]}
      labels={labels}
      events={events}
      height={180}
      ariaLabel={`Daily clicks for this page over the last ${daily.length} days${shipMarkers.length > 0 ? `, with ${shipMarkers.length} shipped change${shipMarkers.length === 1 ? "" : "s"} marked` : ""}.`}
    />
  );
}
