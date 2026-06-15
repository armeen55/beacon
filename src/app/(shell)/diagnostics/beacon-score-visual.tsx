"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ScoreRail } from "@/components/viz/score-rail";
import { RadialScore } from "@/components/viz/radial-score";
import { ViewToggle } from "@/components/viz/view-toggle";

type ScoreDim = {
  label: string;
  value: number | null;
  max: number;
  status: "sufficient" | "partial" | "insufficient";
};

export function BeaconScoreVisual({
  dimensions,
  composite,
  compositeStatus,
  sufficientCount,
  totalDimensions,
}: {
  dimensions: ScoreDim[];
  composite: number | null;
  compositeStatus: string;
  sufficientCount: number;
  totalDimensions: number;
}) {
  const [view, setView] = useState<"bars" | "radial">("bars");

  // #407 — a partial composite (some dimensions lack data) previously
  // rendered identically to a stable one, with only a 10px/60% footnote
  // hinting it. De-confidence the number itself (smaller + muted) and
  // put an explicit "(partial — only N/total dimensions)" label right
  // next to it at normal size so a skeptic can't read partial as full.
  const isPartial = compositeStatus !== "stable";

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          {composite !== null && (
            <>
              <span
                className={cn(
                  "tabular-nums tracking-tighter",
                  isPartial
                    ? "text-xl font-bold text-muted-foreground"
                    : "text-3xl font-black",
                )}
              >
                {composite}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
              {isPartial && (
                <span className="text-[12px] font-medium text-status-warning">
                  (partial — only {sufficientCount}/{totalDimensions} dimensions)
                </span>
              )}
            </>
          )}
        </div>
        <ViewToggle
          options={[{ value: "bars" as const, label: "Bars" }, { value: "radial" as const, label: "Radial" }]}
          value={view}
          onChange={setView}
          size="sm"
        />
      </div>

      {view === "bars" ? (
        <ScoreRail
          segments={dimensions.map((dim) => ({
            label: dim.label,
            value: dim.value,
            max: dim.max,
            status: dim.status,
          }))}
        />
      ) : (
        <RadialScore
          dimensions={dimensions.map((dim) => ({
            label: dim.label,
            value: dim.value,
            max: dim.max,
          }))}
          size={180}
          centerValue={composite}
          centerLabel="score"
        />
      )}

      <p className="text-[10px] text-muted-foreground/60">
        {sufficientCount}/{totalDimensions} dimensions with sufficient data
        {/* #407 — the partial state is now called out prominently next to
            the number, so this footnote no longer needs to carry it. */}
      </p>
    </div>
  );
}
