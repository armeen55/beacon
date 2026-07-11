/**
 * today-briefing (P14) - the supporting Today briefing blocks that live behind the ONE
 * "More on today" drill-down (slot 6), each rendered token-only from a pure selector in this
 * directory, each self-hiding when its selector returns null:
 *
 *   1. TodayGoalPaceCard  (v1 329/331) - the honest weekly pace read + the 20-minute ritual step.
 *   2. StillArriving      (v1 520)     - a soft "still arriving" pill shading a not-yet-final number.
 *
 * Wave 3B (2026-07-10): the old lead-headline card and smoke-alarm card that used to live here
 * were KILLED. Both are now subsumed by the ONE Today command (src/components/today/
 * today-command-card.tsx), so Today never stacks two competing "what matters most" cards.
 *
 * All presentation lives here (my owned src/components/today/**). page.tsx just calls the pure
 * selectors with data it already loaded and renders these, so no raw-palette class is added under
 * src/app/(shell) (the design-system ratchet). Tokens + primitives only; Beacon voice; no dashes.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ReceiptLine } from "@/components/data/receipt-line";
import type { TodayGoalPace } from "./today-goal-pace";
import { stillArrivingPhrase, type StillArrivingRead } from "./today-still-arriving";

// ── 1. Goal pace + start-my-day (v1 329/331) ──────────────────────────────────
// The honest weekly pace read, a subtle progress bar (token surfaces), and the 20-minute ritual
// step with its one action link. checkedLine is the shared receipt convention.

export function TodayGoalPaceCard({
  pace,
  checkedLine,
}: {
  pace: TodayGoalPace;
  checkedLine?: string | null;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, pace.progress)) * 100);
  return (
    <Card variant="quiet" padding="md" aria-label="Your weekly pace and start-my-day step">
      <div className="space-y-2">
        <p className="text-body font-medium text-foreground">
          {pace.paceClause}
          {pace.onTrack ? <span className="ml-2 align-middle"><Pill intent="won">On track</Pill></span> : null}
        </p>
        {pace.progress > 0 ? (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Weekly goal progress"
          >
            <div className="h-full rounded-full bg-status-success" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 break-words text-body text-muted-foreground">{pace.ritualClause}</p>
          <Link
            href={pace.href}
            className="shrink-0 text-meta font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {pace.actionLabel} &rarr;
          </Link>
        </div>
        <ReceiptLine line={checkedLine ?? null} />
      </div>
    </Card>
  );
}

// ── 2. Still-arriving shading (v1 520) ────────────────────────────────────────
// A soft "still arriving" pill that shades a not-yet-final number. Renders nothing when the
// number is final (so a caller can drop it inline next to the number and it disappears once the
// window closes). measuring intent = the soft blue "collecting results" treatment, never red/green.

export function StillArriving({ read }: { read: StillArrivingRead }) {
  if (read.final) return null;
  return (
    <Pill intent="measuring" title="This number is not final yet.">
      {stillArrivingPhrase(read)}
    </Pill>
  );
}
