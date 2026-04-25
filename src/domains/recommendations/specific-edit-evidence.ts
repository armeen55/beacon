/**
 * Sprint 6A.1 Phase 7 (2026-04-24) — Specific Edit Evidence Packet builder.
 *
 * The structured contract that every Specific Edit Generator (deterministic
 * v1, deterministic+LLM v2 in Sprint 6A.2) consumes. Pure compute, no I/O,
 * no DB writes, no LLM, no UI. Composes already-derived inputs from the
 * recommendation pipeline + Phase 6A.1.6's `page_element_inventory` rows
 * into one immutable, JSON-serializable packet plus a stable
 * `evidenceHash` so caches can detect "same evidence" across runs.
 *
 * This is intentionally separate from
 * `src/domains/recommendations/evidence-packet.ts` (Phase v7, 2026-04-23):
 *
 *   - That packet feeds the GPT-5-mini RECOMMENDATION ADJUDICATOR — it
 *     decides ACTION + MOTIVE + TARGET URL for each rec.
 *   - This packet feeds the SPECIFIC EDIT GENERATOR — it decides
 *     "change H2 X to Y, add FAQ Z, rewrite title to W" given a rec
 *     whose action + target URL is already settled.
 *
 * Two pipelines, two packets. Sharing the type would force one to
 * carry the other's bloat. The two stay independent on purpose.
 *
 * Hard rules (locked in by tests):
 *   1. `allowedTargetUrls` MUST come from owned inventory only (+ the
 *      `needs_new_page` sentinel). Generators / LLM cannot invent URLs.
 *   2. `targetPageElements` rows MUST come from `page_element_inventory`
 *      (carry `element_key` + `display_label` + `element_text`).
 *   3. `evidenceHash` MUST be deterministic (same inputs → same hash) and
 *      MUST change when meaningful evidence changes (tracked by tests on
 *      affectedPrompts, ownedPageCandidates, targetPageElements,
 *      competitorAngles, allowedTargetUrls).
 *   4. `tenantId` + `recId` are required and threaded through to every
 *      consumer + the hash itself.
 *   5. No tenant-specific (Ritz) hardcoding. Tests use neutral fixtures.
 *   6. Empty data on any optional dimension (no competitors observed, no
 *      page elements yet, no priors) does NOT crash — every collection
 *      defaults to `[]` and the packet still validates.
 *
 * Caps are intentionally generous for v1 — the LLM cost path lives
 * downstream in Phase 6A.2's provider adapter; v1 deterministic
 * generators don't pay per-token. Future tightening will live there.
 */

import { createHash } from "node:crypto";

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { ElementType } from "@/domains/pages/extractors/registry";
import type { PromptOpportunity } from "@/domains/prompts/opportunity-classify";
import type { PromptPrimarySummary } from "@/domains/prompts/competitor-primary";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";

import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  type ActionType,
} from "./action-types";
import {
  matchClusterToInventory,
  type PageInventoryEntry,
} from "./page-inventory";
import { canonicalStringify } from "./evidence-packet";
import { NEEDS_NEW_PAGE } from "./resolved-types";

// ---------------------------------------------------------------------------
// Types — every field designed to round-trip through JSON.stringify cleanly.
// No Date objects, no Maps/Sets, no class instances, no functions. Only
// JSON primitives + plain objects + arrays.
// ---------------------------------------------------------------------------

export type SpecificEditClusterKind = "geo" | "topic";

export type AffectedPromptBlock = {
  promptId: string;
  promptText: string;
  /** PromptOpportunityCategory — "absent" | "outranked" | "close" |
   *  "winning" | "early". */
  category: string;
  observationCount: number;
  /** 0..1, rounded to 2dp. */
  brandPrimaryShare: number;
  /** Highest-share competitor on this prompt; null when none reach majority
   *  or no competitor data is available. Always tenant-agnostic. */
  topPrimaryCompetitor: { name: string; share: number } | null;
  /** Top descriptors AI used near the brand on this prompt (cap 6). */
  descriptorsNearBrand: string[];
};

