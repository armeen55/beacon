import type { ChangelogEntry } from "@/domains/changelog/types";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import type { Result } from "@/domains/results/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Attribution, MatchStrength } from "./types";
import {
  computeAttribution,
  computeConfidenceScore,
  EVIDENCE_TIER_BONUS,
  EVIDENCE_TIER_CAP,
} from "./compute";
import type { CandidateLink } from "@/domains/attribution/types";
import { ATTRIBUTION_CONFIG } from "./config";
import { classifyEvidenceTier } from "@/domains/pages/evidence-tier";
import { normalizePageUrl } from "@/domains/pages/classify";
import type { EvidenceTier, PageEntity } from "@/domains/pages/types";

// ── Page registry (loaded once for evidence tier verification) ──────
//
// Sprint 7 Phase 7.5c/3 (2026-04-25): the registry is now built from a
// per-request fetch via `getOwnedPages()` instead of a module-level
// top-level await on `allPages`. Multi-tenant correctness requires a
// request context (header-resolved tenantId) that doesn't exist at
// module init.
//
// Contract: `discoverCandidates` is sync and can't await. Callers that
// want full evidence-tier classification MUST `await warmPageRegistry()`
// once before calling `discoverCandidates`. Without warming,
// `getPageRegistry()` returns an empty Map → evidence tier classification
// degrades but doesn't crash.
//
// Phase 7.5c/3 wires warming into the two highest-traffic entry points
// (diagnostics + today-data). Other discoverCandidates callers (topics,
// review, settings/history, scorecard helpers) are deferred to a
// follow-up — they will see degraded evidence tier until then.

// Night-shift cache sweep (2026-06-11): per-tenant warm. The previous
// single global registry pinned the FIRST tenant's pages for every
// later tenant in a warm process — permanently wrong for tenant B.
// Sync consumers must name the tenant whose registry they want. There is no
// process-global "last warmed" pointer: overlapping A/B requests cannot change
// which registry a later synchronous call observes.
const _registryByTenant = new Map<string, Map<string, PageEntity>>();
const _registryPromiseByTenant = new Map<string, Promise<void>>();

export async function warmPageRegistry(
  explicitTenantId?: string,
): Promise<string> {
  const tenantId = explicitTenantId ?? await currentTenantId();
  if (_registryByTenant.has(tenantId)) return tenantId;
  if (!_registryPromiseByTenant.has(tenantId)) {
    _registryPromiseByTenant.set(
      tenantId,
      (async () => {
        const repo = getRepository().forTenant(tenantId);
        const pages = await repo.getPages();
        _registryByTenant.set(tenantId, new Map(pages.map((p) => [p.url, p])));
        // Topic index warms alongside (see getCitationTopicIndex).
        await warmCitationTopicIndex(tenantId);
      })(),
    );
  }
  await _registryPromiseByTenant.get(tenantId)!;
  return tenantId;
}

function getPageRegistry(tenantId?: string): Map<string, PageEntity> {
  return (tenantId ? _registryByTenant.get(tenantId) : undefined) ?? new Map();
}

// ── Citation topic index (which pages are cited for which topics) ────

// Night-shift fix (2026-06-11): the old flat-path read
// (.data/citation-evidence-index.json) predates tenant routing — the
// file no longer exists at that path, so this index has been silently
// EMPTY everywhere (hosted included). Warm it from the per-tenant
// citation-evidence STORE instead (live on disk AND Supabase).
const _topicIndexByTenant = new Map<string, Map<string, Set<string>>>();

async function warmCitationTopicIndex(tenantId: string): Promise<void> {
  if (_topicIndexByTenant.has(tenantId)) return;
  try {
    const index = await getRepository()
      .forTenant(tenantId)
      .getCitationEvidenceIndex();
    const ptMap: Record<string, string[]> =
      (index?.page_to_topics as Record<string, string[]>) ?? {};
    _topicIndexByTenant.set(
      tenantId,
      new Map(Object.entries(ptMap).map(([url, topics]) => [url, new Set(topics)])),
    );
  } catch {
    _topicIndexByTenant.set(tenantId, new Map());
  }
}

function getCitationTopicIndex(tenantId?: string): Map<string, Set<string>> {
  return (tenantId ? _topicIndexByTenant.get(tenantId) : undefined) ?? new Map();
}

export type CandidateResult = {
  change: ChangelogEntry;
  attribution: Attribution;
  score: number;
};

// ── Pre-score pruning ───────────────────────────────────────────────

const EXCLUDED_SIGNAL_TYPES = new Set<string>(["measurement", "lead_form"]);

const BASELINE_PATTERNS = [
  /captured.*baseline/i,
  /first clean baseline/i,
  /baseline.*snapshot/i,
];

function shouldExcludeChange(change: ChangelogEntry): boolean {
  if (EXCLUDED_SIGNAL_TYPES.has(change.signal_type)) return true;
  const desc = change.change_description ?? "";
  return BASELINE_PATTERNS.some((p) => p.test(desc));
}

