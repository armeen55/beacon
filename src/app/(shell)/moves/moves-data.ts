import "server-only";
import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { summarizeSpecialistDebate } from "@/domains/demand-graph/debate-summary";
import { loadActionPackWorklistForTenant } from "@/domains/action-pack/load";
import { competitorRelevance } from "@/domains/evidence/relevance-gate";
import { ACTION_LABEL, actionFamily, type ActionPack } from "@/domains/action-pack/types";

import { after } from "next/server";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";
import { buildTodayMovesData, type TodayMove, type TodayMovesHeroData } from "../today-moves-data";
import { readWorklistSurface, writeWorklistSurface, isSurfaceStale } from "../worklist-surface-store";
import { computeOpportunity } from "@/domains/forecast/opportunity-math";
import { defaultCtrCurve } from "@/domains/forecast/tenant-ctr-curve";
import { loadTenantCtrCurve } from "@/domains/forecast/load-tenant-ctr-curve";
import { rootDomainOf } from "@/domains/serp/serp-teardown-fusion";
import { buildWinnersPanel, type WinnerAudit, type WinnerLine } from "@/domains/demand-graph/winners-panel";
import { getCompetitorAuditsForTenantId, type CompetitorPageAudit } from "@/domains/demand-graph/competitor-page-audit";
import { getBusinessConfig, hydrateBusinessConfigFromSupabase } from "@/lib/business-config";

/**
 * /moves data (2026-06-27), the worklist is now driven by the CANONICAL ActionPack
 * brain (`loadActionPackWorklistForTenant`): the same deduped, cross-source-ranked
 * set the unified diagnostic proves. ActionPack decides WHAT shows + the ORDER; the
 * rich `TodayMove` (shared with Today `/`) supplies the full card body (title lab,
 * drafts, debate, prepared checklist) by joining on the page URL. Coverage-only AEO
 * packs the demand-graph worklist used to miss now appear inline (lightweight card).
 *
 * Create/hub packs are intentionally excluded here, they live on the New Pages board
 * (`TodayNewPagesSection`), which keeps the AI-validated badges + Draft AEO brief.
 * Read-only; no live Profound/DataForSEO on render (ActionPack reads cached/durable).
 */

const canon = (u: string): string => (canonicalizeCitationUrl(u) ?? u).toLowerCase().replace(/\/+$/, "");

/** Last-line P0 guard: an edit worklist may target only this tenant's owned
 * domain. Relative paths and the create-page sentinel are tenant-local; an
 * absolute URL for any other root domain is rejected, never rendered. */
export function targetBelongsToTenantDomain(targetUrl: string, ownedDomain: string): boolean {
  const target = targetUrl.trim();
  if (!target) return false;
  if (target === "needs_new_page" || target.startsWith("/")) return true;
  const own = rootDomainOf(ownedDomain);
  const candidate = rootDomainOf(target);
  return Boolean(own && candidate && own === candidate);
}

/** Render cap for /moves, the strongest N (single-user app; the full brain count
 *  stays in stats.movesReady). Filters narrow within the shown set. */
const MOVES_CAP = 75;

const EMPTY_STATS: TodayMovesHeroData["stats"] = {
  movesReady: 0, demandAtStake: 0, citationsContested: 0, pagesCovered: 0,
  draftsReady: 0, strikingWins: 0, losingQueries: 0, selfCompeting: 0,
  heldWhileMeasuring: 0, preparedReady: 0,
};

/** Map an ActionPack action type → the TodayMove action key (drives the card's
 *  tone + label + which affordances the MoveCard offers). */
function actionKeyOf(a: ActionPack["actionType"]): string {
  switch (a) {
    case "add_answer_block": return "add_answer_block";
    case "fix_conversion_friction": return "fix_page_experience";
    case "fix_title_meta_ctr": return "edit_title";
    case "add_internal_links":
    case "consolidate_pages": return "add_internal_links";
    default: return "edit_title"; // edit_existing_page
  }
}

function toneOf(p: ActionPack): TodayMove["actionTone"] {
  if (p.actionType === "add_answer_block") return "citation";
  if (p.actionType === "fix_conversion_friction") return "experience";
  if (p.actionType === "add_internal_links" || p.actionType === "consolidate_pages") return "experience";
  return "clicks";
}