export type OwnedPageCandidateBlock = {
  /** Canonicalized URL; only owned URLs land here. */
  url: string;
  routeType: string;
  detectedGeo: string | null;
  detectedService: string | null;
  /** 0..1 blended score from `matchClusterToInventory`. */
  matchScore: number;
  matchReasons: string[];
  /** Raw inventory snapshot tokens — title + h1 + h2s — for generator
   *  context (e.g. avoid duplicating an H2 the page already has). */
  title: string | null;
  h1: string | null;
  h2s: string[];
};

export type TargetPageElementBlock = {
  /** The owned URL this element belongs to. Always one of
   *  `allowedTargetUrls` (excluding the `needs_new_page` sentinel). */
  url: string;
  elementKey: string;
  elementType: ElementType;
  displayLabel: string;
  elementText: string | null;
  /** Light-weight diagnostics from extractor (faq_source, anchor, etc.).
   *  Already small per Phase 6A.1.5 caps. */
  elementMetadata: Record<string, unknown>;
};

export type CompetitorAngleBlock = {
  /** Tenant-agnostic name (drawn from observations, not config). */
  competitorName: string;
  /** Number of affected prompts where this competitor occupies the
   *  primary slot at all (count of unique prompts). */
  promptsWherePrimary: number;
  /** Total affected prompts (denominator). */
  totalAffectedPrompts: number;
  /** Sum of primary observations across all affected prompts. Useful for
   *  weighting competitors that dominate one prompt vs. those that
   *  appear weakly across many. */
  totalPrimaryObservations: number;
};

/**
 * Per-tenant historical signal: "for this action_type on this tenant,
 * how often did past edits move citations". Phase 6A.1.7 ships an
 * empty array — the materialization job that populates this lives in
 * Sprint 6A.2 (`element_change_outcomes` aggregation). Builder accepts
 * the input today so the contract is locked even before the producer
 * exists.
 */
export type PriorOutcomeBlock = {
  actionType: ActionType;
  /** How many historical changelog entries with this action_type fed the rate. */
  sampleSize: number;
  /** 0..1, rounded to 2dp. Higher = more often correlated with citation lift. */
  positiveOutcomeRate: number;
};

