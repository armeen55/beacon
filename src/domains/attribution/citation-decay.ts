/**
 * Citation Decay — detects freshness decline in owned citation momentum.
 *
 * Operates on citation cold store date shards. Compares recent period
 * vs earlier period to detect decline. Does NOT forecast — only detects
 * observed trend direction from existing time-series data.
 *
 * Status values are conservative:
 * - stable: no meaningful decline detected
 * - soft_decline: modest drop, worth monitoring
 * - meaningful_decline: significant drop, likely worth acting on
 * - insufficient_history: not enough data to assess
 */

import "server-only";

import {
  getAllCitationDates,
  getCitationsForDate,
} from "@/lib/persistence/cold-store";
import type {
  CitationDecayResult,
  DecayConfig,
  DecayStatus,
} from "./decay-types";
import { DEFAULT_DECAY_CONFIG } from "./decay-types";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";
import type { CitationObservation } from "@/domains/citation-observations/types";

export type CitationDateShard = {
  date: string;
  citations: CitationObservation[];
};

/**
 * Compute citation decay for all owned pages across the full date range.
 */
export function computeCitationDecay(
  ownedDomain: string,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): CitationDecayResult[] {
  const dates = getAllCitationDates();
  return computeCitationDecayFromShards(
    dates.map((date) => ({ date, citations: getCitationsForDate(date) })),
    ownedDomain,
    config,
  );
}

/** Pure core. Cold history that ends before the native-poll regime abstains. */
export function computeCitationDecayFromShards(
  shards: CitationDateShard[],
  ownedDomain: string,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): CitationDecayResult[] {
  const ordered = [...shards].sort((a, b) => a.date.localeCompare(b.date));
  const dates = ordered.map((shard) => shard.date);
  if (dates.length < config.min_periods) return [];

  const ownedNorm = ownedDomain.replace(/^www\./, "").toLowerCase();

  // The legacy cold shards stopped being the complete source when native
  // polling launched. A pre-regime series cannot honestly claim a current
  // decline, so retain the pages but mark every read insufficient.
  if (dates[dates.length - 1]! < NATIVE_REGIME_START) {
    const counts = new Map<string, { count: number; last: string }>();
    for (const shard of ordered) {
      for (const citation of shard.citations) {
        if (!citation.is_owned) continue;
        const domain = citation.domain?.replace(/^www\./, "").toLowerCase();
        const url = (citation.url ?? "").replace(/\/+$/, "").toLowerCase();
        if (domain !== ownedNorm || !url) continue;
        const previous = counts.get(url);
        counts.set(url, {
          count: (previous?.count ?? 0) + 1,
          last: previous && previous.last > shard.date ? previous.last : shard.date,
        });
      }
    }
    return [...counts.entries()].map(([page_url, value]) => ({
      page_url,
      topic: null,
      status: "insufficient_history" as const,
      current_period_citations: 0,
      previous_period_citations: value.count,
      change_pct: null,
      periods_analyzed: dates.length,
      last_citation_date: value.last,
      explanation:
        "Historical citation shards end before native AI polling began, so they cannot support a current decay comparison.",
    }));
  }

  // Split dates into two halves: earlier vs recent
  const midpoint = Math.floor(dates.length / 2);
  const earlierDates = dates.slice(0, midpoint);
  const recentDates = dates.slice(midpoint);

  if (earlierDates.length === 0 || recentDates.length === 0) return [];

  // Count owned citations per page URL across each half
  const earlierCounts = new Map<string, number>();
  const recentCounts = new Map<string, number>();
  const lastSeen = new Map<string, string>();

  for (const date of earlierDates) {
    const citations = ordered.find((shard) => shard.date === date)?.citations ?? [];
    for (const c of citations) {
      if (!c.is_owned) continue;
      const domain = c.domain?.replace(/^www\./, "").toLowerCase();
      if (domain !== ownedNorm) continue;
      const url = (c.url ?? "").replace(/\/+$/, "").toLowerCase();
      if (!url) continue;
      earlierCounts.set(url, (earlierCounts.get(url) ?? 0) + 1);
      const existing = lastSeen.get(url);
      if (!existing || date > existing) lastSeen.set(url, date);
    }
  }

  for (const date of recentDates) {
    const citations = ordered.find((shard) => shard.date === date)?.citations ?? [];
    for (const c of citations) {
      if (!c.is_owned) continue;
      const domain = c.domain?.replace(/^www\./, "").toLowerCase();
      if (domain !== ownedNorm) continue;
      const url = (c.url ?? "").replace(/\/+$/, "").toLowerCase();
      if (!url) continue;
      recentCounts.set(url, (recentCounts.get(url) ?? 0) + 1);
      const existing = lastSeen.get(url);
      if (!existing || date > existing) lastSeen.set(url, date);
    }
  }

  // Merge all page URLs
  const allUrls = new Set([...earlierCounts.keys(), ...recentCounts.keys()]);
  const results: CitationDecayResult[] = [];

  for (const url of allUrls) {
    const earlier = earlierCounts.get(url) ?? 0;
    const recent = recentCounts.get(url) ?? 0;
    const total = earlier + recent;

    if (total < config.min_citations) {
      results.push({
        page_url: url,
        topic: null,
        status: "insufficient_history",
        current_period_citations: recent,
        previous_period_citations: earlier,
        change_pct: null,
        periods_analyzed: dates.length,
        last_citation_date: lastSeen.get(url) ?? null,
        explanation: `Only ${total} citation${total !== 1 ? "s" : ""} observed — not enough history to assess trend.`,
      });
      continue;
    }

    let status: DecayStatus;
    let changePct: number | null = null;
    let explanation: string;

    if (earlier === 0) {
      // New — only recent citations
      status = "stable";
      explanation = `${recent} citation${recent !== 1 ? "s" : ""} observed in recent period only — new or recently cited.`;
    } else {
      changePct = (recent - earlier) / earlier;

      if (changePct <= config.meaningful_decline_threshold) {
        status = "meaningful_decline";
        explanation = `Citations dropped ${Math.abs(Math.round(changePct * 100))}% from ${earlier} to ${recent}. This page may be losing freshness or relevance in AI answers.`;
      } else if (changePct <= config.soft_decline_threshold) {
        status = "soft_decline";
        explanation = `Citations declined ${Math.abs(Math.round(changePct * 100))}% from ${earlier} to ${recent}. Worth monitoring.`;
      } else {
        status = "stable";
        explanation = recent >= earlier
          ? `Citations ${recent > earlier ? "grew" : "held steady"} from ${earlier} to ${recent}.`
          : `Minor variation (${Math.round(changePct * 100)}%) — within normal range.`;
      }
    }

    results.push({
      page_url: url,
      topic: null,
      status,
      current_period_citations: recent,
      previous_period_citations: earlier,
      change_pct: changePct,
      periods_analyzed: dates.length,
      last_citation_date: lastSeen.get(url) ?? null,
      explanation,
    });
  }

  return results.sort((a, b) => {
    const statusOrder: Record<DecayStatus, number> = {
      meaningful_decline: 0,
      soft_decline: 1,
      stable: 2,
      insufficient_history: 3,
    };
    return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
  });
}