/** G3 (Wave 4) - project a cached competitor-page-audit row into the lite facts
 *  shape winners-panel/whatToSteal already reads (mirrors the exact mapping
 *  today-moves-data.ts uses for the single-competitor "Steal this" line). */
function auditToWinnerAudit(a: CompetitorPageAudit | undefined): WinnerAudit | undefined {
  if (!a) return undefined;
  const f = a.facts;
  return {
    auditedAt: a.auditedAt ?? null,
    facts: f
      ? {
          hasAnswerBlock: f.hasAnswerBlock,
          hasFaq: f.hasFaq,
          faqQuestionCount: f.faqQuestionCount,
          schemaTypes: f.schemaTypes,
          hasToolOrCalculator: f.hasToolOrCalculator,
          wordCount: f.wordCount,
          sectionCount: f.sectionCount,
          hasReviewSchema: f.eeat?.hasReviewSchema,
        }
      : null,
  };
}

/** G3 (Wave 4) - "Who wins this topic now": fuse the pack's ALREADY-computed
 *  AI-cited competitors + Google top domains (no new fetch - both are already on
 *  the ActionPack) into the deduped, capped winner list, enriched with whatever
 *  competitor-page-audit facts are already cached for those URLs. Null when there
 *  is no competitor/Google evidence at all, so the detail view renders no panel
 *  rather than an empty one. */
function winnersForPack(p: ActionPack, audits: Map<string, CompetitorPageAudit>): WinnerLine[] | null {
  const competitorUrls = p.competitorPagesToBeat ?? [];
  const serpTopDomains = p.dataforseoValidation?.topDomains ?? [];
  if (competitorUrls.length === 0 && serpTopDomains.length === 0) return null;
  const winners = buildWinnersPanel({
    competitorUrls,
    serpTopDomains,
    ownDomain: rootDomainOf(p.targetUrl ?? ""),
    // Same key derivation the audit store itself uses (canonicalizeCitationUrl(url) ||
    // url) - NOT the local `canon()` helper above, which additionally lowercases/strips
    // trailing slashes for the page-URL join and would miss real cache hits here.
    getAudit: (url) => auditToWinnerAudit(audits.get(canonicalizeCitationUrl(url) || url)),
  });
  return winners.length > 0 ? winners : null;
}

function prettyPath(url: string): string {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "");
    return p === "" ? "Home" : p;
  } catch {
    return url;
  }
}

/** B9 (worklist fix batch) - a raw slug ("/persian-male-names") is not a page title; prefer
 *  the pack's human topic label when it reads like real words, not a slug/URL fragment. */
function looksLikeSlug(s: string): boolean {
  return /^\/?[a-z0-9]+(?:[-_][a-z0-9]+)*\/?$/.test(s.trim()) && !s.includes(" ");
}
function humanPageLabel(p: ActionPack): string {
  const path = p.targetUrl ? prettyPath(p.targetUrl) : p.label;
  if (p.label && p.label.trim() && !looksLikeSlug(p.label)) return p.label.trim();
  return path;
}

/** Lightweight TodayMove from an ActionPack, used for coverage-only AEO packs that
 *  have no rich demand-graph move to join to. Honest: rich-only fields stay empty. */