export type SpecificEditEvidencePacket = {
  schemaVersion: "specific-edit/v1";
  generatedAt: string;
  tenantId: string;
  recId: string;
  /**
   * Optional stable identifier for the cluster this rec belongs to.
   * Null today — the existing recommendation pipeline doesn't materialize
   * clusters as first-class entities (the cluster IS its label). Reserved
   * here so when clusters get promoted to first-class in a future phase
   * the contract doesn't break.
   */
  clusterId: string | null;
  /** Operator-facing cluster label (e.g. "Palo Alto", "kitchen renovation").
   *  Null for single-prompt recs that don't participate in any cluster. */
  clusterLabel: string | null;
  /** "geo" / "topic" / null. Drives generator heuristics. */
  clusterKind: SpecificEditClusterKind | null;
  affectedPrompts: AffectedPromptBlock[];
  ownedPageCandidates: OwnedPageCandidateBlock[];
  targetPageElements: TargetPageElementBlock[];
  competitorAngles: CompetitorAngleBlock[];
  priorOutcomes: PriorOutcomeBlock[];
  /** Owned URLs the generator may target + the `needs_new_page` sentinel.
   *  Validation layer (6A.1.10) rejects outputs whose `target_url` isn't
   *  in this set. */
  allowedTargetUrls: string[];
  /** ActionTypes a generator (deterministic or LLM) may emit for this
   *  packet. Defaults to v1 active set; callers can widen for 6A.2. */
  allowedActionTypes: ActionType[];
  /** Stable sha256 prefix of the packet contents (sans this field).
   *  Same inputs → same hash → cache hit; meaningful evidence change →
   *  fresh hash → cache miss → re-generate. */
  evidenceHash: string;
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type BuildSpecificEditEvidencePacketArgs = {
  tenantId: string;
  recId: string;
  /** Optional — pass `null` when the cluster has no first-class id. */
  clusterId?: string | null;
  /** Operator-facing cluster label or null for single-prompt recs. */
  clusterLabel: string | null;
  /** "geo" | "topic" | null. */
  clusterKind: SpecificEditClusterKind | null;
  /** Prompt IDs the recommendation declares as affected. Ordering preserved. */
  affectedPromptIds: ReadonlyArray<string>;
  /** Already-classified prompt opportunities. Builder filters by
   *  affectedPromptIds. */
  promptOpportunities: ReadonlyArray<PromptOpportunity>;
  /** Tracked prompts — used to look up prompt text. */
  trackedPrompts: ReadonlyArray<TrackedPrompt>;
  /** Already-aggregated competitor-primary summaries per prompt. Builder
   *  filters by affectedPromptIds + sums across them. */
  primarySummaries: ReadonlyArray<PromptPrimarySummary>;
  /** Owned-only page inventory (from `buildPageInventory`). Builder runs
   *  cluster-match scoring against this. */
  ownedPageInventory: ReadonlyArray<PageInventoryEntry>;
  /** Per-snapshot extractor output rows. Builder filters to the latest
   *  snapshot per (url, element_key) and only includes elements whose
   *  url is in the candidate set. */
  pageElementInventory: ReadonlyArray<PageElementInventoryRow>;
  /** Optional historical action-type → outcome rates (Sprint 6A.2 will
   *  populate). Defaults to `[]`. */
  priorOutcomes?: ReadonlyArray<PriorOutcomeBlock>;
  /** Optional override; defaults to v1 active set. */
  allowedActionTypes?: ReadonlyArray<ActionType>;
  /** Cap on candidate URLs scored against the cluster. Defaults to 8. */
  maxCandidatePages?: number;
  /** Cap on element rows per packet. Defaults to 80 (10 candidate pages
   *  × 8 elements average). Generators don't need every list/H3/anchor. */
  maxTargetElements?: number;
  now?: Date;
};

const DEFAULT_MAX_CANDIDATE_PAGES = 8;
const DEFAULT_MAX_TARGET_ELEMENTS = 80;
const DEFAULT_MAX_DESCRIPTORS_PER_PROMPT = 6;
const DEFAULT_MAX_H2S_PER_CANDIDATE = 8;

export function buildSpecificEditEvidencePacket(
  args: BuildSpecificEditEvidencePacketArgs,
): SpecificEditEvidencePacket {
  const now = args.now ?? new Date();
  const affectedSet = new Set(args.affectedPromptIds);

  const promptTextById = new Map(
    args.trackedPrompts.map((p) => [p.id, p.text]),
  );
  const opportunityById = new Map(
    args.promptOpportunities.map((op) => [op.prompt_id, op]),
  );
  const summaryById = new Map(
    args.primarySummaries.map((s) => [s.prompt_id, s]),
  );

  const affectedPrompts = buildAffectedPromptBlocks(
    args.affectedPromptIds,
    promptTextById,
    opportunityById,
    summaryById,
  );

  const ownedPageCandidates = buildOwnedPageCandidates(
    args.clusterLabel,
    args.clusterKind,
    args.ownedPageInventory,
    args.affectedPromptIds,
    promptTextById,
    args.maxCandidatePages ?? DEFAULT_MAX_CANDIDATE_PAGES,
  );

  const candidateUrlSet = new Set(
    ownedPageCandidates.map((c) => c.url),
  );

  const targetPageElements = buildTargetPageElements(
    candidateUrlSet,
    args.pageElementInventory,
    args.maxTargetElements ?? DEFAULT_MAX_TARGET_ELEMENTS,
  );

  const competitorAngles = buildCompetitorAngles(
    args.affectedPromptIds,
    summaryById,
  );

  const allowedTargetUrls = buildAllowedTargetUrls(
    candidateUrlSet,
  );

  const allowedActionTypes = (
    args.allowedActionTypes ?? defaultAllowedActionTypes()
  )
    // De-dupe + sort for hash stability (caller may pass a mutable array
    // in unspecified order).
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice()
    .sort();

  const priorOutcomes = (args.priorOutcomes ?? [])
    .slice()
    .sort((a, b) =>
      a.actionType.localeCompare(b.actionType),
    );

  // Build packet WITHOUT evidenceHash, hash it, then attach.
  const withoutHash: Omit<SpecificEditEvidencePacket, "evidenceHash"> = {
    schemaVersion: "specific-edit/v1",
    generatedAt: now.toISOString(),
    tenantId: args.tenantId,
    recId: args.recId,
    clusterId: args.clusterId ?? null,
    clusterLabel: args.clusterLabel,
    clusterKind: args.clusterKind,
    affectedPrompts,
    ownedPageCandidates,
    targetPageElements,
    competitorAngles,
    priorOutcomes,
    allowedTargetUrls,
    allowedActionTypes: [...allowedActionTypes],
  };

  const evidenceHash = computeEvidenceHash(withoutHash);

  return { ...withoutHash, evidenceHash };
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildAffectedPromptBlocks(
  affectedPromptIds: ReadonlyArray<string>,
  promptTextById: ReadonlyMap<string, string>,
  opportunityById: ReadonlyMap<string, PromptOpportunity>,
  summaryById: ReadonlyMap<string, PromptPrimarySummary>,
): AffectedPromptBlock[] {
  const out: AffectedPromptBlock[] = [];
  for (const promptId of affectedPromptIds) {
    const op = opportunityById.get(promptId);
    const summary = summaryById.get(promptId);

    const observationCount =
      op?.evidence.observationCount ?? summary?.totalAnswers ?? 0;
    const brandPrimaryShare = summary?.ritzPrimaryShare ?? 0;

    let topPrimaryCompetitor: { name: string; share: number } | null = null;
    if (summary && summary.totalAnswers > 0) {
      const top = summary.primaryCompetitors[0];
      if (top && top.primaryCount > 0) {
        topPrimaryCompetitor = {
          name: top.name,
          share: round2(top.primaryCount / summary.totalAnswers),
        };
      }
    }

    out.push({
      promptId,
      promptText: promptTextById.get(promptId) ?? promptId,
      category: op?.category ?? "early",
      observationCount,
      brandPrimaryShare: round2(brandPrimaryShare),
      topPrimaryCompetitor,
      descriptorsNearBrand:
        op?.evidence.topDescriptors.slice(
          0,
          DEFAULT_MAX_DESCRIPTORS_PER_PROMPT,
        ) ?? [],
    });
  }
  return out;
}

function buildOwnedPageCandidates(
  clusterLabel: string | null,
  clusterKind: SpecificEditClusterKind | null,
  ownedPageInventory: ReadonlyArray<PageInventoryEntry>,
  affectedPromptIds: ReadonlyArray<string>,
  promptTextById: ReadonlyMap<string, string>,
  topN: number,
): OwnedPageCandidateBlock[] {
  if (ownedPageInventory.length === 0) return [];

  // Match label preference: clusterLabel, fall back to first affected
  // prompt's text. If neither is available, return [] gracefully.
  const matchLabel =
    clusterLabel ??
    promptTextById.get(affectedPromptIds[0] ?? "") ??
    null;
  if (!matchLabel) return [];

  const matches = matchClusterToInventory({
    label: matchLabel,
    kind: clusterKind,
    inventory: ownedPageInventory,
    topN,
  });

  return matches.map((m) => ({
    url: m.url,
    routeType: m.entry.routeType,
    detectedGeo: m.entry.detectedGeo,
    detectedService: m.entry.detectedService,
    matchScore: round2(m.score),
    matchReasons: m.reasons.slice(0, 4),
    title: m.entry.title,
    h1: m.entry.h1,
    h2s: m.entry.h2s.slice(0, DEFAULT_MAX_H2S_PER_CANDIDATE),
  }));
}

function buildTargetPageElements(
  candidateUrlSet: ReadonlySet<string>,
  pageElementInventory: ReadonlyArray<PageElementInventoryRow>,
  maxElements: number,
): TargetPageElementBlock[] {
  if (candidateUrlSet.size === 0) return [];
  if (pageElementInventory.length === 0) return [];

  // Filter to candidate URLs first; then dedupe to the freshest row per
  // (url, element_key) by observed_at. Same element_key reused across
  // snapshots = evolving content; we want the latest.
  const filtered = pageElementInventory.filter((r) =>
    candidateUrlSet.has(r.url),
  );

  const latestByKey = new Map<string, PageElementInventoryRow>();
  for (const row of filtered) {
    const key = `${row.url}\u0000${row.element_key}`;
    const existing = latestByKey.get(key);
    if (!existing || row.observed_at > existing.observed_at) {
      latestByKey.set(key, row);
    }
  }

  // Stable order for hash determinism: by url asc, then element_key asc.
  const ordered = [...latestByKey.values()].sort(
    (a, b) =>
      a.url.localeCompare(b.url) ||
      a.element_key.localeCompare(b.element_key),
  );

  const capped = ordered.slice(0, maxElements);

  return capped.map((row) => ({
    url: row.url,
    elementKey: row.element_key,
    elementType: row.element_type,
    displayLabel: row.display_label,
    elementText: row.element_text,
    elementMetadata: row.element_metadata,
  }));
}

function buildCompetitorAngles(
  affectedPromptIds: ReadonlyArray<string>,
  summaryById: ReadonlyMap<string, PromptPrimarySummary>,
): CompetitorAngleBlock[] {
  const totalAffected = affectedPromptIds.length;
  if (totalAffected === 0) return [];

  type Acc = { promptsWherePrimary: number; totalPrimaryObservations: number };
  const counts = new Map<string, Acc>();

  for (const promptId of affectedPromptIds) {
    const summary = summaryById.get(promptId);
    if (!summary) continue;
    for (const c of summary.primaryCompetitors) {
      if (c.primaryCount <= 0) continue;
      const acc = counts.get(c.name) ?? {
        promptsWherePrimary: 0,
        totalPrimaryObservations: 0,
      };
      acc.promptsWherePrimary += 1;
      acc.totalPrimaryObservations += c.primaryCount;
      counts.set(c.name, acc);
    }
  }

  const out: CompetitorAngleBlock[] = [];
  for (const [name, acc] of counts) {
    out.push({
      competitorName: name,
      promptsWherePrimary: acc.promptsWherePrimary,
      totalAffectedPrompts: totalAffected,
      totalPrimaryObservations: acc.totalPrimaryObservations,
    });
  }
  // Stable order: most "primary" prompts first; ties broken by total
  // observations desc; then alphabetical for hash determinism.
  out.sort(
    (a, b) =>
      b.promptsWherePrimary - a.promptsWherePrimary ||
      b.totalPrimaryObservations - a.totalPrimaryObservations ||
      a.competitorName.localeCompare(b.competitorName),
  );
  return out;
}

function buildAllowedTargetUrls(
  candidateUrlSet: ReadonlySet<string>,
): string[] {
  // Owned URLs only + the sentinel. Sentinel always present so generators
  // can declare "this rec needs a brand-new page" even when an existing
  // owned page is a candidate.
  const out = [...candidateUrlSet].sort();
  out.push(NEEDS_NEW_PAGE);
  return out;
}

function defaultAllowedActionTypes(): ActionType[] {
  return ACTION_TYPES.filter(
    (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
  );
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

/**
 * Compute a 16-char hex prefix of sha256 over the canonical-stringified
 * packet (everything except `evidenceHash`). 16 hex chars = 64 bits of
 * entropy — collision probability is negligible at the volumes Beacon
 * generates (low thousands of recs/tenant/day).
 *
 * `generatedAt` is INCLUDED in the hash by design: a packet built one
 * second after another with otherwise identical inputs is genuinely a
 * different cache entry. Callers that want timestamp-independent
 * caching should pass the same `now` value.
 *
 * The hash is built off the same canonical-stringify the existing
 * adjudicator packet uses (key-sorted, array-stable) so future tooling
 * that compares packets across systems is consistent.
 */
function computeEvidenceHash(
  withoutHash: Omit<SpecificEditEvidencePacket, "evidenceHash">,
): string {
  const canonical = canonicalStringify(withoutHash);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
