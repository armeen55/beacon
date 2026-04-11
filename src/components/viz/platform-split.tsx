"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type PlatformEntry = {
  platform: string;
  label: string;
  value: number;
  ownedRank?: number | null;
  ownedShare?: number | null;
};

const PLATFORM_COLORS: Record<string, string> = {
  chatgpt: "bg-emerald-500",
  google_aio: "bg-blue-500",
  perplexity: "bg-violet-500",
  unknown: "bg-gray-400",
};

export function PlatformSplit({
  entries,
  title,
  showOwnedPosition = false,
}: {
  entries: PlatformEntry[];
  title?: string;
  showOwnedPosition?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = entries.reduce((s, e) => s + e.value, 0);

  return (
    <div>
      {title && <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>}

      {/* Proportional strip */}
      <div className="flex h-3 rounded-full overflow-hidden gap-px bg-border/20">
        {entries.map((entry, i) => {
          const pct = total > 0 ? (entry.value / total) * 100 : 0;
          return (
            <div
              key={entry.platform}
              className={cn(
                "transition-all duration-200 cursor-default",
                PLATFORM_COLORS[entry.platform] ?? "bg-gray-400",
                hovered === i && "brightness-125",
              )}
              style={{ width: `${Math.max(pct, 1)}%` }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {entries.map((entry, i) => {
          const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
          return (
            <div
              key={entry.platform}
              className={cn(
                "flex items-center gap-1.5 cursor-default transition-opacity",
                hovered !== null && hovered !== i && "opacity-40",
              )}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className={cn("w-2 h-2 rounded-sm shrink-0", PLATFORM_COLORS[entry.platform] ?? "bg-gray-400")} />
              <span className="text-[10px] text-muted-foreground">{entry.label}</span>
              <span className="text-[10px] tabular-nums font-semibold">{entry.value.toLocaleString()}</span>
              <span className="text-[9px] text-muted-foreground/60">{pct}%</span>
              {showOwnedPosition && entry.ownedRank !== null && entry.ownedRank !== undefined && (
                <span className="text-[9px] text-accent-primary font-medium">#{entry.ownedRank}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
