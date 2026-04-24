import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Honesty banner shown on surfaces that still read from the frozen
 * `citation_evidence_index` (built at the last Profound import).
 *
 * Background: Beacon pivoted on 2026-04-22 from Profound CSV imports to
 * native Perplexity + OpenAI polling. Native observations write to
 * `prompt_answer_observations` and `daily_metric_snapshots` (source_type='derived'),
 * but the `citation_evidence_index` feeding /pages, /competitors, /topics,
 * and /changes has NOT been rebuilt from native data yet. It's frozen at
 * the built_at of the last Profound import (~2026-04-15).
 *
 * This banner tells the operator the date cutoff plainly so the rankings
 * and per-URL counts on these surfaces read as "known Profound-era snapshot"
 * rather than "live current state". The native-integration rebuild ships
 * in a later commit of this phase.
 *
 * Commit 2 (2026-04-24) — truth-surface sweep.
 * Copy refreshed 2026-04-23 (Phase A fix-first) to describe the index as
 * a pre-pivot snapshot, not a "not yet integrated" deferred promise.
 */

export type EvidenceFreshnessBannerProps = {
  /** ISO timestamp the citation_evidence_index was built at. */
  builtAt: string | null;
  /** Surface name for the banner copy — "competitor rankings", "per-URL counts", etc. */
  label: string;
  /** Optional href for a "learn more" target. Defaults to /settings/methodology. */
  methodologyHref?: string;
  className?: string;
};

export function EvidenceFreshnessBanner({
  builtAt,
  label,
  methodologyHref = "/settings/methodology",
  className,
}: EvidenceFreshnessBannerProps) {
  if (!builtAt) {
    return (
      <div
        className={cn(
          "rounded-md border border-border/60 bg-surface-inset/30 px-4 py-2.5 text-[12px] text-muted-foreground",
          className,
        )}
        role="status"
      >
        {label} unavailable — no citation evidence has been built yet. Run an
        import or wait for the first native-poll integration.
      </div>
    );
  }

  const builtDate = new Date(builtAt);
  const ageDays = Math.floor((Date.now() - builtDate.getTime()) / 86_400_000);
  const builtLabel = builtDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const isStale = ageDays >= 3;

  return (
    <div
      className={cn(
        "rounded-md border px-4 py-2.5 text-[12px] leading-relaxed",
        isStale
          ? "border-status-warning/40 bg-status-warning/[0.05] text-foreground"
          : "border-border/60 bg-surface-inset/30 text-muted-foreground",
        className,
      )}
      role="status"
    >
      <span
        className={cn(
          "font-medium",
          isStale ? "text-status-warning" : "text-foreground",
        )}
      >
        {label} reflects the citation-evidence index built{" "}
        <span className="tabular-nums">{builtLabel}</span>
        {ageDays > 0 && <> ({ageDays}d ago)</>}
      </span>
      {" "}— a pre-pivot Profound-era snapshot. Daily native Perplexity and
      ChatGPT polls are writing richer per-observation signal, and the next
      rebuild will fold that into this index.{" "}
      <Link
        href={methodologyHref}
        className="underline underline-offset-2 hover:text-foreground"
      >
        How this works
      </Link>
      .
    </div>
  );
}
