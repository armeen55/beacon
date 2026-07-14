import "server-only";
import { loadChangePacksForTenant } from "./gap-compiler";
import { attachOpinions, type Specialist } from "./specialist-opinions";
import { routeMove, type MoveRouterDecision } from "./move-router";
import { loadSpecialistWeightTable } from "@/domains/team-scoreboard/load-team-scoreboard";
import {
  buildPreparedMovePack,
  toPersistedPack,
  parsePreparedPack,
  isPackStale,
  type PreparedMovePack,
  type StructuredDraft,
  type PreparedStatus,
  type RegenMeta,
} from "./prepared-move-pack";
import { saveMoveDraft, getLatestMoveDrafts } from "./move-draft-store";
import {
  draftAnswerBlockStructured,
  draftAtomicEditStructured,
  draftCreatePageStructured,
  draftCROFixStructured,
  type CompleteFn,
  type StructuredDraftResult,
} from "@/domains/llm/structured-drafter";
import { evaluatePreparedPackQuality } from "@/domains/drafts/draft-quality";
import { ExperimentPlanSchema, type ExperimentPlan, type ImplementationStep } from "@/domains/llm/schemas";
import type { EvidencePacket } from "./evidence-packet";
import { classifyQueryIntent } from "@/domains/experiments/answer-intent";
import { loadFamilyDemandProfiles } from "@/domains/seasonal/family-demand-profile-store";
import { runSerpQuery, type SerpRunResult } from "@/domains/serp/dataforseo-serp";
import { validateCreatePage } from "@/domains/serp/serp-validation";
import { rootDomain } from "@/domains/serp/serp-provider";
import { parsePreparedVerdict, type PreparedSerpVerdict } from "@/domains/serp/prepare-create-page-verdicts";
import { decideExistingPageHold, type ExistingMoveType } from "@/domains/serp/existing-page-winnability";
import { getBusinessConfig } from "@/lib/business-config";
import type { FirstMentionConfig } from "@/domains/drafts/first-mention-check";
import { log } from "@/lib/logger";
import { dossierReferenceCandidates, researchDossierHints } from "@/domains/research/research-dossier";
import type { RankedUnifiedEntry } from "@/domains/allocator/unified-list";
import {
  researchFinalRankedSerps,
  type RankedSerpResearchDeps,
} from "@/domains/serp/ranked-serp-research";

/** First path segment groups a family - mirrors pageFamilyOf in
 *  daily-experiment-planner.ts (duplicated here to avoid an experiments ->
 *  demand-graph dependency; both copies are pinned by tests). */
