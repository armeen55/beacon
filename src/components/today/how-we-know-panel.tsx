"use client";

import Link from "next/link";
import { BEACON_METHODOLOGY } from "@/lib/beacon-proof-copy";
import type { TodayProofContext } from "@/lib/today-proof-context";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function HowWeKnowPanel({
  context,
  variant = "today",
}: {
  context: TodayProofContext;
  variant?: "today" | "pages";
}) {
  return (
    <details className="group rounded-lg border border-border/50 bg-surface-inset/15 text-[11px]">
      <summary className="cursor-pointer list-none px-3 py-2 font-semibold text-foreground hover:bg-surface-inset/30 [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2">
        <span>{BEACON_METHODOLOGY.title}</span>
        <span className="text-muted-foreground font-normal tabular-nums shrink-0">
          {variant === "today" ? "Today" : "Pages"}
        </span>
      </summary>
      <div className="border-t border-border/40 px-3 py-3 space-y-3 text-muted-foreground leading-relaxed">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80 mb-1">Crawl vs findings</p>
          <p>{BEACON_METHODOLOGY.crawlFindings}</p>
          <ul className="mt-1.5 space-y-0.5 list-disc pl-4">
            <li>
              Latest crawl:{" "}
              {context.crawlHref ? (
                <Link href={context.crawlHref} className="text-accent-primary hover:underline font-medium">
                  {context.crawlRunId ?? "open run"}
                </Link>
              ) : (
                <span className="text-muted-foreground/80">
                  {context.crawlRunId
                    ? "observation record not on file — id is shown in Today scan findings when present."
                    : "no crawl id on file."}
                </span>
              )}
              {context.crawlCompletedAt && (
                <span className="text-muted-foreground/80"> · {fmt(context.crawlCompletedAt)}</span>
              )}
            </li>
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80 mb-1">Visibility sample</p>
          <p>{BEACON_METHODOLOGY.visibilitySample}</p>
          <p className="mt-1.5 text-[10px] text-muted-foreground/85">
            Beacon does not know real-time AI answers or full-web coverage — only what your last
            completed crawl and imports contain.
          </p>
          <ul className="mt-1.5 space-y-0.5 list-disc pl-4">
            <li>
              Rows in sample:{" "}
              <span className="font-medium text-foreground tabular-nums">{context.resultsRowCount}</span>
              {context.resultsThrough && (
                <span className="text-muted-foreground/80"> · through {context.resultsThrough}</span>
              )}
            </li>
            {context.visibilityHref && (
              <li>
                Primary visibility run:{" "}
                <Link href={context.visibilityHref} className="text-accent-primary hover:underline font-medium">
                  {context.visibilityRunId}
                </Link>
                {context.visibilityCompletedAt && (
                  <span className="text-muted-foreground/80"> · {fmt(context.visibilityCompletedAt)}</span>
                )}
              </li>
            )}
            {context.citationIndexBuiltAt && (
              <li>
                Citation index built: <span className="font-mono text-[10px]">{fmt(context.citationIndexBuiltAt)}</span>
              </li>
            )}
            {context.visibilitySynthetic && (
              <li className="text-status-warning font-medium">Synthetic visibility wrapper — sample may be pinned to demo defaults.</li>
            )}
            {context.visibilitySource && (
              <li>Source: <span className="font-medium text-foreground">{context.visibilitySource}</span></li>
            )}
          </ul>
        </div>
        {context.answerIntelligence && context.answerIntelligence.totalObservations > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80 mb-1">AI answer analysis</p>
            <p>
              Based on {context.answerIntelligence.totalObservations.toLocaleString()} AI answer observations
              across {context.answerIntelligence.topicCount} tracked topics. Covers mention rates,
              competitive co-citation, and answer-level positioning.
            </p>
            <ul className="mt-1.5 space-y-0.5 list-disc pl-4">
              <li>
                Brand mentioned in{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {Math.round(context.answerIntelligence.overallMentionRate * 100)}%
                </span>
                {" "}of tracked AI answers
              </li>
              {context.answerIntelligence.decliningTopics.length > 0 && (
                <li>
                  Declining:{" "}
                  <span className="text-foreground font-medium">
                    {context.answerIntelligence.decliningTopics.slice(0, 3).join(", ")}
                  </span>
                </li>
              )}
              {context.answerIntelligence.risingTopics.length > 0 && (
                <li>
                  Rising:{" "}
                  <span className="text-foreground font-medium">
                    {context.answerIntelligence.risingTopics.slice(0, 3).join(", ")}
                  </span>
                </li>
              )}
              <li>
                Built: <span className="font-mono text-[10px]">{fmt(context.answerIntelligence.builtAt)}</span>
              </li>
            </ul>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80 mb-1">Top move</p>
          <p>{BEACON_METHODOLOGY.recommendations}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/80 mb-1">Attribution</p>
          <p>{BEACON_METHODOLOGY.attribution}</p>
          <p className="mt-1">
            <Link href="/changes?tab=attribution" className="text-accent-primary hover:underline font-medium">
              Open Attribution →
            </Link>
          </p>
        </div>
        <div className="pt-2 border-t border-border/30">
          <Link href="/settings/methodology" className="text-accent-primary hover:underline font-medium">
            Full methodology →
          </Link>
        </div>
      </div>
    </details>
  );
}
