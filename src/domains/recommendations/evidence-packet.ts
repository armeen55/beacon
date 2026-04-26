/**
 * Evidence packet builder for the GPT-5-mini adjudicator
 * (Phase v7 Commit 3, 2026-04-23).
 *
 * Takes a resolved recommendation candidate + source data and produces
 * a compact JSON packet the LLM can reason over. Packet size is bounded
 * per-field so token cost stays predictable.
 *
 * Design constraints:
 *   - Pure. No I/O.
 *   - Deterministic. Same inputs → same packet bytes → same cache hash.
 *   - Packet includes only what the adjudicator needs to decide the
 *     action. No speculation, no derived metrics.
 *   - `allowedTargetUrls` is the enum the LLM's JSON schema will pin
 *     targetUrl to. Built from: owned URLs cited in cluster observations,
 *     top inventory matches for the cluster label, and the sentinel
 *     "needs_new_page". Never the whole site (noise + hallucination
 *     risk).
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import { NATIVE_REGIME_START } from "@/domains/product/url-citation-history";
import type { ResolvedRecommendationCandidate } from "./resolved-types";
import { NEEDS_NEW_PAGE } from "./resolved-types";
import { canonicalizeUrl } from "./resolve-page-intent";
import {
  matchClusterToInventory,
  type PageInventoryEntry,
} from "./page-inventory";

// ---------------------------------------------------------------------------
// Types — serializable, stable shape (cache hash depends on this).
// ---------------------------------------------------------------------------

export type EvidencePacketPromptBlock = {
  prompt_id: string;
  text: string;
  category: string;
  classifierReasoning: string;
  observationCount: number;
  ritzState: "primary" | "cited" | "absent";
  ritzPrimaryShare: number;
  topPrimaryCompetitor: { name: string; share: number } | null;
  fragmented: boolean;
  ownedUrlsCited: Array<{
    url: string;
    citationCount: number;
    avgRank: number | null;
  }>;
  competitorDomainsCited: string[];
  dominantAnswerStructure: { structure: string; share: number } | null;
  descriptorsNearBrand: string[];
};

export type EvidencePacketInventoryBlock = {
  url: string;
  title: string | null;
  h1: string | null;
  h2s: string[];
  metaDescription: string | null;
  routeType: string;
  detectedGeo: string | null;
  detectedService: string | null;
  labelMatchScore: number;
  labelMatchReasons: string[];
};

export type EvidencePacketAnswerExcerpt = {
  prompt_id: string;
  platform: string;
  observed_at: string;
  excerpt: string;
  citation_urls: string[];
};

export type EvidencePacket = {
  schemaVersion: "v1";
  generatedAt: string;
  tenantId: string;
  candidate: {
    stableKey: string;
    deterministicAction: string;
    deterministicTargetUrl: string;
    deterministicReasoning: string;
    deterministicConfidence: string;
    deterministicTier: string;
    cluster: {
      kind: string | null;
      label: string | null;
    };
    affectedPromptCount: number;
    title: string;
    description: string;
  };
  affectedPrompts: EvidencePacketPromptBlock[];
  siteInventory: {
    pages: EvidencePacketInventoryBlock[];
    source: "page_snapshots";
  };
  sampleAnswerExcerpts: EvidencePacketAnswerExcerpt[];
  allowedTargetUrls: string[];
  allowedActions: ReadonlyArray<string>;
  allowedMotives: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Caps — bound token cost per packet.
// ---------------------------------------------------------------------------

const MAX_AFFECTED_PROMPTS = 8;
const MAX_INVENTORY_PAGES = 10;
const MAX_SAMPLE_EXCERPTS = 6;
const MAX_EXCERPT_CHARS = 480;
const MAX_DESCRIPTORS = 10;
const MAX_COMPETITOR_DOMAINS = 6;
const MAX_ALLOWED_URLS = 40;

const ALLOWED_ACTIONS = [
  "strengthen_existing_page",
  "expand_existing_page",
  "add_section_or_faq",
  "create_new_page",
  "merge_or_dedupe",
  "needs_review",
  "watch",
] as const;

const ALLOWED_MOTIVES = [
  "counter_competitor",
  "capture_absent_cluster",
  "improve_close_prompt",
  "defend_winning_cluster",
  "resolve_cannibalization",
  "improve_citation_depth",
] as const;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type BuildEvidencePacketArgs = {
  tenantId: string;
  candidate: ResolvedRecommendationCandidate;
  matrixPrompts: ReadonlyArray<PromptOpportunity>;
  trackedPrompts: ReadonlyArray<TrackedPrompt>;
  activeEntities: ReadonlyArray<TrackedEntity>;
  observations: ReadonlyArray<PromptAnswerObservation>;
  pageInventory: ReadonlyArray<PageInventoryEntry>;
  /**
   * Optional map of observation_id → answer text. Excerpts only generate
   * for observations whose text is provided. Keep the number small.
   */
  answerTexts?: ReadonlyMap<string, string>;
  now?: Date;
};

