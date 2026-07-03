import Link from "next/link";

/**
 * TonightSummaryChip (2026-07-02, FP5a) - the ONE line /changes shows about tonight's
 * picked changes. The full "Today's changes" panel (DailyExperimentsSection) renders
 * ONLY on Today now - it used to render verbatim on BOTH / and /changes, the exact
 * duplicate-home the FINISHED PRODUCT diagnosis flagged. The numbers come from the
 * FP3 lifecycle loader (the same picked/applied formula Today's progress bar uses),
 * so this chip and Today can never disagree. Self-hides when nothing is picked.
 */
export function TonightSummaryChip({ picked, applied }: { picked: number; applied: number }) {
  if (picked <= 0) return null;
  return (
    <p
      data-tonight-summary-chip="true"
      className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-body text-foreground-secondary tabular-nums"
    >
      <span>
        Tonight: {picked} picked, {applied} applied.
      </span>
      <Link
        href="/"
        className="shrink-0 text-body font-medium text-foreground-secondary underline underline-offset-2 hover:text-foreground"
      >
        See them on Today →
      </Link>
    </p>
  );
}
