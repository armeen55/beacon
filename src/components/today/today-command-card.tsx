/**
 * today-command-card (Wave 3B, 2026-07-10) - THE one command block on Today (slot 2 of the
 * six-slot hierarchy). It renders exactly one directive from buildTodayCommand: a bold headline,
 * a few plain evidence lines, one exact next step, and ONE accent CTA (the only accent element
 * above the fold). It subsumes and replaces the old smoke-alarm card, lead-headline card, and the
 * lead of the "What to do next" list, so two "do this" cards can never shout at once.
 *
 * Token-only (lives outside the src/app/(shell) raw-palette ratchet, but built the same way):
 * Card + Pill primitives, the five-size type scale, status/accent tokens, light and dark safe.
 * The card surface + role ride the command kind so a broken pipe or a losing page reads as an
 * alert, a move reads as a normal card, and a quiet day reads as a calm one.
 */

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Pill, type PillIntent } from "@/components/ui/pill";
import type { TodayCommand, TodayCommandKind } from "@/domains/measurement/today/today-command";

/** Card surface per kind: alerts (defect / loss) ride the danger surface, a move rides the
 *  default card, a quiet day rides the calm quiet surface. */
const KIND_VARIANT: Record<TodayCommandKind, "default" | "quiet" | "alert"> = {
  fix_defect: "alert",
  background_recovery: "quiet",
  respond_to_loss: "alert",
  ship_move: "default",
  observe: "quiet",
};

/** The small kind chip. Its color is a STATUS token, never the accent, so the CTA stays the one
 *  accent element on the card. */
const KIND_PILL: Record<TodayCommandKind, { intent: PillIntent; label: string }> = {
  fix_defect: { intent: "attention", label: "Fix this first" },
  background_recovery: { intent: "measuring", label: "Working in background" },
  respond_to_loss: { intent: "attention", label: "Losing clicks" },
  ship_move: { intent: "neutral", label: "Do this next" },
  observe: { intent: "measuring", label: "All clear" },
};

const KIND_LABEL: Record<TodayCommandKind, string> = {
  fix_defect: "Something is broken",
  background_recovery: "Background work is continuing",
  respond_to_loss: "Today's biggest problem",
  ship_move: "Today's move",
  observe: "Nothing needs a decision",
};

export function TodayCommandCard({ command }: { command: TodayCommand }) {
  const variant = KIND_VARIANT[command.kind];
  const pill = KIND_PILL[command.kind];
  const isAlert = command.kind === "fix_defect" || command.kind === "respond_to_loss";
  return (
    <Card
      variant={variant}
      padding="lg"
      data-command-card="true"
      data-command-kind={command.kind}
      role={isAlert ? "alert" : undefined}
      aria-label={KIND_LABEL[command.kind]}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill intent={pill.intent}>{pill.label}</Pill>
        </div>
        {/* The one bold directive. */}
        <p className="break-words text-section font-semibold text-foreground">{command.headline}</p>
        {/* The evidence lines (slot 3): plain, muted, one per line. */}
        {command.why.length > 0 ? (
          <ul className="space-y-1" data-command-why="true">
            {command.why.map((line, i) => (
              <li key={i} className="break-words text-body text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {/* The exact action + the one accent CTA (slot 4). P2-2 (2026-07-10, visual audit) - this
            must render as ONE accent BUTTON (the only accent element above the fold), not an
            underlined text link (the audit found "Review the page ->" rendering as plain
            underlined text, easy to miss and not read as the card's one action). */}
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
