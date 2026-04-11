/**
 * Competitors View Model — transforms competitive data into chart-ready props.
 */

import type { BarChartProps, RankEntryProps, ComparisonProps } from "@/components/viz/chart-types";
import type { CoMentionMatrix } from "@/domains/competitors/co-mention-types";
import type { SourceTrustIndex } from "@/domains/competitors/source-trust-types";
import type { BattlecardIndex } from "@/domains/competitors/battlecard-types";

export function coMentionBars(matrix: CoMentionMatrix): BarChartProps {
  return {
    entries: matrix.entries.slice(0, 10).map((e) => ({
      label: e.domain,
      value: e.co_occurrence_count,
      meta: `Strength: ${Math.round(e.co_mention_strength * 100)}% · ${e.topics.slice(0, 3).join(", ")}`,
      color: e.is_in_universe ? undefined : "bg-accent-primary",
    })),
    title: "Co-mention frequency",
    subtitle: `${matrix.total_answers_analyzed} answers analyzed`,
  };
}

export function trustRankEntries(index: SourceTrustIndex, platform: string): RankEntryProps[] {
  const profile = index.platforms.find((p) => p.platform === platform);
  if (!profile) return [];

  return profile.top_sources.slice(0, 15).map((s, i) => ({
    label: s.domain,
    value: s.citation_count,
    isOwned: s.is_owned,
    badge: s.is_owned ? "you" : s.is_competitor ? "comp" : undefined,
    badgeColor: s.is_owned ? "text-status-success border-status-success/20" : s.is_competitor ? "text-status-danger border-status-danger/20" : undefined,
    meta: `${s.share_pct}% share · ${s.topics.slice(0, 3).join(", ")}`,
  }));
}

export function battlecardComparisons(index: BattlecardIndex): ComparisonProps[] {
  return index.cards.slice(0, 5).map((card) => ({
    entries: card.dimensions.map((d) => ({
      label: d.label,
      ownedValue: d.owned_value ?? 0,
      competitorValue: d.competitor_value ?? 0,
      meta: d.explanation,
    })),
    ownedLabel: "You",
    competitorLabel: card.competitor_name ?? card.competitor_domain,
  }));
}
