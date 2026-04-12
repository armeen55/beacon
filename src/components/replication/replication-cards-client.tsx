"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SerializedReplicationCard } from "@/domains/product/replication-serialize";

export type { SerializedReplicationCard } from "@/domains/product/replication-serialize";

function tierLabel(tier: string): string {
  if (tier === "validated") return "Validated winner";
  if (tier === "qualified_partial") return "Partial (high-confidence)";
  if (tier === "promising_experiment") return "Promising experiment";
  return tier;
}

function tierToEvidence(
  tier: string,
): "observed" | "mixed" | "inferred" {
  if (tier === "validated") return "observed";
  if (tier === "qualified_partial") return "mixed";
  return "inferred";
}

export function ReplicationCardsClient({
  cards,
  variant,
  respondToRecommendation,
  startExperimentAction,
}: {
  cards: SerializedReplicationCard[];
  variant: "today" | "changes";
  respondToRecommendation: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
  ) => Promise<{ success: boolean }>;
  startExperimentAction: (opts: {
    recId: string;
    headline: string;
    recType: string;
    targetPageUrl: string | null;
    targetPagePath: string | null;
    watchAfter: string;
    operatorNote: string;
    baselineCitations: number | null;
    replicationSourceChangeId?: string | null;
    replicationPatternId?: string | null;
    replicationEvidenceTier?: "observed" | "mixed" | "inferred";
  }) => Promise<{ success: boolean; experimentId: string }>;
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
          Replicate winners
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
            <button
              type="button"
              onClick={() => setOpenId(open ? null : card.id)}
              className="w-full text-left px-3 py-2.5 flex items-start justify-between gap-2 hover:bg-surface-inset/20 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-foreground leading-snug">
                  {card.headline}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
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
            {open && (
              <div className="border-t border-border/40 px-3 py-2.5 space-y-3 text-[10px] text-muted-foreground">
                <div>
                  <p className="font-semibold text-foreground/85 text-[9px] uppercase tracking-wide mb-1">
                    Next step
                  </p>
                  <p className="leading-relaxed">{card.expectedNextStep}</p>
                </div>
                <div>
                  <p className="font-semibold text-foreground/85 text-[9px] uppercase tracking-wide mb-1">
                    Targets
                  </p>
                  <ul className="space-y-2">
                    {card.targets.map((t) => (
                      <li
                        key={t.recId}
                        className="rounded border border-border/35 bg-background/40 px-2 py-1.5"
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
                        <ul className="list-disc pl-3 mt-1 space-y-0.5 text-[9px]">
                          {t.similarityReasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const note = prompt(
                              "Short note: what will you ship on this URL?",
                            );
                            if (note === null) return;
                            startT(async () => {
                              await respondToRecommendation(t.recId, "accepted");
                              await startExperimentAction({
                                recId: t.recId,
                                headline: `${card.headline} → ${t.targetPagePath}`,
                                recType: t.recType,
                                targetPageUrl: t.targetPageUrl,
                                targetPagePath: t.targetPagePath,
                                watchAfter: card.watchAfter,
                                operatorNote: note,
                                baselineCitations: t.baselineCitations,
                                replicationSourceChangeId: card.sourceChangeId,
                                replicationPatternId: card.patternId,
                                replicationEvidenceTier: tierToEvidence(
                                  card.winnerTier,
                                ),
                              });
                              setMsg("Tracking replication on this target.");
                            });
                          }}
                          className={cn(
                            "mt-1.5 text-[9px] font-semibold text-status-success hover:underline disabled:opacity-50",
                          )}
                        >
                          Track this target →
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className="font-semibold text-foreground/80 text-[9px] uppercase mb-0.5">
                      Observed
                    </p>
                    <ul className="list-disc pl-3 space-y-0.5">
                      {card.cardObserved.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground/80 text-[9px] uppercase mb-0.5">
                      Inferred
                    </p>
                    <ul className="list-disc pl-3 space-y-0.5">
                      {card.cardInferred.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground/80">
                  Confidence:{" "}
                  <span className="font-medium text-foreground">{card.confidence}</span>
                  {card.sourceChangeId && (
                    <>
                      {" · "}
                      <Link
                        href={`/changes/${encodeURIComponent(card.sourceChangeId)}`}
                        className="text-accent-primary hover:underline font-medium"
                      >
                        Winner change →
                      </Link>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
