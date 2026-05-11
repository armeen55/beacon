/**
 * /changes proof timeline — result-pill view.
 *
 * Bundle (2026-05-10) — renders ONE pill per timeline card from the
 * pure resolver in
 * `src/domains/changes/proof-timeline/result-pill.ts`. Replaces the
 * legacy three-pill row (Attribution Status + Impact Direction +
 * Verdict) with a single customer-readable signal.
 *
 * No internal vocabulary. Tone classes map to the same OKLCH palette
 * used by the rest of the v2 surfaces (today + recommendations).
 */
import { cn } from "@/lib/utils";
import type { ProofPill, ProofPillTone } from "@/domains/changes/proof-timeline/result-pill";

const PILL_TONE_CLASS: Record<ProofPillTone, string> = {
  success: "border-status-success/35 bg-status-success/[0.08] text-status-success",
  danger: "border-status-danger/35 bg-status-danger/[0.08] text-status-danger",
  warning: "border-status-warning/35 bg-status-warning/[0.08] text-status-warning",
  info: "border-accent-primary/35 bg-accent-primary/[0.06] text-accent-primary",
  muted: "border-border/60 bg-surface-inset/60 text-muted-foreground",
};

export function ChangesV2ResultPill({
  pill,
  className,
}: {
  pill: ProofPill;
  className?: string;
}) {
  return (
    <span
      data-changes-result-pill={pill.kind}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums whitespace-nowrap",
        PILL_TONE_CLASS[pill.tone],
        className,
      )}
    >
      {pill.label}
    </span>
  );
}
