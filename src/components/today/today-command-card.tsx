/**
 * today-command-card (V1 Truth Convergence Phase 8, 2026-08-01) - THE one command block on
 * Today. It renders exactly one of the FOUR primary states from buildTodayCommand: a state chip,
 * a bold headline, the plain evidence lines, the top three ranked changes when there are any
 * (each carrying the ranker's own reason for sitting where it sits), one exact next step, and
 * ONE accent CTA.
 *
 * NEVER "ALL CLEAR". There is no chip in this file that says nothing is wrong, and the losing
 * line renders in every state, so a screen that reports pages losing clicks can never also
 * report a clean day.
 *
 * Token-only (lives outside the src/app/(shell) raw-palette ratchet, but built the same way):
 * Card + Pill primitives, the five-size type scale, status/accent tokens, light and dark safe.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import type { TodayCommand, TodayPrimaryState } from "@/domains/measurement/today/today-command";

/** Card surface per state: a blocker rides the danger surface, a ready change rides the
 *  default card, and the two waiting states ride the calm quiet surface. */
const STATE_VARIANT: Record<TodayPrimaryState, "default" | "quiet" | "alert"> = {
  needs_attention: "alert",
  act_now: "default",
  researching: "quiet",
  monitoring: "quiet",
};

/** The state chip. Its color is a STATUS token, never the accent, so the CTA stays the one
 *  accent element on the card. */
const STATE_PILL: Record<TodayPrimaryState, { intent: PillIntent; label: string }> = {
  needs_attention: { intent: "attention", label: "Needs attention" },
  act_now: { intent: "neutral", label: "Act now" },
  researching: { intent: "measuring", label: "Researching" },
  monitoring: { intent: "measuring", label: "Monitoring" },
};

export function TodayCommandCard({ command }: { command: TodayCommand }) {
  const pill = STATE_PILL[command.state];
  const isAlert = command.state === "needs_attention";
  return (
    <Card
      variant={STATE_VARIANT[command.state]}
      padding="lg"
      data-command-card="true"
      data-command-state={command.state}
      role={isAlert ? "alert" : undefined}
      aria-label={pill.label}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill intent={pill.intent}>{pill.label}</Pill>
        </div>
        {/* The one bold directive. */}
        <p className="break-words text-section font-semibold text-foreground">{command.headline}</p>
        {/* The evidence lines: plain, muted, one per line. */}
        {command.why.length > 0 ? (
          <ul className="space-y-1" data-command-why="true">
            {command.why.map((line, i) => (
              <li key={i} className="break-words text-body text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {/* WHAT IS LOSING, IN EVERY STATE. A quiet day and a bleeding page can both be true on
            one morning, and hiding the second one is how a screen reads as all clear while the
            operator is losing clicks. */}
        {command.losingNote ? (
          <p
            data-command-losing="true"
            className="break-words rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-body text-foreground"
          >
            {command.losingNote}
          </p>
        ) : null}
        {/* The ranked queue behind the headline: the next two changes, each with the ranker's
            own sentence for why it sits below the one above it. */}
        {command.ranked.length > 1 ? (
          <ol className="space-y-2 border-t border-border/60 pt-3" data-command-ranked="true">
            {command.ranked.map((r, i) => (
              <li key={r.changeId} className="space-y-0.5">
                <p className="break-words text-body text-foreground">
                  <span className="tabular-nums text-muted-foreground">{i + 1}. </span>
                  {r.recommendation}
                </p>
                {r.whyRankedAboveNext ? (
                  <p className="break-words text-meta text-muted-foreground">{r.whyRankedAboveNext}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {/* The exact action + the one accent CTA. This must render as ONE accent BUTTON (the
            only accent element above the fold), never an underlined text link. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
          <p className="min-w-0 break-words text-body text-foreground">{command.exactAction}</p>
          {command.cta ? (
            <Link
              href={command.cta.href}
              data-command-cta="true"
              className="inline-flex min-h-[34px] shrink-0 items-center justify-center rounded-md bg-accent-primary px-3.5 py-1.5 text-body font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {command.cta.label} &rarr;
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
