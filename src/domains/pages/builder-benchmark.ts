/**
 * Builder Benchmark + Proof Layer.
 *
 * Computes plain-English market benchmark views and proof snapshots
 * for builder marketers. No jargon. No technical SEO.
 */

import type { CitationEvidenceIndex } from "./types";
import type { PersistedIssue } from "./issues";

// ── Benchmark ──

export type MarketBenchmark = {
  benchmarkId: string;
  createdAt: string;
  /** Total citation observations processed into the evidence index (not a question count) */
  trackedCitationObservations: number;
  ownedAppearanceRate: number;
  ownedAIMentions: number;
  topCompetitors: { name: string; domain: string; rate: number; mentions: number }[];
  strongestAreas: { topic: string; rate: number; label: string }[];
  weakestAreas: { topic: string; rate: number; label: string }[];
  biggestLosses: { topic: string; competitorRate: number; ownedRate: number; gap: number; label: string }[];
};

export type BenchmarkOpts = {
  /** Tenant's directory/aggregator domains to exclude from "top competitors". */
  directoryDomains?: readonly string[];
  /** domain → display name, from the tenant's own competitor universe. */
  competitorNames?: Record<string, string>;
};

/**
 * Universal directory/aggregator/social domains excluded from "top
 * competitors" for EVERY vertical (cross-industry, not builder-specific).
 * A tenant's own configured directoryDomains override this via BenchmarkOpts.
 */
const DEFAULT_DIRECTORY_DOMAINS: readonly string[] = [
  "yelp.com", "reddit.com", "facebook.com", "instagram.com",
  "linkedin.com", "youtube.com", "wikipedia.org", "google.com",
];

/** Strip TLD + title-case a bare domain into a readable fallback label. */
export function prettifyDomain(domain: string): string {
  const base = domain.replace(/^www\./, "").replace(/\.[a-z.]+$/i, "");
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || domain;
}

export function computeMarketBenchmark(
  citationIndex: CitationEvidenceIndex,
  issues: PersistedIssue[],
  opts?: BenchmarkOpts,
): MarketBenchmark {
  const now = new Date().toISOString();

  let totalCit = 0, ownedCit = 0;
  for (const t of citationIndex.by_topic) {
    totalCit += t.total_citations;
    ownedCit += t.owned_citations;
  }
  const ownedRate = totalCit > 0 ? Math.round((ownedCit / totalCit) * 100) : 0;

  // Top competitors
  const compDomains = new Map<string, number>();
  for (const r of citationIndex.by_page_and_topic) {
    if (r.is_owned) continue;
    compDomains.set(r.domain, (compDomains.get(r.domain) ?? 0) + r.total_citations);
  }

  const directorySet = (opts?.directoryDomains ?? DEFAULT_DIRECTORY_DOMAINS).map((d) =>
    d.toLowerCase()
  );
  const isDirectory = (domain: string): boolean => {
    const d = domain.toLowerCase();
    return directorySet.some((dir) => d === dir || d.endsWith(`.${dir}`));
  };
  const names = opts?.competitorNames ?? {};

  const topComp = [...compDomains.entries()]
    .filter(([d]) => !isDirectory(d))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, mentions]) => ({
      name: names[domain] ?? names[domain.toLowerCase()] ?? prettifyDomain(domain),
      domain,
      rate: totalCit > 0 ? Math.round((mentions / totalCit) * 100) : 0,
      mentions,
    }));

  // Per topic stats
  const topicStats = citationIndex.by_topic.map((t) => {
    const ownRate = t.total_citations > 0 ? Math.round((t.owned_citations / t.total_citations) * 100) : 0;
    const compRate = t.total_citations > 0 ? Math.round((t.competitor_citations / t.total_citations) * 100) : 0;
    // Vertical-neutral topic label: drop a single-word label prefix
    // (e.g. "Shield: ") and any trailing parenthetical qualifier
    // (e.g. "(Bay Area)", "(Los Angeles)").
    const shortTopic =
      t.topic
        .replace(/^\w+:\s+/, "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .trim() || t.topic;
    return { topic: shortTopic, fullTopic: t.topic, ownRate, compRate, gap: compRate - ownRate, total: t.total_citations };
  });

  const strongest = [...topicStats].sort((a, b) => b.ownRate - a.ownRate).slice(0, 3)
    .map((t) => ({ topic: t.topic, rate: t.ownRate, label: `You hold ${t.ownRate}% of tracked mentions for ${t.topic.toLowerCase()}` }));

  const weakest = [...topicStats].sort((a, b) => a.ownRate - b.ownRate).slice(0, 3)
    .map((t) => ({ topic: t.topic, rate: t.ownRate, label: `Only ${t.ownRate}% of mentions for ${t.topic.toLowerCase()}` }));

  const losses = [...topicStats].sort((a, b) => b.gap - a.gap).slice(0, 3)
    .map((t) => ({
      topic: t.topic,
      competitorRate: t.compRate,
      ownedRate: t.ownRate,
      gap: t.gap,
      label: `Competitors hold ${t.compRate}% of mentions for ${t.topic.toLowerCase()} — you hold ${t.ownRate}%`,
    }));

  return {
    benchmarkId: `bench-${Date.now()}`,
    createdAt: now,
    trackedCitationObservations: citationIndex.total_citations_processed,
    ownedAppearanceRate: ownedRate,
    ownedAIMentions: ownedCit,
    topCompetitors: topComp,
    strongestAreas: strongest,
    weakestAreas: weakest,
    biggestLosses: losses,
  };
}

// ── Proof Snapshots ──

