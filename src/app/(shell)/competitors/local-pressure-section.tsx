"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ComparisonBar } from "@/components/viz/comparison-bar";
import { ViewToggle } from "@/components/viz/view-toggle";
import type { CityCoverage } from "@/domains/geo/types";

export function LocalPressureSection({ cities }: { cities: CityCoverage[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");

  if (cities.length === 0) return null;

  const comparisonEntries = cities.map((c) => ({
    label: c.city.charAt(0).toUpperCase() + c.city.slice(1),
    ownedValue: c.owned_pages,
    competitorValue: c.competitor_pages,
    meta: c.coverage_status === "absent" ? "No presence in this market" : "Weak presence — competitors dominate",
  }));

  return (
    <section>
      <details className="group/geo">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground hover:text-accent-primary transition-colors [&::-webkit-details-marker]:hidden">
          <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/geo:rotate-90">▶</span>
          Local competitive pressure
          <span className="text-[10px] font-medium text-status-warning ml-1">
            {cities.length} gap{cities.length !== 1 ? "s" : ""}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed flex-1">
              Local markets where competitors have meaningful page presence but your owned visibility is limited or absent.
            </p>
            <ViewToggle
              options={[{ value: "chart" as const, label: "Chart" }, { value: "table" as const, label: "Table" }]}
              value={view}
              onChange={setView}
              size="sm"
            />
          </div>

          {view === "chart" ? (
            <div className="rounded-lg border border-border/60 p-4">
              <ComparisonBar
                entries={comparisonEntries}
                title="Your pages vs competitor pages"
                ownedLabel="Your pages"
                competitorLabel="Competitor pages"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-surface-inset/50 text-[10px] font-medium text-muted-foreground border-b border-border/60">
                <span>Market</span>
                <span className="text-right">Comp. pages</span>
                <span className="text-right">Your pages</span>
                <span className="text-right">Status</span>
              </div>
              {cities.map((c) => (
                <div
                  key={c.city}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 border-b border-border/40 last:border-b-0"
                >
                  <span className="text-[12px] font-medium capitalize">{c.city}</span>
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {c.competitor_pages}
                  </span>
                  <span className="text-right text-[11px] tabular-nums font-medium">
                    {c.owned_pages}
                  </span>
                  <span
                    className={cn(
                      "text-right text-[10px] font-medium",
                      c.coverage_status === "absent"
                        ? "text-status-danger"
                        : "text-status-warning",
                    )}
                  >
                    {c.coverage_status === "absent" ? "No presence" : "Weak"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/60">
            Based on page registry data. Not all competitor pages represent active competitive threat — review before acting.
          </p>
        </div>
      </details>
    </section>
  );
}