// ── Signal quality gates ────────────────────────────────────────────

/**
 * Require at least one content-specific factor (topic or URL),
 * OR both structural factors (geo + sourceCategory) together.
 * A single structural factor alone is too permissive.
 */
function hasMeaningfulSignal(matches: Attribution["matches"]): boolean {
  const meaningful = (m: MatchStrength) => m === "strong" || m === "partial";
  if (meaningful(matches.topic) || meaningful(matches.url)) return true;
  return meaningful(matches.geo) && meaningful(matches.sourceCategory);
}

/**
 * Post-score hard negatives: eliminate structurally impossible candidates.
 * Only fires when there is no content relevance (topic + url both miss).
 */
function isHardNegative(matches: Attribution["matches"]): boolean {
  const noContent =
    (matches.topic === "none" || matches.topic === "unknown") &&
    (matches.url === "none" || matches.url === "unknown");
  if (!noContent) return false;

  if (matches.temporal === "none") return true;
  if (matches.platform === "none") return true;
  return false;
}

// ── Citation evidence lookup ─────────────────────────────────────────

const CITATION_EVIDENCE_BONUS = 12;

/**
 * Check if a change's page URL is cited by AI platforms for the event's topic.
 * Returns true if the page_to_topics index contains the change URL
 * with a topic matching the result's topic.
 */
function hasCitationTopicSupport(
  change: ChangelogEntry,
  resultTopic: string | null,
  siteDomain?: string,
  tenantId?: string,
): boolean {
  if (!resultTopic || !change.url) return false;

  const index = getCitationTopicIndex(tenantId);
  if (index.size === 0) return false;

  const parsed = normalizePageUrl(change.url, siteDomain);
  if (!parsed) return false;

  const topics = index.get(parsed.url);
  if (!topics) return false;

  return topics.has(resultTopic);
}

// ── Score adjustments ───────────────────────────────────────────────

const NO_CONTENT_SCORE_CAP = 45;

function adjustScore(
  rawScore: number,
  tier: EvidenceTier | null,
  matches: Attribution["matches"],
  citationSupport: boolean
): number {
  let score = rawScore;

  if (tier) {
    score = Math.min(
      score + EVIDENCE_TIER_BONUS[tier],
      EVIDENCE_TIER_CAP[tier]
    );
  }

  const noContent =
    (matches.topic === "none" || matches.topic === "unknown") &&
    (matches.url === "none" || matches.url === "unknown");

  if (noContent) {
    score = Math.min(score, NO_CONTENT_SCORE_CAP);
  } else if (citationSupport) {
    score += CITATION_EVIDENCE_BONUS;
  }

  return Math.min(score, 100);
}

// ── Main discovery ──────────────────────────────────────────────────

export function discoverCandidates(
  result: Result,
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[],
  options?: {
    maxDays?: number;
    minScore?: number;
    topK?: number;
    candidateLinks?: CandidateLink[];
    siteDomain?: string;
    tenantId?: string;
  },
): CandidateResult[] {
  const { maxDays, minScore, topK } = ATTRIBUTION_CONFIG.discovery;
  const maxDaysResolved = options?.maxDays ?? maxDays;
  const minScoreResolved = options?.minScore ?? minScore;
  const topKResolved = options?.topK ?? topK;
  const candidateLinks = options?.candidateLinks ?? [];

  const resultDate = new Date(result.snapshot_date).getTime();

  const excludeIds = new Set([
    ...result.attributed_changelog_ids,
    ...candidateLinks
      .filter(
        (cl) => cl.result_id === result.id && cl.status === "rejected"
      )
      .map((cl) => cl.change_id),
  ]);

  return allChanges
    .filter((change) => {
      if (excludeIds.has(change.id)) return false;
      if (shouldExcludeChange(change)) return false;
      const changeDate = new Date(change.timestamp).getTime();
      const diffDays = (resultDate - changeDate) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= maxDaysResolved;
    })
    .map((change) => {
      const evidenceMeta = classifyEvidenceTier(
        change,
        getPageRegistry(options?.tenantId),
        options?.siteDomain,
      );
      const attribution = computeAttribution(
        change,
        result,
        allOpportunities,
        evidenceMeta,
        options?.siteDomain,
      );
      const rawScore = computeConfidenceScore(attribution.matches);
      const citationSupport = hasCitationTopicSupport(
        change,
        result.topic,
        options?.siteDomain,
        options?.tenantId,
      );
      const score = adjustScore(rawScore, evidenceMeta.tier, attribution.matches, citationSupport);
      return { change, attribution, score };
    })
    .filter(
      ({ score, attribution }) =>
        score >= minScoreResolved &&
        hasMeaningfulSignal(attribution.matches) &&
        !isHardNegative(attribution.matches)
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.attribution.temporal_distance_days -
          b.attribution.temporal_distance_days
    )
    .slice(0, topKResolved);
}
