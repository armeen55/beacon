/**
 * today-proof-strip (Wave 3B, 2026-07-10) - THE one measuring/results status strip on Today
 * (slot 5). It consolidates the old separate "N changes measuring" strip and the cumulative
 * outcome strip into ONE compact card: the canonical measuring count, the one honest next-read
 * date, and a receipt naming how fresh the underlying Search Console data is.
 *
 * Every number comes from a canonical selector so this strip can never disagree with Results or
 * the scoreboard:
 *   - measuringCount  = countLedgerLifecycle (the same rule Results bands read)
 *   - firstReadOn     = verdictSchedule.firstReadOn (the one "when results land" date)
 *   - the date labels  = monthDayLabel (UTC), so a local timezone never drifts the day
 *
 * Token-only, light and dark safe. EmptyState for the genuinely-nothing-measuring case, never a
 * bare zero.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ReceiptLine, buildReceiptLine, monthDayLabel } from "@/components/data/receipt-line";

export type TodayProofStripProps = {
  /** Canonical count of changes still measuring (countLedgerLifecycle). */
  measuringCount: number;
  /** verdictSchedule.firstReadOn (YYYY-MM-DD, UTC), or null when nothing has a future read. */
  firstReadOn: string | null;
  /** The Search Console data-through date (YYYY-MM-DD), for the freshness receipt. */
  gscThrough: string | null;
  nowMs: number;
};

export function TodayProofStrip({ measuringCount, firstReadOn, gscThrough, nowMs }: TodayProofStripProps) {
  const nextRead = monthDayLabel(firstReadOn);
  const receipt = buildReceiptLine({
    source: "your Search Console data",
    through: gscThrough,
    nowMs,
    note: "Google reports a few days behind.",
  });

  if (measuringCount <= 0) {
    return (
      <EmptyState
        headline="Nothing is measuring yet."
        nextStep="Ship a change and I will start tracking it here."
      />
    );
  }

  return (
    <Card variant="quiet" padding="md" aria-label="What is measuring">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-words text-body text-foreground tabular-nums">
          <span className="font-semibold">{measuringCount.toLocaleString()}</span>{" "}
          change{measuringCount === 1 ? " is" : "s are"} measuring.
          {nextRead ? <span className="text-muted-foreground"> The next results land around {nextRead}.</span> : null}
        </p>
        <Link
          href="/results"
          className="shrink-0 text-meta font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          See what's measuring &rarr;
        </Link>
      </div>
      <ReceiptLine className="mt-1" line={receipt} />
    </Card>
  );
}