function actionPackToTodayMove(p: ActionPack): TodayMove {
  const action = actionKeyOf(p.actionType);
  return {
    id: p.id,
    action,
    actionLabel: ACTION_LABEL[p.actionType],
    actionTone: toneOf(p),
    query: p.label,
    targetUrl: p.targetUrl ?? "needs_new_page",
    pageLabel: humanPageLabel(p),
    why: p.whyNotNoise,
    proof: p.profoundReceipt
      ? `AI is asked “${p.profoundReceipt.topPrompt}”: ${p.profoundReceipt.citedDomains.slice(0, 2).join(", ")} cited${p.profoundReceipt.ownAbsent ? ", you're not" : ""}.`
      : "",
    confidence: p.confidence,
    demand: p.gscDemand?.impressions ?? null,
    demandBasis: p.gscDemand && p.gscDemand.impressions > 0 ? "gsc" : p.profoundReceipt ? "ai_attention" : null,
    whoCited:
      p.profoundReceipt?.citedDomains?.[0] &&
      competitorRelevance(p.label, { url: p.profoundReceipt.citedDomains[0], title: p.profoundReceipt.citedDomains[0] }).relevant
        ? p.profoundReceipt.citedDomains[0]
        : null,
    // Evidence relevance gate: suppress an off-topic / noise competitor page (a
    // facebook.com/TasteAtlas eggplant URL on a flag page) from "what wins".
    whatWins:
      p.competitorPagesToBeat?.[0] &&
      competitorRelevance(p.label, { url: p.competitorPagesToBeat[0], title: p.competitorPagesToBeat[0] }).relevant
        ? p.competitorPagesToBeat[0]
        : null,
    yourGap: "",
    topQueries: [],
    declines: [],
    cannibalization: [],
    ga4: p.ga4Value ? { sessions: p.ga4Value.sessions, conversions: p.ga4Value.conversions } : null,
    friction: null, // ActionPack carries a friction score, not the dead/rage split the card renders
    looselyMatched: false,
    also: [],
    outline: [],
    answerBrief: null,
    draftTitle: null,
    draftMeta: null,
    faqs: [],
    schema: [],
    titleVariants: [],
    rankWhy: `Ranked by ${p.evidenceSources.join(" + ")}.`,
    score: p.priorityScore,
    savedAnswerBlock: null,
    savedFaqJsonLd: null,
    specialists: [],
    debate: summarizeSpecialistDebate([]),
    routerAction: null,
    routerRationale: null,
    routerConfidence: null,
    preparedStatus: null,
    preparedChecklist: null,
    preparedDraftKind: null,
    preparedDraftText: null,
    preparedQuality: null,
    preparedExperiment: null,
    preparedStale: false,
    learnedTag: null,
  };
}

