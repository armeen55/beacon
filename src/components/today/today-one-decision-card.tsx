"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TodayOneDecision } from "@/lib/today-one-decision";

export function TodayOneDecisionCard({ d }: { d: TodayOneDecision }) {
  const border =
    d.tone === "warning"
      ? "border-2 border-status-warning/45 bg-status-warning/[0.07]"
      : d.tone === "go"
        ? "border-2 border-accent-primary/25 bg-accent-primary/[0.04]"
        : "border border-border/70 bg-surface-inset/25";

  return (
    <section
      className={cn("rounded-lg px-4 py-3.5", border)}
      aria-labelledby="today-one-decision-title"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Right now
      </p>
      <h2
        id="today-one-decision-title"
        className="mt-1 text-[15px] font-bold text-foreground leading-snug"
      >
        {d.title}
      </h2>

      <p className="mt-3 text-[11px] font-semibold text-foreground">
        Should you do this?{" "}
        <span
          className={cn(
            d.shouldAct ? "text-status-success" : "text-muted-foreground",
          )}
        >
          {d.shouldAct ? "Yes" : "No"}
        </span>
      </p>
      {d.shouldAct ? (
        <p className="mt-1 text-[12px] text-foreground/90 leading-relaxed">
          {d.why}
        </p>
      ) : null}

      {d.shouldAct && d.firstStep ? (
        <div className="mt-3 rounded-md bg-background/60 border border-border/50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            First step (under 5 minutes)
          </p>
          {d.href ? (
            <p className="mt-1 text-[12px] leading-relaxed text-foreground">
              <Link
                href={d.href}
                className="font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/90"
              >
                {d.firstStep}
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-[12px] leading-relaxed text-foreground">
              {d.firstStep}
            </p>
          )}
        </div>
      ) : null}

      {!d.shouldAct && d.whatWouldChangeThis ? (
        <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed space-y-2">
          <p>
            <span className="font-semibold text-foreground/85">Why not force it: </span>
            {d.why}
          </p>
          <p>
            <span className="font-semibold text-foreground/85">You would reopen this when: </span>
            {d.whatWouldChangeThis}
          </p>
        </div>
      ) : null}
    </section>
  );
}
