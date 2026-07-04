/**
 * TodayWhileAwayCard (P21, v1 238) - the one honest "while you were away" block, rendered
 * token-only from the pure buildWhileAwaySummary selector, self-hiding when the selector
 * returns null (first visit, a refresh rather than time away, or nothing changed).
 *
 * It celebrates a win in one sentence and links to where the operator acts next: Results
 * when something finished measuring, else the worklist when only new opportunities
 * appeared. The receipt line names the source and when it was counted, the shared
 * ReceiptLine convention. Tokens + primitives only (design-system ratchet); Beacon voice;
 * no em or en dashes.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ReceiptLine } from "@/components/data/receipt-line";
import type { WhileAwaySummary } from "./today-while-away";

export function TodayWhileAwayCard({
  summary,
  checkedLine,
}: {
  summary: WhileAwaySummary;
  checkedLine?: string | null;
}) {
  // A win to celebrate reads on the success surface; a return with only new work to do
  // reads neutral. A settled-but-none-won return is not an alarm, so it stays neutral too.
  const celebrated = summary.wonCount > 0;
  const surface = celebrated
    ? "border-status-success/30 bg-status-success-bg"
    : "border-border bg-card";
  // The action points where the news lives: Results when something settled, else the
  // worklist where new opportunities queue up.
  const href = summary.finishedMeasuring > 0 ? "/results" : "/worklist";
  const actionLabel = summary.finishedMeasuring > 0 ? "See the results" : "See what is new";

  return (
    <Card
      variant="quiet"
      padding="md"
      aria-label="A summary of what changed while you were away"
      className={surface}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Pill intent={celebrated ? "won" : "neutral"}>While you were away</Pill>
          <p className="min-w-0 break-words text-body text-foreground">{summary.sentence}</p>
        </div>
        <Link
          href={href}
          className="shrink-0 text-meta font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {actionLabel} &rarr;
        </Link>
      </div>
      <ReceiptLine line={checkedLine ?? null} className="mt-1.5" />
    </Card>
  );
}
