/**
 * /prompts v2 — per-platform badge.
 *
 * Renders one customer-safe badge per (prompt × platform), driven
 * by the pure projection in `src/domains/prompts/v2-projection.ts`.
 * Tone classes match the rest of the v2 surfaces (today + recs +
 * changes).
 */
import { cn } from "@/lib/utils";
import type { PromptsV2PlatformBadge } from "@/domains/prompts/v2-projection";

const STATE_TONE: Record<PromptsV2PlatformBadge["state"], string> = {
  primary: "border-status-success/35 bg-status-success/[0.08] text-status-success",
  cited: "border-accent-primary/35 bg-accent-primary/[0.06] text-accent-primary",
  mentioned: "border-status-warning/35 bg-status-warning/[0.08] text-status-warning",
  absent: "border-status-danger/35 bg-status-danger/[0.08] text-status-danger",
  no_data: "border-border/60 bg-surface-inset/60 text-muted-foreground",
};

export function PromptsV2PlatformBadge({
  badge,
  className,
}: {
  badge: PromptsV2PlatformBadge;
  className?: string;
}) {
  return (
    <span
      data-prompts-v2-platform={badge.platform}
      data-prompts-v2-platform-state={badge.state}
      title={`${badge.label} · ${badge.microcopy}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STATE_TONE[badge.state],
        className,
      )}
    >
      <span className="font-semibold">{badge.label}</span>
      <span className="opacity-70">·</span>
      <span>{badge.microcopy}</span>
    </span>
  );
}