/**
 * Get only pages with active decay signals (soft or meaningful decline).
 */
export function getDecayAlerts(
  results: CitationDecayResult[],
): CitationDecayResult[] {
  return results.filter(
    (r) => r.status === "meaningful_decline" || r.status === "soft_decline",
  );
}

/**
 * Summary of decay analysis across all pages.
 */
export function summarizeDecay(results: CitationDecayResult[]): {
  total_analyzed: number;
  meaningful_decline: number;
  soft_decline: number;
  stable: number;
  insufficient: number;
  worst_decline_url: string | null;
  worst_decline_pct: number | null;
} {
  let meaningful = 0;
  let soft = 0;
  let stable = 0;
  let insufficient = 0;
  let worstUrl: string | null = null;
  let worstPct: number | null = null;

  for (const r of results) {
    switch (r.status) {
      case "meaningful_decline":
        meaningful++;
        break;
      case "soft_decline":
        soft++;
        break;
      case "stable":
        stable++;
        break;
      case "insufficient_history":
        insufficient++;
        break;
    }
    if (r.change_pct !== null && (worstPct === null || r.change_pct < worstPct)) {
      worstPct = r.change_pct;
      worstUrl = r.page_url;
    }
  }

  return {
    total_analyzed: results.length,
    meaningful_decline: meaningful,
    soft_decline: soft,
    stable,
    insufficient,
    worst_decline_url: worstUrl,
    worst_decline_pct: worstPct,
  };
}