function pageFamilyOfUrl(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

/**
 * prepare-today-moves (2026-06-25, P5 — "Prepare my top 10") — turn the top
 * existing-page Iranopedia Moves into PreparedMovePacks that arrive
 * "ready_to_review": specialist opinions (P1) + router decision (P2) + a
 * Zod-validated structured draft (P4) + an experiment + a proof plan, persisted
 * via move_drafts (kind=prepared_pack, NO migration).
 *
 * Operator-triggered + capped: one paid LLM draft per Move (gpt-5-mini, ~$0.01),
 * fail-soft per Move (one failure never aborts the batch), and CACHE-FIRST — a
 * non-stale pack that already has a draft is skipped (zero LLM re-spend). NO
 * publish and NO migration. The exact final-ranked queries are checked through
 * the existing capped/cache-first SERP gauntlet before drafting, including new
 * pages. Tenant-agnostic.
 */

const ALL_SPECIALISTS: Specialist[] = ["gsc", "ga4", "clarity", "profound", "dataforseo", "wix", "llm", "commerce_asset", "seasonal"];
const MAX_PERSIST_CHARS = 11_500; // under the move_drafts 12k content cap

export type PrepareMoveOutcome = {
  moveId: string;
  label: string;
  targetUrl: string | null;
  gap: string;
  action: string;
  preparedStatus: PreparedStatus;
  draftKind: string | null;
  evidenceRefsCount: number;
  proofPlanPresent: boolean;
  risksCount: number;
  missingEvidence: Specialist[];
  note: string;
};

export type PrepareMovesSummary = {
  considered: number;
  prepared: number;
  readyToReview: number;
  draftReady: number;
  cached: number;
  failed: number;
  /** Drafts regenerated FROM competitor teardown facts (subset of `prepared`). */
  regenerated: number;
  /** True if the per-run $ cap stopped the batch before all targets were processed. */
  stoppedForBudget: boolean;
  llmCostUsd: number;
  /** RANK-3: moves the live Google-results check judged effectively unwinnable
   *  (marketplace/structural top results, or the winnability numbers reject
   *  them) and therefore CAPPED at serp_checked instead of drafting a confident
   *  "ready" move that cannot rank. 0 on a run where no move was held. */
  winnabilityHeld: number;
  /** RANK-3: SERP spend from the live existing-page winnability checks this run
   *  (separate from llmCostUsd). 0 when every check was a cache hit / dry-run /
   *  unconfigured (no live call). */
  serpCostUsd: number;
  /** Exact final-ranked queries that returned a real or cached live SERP. */
  serpQueriesChecked?: number;
  /** Organic winner pages torn down before packet compilation and drafting. */
  serpWinnerPagesAnalyzed?: number;
  serpWinnerPagesFromCache?: number;
  outcomes: PrepareMoveOutcome[];
};

/** Deterministic experiment for a Move (no extra LLM cost) — validated against the
 *  schema; null if it somehow can't satisfy the contract. */
function buildExperimentPlan(
  packet: EvidencePacket,
  decision: MoveRouterDecision,
  draftValue: { evidenceRefs?: unknown; operatorSteps?: string[] },
): ExperimentPlan | null {
  const gap = packet.move.gapType;
  const primaryMetric =
    gap === "answer_block"
      ? "profound_citations"
      : gap === "edit_page"
        ? "gsc_ctr"
        : gap === "create_page"
          ? "gsc_impressions"
          : "clarity_friction";
  const expectedDirection = gap === "fix_experience" ? "down" : "up";
  const candidate = {
    hypothesis: decision.rationale.slice(0, 300) || `Shipping this ${gap} move improves ${primaryMetric}.`,
    primaryMetric,
    expectedDirection,
    windowsDays: packet.proofPlan.windowsDays,
    controlDescription: packet.proofPlan.controls.slice(0, 300),
    evidenceRefs: Array.isArray(draftValue.evidenceRefs) ? draftValue.evidenceRefs : [],
    confidence: decision.confidenceLevel,
    operatorSteps: (draftValue.operatorSteps ?? ["Ship the prepared change and record it for proof."]).slice(0, 12),
  };
  const res = ExperimentPlanSchema.safeParse(candidate);
  return res.success ? res.data : null;
}

/** True when this packet carries an ON-TOPIC competitor teardown we can ground a draft
 *  in (relevance-gated — never a loosely-matched/eggplant join). */
export function hasUsableTeardown(packet: EvidencePacket): boolean {
  const c = packet.competitor;
  return !!c.facts && !c.looselyMatched && c.fetchStatus === "ok";
}

/** Turn an on-topic competitor teardown into grounded, structured hints the drafter
 *  uses to BEAT the winning page — never to copy it. Empty when no relevant teardown.
 *  The drafter system prompts already forbid invented stats/dates/superlatives, so
 *  these facts are framed as "what the winner has; do better, in your own words". */
export function competitorTeardownHints(packet: EvidencePacket): string[] {
  if (!hasUsableTeardown(packet)) return [];
  const c = packet.competitor;
  const f = c.facts!;
  const out: string[] = [];
  const struct: string[] = [];
  if (f.wordCount) struct.push(`${f.wordCount} words`);
  if (f.sectionCount) struct.push(`${f.sectionCount} sections`);
  if (f.hasFaq) struct.push(`an FAQ (${f.faqQuestionCount} questions)`);
  if (f.hasAnswerBlock) struct.push("a direct answer block up top");
  if (f.schemaTypes.length) struct.push(`${f.schemaTypes.length} schema type(s)`);
  if (f.hasToolOrCalculator) struct.push("an interactive tool");
  if (f.imageCount) struct.push(`${f.imageCount} images`);
  if (struct.length) out.push(`The page that currently wins this topic (${c.domain}) has: ${struct.join(", ")}.`);
  if (f.title) out.push(`Its title reads: "${f.title.slice(0, 120)}".`);
  const outline = (f.outline ?? []).filter(Boolean).slice(0, 6);
  if (outline.length) out.push(`Its sections: ${outline.join("; ")}.`);
  const faqs = (f.faqQuestions ?? []).filter(Boolean).slice(0, 4);
  if (faqs.length) out.push(`Questions it answers: ${faqs.join("; ")}.`);
  out.push(
    `Beat ${c.domain}: be clearer and more useful — cover what it covers plus what it misses, in your OWN words. Do not copy its wording, title, or headings. Grounding source only: ${c.topUrl}.`,
  );
  return out;
}

function evidenceHintsFor(packet: EvidencePacket): string[] {
  return [
    packet.move.instruction ? `Ranked move: ${packet.move.instruction}` : "",
    packet.competitor.domain && !packet.competitor.looselyMatched ? `AI cites ${packet.competitor.domain} for this topic, not you` : "",
    packet.yourPage.gsc ? "the page already ranks on Google but isn't the cited source" : "",
    ...researchDossierHints(packet.research),
    ...competitorTeardownHints(packet),
  ].filter(Boolean).slice(0, 18);
}

/** Pilot loop 4 (2026-07-10): the packet's own AI-cited competitor URLs (topUrl +
 *  otherUrls, already loaded from the tenant's citation tables by the graph builder,
 *  ZERO new fetches here) as "sources you may cite" candidates for the answer-block
 *  drafter. A bare list/index URL (a shared roundup page like "List_of_X") is filtered
 *  OUT by the drafter itself (looksLikeListOrIndexUrl, structured-drafter.ts), so this
 *  is deliberately un-filtered here - just the cheap candidate pool the drafter then
 *  narrows down. Empty when the packet carries no competitor URL, never an error. */
function referenceCandidatesFor(packet: EvidencePacket): string[] {
  return [...new Set([
    packet.competitor.topUrl,
    ...(packet.competitor.otherUrls ?? []),
    ...dossierReferenceCandidates(packet.research),
  ])].filter(
    (u): u is string => !!u,
  ).slice(0, 12);
}

async function draftForPacket(
  packet: EvidencePacket,
  tenantId: string,
  opts: { complete?: CompleteFn; bypassCache?: boolean; authoritativeSourceDomains?: readonly string[] },
): Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>> {
  const evidenceHints = evidenceHintsFor(packet);
  // Prefer the tenant's real, impression-weighted GSC queries. Cold-start and
  // create-page moves retain the conservative label + fanout fallback.
  const observedQueries = packet.demand.queries
    .filter((row) => row.query.trim() && row.impressions > 0)
    .map((row) => ({ query: row.query, impressions: row.impressions }));
  const intent = classifyQueryIntent(observedQueries.length > 0
    ? observedQueries
    : [
        { query: packet.move.label, impressions: 2 },
        ...(packet.demand.fanoutSeeds ?? []).map((q) => ({ query: q, impressions: 1 })),
      ])?.dominant;
  const common = {
    query: packet.move.label,
    pageLabel: packet.yourPage.url ?? packet.move.label,
    outline: packet.draft.outline,
    evidenceHints,
    intent,
    tenantId,
    // Item 74: lets the drafter pull winning-pattern few-shots for this page family.
    pageFamily: packet.yourPage.url ? pageFamilyOfUrl(packet.yourPage.url) : undefined,
  };
  if (packet.move.gapType === "answer_block") {
    const researchedQuestions = (packet.research?.questions ?? [])
      .filter((row) => row.coverageStatus !== "answered")
      .map((row) => row.question);
    return draftAnswerBlockStructured(
      {
        ...common,
        brief: packet.draft.answerBlockBrief,
        faqs: [...new Set([
          ...packet.draft.faqQuestions,
          ...researchedQuestions,
          ...packet.demand.fanoutSeeds,
        ])].slice(0, 12),
        referenceCandidates: referenceCandidatesFor(packet),
      },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  if (packet.move.gapType === "edit_page") {
    return draftAtomicEditStructured(
      { ...common, field: "title", currentValue: packet.yourPage.facts?.title ?? null },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  if (packet.move.gapType === "create_page") {
    return draftCreatePageStructured(
      {
        query: packet.move.label,
        pageLabel: packet.yourPage.url ?? packet.move.label,
        competitorPages: [packet.competitor.topUrl, ...(packet.competitor.otherUrls ?? [])].filter((u): u is string => !!u),
        fanoutQueries: [...new Set([
          ...packet.demand.queries.map((row) => row.query),
          ...(packet.demand.fanoutSeeds ?? []),
          ...(packet.research?.questions ?? [])
            .filter((row) => row.coverageStatus !== "answered")
            .map((row) => row.question),
        ])],
        evidenceHints,
        referenceCandidates: referenceCandidatesFor(packet),
      },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  if (packet.move.gapType === "fix_experience") {
    const frictionGap = packet.gaps.find((g) => g.kind === "ux_friction");
    return draftCROFixStructured(
      {
        pageLabel: packet.yourPage.url ?? packet.move.label,
        frictionDetail: frictionGap?.detail ?? `Clarity friction score ${packet.yourPage.friction} on this page`,
      },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  return { status: "off" };
}

function outcomeOf(pack: PreparedMovePack, packet: EvidencePacket, opinions: ReturnType<typeof attachOpinions>, note: string): PrepareMoveOutcome {
  const present = new Set(opinions.map((o) => o.specialist));
  const draftVal = (pack.structuredDraft as { value?: { evidenceRefs?: unknown[]; risks?: unknown[] } } | null)?.value;
  return {
    moveId: pack.moveId,
    label: packet.move.label,
    targetUrl: pack.targetUrl,
    gap: pack.moveType,
    action: pack.routerDecision.action,
    preparedStatus: pack.preparedStatus,
    draftKind: (pack.structuredDraft as { kind?: string } | null)?.kind ?? null,
    evidenceRefsCount: Array.isArray(draftVal?.evidenceRefs) ? draftVal!.evidenceRefs!.length : 0,
    proofPlanPresent: (pack.proofPlan?.metrics?.length ?? 0) > 0,
    risksCount: Array.isArray(draftVal?.risks) ? draftVal!.risks!.length : 0,
    missingEvidence: ALL_SPECIALISTS.filter((s) => !present.has(s)),
    note,
  };
}

/** Pure per-run cap predicate — start a draft only when its conservative projection
 *  still fits under the ceiling. `maxUsd = Infinity` (the default) always affords. */
export function canAffordDraft(spentUsd: number, projectedUsd: number, maxUsd: number): boolean {
  return spentUsd + projectedUsd <= maxUsd;
}

/** Quality status of a pack's current draft (the gate's verdict), or null. */
function packQualityStatus(
  pack: PreparedMovePack | null,
  gateConfig?: { authoritativeSourceDomains?: readonly string[]; firstMentionConfig?: FirstMentionConfig | null },
): string | null {
  if (!pack?.structuredDraft) return null;
  return evaluatePreparedPackQuality({
    structuredDraft: pack.structuredDraft as { kind?: string; value?: unknown },
    preparedStatus: pack.preparedStatus,
    moveType: pack.moveType,
    repeatFlagged: pack.draftRepeatFlag != null,
    authoritativeSourceDomains: gateConfig?.authoritativeSourceDomains,
    firstMentionConfig: gateConfig?.firstMentionConfig,
  }).status;
}

/** A short excerpt of a draft's primary text, for recoverability metadata. */
function draftExcerpt(pack: PreparedMovePack | null): string | null {
  const v = (pack?.structuredDraft as { value?: Record<string, unknown> } | null)?.value;
  if (!v) return null;
  const text = (v.answer ?? v.after ?? v.openingAnswer ?? v.fix ?? "") as string;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, 200) : null;
}

/** Existing-page move types handled alongside create_page by the final-ranked
 * live Google-results check. */
const EXISTING_MOVE_TYPES = new Set<string>(["answer_block", "edit_page", "fix_experience"]);
const SERP_VERDICT_FRESH_MS = 14 * 24 * 60 * 60 * 1000; // align to the 14d SERP cache

/**
 * RANK-3: the LIVE Google-results winnability check for ONE existing-page move.
 * Cache-first (a fresh persisted serp_verdict is reused at $0), then a single
 * runSerpQuery call whose OWN money gauntlet (configured -> cache -> DRY-RUN
 * default -> global breaker -> per-platform monthly cap, fail-CLOSED -> ledger)
 * decides whether a cent is ever spent. A verdict is derived + persisted ONLY
 * on a real read (ok / cache_hit), exactly like prepare-create-page-verdicts;
 * on dry-run / disabled / capped / error it returns { verdict: null } so the
 * caller's readiness is byte-identical to pre-RANK-3 (no hold, no line, no spend).
 *
 * Pass a `runSerp` override in tests so no live paid call is ever made.
 */
async function checkExistingPageWinnability(
  tenantId: string,
  packet: EvidencePacket,
  ownDomain: string,
  nowIso: string,
  saved: Map<string, { content?: string }>,
  runSerp: typeof runSerpQuery,
  prefetched?: SerpRunResult,
): Promise<{ verdict: PreparedSerpVerdict | null; costUsd: number }> {
  const demandKey = packet.move.key;
  const query = packet.move.label?.trim();
  if (!query) return { verdict: null, costUsd: 0 };

  // Cache-first (pack-level): reuse a fresh persisted serp_verdict at $0.
  const cached = parsePreparedVerdict(saved.get(`${demandKey}::serp_verdict`)?.content);
  if (cached?.generatedAt && Date.parse(nowIso) - Date.parse(cached.generatedAt) < SERP_VERDICT_FRESH_MS) {
    return { verdict: cached, costUsd: 0 };
  }

  // Live read behind the full runSerpQuery money gauntlet. Only ok/cache_hit is
  // a real snapshot; everything else means "no verdict" (no spend, no hold).
  let r;
  try {
    r = prefetched ?? await runSerp(query, { depth: 10 });
  } catch {
    return { verdict: null, costUsd: 0 };
  }
  if (r.status !== "ok" && r.status !== "cache_hit") {
    return { verdict: null, costUsd: 0 };
  }

  // Keep AI overlap honest. The packet's leading competitor may now be a
  // winner discovered by this same Google read, which is not independent AI
  // confirmation merely because it was added to the packet before drafting.
  const aeoUrls = packet.research?.ai?.topCitedPages
    .filter((page) => !page.isOwned)
    .map((page) => page.url) ?? [];
  const overlapUrls = packet.research
    ? aeoUrls
    : packet.competitor.otherUrls.concat(packet.competitor.topUrl ?? "");
  const profoundDomains = [...new Set(overlapUrls.map((url) => rootDomain(url)).filter(Boolean))];
  const v = validateCreatePage({ snapshot: r.snapshot, ownDomain, profoundDomains, searchVolume: null });
  const compact: PreparedSerpVerdict = {
    verdict: v.verdict,
    confidence: v.confidence,
    intent: v.intent,
    contentDomainCount: v.contentDomainCount,
    marketplaceUgcCount: v.marketplaceUgcCount,
    profoundOverlapCount: v.profoundOverlapCount,
    ownAlreadyRanks: v.ownAlreadyRanks,
    topDomains: v.topDomains.slice(0, 5),
    reason: v.reasons[0] ?? "",
    generatedAt: nowIso,
    costUsd: r.costUsd,
  };
  await saveMoveDraft(tenantId, demandKey, "serp_verdict", JSON.stringify(compact)).catch(() => false);
  return { verdict: compact, costUsd: prefetched ? 0 : r.status === "ok" ? r.costUsd : 0 };
}

/** Derive the tenant's own root domain from the graph's page URLs (most common). */
function deriveOwnDomainFromPackets(packets: ReadonlyArray<EvidencePacket>): string {
  const counts = new Map<string, number>();
  for (const p of packets) {
    const d = rootDomain(p.yourPage.url ?? "");
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export async function prepareTodayMovesForTenant(
  tenantId: string,
  opts: {
    maxN?: number;
    now?: () => Date;
    complete?: CompleteFn;
    /** Hard per-run spend ceiling — stop before a draft that would exceed it. */
    maxUsd?: number;
    /** Always re-draft (skip the cache-first serve) — used by teardown regeneration. */
    forceRegenerate?: boolean;
    /** Only prepare Moves that carry an on-topic competitor teardown. */
    requireTeardown?: boolean;
    /** RANK-3: run a live Google-results winnability check per existing-page move
     *  before drafting (default ON). The check is cache-first + rides
     *  runSerpQuery's full money gauntlet, so with SERP unconfigured / dry-run /
     *  cache-empty it makes NO live call and leaves readiness byte-identical.
     *  Set false to skip the check entirely. */
    checkWinnability?: boolean;
    /** RANK-3 (tests): inject the SERP runner so no live paid call is ever made. */
    runSerp?: typeof runSerpQuery;
    /** Tests may inject the final-ranked research seam and winner auditor. */
    researchRankedSerps?: typeof researchFinalRankedSerps;
    auditSerpWinnerUrls?: RankedSerpResearchDeps["auditUrls"];
    /** Authoritative final /changes order. When supplied, preparation follows
     *  this exact sequence instead of independently re-ranking graph packets. */
    rankedEntries?: readonly RankedUnifiedEntry[];
  } = {},
): Promise<PrepareMovesSummary> {
  const max = opts.maxN ?? 10;
  const maxUsd = opts.maxUsd ?? Infinity;
  const nowIso = (opts.now ?? (() => new Date()))().toISOString();
  const checkWinnability = opts.checkWinnability !== false;
  const runSerp = opts.runSerp ?? runSerpQuery;
  // W5 P1-3 (2026-07-09): the tenant's own source-authority allowlist +
  // first-mention rule, resolved ONCE, so generation-time source stamping and
  // the quality gate both see this tenant's config (and never another
  // tenant's). Unset fields leave every gate byte-identical to today.
  const bizConfig = getBusinessConfig(tenantId);
  const authoritativeSourceDomains = bizConfig.authoritativeSourceDomains;
  const firstMentionConfig: FirstMentionConfig | null = bizConfig.firstMention ?? null;
  const summary: PrepareMovesSummary = {
    considered: 0,
    prepared: 0,
    readyToReview: 0,
    draftReady: 0,
    cached: 0,
    failed: 0,
    regenerated: 0,
    stoppedForBudget: false,
    llmCostUsd: 0,
    winnabilityHeld: 0,
    serpCostUsd: 0,
    serpQueriesChecked: 0,
    serpWinnerPagesAnalyzed: 0,
    serpWinnerPagesFromCache: 0,
    outcomes: [],
  };

  let rankedEntries = opts.rankedEntries;
  let prefetchedSerps = new Map<string, SerpRunResult>();
  if (checkWinnability && rankedEntries?.length) {
    const research = opts.researchRankedSerps ?? researchFinalRankedSerps;
    const researchDeps: Partial<RankedSerpResearchDeps> = { runSerp };
    if (opts.auditSerpWinnerUrls) researchDeps.auditUrls = opts.auditSerpWinnerUrls;
    const receipt = await research(
      rankedEntries,
      { maxEntries: max, winnersPerQuery: 2 },
      researchDeps,
    ).catch(() => null);
    if (receipt) {
      rankedEntries = receipt.entries;
      prefetchedSerps = receipt.byQuery;
      summary.serpCostUsd += receipt.costUsd;
      summary.serpQueriesChecked = (summary.serpQueriesChecked ?? 0) + receipt.queriesChecked;
      summary.serpWinnerPagesAnalyzed = (summary.serpWinnerPagesAnalyzed ?? 0) + receipt.winnerPagesAnalyzed;
      summary.serpWinnerPagesFromCache = (summary.serpWinnerPagesFromCache ?? 0) + receipt.winnerPagesFromCache;
    }
  }

  const { packets } = await loadChangePacksForTenant(tenantId, {
    limit: Math.max(max, 25),
    rankedEntries,
  }).catch(() => ({ packets: [] as EvidencePacket[] }));
  const orderedPackets = rankedEntries?.length
    ? packets
    : [...packets].sort((a, b) => b.move.score - a.move.score);
  const targets = orderedPackets
    .filter(
      (p) =>
        p.move.gapType === "answer_block" ||
        p.move.gapType === "edit_page" ||
        p.move.gapType === "fix_experience" ||
        p.move.gapType === "create_page",
    )
    .filter((p) => !opts.requireTeardown || hasUsableTeardown(p))
    .slice(0, max);
  summary.considered = targets.length;

  const saved = await getLatestMoveDrafts(tenantId).catch(() => new Map());

  // RANK-3: the tenant's own root domain (for "do you already rank" detection in
  // the live Google-results check). Derived once from the loaded packets' page URLs.
  const ownDomain = deriveOwnDomainFromPackets(packets);

  // Seasonality voice (BEACON_500 item 69): loaded ONCE per run (a cheap $0
  // json-store read), then looked up per Move by page family, so the team's
  // seasonal specialist can object to shipping into a demand cliff / flag
  // proactive prep the same way every other specialist reasons from its own
  // pre-loaded evidence.
  const seasonalProfiles = await loadFamilyDemandProfiles(tenantId).catch(() => []);
  const seasonalProfileByFamily = new Map(seasonalProfiles.map((p) => [p.pageFamily, p] as const));

  // Item 70: learned per-specialist vote weights (neutral 1.0 until the scoreboard has
  // settled verdicts, so cold routing stays byte-identical). Loaded once per prepare run.
  const specialistWeightTable = await loadSpecialistWeightTable(tenantId).catch(() => null);
  const specialistWeight = specialistWeightTable
    ? (s: string, f: string) => specialistWeightTable.get(s, f)
    : undefined;

  for (const packet of targets) {
    const moveId = packet.move.key;
    try {
      const seasonalProfile = packet.yourPage.url
        ? (seasonalProfileByFamily.get(pageFamilyOfUrl(packet.yourPage.url)) ?? null)
        : null;
      const opinions = attachOpinions(packet, { nowIso, seasonalProfile });
      const decision = routeMove({ packet, opinions, specialistWeight });

      // RANK-3: LIVE Google-results winnability check for existing-page moves
      // (answer_block / edit_page / fix_experience). Cache-first + rides
      // runSerpQuery's full money gauntlet, so it makes NO live call (and changes
      // NOTHING) when SERP is unconfigured / dry-run / cache-empty. When it does
      // land a verdict, an effectively-unwinnable move (marketplace/structural
      // top results, or the winnability numbers reject it) is HELD: we cap
      // readiness at serp_checked and skip the LLM draft entirely, rather than
      // spend on a confident "ready" move that cannot rank.
      let winnabilityLine: string | undefined;
      let winnabilityHold = false;
      let hasSerpVerdict = false;
      if (checkWinnability && (EXISTING_MOVE_TYPES.has(packet.move.gapType) || packet.move.gapType === "create_page")) {
        const { verdict, costUsd } = await checkExistingPageWinnability(
          tenantId,
          packet,
          ownDomain,
          nowIso,
          saved,
          runSerp,
          prefetchedSerps.get(packet.move.label.trim().toLocaleLowerCase("en-US")),
        );
        summary.serpCostUsd += costUsd;
        if (verdict) {
          hasSerpVerdict = true;
          if (packet.move.gapType === "create_page") {
            winnabilityHold = verdict.verdict === "reject";
            winnabilityLine = winnabilityHold
              ? `Google checked: do not build this page yet. ${verdict.reason}`
              : `Google checked: ${verdict.verdict.toUpperCase()} is supported. ${verdict.reason}`;
          } else {
            const hold = decideExistingPageHold({ verdict, moveType: packet.move.gapType as ExistingMoveType });
            winnabilityHold = hold.hold;
            winnabilityLine = hold.line ?? undefined;
          }
        }
      }

      // RANK-3: an effectively-unwinnable move is held BEFORE any LLM draft spend.
      // Persist a draft-less pack capped at serp_checked with the honest hold
      // line, so the card explains why instead of showing a "ready" move that
      // cannot rank. Never clobbers an existing good draft (latest-wins store).
      if (winnabilityHold) {
        const held = buildPreparedMovePack({
          tenantId,
          packet,
          opinions,
          decision,
          nowIso,
          structuredDraft: null,
          hasSerpVerdict: true,
          costSpent: { llmUsd: 0, serpUsd: 0 },
          winnabilityLine,
          winnabilityHold: true,
        });
        const existingForHold = parsePreparedPack(saved.get(`${moveId}::prepared_pack`)?.content);
        const serializedHeld = toPersistedPack(held);
        if (!existingForHold?.structuredDraft && serializedHeld.length <= MAX_PERSIST_CHARS) {
          await saveMoveDraft(tenantId, moveId, "prepared_pack", serializedHeld).catch(() => false);
        }
        summary.winnabilityHeld += 1;
        summary.outcomes.push(outcomeOf(held, packet, opinions, "held: Google results not winnable with a content change"));
        continue;
      }

      // Cache-first: serve a non-stale persisted pack that already has a draft —
      // UNLESS that cached draft fails the quality gate (generic / too-thin / off-topic
      // / meta non-answer). A quality-rejected draft is treated like a stale one and
      // re-drafted with the hardened prompt, so "Prepare" upgrades bad output in place.
      // forceRegenerate (teardown regeneration) ALWAYS re-drafts.
      const existing = parsePreparedPack(saved.get(`${moveId}::prepared_pack`)?.content);
      if (!opts.forceRegenerate && existing && existing.structuredDraft && !isPackStale(existing, packet.evidenceHash, nowIso)) {
        const q = evaluatePreparedPackQuality({
          structuredDraft: existing.structuredDraft as { kind?: string; value?: unknown },
          preparedStatus: existing.preparedStatus,
          moveType: existing.moveType,
          repeatFlagged: existing.draftRepeatFlag != null,
          authoritativeSourceDomains,
          firstMentionConfig,
        });
        if (q.copyAllowed) {
          summary.cached += 1;
          if (existing.preparedStatus === "ready_to_review") summary.readyToReview += 1;
          else if (existing.preparedStatus === "draft_ready") summary.draftReady += 1;
          summary.outcomes.push(outcomeOf(existing, packet, opinions, "cached (unchanged)"));
          continue;
        }
        // else fall through → regenerate this low-quality cached draft.
      }

      // Per-run spend ceiling (pre-check): only START a draft when its conservative
      // projection still fits under the cap. Paired with the post-check below (on ACTUAL
      // spent), this bounds overspend to a single in-flight draft.
      const projectedNext = packet.move.gapType === "create_page" ? 0.03 : 0.02;
      if (!canAffordDraft(summary.llmCostUsd, projectedNext, maxUsd)) {
        summary.stoppedForBudget = true;
        break;
      }

      // Capture the prior draft's quality + excerpt for regeneration provenance.
      const previousQuality = packQualityStatus(existing, { authoritativeSourceDomains, firstMentionConfig });
      const previousExcerpt = draftExcerpt(existing);

      // R16: an in-place regeneration (explicit teardown regenerate, or a
      // quality-rejected cached draft falling through above) must not be served
      // the identical cached output - bypass the call cache for a fresh take.
      const regenerateInPlace =
        opts.forceRegenerate === true ||
        (existing?.structuredDraft != null && !isPackStale(existing, packet.evidenceHash, nowIso));
      const draftRes = await draftForPacket(packet, tenantId, {
        complete: opts.complete,
        bypassCache: regenerateInPlace,
        authoritativeSourceDomains,
      });
      let structuredDraft: StructuredDraft = null;
      let experiment: ExperimentPlan | null = null;
      let checklist: ImplementationStep[] = [];
      let llmCost = 0;
      let note = "";
      if (draftRes.status === "drafted") {
        structuredDraft = { kind: draftRes.kind, value: draftRes.value };
        llmCost = draftRes.costUsd;
        checklist = (draftRes.value.operatorSteps ?? []).slice(0, 12).map((step) => ({ step, pushMethod: "manual" as const, done: false }));
        experiment = buildExperimentPlan(packet, decision, draftRes.value);
        note = draftRes.retried ? "drafted (retried)" : "drafted";
        if (draftRes.repeatFlag) note += " (reads like a repeat)";
      } else {
        llmCost = draftRes.status === "validation_failed" ? draftRes.costUsd : 0;
        note = draftRes.status === "off" ? "draft skipped (LLM off / no drafter)" : draftRes.status === "blocked_budget" ? "draft skipped (budget cap)" : `draft failed: ${(draftRes as { reason?: string }).reason ?? "invalid"}`;
      }
      summary.llmCostUsd += llmCost;

      // Teardown-regeneration provenance: only when we actually re-drafted (forceRegenerate)
      // AND the Move carries an on-topic teardown the draft was grounded in.
      const regenMeta: RegenMeta | undefined =
        opts.forceRegenerate && hasUsableTeardown(packet) && draftRes.status === "drafted"
          ? {
              regeneratedFromTeardown: true,
              competitorUrl: packet.competitor.topUrl,
              competitorDomain: packet.competitor.domain,
              previousQuality,
              newQuality: null, // filled below once the new pack's quality is evaluated
              costUsd: llmCost,
              source: "gpt-5-mini",
              previousExcerpt,
              regeneratedAt: nowIso,
            }
          : undefined;
      if (regenMeta) summary.regenerated += 1;

      const pack = buildPreparedMovePack({
        tenantId,
        packet,
        opinions,
        decision,
        nowIso,
        structuredDraft,
        experiment,
        implementationChecklist: checklist,
        costSpent: { llmUsd: llmCost, serpUsd: 0 },
        regenMeta,
        // R16: persist the de-templating flag so the quality gate demotes this
        // draft to needs-review on every later read.
        draftRepeatFlag: draftRes.status === "drafted" ? draftRes.repeatFlag : undefined,
        // RANK-3: the winnable move carries its honest "worth doing" Google-results
        // line + records that a live SERP verdict was checked (not held).
        hasSerpVerdict,
        winnabilityLine,
      });
      if (regenMeta) regenMeta.newQuality = packQualityStatus(pack, { authoritativeSourceDomains, firstMentionConfig });

      // NEVER clobber a good draft: if this (re)draft failed but a prior pack already
      // carries a structured draft, keep the prior one (move_drafts is latest-wins, so
      // persisting a draft-less pack here would destroy a working draft). Operator rule:
      // "do not overwrite good drafts blindly."
      const wouldClobberGoodDraft = draftRes.status !== "drafted" && !!existing?.structuredDraft;
      const serialized = toPersistedPack(pack);
      if (wouldClobberGoodDraft) {
        note += " (kept prior draft — regeneration didn't beat it)";
      } else if (serialized.length <= MAX_PERSIST_CHARS) {
        await saveMoveDraft(tenantId, moveId, "prepared_pack", serialized).catch(() => false);
      } else {
        log.warn("[prepare-today-moves] pack too large to persist", { tenantId, moveId, size: serialized.length });
        note += " (not persisted: too large)";
      }

      summary.prepared += 1;
      if (pack.preparedStatus === "ready_to_review") summary.readyToReview += 1;
      else if (pack.preparedStatus === "draft_ready") summary.draftReady += 1;
      if (draftRes.status !== "drafted") summary.failed += 1;
      summary.outcomes.push(outcomeOf(pack, packet, opinions, note));

      // Hard ceiling on ACTUAL spend (not just the pre-draft projection): once real
      // cost — including a validation_failed/retry that ran hotter than projected —
      // reaches the cap, stop before starting another draft. Bounds overspend to the
      // one in-flight draft; the monthly adjudicator cap is the backstop beneath this.
      if (summary.llmCostUsd >= maxUsd) {
        summary.stoppedForBudget = true;
        break;
      }
    } catch (e) {
      summary.failed += 1;
      summary.outcomes.push({
        moveId,
        label: packet.move.label,
        targetUrl: packet.yourPage.url,
        gap: packet.move.gapType,
        action: "wait",
        preparedStatus: "failed",
        draftKind: null,
        evidenceRefsCount: 0,
        proofPlanPresent: false,
        risksCount: 0,
        missingEvidence: ALL_SPECIALISTS,
        note: `threw: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`,
      });
    }
  }

  return summary;
}
