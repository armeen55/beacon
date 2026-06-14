/**
 * Builder Benchmark + Proof Layer.
 *
 * Computes plain-English market benchmark views and proof snapshots
 * for builder marketers. No jargon. No technical SEO.
 */

import { absoluteUrlForPath } from "@/lib/site-config";
import type { CitationEvidenceIndex } from "./types";
import type { PersistedIssue } from "./issues";
import type { ScorecardRow } from "@/domains/attribution/scorecard";

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
  topNextMoves: { label: string; href: string }[];
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
function prettifyDomain(domain: string): string {
  const base = domain.replace(/^www\./, "").replace(/\.[a-z.]+$/i, "");
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || domain;
}

/**
 * Resolve benchmark display options from the CURRENT tenant: its configured
 * directory domains + its competitor-universe display names. Fail-soft to the
 * universal defaults so a no-config tenant still gets sensible output.
 * (Dynamic imports keep the pure compute module free of server-only deps.)
 */
export async function getCurrentTenantBenchmarkOpts(): Promise<BenchmarkOpts> {
  try {
    const [{ getBusinessConfigForCurrentTenant }, { loadCompetitorUniverseRuntime }] =
      await Promise.all([
        import("@/lib/business-config"),
        import("@/domains/competitors/universe-read"),
      ]);
    const [cfg, universe] = await Promise.all([
      getBusinessConfigForCurrentTenant(),
      loadCompetitorUniverseRuntime(),
    ]);
    return {
      directoryDomains: cfg.directoryDomains?.length ? cfg.directoryDomains : undefined,
      competitorNames: universe.domainToLabel ?? {},
    };
  } catch {
    return {};
  }
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

  // Next moves from issues
  const openIssues = issues.filter((i) => i.status === "new" || i.status === "handed_off");
  const nextMoves: MarketBenchmark["topNextMoves"] = [];
  if (openIssues.length > 0) {
    nextMoves.push({ label: `Fix ${openIssues.length} page${openIssues.length !== 1 ? "s" : ""} that need attention`, href: "/pages" });
  }
  if (weakest.length > 0) {
    nextMoves.push({ label: `Add stronger content for ${weakest[0].topic.toLowerCase()} searches`, href: "/competitors#opportunities" });
  }
  if (losses.length > 1) {
    nextMoves.push({ label: `Create or improve your ${losses[1].topic.toLowerCase()} page`, href: "/competitors#opportunities" });
  }
  if (nextMoves.length === 0) {
    nextMoves.push({ label: "Review your website pages", href: "/pages" });
  }

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
    topNextMoves: nextMoves,
  };
}

// ── Proof Snapshots ──

export type ProofLabel = "improved" | "likely_improving" | "too_early" | "no_clear_movement";

export type ProofSnapshot = {
  proofSnapshotId: string;
  createdAt: string;
  pagePath: string;
  changeSummary: string;
  beforeAIMentions: number | null;
  afterAIMentions: number | null;
  proofLabel: ProofLabel;
  explanation: string;
};

export function computeProofSnapshots(
  scorecardRows: ScorecardRow[],
  citationsByUrl: Map<string, number>
): ProofSnapshot[] {
  const proofs: ProofSnapshot[] = [];
  const now = new Date().toISOString();

  const validated = scorecardRows
    .filter((r) => r.verdict === "validated" || r.verdict === "partial")
    .sort((a, b) => (b.topScore ?? 0) - (a.topScore ?? 0))
    .slice(0, 5);

  for (const row of validated) {
    const path = row.change.url?.replace(/^\/+/, "/") ?? "";
    const normUrl = row.change.url
      ? absoluteUrlForPath(path.startsWith("/") ? path : `/${path}`).toLowerCase()
      : "";
    const citations = normUrl ? (citationsByUrl.get(normUrl) ?? 0) : 0;
    const daysSince = row.daysSinceChange;

    let proofLabel: ProofLabel;
    let explanation: string;

    if (row.verdict === "validated" && row.operatorConfirmedCount > 0) {
      proofLabel = "improved";
      explanation = `You locked a cause in Review for a related visibility shift. ${citations > 0 ? `This URL has ${citations} tracked mentions in our citation sample.` : "Mention counts in the sample are available on the change detail."} Not proof of leads or revenue.`;
    } else if (row.verdict === "validated") {
      proofLabel = "likely_improving";
      explanation = `Model suggests this change may be helping. ${citations > 0 ? `Current sample: ${citations} mentions tied to this page.` : ""}`;
    } else if (daysSince < 14) {
      proofLabel = "too_early";
      explanation = `Changed ${daysSince} day${daysSince !== 1 ? "s" : ""} ago — too early to see clear results yet.`;
    } else {
      proofLabel = "no_clear_movement";
      explanation = `No clear improvement detected yet after ${daysSince} days.`;
    }

    const changeName = row.change.asset_name
      .replace(/FAQ/g, "Q&A")
      .replace(/schema/g, "page details");

    proofs.push({
      proofSnapshotId: `proof-${row.change.id}`,
      createdAt: now,
      pagePath: path || row.change.asset_name,
      changeSummary: changeName,
      beforeAIMentions: null,
      afterAIMentions: citations > 0 ? citations : null,
      proofLabel,
      explanation,
    });
  }

  return proofs;
}

// ── Labels ──

export const PROOF_LABELS: Record<ProofLabel, { label: string; color: string }> = {
  improved: { label: "Review locked cause", color: "text-status-success" },
  likely_improving: { label: "Model suggests lift", color: "text-accent-primary" },
  too_early: { label: "Too early to judge", color: "text-muted-foreground" },
  no_clear_movement: { label: "No clear change in mentions", color: "text-status-warning" },
};
