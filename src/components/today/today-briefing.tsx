/**
 * today-briefing (P14) - the four top-of-Today briefing blocks, each rendered token-only from a
 * pure selector in this directory, each self-hiding when its selector returns null:
 *
 *   1. TodayLeadHeadlineCard  (v1 459/461) - the single lead story: biggest win this week + next move.
 *   2. TodaySmokeAlarmCard    (v1 324)     - one honest alarm naming the exact bleeding page + number.
 *   3. TodayGoalPaceCard      (v1 329/331) - the honest weekly pace read + the 20-minute ritual step.
 *   4. StillArriving          (v1 520)     - a soft "still arriving" pill shading a not-yet-final number.
 *
 * All presentation lives here (my owned src/components/today/**). page.tsx just calls the pure
 * selectors with data it already loaded and renders these, so no raw-palette class is added under
 * src/app/(shell) (the design-system ratchet). Tokens + primitives only; Beacon voice; no dashes.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ReceiptLine } from "@/components/data/receipt-line";
import type { TodayLeadHeadline } from "./today-lead-headline";
import type { TodaySmokeAlarm } from "./today-smoke-alarm";
import type { TodayGoalPace } from "./today-goal-pace";
import { stillArrivingPhrase, type StillArrivingRead } from "./today-still-arriving";

// ── 1. Lead headline (v1 459/461) ─────────────────────────────────────────────
// One card at the very top: the biggest win this week and the next move, in plain first person.
// Tone rides the win: a landed win reads on the success surface, an owned loss on the neutral
// surface (a loss is not an alarm), a next-move-only headline reads neutral. Token surfaces only.

const LEAD_SURFACE: Record<TodayLeadHeadline["tone"], string> = {
  good: "border-status-success/30 bg-status-success-bg",
  bad: "border-border bg-surface-raised",
  neutral: "border-border bg-card",
};

export function TodayLeadHeadlineCard({ headline }: { headline: TodayLeadHeadline }) {
  return (
    <Card
      variant="quiet"
      padding="md"
      aria-label="What matters most today"
      className={LEAD_SURFACE[headline.tone]}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          {headline.winClause ? (
            <p className="break-words text-body font-semibold text-foreground">{headline.winClause}</p>
          ) : null}
          {headline.nextClause ? (
            <p className="break-words text-body text-muted-foreground">{headline.nextClause}</p>
          ) : null}
        </div>
        <Link
          href={headline.href}
          className="shrink-0 text-meta font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {headline.actionLabel} &rarr;
        </Link>
      </div>
    </Card>
  );
}

// ── 2. Smoke alarm with page blame (v1 324) ───────────────────────────────────
// One honest, page-named alarm on the alert surface. Uses the Card "alert" variant + an
// "attention" Pill so it reads exactly like every other broken-state chip in the app.

export function TodaySmokeAlarmCard({ alarm }: { alarm: TodaySmokeAlarm }) {
  return (
    <Card variant="alert" padding="md" role="alert" aria-label="A page is losing clicks">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Pill intent="attention">Losing clicks</Pill>
          <p className="min-w-0 break-words text-body text-foreground">{alarm.sentence}</p>
        </div>
        <Link
          href={alarm.href}
          className="shrink-0 text-meta font-semibold text-status-danger underline underline-offset-2 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {alarm.actionLabel} &rarr;
        </Link>
      </div>
    </Card>
  );
}

// ── 3. Goal pace + start-my-day (v1 329/331) ──────────────────────────────────
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

// ── 4. Still-arriving shading (v1 520) ────────────────────────────────────────
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
