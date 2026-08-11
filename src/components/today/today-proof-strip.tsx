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

type TodayProofStripProps = {
  /** Canonical count of changes still measuring (countLedgerLifecycle). */
  measuringCount: number;
  /** verdictSchedule.firstReadOn (YYYY-MM-DD, UTC), or null when nothing has a future read. */
  firstReadOn: string | null;
  /** P2-1 (2026-07-10, visual audit) - verdictSchedule.finalVerdictOn: the soonest date a
   *  measuring change's 28-day window closes to a settled read. Named alongside firstReadOn
   *  so this strip and the Results cumulative-outcome strip's "Next checkpoint" clause read
   *  as two stages of the SAME schedule, never two unrelated dates on separate surfaces. Null
   *  when no measuring row has a future close, or when it lands the same day as firstReadOn
   *  (nothing to add). */
  firstSettledReadOn?: string | null;
  /** The Search Console data-through date (YYYY-MM-DD), for the freshness receipt. */
  gscThrough: string | null;
  /** FINISHED READINGS ON FILE (countLedgerLifecycle.decided): changes whose measurement is over. Nothing mid-measurement with twenty five settled readings is a NORMAL state, and this strip called it a cold start and told the operator to ship their first change over the top of twenty five of them. Zero here AND zero measuring is the genuine cold start, and only then is that instruction true. */
  decidedCount?: number;
  nowMs: number;
};

export function TodayProofStrip({ measuringCount, firstReadOn, firstSettledReadOn = null, gscThrough, decidedCount = 0, nowMs }: TodayProofStripProps) {
  const nextRead = monthDayLabel(firstReadOn);
  // P2-1 - only named when it is a real, later date than the checkpoint (no redundant repeat).
  const settledRead =
    firstSettledReadOn && firstSettledReadOn !== firstReadOn ? monthDayLabel(firstSettledReadOn) : null;
  const receipt = buildReceiptLine({
    source: "your Search Console data",
    through: gscThrough,
    nowMs,
    note: "Google reports a few days behind.",
  });

  // The genuine cold start, and ONLY it: nothing in flight AND nothing ever settled.
  if (measuringCount <= 0 && decidedCount <= 0) return <EmptyState headline="Nothing is measuring yet." nextStep="Make a change and tracking for it starts here." />;
  // ZERO IN FLIGHT IS NOT ZERO EVIDENCE. Nothing measuring with readings already settled is a healthy state, so it gets its own sentence and its own way into Results, never the cold-start instruction printed over finished work.
  const inFlight = measuringCount > 0;
  return (
    <Card variant="quiet" padding="md" aria-label="What is measuring">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-words text-body text-foreground tabular-nums">
          {inFlight ? (
            <>
              <span className="font-semibold">{measuringCount.toLocaleString()}</span>{" "}
              change{measuringCount === 1 ? " is" : "s are"} measuring.
              {nextRead ? <span className="text-muted-foreground"> The next results land around {nextRead}.</span> : null}
              {settledRead ? <span className="text-muted-foreground"> The first settled read lands around {settledRead}.</span> : null}
            </>
          ) : (
            <>
              Nothing is mid-measurement right now. <span className="font-semibold">{decidedCount.toLocaleString()}</span>
              {decidedCount === 1 ? " finished reading is" : " finished readings are"} on Results.
            </>)}
        </p>
        <Link
          href="/results"
          className="shrink-0 text-meta font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {inFlight ? "See what's measuring" : "See what was learned"} &rarr;
        </Link>
      </div>
      <ReceiptLine className="mt-1" line={receipt} />
    </Card>
  );
}
