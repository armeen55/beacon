import { cn } from "@/lib/utils";
import { SCORE_LABEL_DISPLAY } from "@/lib/constants";
import type { ScoreLabel } from "@/lib/constants";

type ScoreRingProps = {
  score: number;
  label: ScoreLabel;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeMap = {
  sm: { ring: 36, stroke: 3, text: "text-[11px]", sub: "text-[8px]" },
  md: { ring: 56, stroke: 4, text: "text-[16px]", sub: "text-[10px]" },
  lg: { ring: 80, stroke: 5, text: "text-[22px]", sub: "text-[11px]" },
} as const;

const colorMap: Record<ScoreLabel, string> = {
  act_now: "stroke-status-danger",
  strong: "stroke-status-success",
  moderate: "stroke-status-warning",
  low: "stroke-status-neutral",
  deferred: "stroke-muted-foreground",
};

const textColorMap: Record<ScoreLabel, string> = {
  act_now: "text-status-danger",
  strong: "text-status-success",
  moderate: "text-status-warning",
  low: "text-muted-foreground",
  deferred: "text-muted-foreground",
};

export function ScoreRing({ score, label, size = "md", className }: ScoreRingProps) {
  const cfg = sizeMap[size];
  const radius = (cfg.ring - cfg.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: cfg.ring, height: cfg.ring }}>
        <svg width={cfg.ring} height={cfg.ring} className="-rotate-90">
          <circle
            cx={cfg.ring / 2}
            cy={cfg.ring / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={cfg.stroke}
            className="text-border"
          />
          <circle
            cx={cfg.ring / 2}
            cy={cfg.ring / 2}
            r={radius}
            fill="none"
            strokeWidth={cfg.stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={colorMap[label]}
          />
        </svg>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center font-semibold tabular-nums",
            cfg.text,
            textColorMap[label]
          )}
        >
          {score}
        </span>
      </div>
      {size !== "sm" && (
        <span className={cn("font-medium", cfg.sub, textColorMap[label])}>
          {SCORE_LABEL_DISPLAY[label]}
        </span>
      )}
    </div>
  );
}