export function buildEvidencePacket(args: BuildEvidencePacketArgs): EvidencePacket {
  const now = args.now ?? new Date();
  const ownedDomains = extractOwnedDomains(args.activeEntities);
  const ownedNames = new Set(
    args.activeEntities
      .filter((e) => e.is_owned)
      .map((e) => e.name)
      .filter((n): n is string => Boolean(n)),
  );

  const affectedSet = new Set(args.candidate.affectedPromptIds);
  const affectedOpportunities = args.matrixPrompts.filter((op) =>
    affectedSet.has(op.prompt_id),
  );
  const promptTextById = new Map(
    args.trackedPrompts.map((p) => [p.id, p.text]),
  );

  const cappedOpportunities = affectedOpportunities.slice(
    0,
    MAX_AFFECTED_PROMPTS,
  );
  const affectedPrompts: EvidencePacketPromptBlock[] = cappedOpportunities.map(
    (op) => buildPromptBlock(op, promptTextById, args.observations, ownedDomains, ownedNames),
  );

  // Inventory: pick the top matches for the cluster label. If the cluster
  // has no label (single-prompt candidate), use the first affected prompt's
  // text as the match label.
  const matchLabel =
    args.candidate.clusterLabel ??
    promptTextById.get(args.candidate.affectedPromptIds[0] ?? "") ??
    args.candidate.title;
  const inventoryMatches = matchClusterToInventory({
    label: matchLabel,
    kind: args.candidate.clusterKind,
    inventory: args.pageInventory,
    topN: MAX_INVENTORY_PAGES,
  });
  const siteInventoryPages: EvidencePacketInventoryBlock[] = inventoryMatches.map(
    (m) => ({
      url: m.url,
      title: m.entry.title,
      h1: m.entry.h1,
      h2s: m.entry.h2s.slice(0, 5),
      metaDescription: m.entry.metaDescription,
      routeType: m.entry.routeType,
      detectedGeo: m.entry.detectedGeo,
      detectedService: m.entry.detectedService,
      labelMatchScore: round2(m.score),
      labelMatchReasons: m.reasons.slice(0, 4),
    }),
  );

  // Sample answer excerpts — one per affected prompt, newest first, text
  // capped. Skip when no answerTexts map provided.
  const sampleAnswerExcerpts: EvidencePacketAnswerExcerpt[] = [];
  if (args.answerTexts) {
    const relevantObs = args.observations
      .filter(
        (o) =>
          affectedSet.has(o.prompt_id) &&
          o.observed_at.slice(0, 10) >= NATIVE_REGIME_START,
      )
      .sort((a, b) => (a.observed_at > b.observed_at ? -1 : 1));
    const seenPromptIds = new Set<string>();
    for (const o of relevantObs) {
      if (sampleAnswerExcerpts.length >= MAX_SAMPLE_EXCERPTS) break;
      if (seenPromptIds.has(o.prompt_id)) continue;
      const text = args.answerTexts.get(o.id);
      if (!text) continue;
      seenPromptIds.add(o.prompt_id);
      sampleAnswerExcerpts.push({
        prompt_id: o.prompt_id,
        platform: (o.platform ?? "unknown").toLowerCase(),
        observed_at: o.observed_at,
        excerpt:
          text.length > MAX_EXCERPT_CHARS
            ? `${text.slice(0, MAX_EXCERPT_CHARS).trim()}…`
            : text,
        citation_urls: (o.citation_urls ?? []).slice(0, 6),
      });
    }
  }

  // Allowed URL enum: owned URLs from observations + top inventory matches +
  // sentinel. Deduped + capped. Never the full site inventory.
  const allowedTargetUrls = buildAllowedTargetUrls(
    args.candidate.resolution.targetUrl,
    affectedPrompts,
    siteInventoryPages,
  );

  return {
    schemaVersion: "v1",
    generatedAt: now.toISOString(),
    tenantId: args.tenantId,
    candidate: {
      stableKey: args.candidate.stableKey,
      deterministicAction: args.candidate.resolution.action,
      deterministicTargetUrl: args.candidate.resolution.targetUrl,
      deterministicReasoning: args.candidate.resolution.reasoning,
      deterministicConfidence: args.candidate.resolution.confidence,
      deterministicTier: args.candidate.resolution.tier,
      cluster: {
        kind: args.candidate.clusterKind,
        label: args.candidate.clusterLabel,
      },
      affectedPromptCount: args.candidate.affectedPromptIds.length,
      title: args.candidate.title,
      description: args.candidate.description,
    },
    affectedPrompts,
    siteInventory: {
      pages: siteInventoryPages,
      source: "page_snapshots",
    },
    sampleAnswerExcerpts,
    allowedTargetUrls,
    allowedActions: ALLOWED_ACTIONS,
    allowedMotives: ALLOWED_MOTIVES,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildPromptBlock(
  op: PromptOpportunity,
  promptTextById: Map<string, string>,
  observations: ReadonlyArray<PromptAnswerObservation>,
  ownedDomains: ReadonlySet<string>,
  ownedNames: ReadonlySet<string>,
): EvidencePacketPromptBlock {
  const ownedUrlStats = new Map<string, { count: number; rankSum: number; rankN: number }>();
  const competitorHosts = new Map<string, number>();
  const dominantStructure = computeDominantStructure(op.evidence.answerStructureDistribution);

  let ritzPrimary = 0;
  let ritzMentioned = 0;
  let total = 0;

  for (const o of observations) {
    if (o.prompt_id !== op.prompt_id) continue;
    if (o.observed_at.slice(0, 10) < NATIVE_REGIME_START) continue;
    total += 1;
    if (o.primary_recommendation === true) ritzPrimary += 1;
    if (o.tracked_brand_mentioned === true) ritzMentioned += 1;

    const seenOwnedInObs = new Set<string>();
    for (const rawUrl of o.citation_urls ?? []) {
      if (!rawUrl) continue;
      const host = extractHost(rawUrl);
      if (!host) continue;
      if (!isOwnedHost(host, ownedDomains)) continue;
      const canonical = canonicalizeUrl(rawUrl);
      if (!canonical) continue;
      if (seenOwnedInObs.has(canonical)) continue;
      seenOwnedInObs.add(canonical);
      const stats = ownedUrlStats.get(canonical) ?? {
        count: 0,
        rankSum: 0,
        rankN: 0,
      };
      stats.count += 1;
      if (typeof o.citation_rank === "number") {
        stats.rankSum += o.citation_rank;
        stats.rankN += 1;
      }
      ownedUrlStats.set(canonical, stats);
    }
    const seenCompInObs = new Set<string>();
    for (const rawUrl of o.citation_urls ?? []) {
      const host = extractHost(rawUrl);
      if (!host) continue;
      if (isOwnedHost(host, ownedDomains)) continue;
      if (seenCompInObs.has(host)) continue;
      seenCompInObs.add(host);
      competitorHosts.set(host, (competitorHosts.get(host) ?? 0) + 1);
    }
  }

  const ritzPrimaryShare = total > 0 ? ritzPrimary / total : 0;
  let ritzState: "primary" | "cited" | "absent";
  if (ritzPrimaryShare >= 0.5) ritzState = "primary";
  else if (ritzMentioned > 0) ritzState = "cited";
  else ritzState = "absent";

  // Top primary competitor from candidate-level evidence already mapped upstream,
  // but we need per-prompt too. Use competitor_co_mentions first-entry proxy
  // per observation, mirroring summarizePromptPrimary.
  const competitorPrimaryCounts = new Map<string, number>();
  for (const o of observations) {
    if (o.prompt_id !== op.prompt_id) continue;
    if (o.observed_at.slice(0, 10) < NATIVE_REGIME_START) continue;
    if (o.primary_recommendation === true) continue;
    const first = (o.competitor_co_mentions ?? []).find(
      (n) => n && !ownedNames.has(n),
    );
    if (first) {
      competitorPrimaryCounts.set(first, (competitorPrimaryCounts.get(first) ?? 0) + 1);
    }
  }
  const topCompetitorEntry = [...competitorPrimaryCounts.entries()].sort(
    ([, a], [, b]) => b - a,
  )[0];
  const topPrimaryCompetitor =
    topCompetitorEntry && total > 0
      ? { name: topCompetitorEntry[0], share: round2(topCompetitorEntry[1] / total) }
      : null;

  const fragmented =
    total > 0 &&
    ritzPrimaryShare < 0.5 &&
    (!topPrimaryCompetitor || topPrimaryCompetitor.share < 0.5) &&
    (ritzPrimary > 0 || competitorPrimaryCounts.size >= 2);

  const ownedUrlsCited = [...ownedUrlStats.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([url, stats]) => ({
      url,
      citationCount: stats.count,
      avgRank: stats.rankN > 0 ? round2(stats.rankSum / stats.rankN) : null,
    }));

  const competitorDomainsCited = [...competitorHosts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_COMPETITOR_DOMAINS)
    .map(([host]) => host);

  return {
    prompt_id: op.prompt_id,
    text: promptTextById.get(op.prompt_id) ?? op.prompt_id,
    category: op.category,
    classifierReasoning: op.reasoning,
    observationCount: total,
    ritzState,
    ritzPrimaryShare: round2(ritzPrimaryShare),
    topPrimaryCompetitor,
    fragmented,
    ownedUrlsCited,
    competitorDomainsCited,
    dominantAnswerStructure: dominantStructure,
    descriptorsNearBrand: op.evidence.topDescriptors.slice(0, MAX_DESCRIPTORS),
  };
}

function computeDominantStructure(
  dist: Record<string, number>,
): { structure: string; share: number } | null {
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const sorted = Object.entries(dist).sort(([, a], [, b]) => b - a);
  const [top, topCount] = sorted[0];
  const share = topCount / total;
  if (share < 0.6) return null;
  return { structure: top, share: round2(share) };
}

function buildAllowedTargetUrls(
  deterministicTargetUrl: string,
  affectedPrompts: ReadonlyArray<EvidencePacketPromptBlock>,
  siteInventoryPages: ReadonlyArray<EvidencePacketInventoryBlock>,
): string[] {
  const set = new Set<string>();
  set.add(NEEDS_NEW_PAGE);
  if (deterministicTargetUrl && deterministicTargetUrl !== NEEDS_NEW_PAGE) {
    set.add(deterministicTargetUrl);
  }
  for (const p of affectedPrompts) {
    for (const u of p.ownedUrlsCited) set.add(u.url);
    if (set.size >= MAX_ALLOWED_URLS) break;
  }
  for (const page of siteInventoryPages) {
    if (set.size >= MAX_ALLOWED_URLS) break;
    set.add(page.url);
  }
  return [...set];
}

function extractOwnedDomains(
  activeEntities: ReadonlyArray<TrackedEntity>,
): Set<string> {
  const out = new Set<string>();
  for (const e of activeEntities) {
    if (!e.is_owned) continue;
    if (!e.domain) continue;
    const host = normalizeHost(e.domain);
    if (host) out.add(host);
  }
  return out;
}

function extractHost(rawUrl: string): string | null {
  try {
    return normalizeHost(new URL(rawUrl).host);
  } catch {
    return null;
  }
}

function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^www\./, "");
}

function isOwnedHost(host: string, ownedDomains: ReadonlySet<string>): boolean {
  if (ownedDomains.has(host)) return true;
  for (const owned of ownedDomains) {
    if (host.endsWith(`.${owned}`)) return true;
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Cache hash — stable string derived from the packet for cache + audit keys.
// ---------------------------------------------------------------------------

/**
 * Canonical JSON stringification for stable hashing. Object keys are
 * sorted, arrays left as-is (the packet arrays are already deterministic
 * upstream).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}