async function loadUncached(tenantId: string): Promise<TodayMovesHeroData> {
  // G3 (Wave 4) - the SAME competitor-page-audit cache loadChangePacksForTenant already
  // reads (react `cache()`-deduped, so this is a free re-read within the request, not a
  // new fetch) - reused here to enrich the winners panel with cached teardown facts.
  const [wl, hero, audits, hydratedConfig] = await Promise.all([
    loadActionPackWorklistForTenant(tenantId).catch(() => null),
    buildTodayMovesData(tenantId, { limit: 60 }).catch((): TodayMovesHeroData | null => null),
    getCompetitorAuditsForTenantId(tenantId).catch((): Map<string, CompetitorPageAudit> => new Map()),
    hydrateBusinessConfigFromSupabase(tenantId).catch(() => null),
  ]);
  const ownedDomain = (hydratedConfig ?? getBusinessConfig(tenantId)).domain;
  const safeHero = hero
    ? { ...hero, moves: hero.moves.filter((move) => targetBelongsToTenantDomain(move.targetUrl, ownedDomain)) }
    : null;

  // No canonical worklist → fall back to the rich hero set (never a blank page).
  if (!wl) return safeHero ?? { moves: [], stats: EMPTY_STATS, learning: { measuring: 0, won: 0, lost: 0, headline: null }, cockpit: null };

  // Index rich demand-graph moves by canonical page URL for the join (one per page).
  const richByUrl = new Map<string, TodayMove>();
  for (const m of safeHero?.moves ?? []) {
    if (m.targetUrl && m.targetUrl !== "needs_new_page") richByUrl.set(canon(m.targetUrl), m);
  }

  // Cross-enrich (W6): a coverage-only (profound) pack and a demand-graph pack can
  // describe the SAME owned URL. Union their evidence sources by canonical URL so a
  // coverage card honestly shows the GSC/Clarity/etc. the brain already has for that
  // page, not a misleadingly profound-only chip row. Honest: only real sources.
  const sourcesByUrl = new Map<string, Set<string>>();
  for (const p of wl.packs) {
    if (!p.targetUrl) continue;
    const key = canon(p.targetUrl);
    const set = sourcesByUrl.get(key) ?? new Set<string>();
    for (const s of p.evidenceSources) set.add(s);
    sourcesByUrl.set(key, set);
  }

  const usedRich = new Set<string>();
  const moves: TodayMove[] = [];
  for (const p of wl.packs) {
    // Create/hub packs live on the New Pages board, not this worklist.
    const fam = actionFamily(p.actionType);
    if (fam === "new_page" || fam === "hub") continue;
    if (!p.targetUrl || !targetBelongsToTenantDomain(p.targetUrl, ownedDomain)) continue;

    const chips = p.targetUrl ? [...(sourcesByUrl.get(canon(p.targetUrl)) ?? p.evidenceSources)] : p.evidenceSources;
    const dfs = p.dataforseoValidation
      ? { verdict: p.dataforseoValidation.verdict, topDomains: p.dataforseoValidation.topDomains.slice(0, 3), overlap: p.dataforseoValidation.profoundOverlapCount }
      : null;
    const rich = p.targetUrl ? richByUrl.get(canon(p.targetUrl)) : undefined;
    if (rich) {
      if (usedRich.has(rich.id)) continue; // one rich card per page
      usedRich.add(rich.id);
      // G3 (Wave 4) - "Who wins this topic now": fuse this pack's already-computed
      // AI-cited competitors + Google top domains into the deduped winner list.
      // Thread it + the canonical ActionPack provenance + SERP verdict onto the rich
      // card (they were computed on the pack but dropped at this projection).
      moves.push({ ...rich, sourceChips: chips, dataforseoVerdict: dfs, winners: winnersForPack(p, audits) });
    } else {
      // coverage-only AEO pack, surfaced inline, with cross-enriched provenance.
      moves.push({ ...actionPackToTodayMove(p), sourceChips: chips, dataforseoVerdict: dfs, winners: winnersForPack(p, audits) });
    }
  }

  // Cap the rendered worklist to the strongest MOVES_CAP so /moves feels powerful,
  // not endless, the true total is preserved in stats.movesReady (the brain size).
  const trueTotal = moves.length;
  const shown = moves.slice(0, MOVES_CAP);

  // D7 (honest opportunity math, DREAM SITE V1) - was a raw sum of demand-graph weight/GSC
  // impressions ("500k people at risk" territory). Now the sum of each move's own CTR-curve
  // forecast midpoint (opportunity-math.ts) - honest-zero for a move with no position/impression
  // history yet (e.g. a coverage-only pack with no topQueries), never an inflated impression count.
  // R9: sized with the tenant's OWN fitted position-to-clicks curve when they have
  // enough of their own search data; the industry default (byte-identical) otherwise.
  const ctrCurve = await loadTenantCtrCurve(tenantId).catch(() => defaultCtrCurve());
  const demandAtStake = Math.round(
    moves.reduce((s, m) => {
      const tq = [...m.topQueries].sort((a, b) => b.impressions - a.impressions)[0];
      if (!tq || tq.impressions <= 0) return s;
      const forecast = computeOpportunity({
        tenantId,
        page: m.targetUrl,
        lever: m.action,
        currentPosition: tq.position,
        impressions90d: tq.impressions,
        clicks90d: tq.clicks,
        curve: ctrCurve,
      });
      if (forecast.lowPerMonth == null || forecast.highPerMonth == null) return s;
      return s + (forecast.lowPerMonth + forecast.highPerMonth) / 2;
    }, 0),
  );

  const stats: TodayMovesHeroData["stats"] = {
    movesReady: trueTotal,
    demandAtStake,
    citationsContested: moves.filter((m) => m.actionTone === "citation").length,
    pagesCovered: new Set(moves.map((m) => m.targetUrl)).size,
    draftsReady: moves.filter((m) => m.savedAnswerBlock || m.preparedChecklist?.draftPrepared).length,
    strikingWins: safeHero?.stats.strikingWins ?? 0,
    losingQueries: safeHero?.stats.losingQueries ?? 0,
    selfCompeting: safeHero?.stats.selfCompeting ?? 0,
    heldWhileMeasuring: safeHero?.stats.heldWhileMeasuring ?? 0,
    preparedReady: moves.filter((m) => m.preparedChecklist?.readyToReview).length,
  };

  // Today-cockpit projection, the few pack-derived counts the `/` cockpit needs, computed
  // here (from the SAME `wl` this surface is built from) so Today reads them off this cached
  // snapshot instead of rebuilding the ~20s ActionPack worklist on its critical path.
  const cockpit: TodayMovesHeroData["cockpit"] = {
    newPagesCount: wl.packs.filter((p) => {
      const fam = actionFamily(p.actionType);
      return fam === "new_page" || fam === "hub";
    }).length,
    aiValidatedCount: wl.packs.filter((p) => p.dataforseoValidation?.verdict === "build").length,
    sourceCoverage: wl.summary.sourceCoverage,
  };

  return { moves: shown, stats, learning: safeHero?.learning ?? { measuring: 0, won: 0, lost: 0, headline: null }, cockpit };
}

