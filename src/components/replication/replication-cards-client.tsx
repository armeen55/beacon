"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SerializedReplicationCard } from "@/domains/product/replication-serialize";

export type { SerializedReplicationCard } from "@/domains/product/replication-serialize";

function tierLabel(tier: string): string {
  if (tier === "validated") return "Positive trend";
  if (tier === "qualified_partial") return "Partial signal";
  if (tier === "promising_experiment") return "Experiment running";
  return tier;
}

function evidenceLabel(confidence: string): string {
  if (confidence === "high") return "strong";
  if (confidence === "medium") return "moderate";
  return "early";
}

export function ReplicationCardsClient({
  cards,
  variant,
  respondToRecommendation,
}: {
  cards: SerializedReplicationCard[];
  variant: "today" | "changes";
  respondToRecommendation: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
    context?: { targetPageUrl?: string | null; patternId?: string | null },
  ) => Promise<{ success: boolean }>;
}) {
  const [openId, setOpenId] = useState<string | null>(() =>
    variant === "today" && cards[0] ? cards[0].id : null,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  const shown = variant === "today" ? cards.slice(0, 2) : cards;

  if (shown.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Similar patterns observed
        </h3>
        {variant === "today" && cards.length > 2 && (
          <Link
            href="/changes?tab=replicate"
            className="text-[10px] font-medium text-accent-primary hover:underline shrink-0"
          >
            All in Changes →
          </Link>
        )}
      </div>
      {msg && (
        <p className="text-[10px] font-medium text-status-success">{msg}</p>
      )}
      {shown.map((card) => {
        const open = openId === card.id;
        return (
          <div
            key={card.id}
            className="rounded-lg border border-status-success/25 bg-status-success/[0.03] overflow-hidden"
          >
            {/* ── Collapsed header: What + Where + Do ── */}
            <button
              type="button"
              onClick={() => setOpenId(open ? null : card.id)}
              className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-surface-inset/20 transition-colors"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-[12px] font-semibold text-foreground leading-snug">
                  {card.headline}
                </p>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  <span className="font-medium text-foreground/80">{card.actionVerb}</span>
                  {" · "}
                  {card.targetingSummary}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  <span className="font-medium text-foreground/90">
                    {tierLabel(card.winnerTier)}
                  </span>
                  {" · "}
                  {card.summaryLine}
                </p>
              </div>
              <span className="text-[9px] text-muted-foreground shrink-0 pt-0.5">
                {open ? "▾" : "▸"}
              </span>
            </button>

            {/* ── Expanded: targets with experiment CTA + evidence ── */}
            {open && (
              <div className="border-t border-border/40 px-3 py-2.5 space-y-3 text-[10px] text-muted-foreground">
                {/* Target list — each target is a queue row */}
                <div className="space-y-2">
                  {card.targets.map((t) => (
                    <div
                      key={t.recId}
                      className="rounded border border-border/35 bg-background/40 px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={t.pagesHref}
                          className="font-mono text-[10px] text-accent-primary hover:underline truncate"
                        >
                          {t.targetPagePath}
                        </Link>
                        <span className="text-[9px] tabular-nums shrink-0">
                          ~{t.citationOpportunity} cit
                        </span>
                      </div>
                      {t.similarityReasons.length > 0 && (
                        <p className="text-[9px] text-muted-foreground/70 mt-0.5 leading-snug">
                          {t.similarityReasons[0]}
                          {t.similarityReasons.length > 1 && ` (+${t.similarityReasons.length - 1} more)`}
                        </p>
                      )}
                      {/* Phase 4 (2026-04-19): "Try as experiment" button
                         removed. Accepting this rec just marks it accepted \u2014
                         the Z-score engine watches the URL automatically. */}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          startT(async () => {
                            await respondToRecommendation(t.recId, "accepted");
                            setMsg("Noted \u2014 we'll track the next change on this page.");
                          });
                        }}
                        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-status-success/30 bg-status-success/[0.06] px-2.5 py-1 text-[10px] font-semibold text-status-success hover:bg-status-success/[0.12] transition-colors disabled:opacity-50"
                      >
                        Apply this →
                      </button>
                    </div>
                  ))}
                </div>

                {/* Next step prose (collapsed) */}
                <div>
                  <p className="font-semibold text-foreground/85 text-[9px] uppercase tracking-wide mb-1">
                    Next step
                  </p>
                  <p className="leading-relaxed">{card.expectedNextStep}</p>
                </div>

                {/* Evidence + source link */}
                <p className="text-[9px] text-muted-foreground/80">
                  Evidence:{" "}
                  <span className="font-medium text-foreground">
                    {evidenceLabel(card.confidence)}
                  </span>
                  {card.sourceChangeId && (
                    <>
                      {" · "}
                      <Link
                        href={`/changes/${encodeURIComponent(card.sourceChangeId)}`}
                        className="text-accent-primary hover:underline font-medium"
                      >
                        Source change →
                      </Link>
                    </>
                  )}
                </p>

                {/* Observed / Inferred (compact, for advanced users) */}
                <details className="group">
                  <summary className="text-[9px] font-medium text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors">
                    Evidence details
                  </summary>
                  <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[9px]">
                    <div>
                      <p className="font-semibold text-foreground/80 uppercase mb-0.5">
                        Observed
                      </p>
                      <ul className="list-disc pl-3 space-y-0.5">
                        {card.cardObserved.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground/80 uppercase mb-0.5">
                        Inferred
                      </p>
                      <ul className="list-disc pl-3 space-y-0.5">
                        {card.cardInferred.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
