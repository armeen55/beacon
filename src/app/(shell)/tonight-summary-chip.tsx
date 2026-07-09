/**
 * TonightSummaryChip (2026-07-02, FP5a; re-homed 2026-07-09 per the operator spec B-7) -
 * the ONE summary line above the batch panel on /changes. The full panel
 * (DailyExperimentsSection) renders directly below it on THIS page now - Today no longer
 * renders it at all, so there is exactly one home and no link needed. The numbers come
 * from the FP3 lifecycle loader (the same picked/applied formula every surface uses), so
 * this chip and the panel can never disagree. Self-hides when nothing is picked.
 */
export function TonightSummaryChip({ picked, applied }: { picked: number; applied: number }) {
  if (picked <= 0) return null;
  return (
    <p
      data-tonight-summary-chip="true"
      className="rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-body text-foreground-secondary tabular-nums"
    >
      Tonight: {picked} picked, {applied} applied. The batch is below.
    </p>
  );
}
