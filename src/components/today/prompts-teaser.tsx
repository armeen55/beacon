"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CategoryGroupSummary } from "@/domains/prompts/decision-matrix";

/**
 * Small Today card that points into /prompts. Per operator guardrail for
 * Phase v5 Commit 5: "small, not a mini dashboard."
 *
 * Shows one-line per-category counts (color-coded), a tight summary
 * sentence, and a single CTA link.
 */

export type PromptsTeaserSummary = {
  totalPrompts: number;
  groupSummaries: CategoryGroupSummary[];
};

export function PromptsTeaser({
  summary,
  className,
}: {
  summary: PromptsTeaserSummary | null;
  className?: string;
}) {
  if (!summary || summary.totalPrompts === 0) return null;

  const get = (cat: string) =>
    summary.groupSummaries.find((g) => g.category === cat)?.count ?? 0;
  const outranked = get("outranked");
  const absent = get("absent");
  const close = get("close");
  const winning = get("winning");
  const early = get("early");

  // Summary sentence — always leads with the strongest signal for the day.
  const sentence = buildSummarySentence({
    outranked,
    absent,
    close,
    winning,
    early,
    total: summary.totalPrompts,
  });

  return (
    <Link
      href="/prompts"
      className={cn(
        "block rounded-lg border border-border/60 bg-surface-raised/30 px-4 py-3 hover:border-accent-primary/40 transition-colors",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
          Prompts
        </p>
        <span className="text-[11px] text-accent-primary hover:underline">
          View →
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-foreground leading-relaxed">
        {sentence}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
        {outranked > 0 && (
          <li className="text-status-danger">
            <span className="font-semibold">{outranked}</span> outranked
          </li>
        )}
        {absent > 0 && (
          <li className="text-status-warning">
            <span className="font-semibold">{absent}</span> absent
          </li>
        )}
        {close > 0 && (
          <li className="text-status-warning/85">
            <span className="font-semibold">{close}</span> close
          </li>
        )}
        {winning > 0 && (
          <li className="text-status-success">
            <span className="font-semibold">{winning}</span> winning
          </li>
        )}
        {early > 0 && (
          <li className="text-muted-foreground">
            <span className="font-semibold">{early}</span> early
          </li>
        )}
      </ul>
    </Link>
  );
}

export function buildSummarySentence(args: {
  outranked: number;
  absent: number;
  close: number;
  winning: number;
  early: number;
  total: number;
}): string {
  const { outranked, absent, close, winning, early, total } = args;
  const weak = outranked + absent;
  if (total === 0) return "No prompts tracked yet.";
  if (winning > 0 && weak === 0) {
    return `Winning on ${winning} of ${total} tracked prompts.`;
  }
  if (weak > 0 && winning > 0) {
    return `Winning ${winning}, ${weak === 1 ? "weak on 1 prompt" : `weak on ${weak}`}${close > 0 ? ` · ${close} close to breaking through` : ""}.`;
  }
  if (weak > 0) {
    return `Weak on ${weak} of ${total} tracked prompts${close > 0 ? ` · ${close} close to breaking through` : ""}.`;
  }
  if (early === total) {
    return `Too early to judge. The next AI reading will add data.`;
  }
  return `${winning} winning, ${close} close, ${absent} absent, ${outranked} outranked.`;
}
