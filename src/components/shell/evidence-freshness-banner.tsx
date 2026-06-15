import Link from "next/link";
import { cn } from "@/lib/utils";
import { EVIDENCE_FRESHNESS_NULL_COPY } from "@/domains/attribution/lifecycle-attribution-copy";

/**
 * Freshness banner for surfaces that read from `citation_evidence_index`
 * (the per-page citation rollup feeding /pages, /competitors, /topics, /changes).
 *
 * Behavior depends on the index's `built_at`:
 *   - Fresh (< 36 hours old): green "Live native data — last rebuilt {date}"
 *   - Stale (≥ 36 hours): amber warning showing the cutoff date so the
 *     operator knows rankings are not current
 *   - Missing (null): muted explanation that the rebuild hasn't run yet
 *
 * Phase v4 Commit 7B (2026-04-30) — the index now rebuilds nightly from
 * native Perplexity + ChatGPT polling via the daily-native-poll workflow.
 * Stale states should only appear after a cron failure.
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
        {/* Phase 6A.6 (2026-04-28) — pre-rename copy was "no citation
            evidence has been built yet — Run an import or wait for the
            first native-poll integration", which gaslighted operators
            after the 2026-04-22 native-poll pivot (native polling DID
            launch). New copy stays honest about the actual gap: the
            index hasn't been rebuilt against native data yet, but
            native polling itself is alive and writing observations. */}
        {EVIDENCE_FRESHNESS_NULL_COPY.label(label)}{" "}
        {EVIDENCE_FRESHNESS_NULL_COPY.detail}
      </div>
    );
  }

  const builtDate = new Date(builtAt);
  const ageHours = Math.floor((Date.now() - builtDate.getTime()) / 3_600_000);
  const ageDays = Math.floor(ageHours / 24);
  const builtLabel = builtDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  // Phase v4 Commit 7B (2026-04-30): the index rebuilds nightly via the
  // daily-native-poll workflow. Anything < 36h old reflects current native
  // polling data and should read green; older means a cron failure or
  // missed run, surface in amber.
  const isFresh = ageHours < 36;
  const isStale = ageDays >= 3;

  if (isFresh) {
    return (
      <div
        className={cn(
          "rounded-md border border-status-success/35 bg-status-success/[0.04] px-4 py-2.5 text-[12px] leading-relaxed text-foreground",
          className,
        )}
        role="status"
      >
        <span className="font-medium text-status-success">
          {label} reflect live native data
        </span>{" "}
        — last rebuilt{" "}
        <span className="tabular-nums">{builtLabel}</span>
        {ageHours > 0 && <> ({ageHours}h ago)</>}
        . Daily native Perplexity and ChatGPT polls feed this directly.{" "}
        <Link
          href={methodologyHref}
          prefetch={false}
          className="underline underline-offset-2 hover:text-status-success"
        >
          How this works
        </Link>
        .
      </div>
    );
  }

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
        {/* All callers pass a PLURAL label ("Change verdicts", "Topic
            rankings", "Competitor rankings"), so the verb is plural "reflect"
            — a future singular-label caller would need to revisit this. */}
        {label} reflect the citation-evidence index built{" "}
        <span className="tabular-nums">{builtLabel}</span>
        {ageDays > 0 && <> ({ageDays}d ago)</>}
      </span>
      {" "}— an older snapshot. Refresh your connected data to rebuild it.{" "}
      <Link
        href={methodologyHref}
        prefetch={false}
        className="underline underline-offset-2 hover:text-foreground"
      >
        How this works
      </Link>
      .
    </div>
  );
}
