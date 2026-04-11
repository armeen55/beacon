"use client";

import { useState } from "react";
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

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          {composite !== null && (
            <>
              <span className="text-3xl font-black tabular-nums tracking-tighter">{composite}</span>
              <span className="text-xs text-muted-foreground">/100</span>
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
        {compositeStatus === "partial" && " · partial composite"}
      </p>
    </div>
  );
}