/** Injectable builder so tests can drive the SWR flow without running the heavy
 *  ~32s ActionPack/demand-graph compute (mirrors changes-data.ts's ChangesViewBuilder). */
type WorklistSurfaceBuilder = (tenantId: string) => Promise<TodayMovesHeroData>;

/**
 * Stale-while-revalidate surface cache. The cold compute (`loadUncached`) rebuilds the
 * demand graph from Supabase (~32s) and floors /changes at ~50s, only `react.cache`
 * (per-request), no cross-request persistence. So: serve the last persisted snapshot
 * INSTANTLY (with its `computedAt` for an honest "updated N ago"), and when it's stale
 * refresh in the background via `after()` (best-effort; if the lambda freezes mid-refresh
 * the next visit retries). Only the first-ever load (cold cache) pays the full compute.
 * Mutating actions invalidate the surface so operator changes show on the next load.
 *
 * Exported for tests; render paths go through loadMovesWorklist below. The optional
 * `build` dep lets a test observe the cold/stale/tenant-threading behavior with a cheap
 * fake builder instead of the real compute.
 */
export async function loadSurfaceWithSwr(
  tenantId: string,
  deps: { build?: WorklistSurfaceBuilder } = {},
): Promise<TodayMovesHeroData> {
  const build = deps.build ?? loadUncached;
  // Sibling fix (2026-07-10 hygiene batch) - thread the EXPLICIT tenantId into both the
  // read and the after() background write, the same P2-f discipline changes-surface-store
  // already applies: writeWorklistSurface's own persistence would otherwise resolve the
  // write's tenant via json-store's ambient currentTenantSlug() (request-header-based),
  // which is not guaranteed correct in a background task outside the render's request
  // scope. `tenantId` is already threaded through `build(tenantId)` below - thread it
  // through the read/write too, so the two can never disagree.
  const cached = await readWorklistSurface(tenantId).catch(() => null);
  if (cached) {
    if (isSurfaceStale(cached.computedAt, Date.now())) {
      after(async () => {
        try {
          const fresh = await build(tenantId);
          await writeWorklistSurface(fresh, new Date().toISOString(), tenantId);
        } catch (e) {
          // Best-effort background refresh; the next visit retries. N39: record
          // it durably so a silently-always-stale worklist is visible on
          // /diagnostics/errors instead of vanishing with the lambda logs.
          await recordAppError({
            route: "/changes",
            tenantId,
            action: "background-refresh",
            ...errorFieldsFrom(e),
          });
        }
      });
    }
    return { ...cached.data, surfaceComputedAt: cached.computedAt };
  }
  // First-ever / invalidated → compute synchronously, then persist for next time.
  const fresh = await build(tenantId);
  await writeWorklistSurface(fresh, new Date().toISOString(), tenantId);
  return fresh;
}

/** Request-memoized /moves worklist, ActionPack-powered, SWR-cached cross-request. */
export const loadMovesWorklist = cache(
  async (): Promise<TodayMovesHeroData> => loadSurfaceWithSwr(await currentTenantId()),
);

/**
 * Nightly warm pass entry (BEACON 500 item 13): rebuild the worklist surface NOW and
 * persist it - the same `loadUncached` + write the SWR path runs in the background,
 * exposed so the 5am precompute cron can front-run the morning open. Build-then-write:
 * a failed rebuild throws and the previous snapshot stays in place.
 */
export async function refreshWorklistSurface(tenantId: string): Promise<void> {
  const fresh = await loadUncached(tenantId);
  await writeWorklistSurface(fresh, new Date().toISOString(), tenantId);
}
