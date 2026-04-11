"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BattlecardIndex, CompetitorBattlecard, DimensionComparison } from "@/domains/competitors/battlecard-types";
import { ThreatMeter } from "@/components/viz/threat-meter";

export function BattlecardSection({ index }: { index: BattlecardIndex }) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  return (
    <section>
      <details className="group/battle">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground hover:text-accent-primary transition-colors [&::-webkit-details-marker]:hidden">
          <span className="text-[9px] text-muted-foreground/50 transition-transform group-open/battle:rotate-90">▶</span>
          Competitive comparison
          {index.cards.filter((c) => c.overall_threat === "high").length > 0 && (
            <span className="text-[10px] font-medium text-status-danger ml-1">
              {index.cards.filter((c) => c.overall_threat === "high").length} high threat
            </span>
          )}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Multi-dimensional comparison against top competitors. {index.data_note}
          </p>

          {index.cards.map((card) => (
            <BattlecardRow
              key={card.competitor_domain}
              card={card}
              expanded={expandedDomain === card.competitor_domain}
              onToggle={() =>
                setExpandedDomain(
                  expandedDomain === card.competitor_domain ? null : card.competitor_domain,
                )
              }
            />
          ))}
        </div>
      </details>
    </section>
  );
}

function BattlecardRow({
  card,
  expanded,
  onToggle,
}: {
  card: CompetitorBattlecard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const threatColor =
    card.overall_threat === "high"
      ? "border-status-danger/30 bg-status-danger/[0.03]"
      : card.overall_threat === "moderate"
        ? "border-status-warning/30 bg-status-warning/[0.03]"
        : "border-border/60";

  return (
    <div className={cn("rounded-lg border overflow-hidden", threatColor)}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-inset/20 transition-colors text-left"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-foreground">
              {card.competitor_name ?? card.competitor_domain}
            </span>
            <ThreatMeter level={card.overall_threat} compact />
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{card.competitor_domain}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-[11px] font-semibold tabular-nums">{card.total_citations.toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground ml-1">citations</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 space-y-3">
          <p className="text-[11px] text-muted-foreground">{card.key_insight}</p>

          <div className="space-y-2">
            {card.dimensions.map((dim, i) => (
              <DimensionBar key={i} dim={dim} />
            ))}
          </div>

          {card.pressure_topics.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Topics where they lead</p>
              <div className="flex flex-wrap gap-1.5">
                {card.pressure_topics.map((t) => (
                  <span key={t} className="text-[10px] bg-surface-inset/50 px-1.5 py-0.5 rounded text-foreground">
                    {t.replace(/^Shield: /, "").replace(/ \(Bay Area\)$/, "")}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DimensionBar({ dim }: { dim: DimensionComparison }) {
  const ownedPct = dim.owned_value !== null && dim.competitor_value !== null && (dim.owned_value + dim.competitor_value) > 0
    ? Math.round((dim.owned_value / (dim.owned_value + dim.competitor_value)) * 100)
    : null;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground truncate">{dim.label}</span>
        <span
          className={cn(
            "text-[9px] font-semibold shrink-0",
            dim.advantage === "owned" ? "text-status-success" : dim.advantage === "competitor" ? "text-status-danger" : "text-muted-foreground",
          )}
        >
          {dim.advantage === "owned" ? "You lead" : dim.advantage === "competitor" ? "They lead" : "Even"}
        </span>
      </div>
      {ownedPct !== null && (
        <div className="flex h-1.5 rounded-full overflow-hidden">
          <div className="bg-accent-primary transition-all" style={{ width: `${ownedPct}%` }} />
          <div className="bg-status-danger/30 flex-1" />
        </div>
      )}
      <p className="text-[9px] text-muted-foreground/60 leading-snug">{dim.explanation}</p>
    </div>
  );
}
