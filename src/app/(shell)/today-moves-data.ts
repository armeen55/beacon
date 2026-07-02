import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { loadDailyClicksByPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { buildTitleVariants } from "@/domains/demand-graph/ctr-title-scorer";
import { buildPageResearchPack, addressableVolume } from "@/domains/demand-graph/page-research-pack";
import { buildOnPagePlan } from "@/domains/demand-graph/page-element-plan";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { readCachedSerpPatterns } from "@/domains/serp/research-enrichment-producer";
import { whatToSteal } from "@/domains/experiments/daily-evidence-brief";
import { getLatestMoveDrafts, type MoveDraftRow } from "@/domains/demand-graph/move-draft-store";
import { evaluatePreparedPackQuality, type DraftQualityResult } from "@/domains/drafts/draft-quality";
import { competitorRelevance, internalLinkRelevance } from "@/domains/evidence/relevance-gate";
import { loadGscCannibalizationForTenant, type GscCannibalizationCase } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import { loadGa4PageValuesForTenant, type Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant, type ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { indexCannibalizationByUrl, type CannibalEntry } from "./today-declines-rows";
import {
  loadTopQueriesForPages,
  loadQueryDeclinesForPages,
  type PageQuery,
  type QueryDecline,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import type { EvidencePacket } from "@/domains/demand-graph/evidence-packet";
import { attachOpinions } from "@/domains/demand-graph/specialist-opinions";
import { routeMove, type MoveRouterDecision } from "@/domains/demand-graph/move-router";
import { loadSpecialistWeightTable } from "@/domains/team-scoreboard/load-team-scoreboard";
import { summarizeSpecialistDebate, type DebateSummary } from "@/domains/demand-graph/debate-summary";
import {
  buildPreparedMovePack,
  parsePreparedPack,
  isPackStale,
  type PreparedStatus,
} from "@/domains/demand-graph/prepared-move-pack";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import {
  buildMeasurementPresentation,
  detectMeasurementOverlaps,
  type MeasurementPresentation,
} from "@/domains/proof-gsc/measurement-maturity";
import { proofCheckDates } from "@/domains/proof-gsc/measure";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { buildMeasuringHold, isHeldForMeasurement } from "./today-measuring-hold";
import { getStagingAvailability } from "@/domains/push/stage-change";
import { stageRouteForActionType, STAGING_OFF } from "@/domains/push/stage-route";
import { getWixUrlMap } from "@/lib/connectors/wix/url-map";
import { getWixConnectorToken } from "@/lib/connector-store";
import { buildWixEditorLink } from "@/domains/push/wix-deep-link";
import { computeOpportunity } from "@/domains/forecast/opportunity-math";

/**
 * today-moves-data (2026-06-24) - the loader behind the premium "Today's Moves"
 * ritual hero. Fuses the LIVE recommendation queue (persisted `recommended_edits`,
 * the demand-graph engine's promoted Moves) with the engine's EvidencePackets
 * (competitor teardown + grounded outline + demand + proof plan), joined by URL.
 *
 * Tenant-agnostic + read-only: when the engine is off for a tenant there are no
 * packets, so the hero is silent (empty → the section renders nothing). No
 * generation, no LLM, no writes - just the same persisted data the queue shows,
 * made beautiful.
 */

export type TodayMoveAction =
  | "add_answer_block"
  | "edit_title"
  | "fix_page_experience"
  | "create_page"
  | string;

export type TodayMove = {
  id: string;
  action: TodayMoveAction;
  actionLabel: string;
  actionTone: "citation" | "clicks" | "experience" | "page";
  query: string;
  targetUrl: string;
  pageLabel: string;
  why: string;
  proof: string;
  confidence: "high" | "medium" | "low";
  demand: number | null;
  demandBasis: "gsc" | "ai_attention" | "mixed" | null;
  whoCited: string | null;
  whatWins: string | null;
  /** Phase 1d: the actionable "steal this" line from the top competitor's page structure
   *  (direct answer / FAQ / tool / schema / depth), reusing the daily card's whatToSteal builder. */
  competitorSteal?: string | null;
  /** §1 "Your gap" - what the cited competitor has that your page lacks (plain language). */
  yourGap: string;
  /** The exact GSC queries this page already ranks for (light per-query path). */
  topQueries: PageQuery[];
  /** Queries this page is LOSING (recent 28d vs prior 28d) - the honest decay signal. */
  declines: QueryDecline[];
  /** Item 4: 70-day daily clicks for the page (sparkline next to the page name). */
  sparkline?: Array<{ date: string; clicks: number }>;
  /** Queries where this page competes with the tenant's OWN other pages (+ a consolidation fix). */
  cannibalization: CannibalEntry[];
  /** GA4 engagement/value (28d) for this page when available - the "is it worth it" signal. */
  ga4: { sessions: number; conversions: number } | null;
  /** Clarity UX friction (dead/rage click rates) when meaningful - the Friction component. */
  friction: { deadPct: number; ragePct: number } | null;
  looselyMatched: boolean;
  /** Other engine actions queued on the SAME page (so a page is one card, not many). */
  also: string[];
  outline: string[];
  answerBrief: string | null;
  /** Deterministic, grounded draft skeleton (NO LLM) - what the operator pastes. */
  draftTitle: string | null;
  draftMeta: string | null;
  faqs: string[];
  schema: string[];
  /** CTR Title Lab: scored, deterministic title variants for "capture clicks" Moves.
   *  Each carries a one-line `reason` (its generation strategy) so the operator sees
   *  WHY each title - not three interchangeable templates. */
  titleVariants: { title: string; score: number; signals: string[]; strategy?: string; reason?: string }[];
  /** The page's current <title> + the cited competitor's title - real evidence fed to
   *  the title generator so suggestions are page-specific (e.g. a "trim under 60 chars"
   *  variant). Internal; not rendered directly. */
  currentTitle?: string | null;
  competitorTitle?: string | null;
  /** Plain-language transparency for WHY this Move ranks where it does (the "one number"). */
  rankWhy: string;
  score: number;
  /** Previously-generated + persisted AI drafts, so they survive reload (no re-spend). */
  savedAnswerBlock: string | null;
  savedFaqJsonLd: string | null;
  /** P1-P3 (read-only): the specialist team's read on this Move - which teammates
   *  weighed in, the debated action + its rationale/confidence, and how prepared
   *  the Move is. Computed in-memory from the EvidencePacket; no writes, no publish,
   *  no paid calls. Null when there's no packet to reason over. */
  specialists: string[];
  /** Read-only specialist debate (who weighed in, conviction, objections) - $0,
   *  computed from this Move's already-built opinions. */
  debate: DebateSummary;
  routerAction: string | null;
  routerRationale: string | null;
  routerConfidence: "high" | "medium" | "low" | null;
  preparedStatus: PreparedStatus | null;
  /** P5 "prepared, not chores": the readiness strip + the persisted structured
   *  draft (from "Prepare my top 10"). Null until the Move has been prepared. */
  preparedChecklist: {
    googleChecked: boolean;
    aiChecked: boolean;
    competitorsRead: boolean;
    draftPrepared: boolean;
    proofPlanReady: boolean;
    readyToReview: boolean;
  } | null;
  preparedDraftKind: string | null;
  /** The paste-ready structured artifact text (answer block, or proposed title). */
  preparedDraftText: string | null;
  /** The experiment hypothesis attached to the prepared Move, if any. */
  preparedExperiment: string | null;
  /** True when the prepared pack is stale vs current evidence (re-prepare). */
  preparedStale: boolean;
  /** Deterministic quality verdict for the prepared draft - gates the copy button
   *  and honest readiness (generic/thin/off-topic drafts lose "Ready" + copy). */
  preparedQuality: DraftQualityResult | null;
  /** Sprint 3 - "ranked higher because similar moves won before" (learned prior
   *  tag from past outcomes). Null when there's no settled evidence yet. */
  learnedTag: string | null;
  /** Page-specific outcome caution (2026-06-28) - this page's OWN shipped change
   *  held-while-measuring / no-lift / lifted, with a small "Learning:" chip + a
   *  link to Results. Null when the page has no relevant shipped change. */
  outcomeCaution?: {
    kind: "held_measuring" | "no_lift" | "lifted" | "neutral";
    label: string | null;
    reason: string | null;
    evidence: string[];
    /** After a no-lift loss: a deterministic "try a different lever" next action. */
    nextLever?: string | null;
  } | null;
  /** Connectedness (2026-06-28) - the unified ActionPack source-provenance chips
   *  ("Ranked by gsc + profound + clarity") threaded from the canonical brain so
   *  the customer card shows what's behind the move, not just the diagnostic. */
  sourceChips?: string[];
  /** Connectedness - the cached DataForSEO SERP verdict for this move, threaded
   *  from ActionPack.dataforseoValidation so the build/wait/skip call is visible
   *  on the card operators use (was computed but dropped at the projection). */
  dataforseoVerdict?: { verdict: "build" | "wait" | "skip"; topDomains: string[]; overlap: number } | null;
  /** Outcome-threading (2026-06-28) - the proof status of the most recent shipped
   *  change on this move's page, so the card shows whether it's already measuring /
   *  won / no-lift without opening Results. Null when no proof row matches. */
  proofStatus?: "measuring" | "won" | "no_clear_lift" | "no_lift" | null;
  /** Teardown-regeneration (2026-06-28) - set when this draft was regenerated using the
   *  competitor page that currently wins. Drives the "Competitor-informed" trust chip +
   *  the "Improved using {domain}" line. Null on normal prepares. */
  competitorInformed?: { domain: string } | null;
  proofLabel?: string | null;
  /** True when the SAME page+action family is already mid-measurement (avoid
   *  encouraging a duplicate ship that would contaminate the open window). */
  alreadyMeasuring?: boolean;
  /** True when the page is measuring but for a DIFFERENT action family (a second
   *  change here would still muddy the open window - warn, don't block). */
  pageMeasuring?: boolean;
  /** P6 - the next proof checkpoint date for a measuring page (the soonest 7/14/28-day
   *  read still ahead), so the card can say "next read ~<date>" instead of a bare
   *  "measuring". Set only while measuring. */
  proofNextCheckpoint?: string | null;
  /** Move 2 - the shared measurement maturity of this move's proof (collecting →
   *  early → interim → mature/inconclusive/blocked/attribution_limited). The
   *  canonical Changes adapter uses this so an EARLY read shows as "Measuring",
   *  never a final "Result". Null when no proof row matches. */
  proofMaturity?: import("@/domains/proof-gsc/measurement-maturity").MeasurementMaturity | null;
  /** Move 2 - which way the basis window moved (positive/negative/neutral/unknown),
   *  independent of maturity. */
  proofDirection?: import("@/domains/proof-gsc/measurement-maturity").MeasurementDirection | null;
  /** PageResearchPack v1 (2026-06-29) - the per-page "what should this page OWN"
   *  research summary: intent clustering (own vs cross-link sibling) + the proof-aware
   *  primary lever + blocked levers + the top element opportunities. Computed from the
   *  page's free signals (GSC + fan-outs + cannibalization + proof). DataForSEO keyword
   *  VOLUME + SERP winner-title study attach later (dry-run-gated). Null for
   *  create-page / no-GSC moves. */
  researchPack?: {
    primaryIntent: string | null;
    /** Cached DataForSEO/keyword volume summed over the owned keywords (null if uncached). */
    addressableVolume: number | null;
    /** Cached SERP "what wins" pattern for the primary intent (null until enriched). */
    serpPattern: { format: string; titlePattern: string; elementImplication: string; winningDomains: string[] } | null;
    own: string[];
    sibling: string[];
    primaryLever: { lever: string; reason: string } | null;
    blockedLevers: { lever: string; reason: string }[];
    elements: { keyword: string; element: string; why: string }[];
    /** P4 - concrete "put X here" element plan: the one to do first + sections / FAQ
     *  targets / cross-links to add, each citing a real signal; + proof warnings. */
    onPagePlan: {
      doFirst: { slot: string; recommendation: string; evidence: string } | null;
      sections: { slot: string; recommendation: string; evidence: string }[];
      faqs: { slot: string; recommendation: string; evidence: string }[];
      internalLinks: { slot: string; recommendation: string; evidence: string }[];
      warnings: string[];
    } | null;
  } | null;
  /** Item 15 - one-click "Stage in Wix" (armed publishing). `enabled` shows the
   *  button (armed + permitted + a pushable change with real text); `nudge` shows
   *  the quiet publishing-settings pointer (Wix target, pushable, but not armed).
   *  Optional + additive: precomputed snapshots without it keep paste behavior. */
  staging?: { enabled: boolean; nudge: boolean };
  /** Item 45 - deep link straight into the Wix dashboard editor for this page's
   *  mapped CMS item (or its Stores product editor). Null/absent when the page
   *  is not resolvable to a live Wix item yet (no site connected, or no
   *  collection mapping) - the card then shows only "View page" as before. */
  wixEditorUrl?: string | null;
};

export type TodayMovesHeroData = {
  moves: TodayMove[];
  stats: {
    movesReady: number;
    demandAtStake: number;
    citationsContested: number;
    pagesCovered: number;
    /** How many of the shown Moves already have a precomputed AI draft waiting. */
    draftsReady: number;
    /** Striking-distance query opportunities across the shown Moves (quick CTR wins). */
    strikingWins: number;
    /** Queries the shown Moves' pages are losing ground on (recent vs prior). */
    losingQueries: number;
    /** Queries where the shown Moves' pages compete with the tenant's own other pages. */
    selfCompeting: number;
    /** Moves suppressed because their page is mid-measurement (Phase 2 hold). */
    heldWhileMeasuring: number;
    /** Shown Moves that are fully prepared (ready to review) after "Prepare my top 10". */
    preparedReady: number;
  };
  /** Sprint 3 - the learning loop's state from the proof ledger + priors. */
  learning: {
    measuring: number;
    won: number;
    lost: number;
    /** "Beacon learned: …" headline from the strongest learned prior, or null. */
    headline: string | null;
  };
  /** SWR surface cache (2026-06-29): when this render was served from the persisted
   *  snapshot, the ISO time it was computed (drives an honest "updated N ago" line).
   *  Undefined on a freshly-computed surface. */
  surfaceComputedAt?: string;
  /** Today-cockpit projection (2026-06-30): the few ActionPack-pack-derived counts the
   *  Today `/` cockpit needs (new-pages tile, AI-validated tile, source-coverage strip),
   *  computed at surface-build time from the SAME ActionPack worklist this surface is built
   *  from - so Today reads them from this CACHED snapshot instead of rebuilding the ~20s
   *  ActionPack worklist on its critical path. Null on the no-worklist fallback. */
  cockpit?: {
    newPagesCount: number;
    aiValidatedCount: number;
    sourceCoverage: { rank_revenue: number; profound: number; dataforseo: number; gsc: number; ga4: number; clarity: number; competitor_teardown: number };
  } | null;
};

const ACTION_META: Record<
  string,
  { label: string; tone: TodayMove["actionTone"] }
> = {
  add_answer_block: { label: "Win the AI citation", tone: "citation" },
  edit_title: { label: "Capture more clicks", tone: "clicks" },
  fix_page_experience: { label: "Fix the experience", tone: "experience" },
  create_page: { label: "Build a new page", tone: "page" },
};

// Hero shows ONLY the engine's Rank-&-Revenue Moves (not every queue row like
// schema fixes), collapsed to one card per page. Priority picks the primary
// action when a page has several.
const ACTION_PRIORITY: Record<string, number> = {
  add_answer_block: 3,
  edit_title: 2,
  fix_page_experience: 1,
  create_page: 0,
};
const CONF_RANK = { high: 3, medium: 2, low: 1 } as const;

const PROOF_MARKERS = ["You'll know it worked", "Once it's live"];

/** Pretty page name from a URL's last path segment. */
function prettyPage(url: string): string {
  try {
    const u = new URL(url);
    const slug = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return slug.replace(/[-_]+/g, " ").trim() || u.hostname;
  } catch {
    return url;
  }
}

/** Brand name from the owned domain's first label (e.g. iranopedia.com → Iranopedia). */
function brandFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const label = h.split(".")[0] ?? h;
    return label.replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

/** Split the persisted `why` into the action rationale + the proof sentence
 *  (the candidate builder appends a "You'll know it worked…" proof line). */
function splitWhyProof(whyRaw: string): { why: string; proof: string } {
  const why = (whyRaw ?? "").trim();
  for (const m of PROOF_MARKERS) {
    const i = why.indexOf(m);
    if (i > 0) return { why: why.slice(0, i).trim(), proof: why.slice(i).trim() };
  }
  return { why, proof: "" };
}

function canon(url: string | null | undefined): string {
  if (!url) return "";
  return (canonicalizeCitationUrl(url) ?? url).toLowerCase();
}

/** Plain-language "Your gap" from the deterministic owned-vs-competitor gaps
 *  (§1 Move card) - what the cited competitor has that your page is missing. */
const GAP_LABEL: Record<string, string> = {
  missing_page: "No page yet",
  missing_answer_block: "No answer block",
  missing_faq: "No FAQ section",
  missing_schema: "Missing schema",
  missing_tool: "No interactive tool",
};
function yourGapLine(gaps: ReadonlyArray<{ kind: string }>): string {
  const labels = [...new Set(gaps.map((g) => GAP_LABEL[g.kind]).filter(Boolean))];
  return labels.slice(0, 4).join(" · ");
}

/** Plain-language "why it ranks here" from the Rank-&-Revenue score components
 *  (Demand × Winnability × $Value × Visibility-Gap − Friction) - transparency, no jargon. */
function rankWhyFromComponents(
  c: { demand: number; winnability: number; dollarValue: number; visibilityGap: number; friction: number } | undefined,
): string {
  if (!c) return "";
  const bits: string[] = [];
  if (c.demand >= 5000) bits.push("high demand");
  else if (c.demand >= 1000) bits.push("real demand");
  if (c.winnability >= 0.85) bits.push("very winnable");
  else if (c.winnability >= 0.6) bits.push("winnable");
  if (c.visibilityGap >= 0.7) bits.push("you're not cited yet");
  // dollarValue is now REAL GA4 revenue (2026-06-26), not a conversion count, so
  // this bit only fires on pages with PROVEN money - honest "money page" framing.
  if (c.dollarValue > 0) bits.push("proven revenue");
  if (c.friction >= 15) bits.push("frustrating to visitors");
  return bits.slice(0, 3).join(" · ");
}

/** Fail-fast guard: the cockpit must NEVER hang on the heavy demand-graph compute
 *  (the /today statement-timeout class). On timeout the enrichment degrades to
 *  empty and the light queue read still renders the hero. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Tenant-explicit builder - the core join used by the request-cached loader AND
 * by the nightly precompute (which has no request context, so it can't derive
 * the tenant from currentTenantId()). Keep them sharing one implementation.
 */
export async function buildTodayMovesData(
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<TodayMovesHeroData> {
    const repo = getRepository().forTenant(tenantId);

    const [edits, packets, responses, savedDrafts, ledger, graphMoves] = await Promise.all([
      repo.getRecommendedEdits().catch(() => []),
      // Enrichment (teardown/outline/proof + the prepared-pack join) rides the heavy
      // graph compute. Was 8s - too tight for a cold render, which silently dropped
      // every move's preparedStatus (the "Prepared/Ready to draft" pill + the rich
      // checklist). The graph is cached (the cockpit warms it first), so 30s only
      // guards a genuine stall. Don't disappear.
      withTimeout(
        loadChangePacksForTenant(tenantId, { limit: 40 }).then((r) => r.packets ?? []),
        30000,
        [] as EvidencePacket[],
      ),
      repo.getRecommendationResponses().catch(() => []),
      // Previously-generated + persisted AI drafts (answer block / FAQ schema) so
      // they survive reload. Degrade-safe: empty map if the table isn't migrated.
      withTimeout(getLatestMoveDrafts(tenantId), 4000, new Map<string, MoveDraftRow>()),
      // Phase 2: the proof ledger → pages mid-measurement are HELD (a 2nd change to
      // a page under measurement contaminates the diff-in-diff). Fail-soft → [].
      withTimeout(loadShippedChanges(), 4000, [] as Awaited<ReturnType<typeof loadShippedChanges>>),
      // Sprint 3: the cached graph carries each Move's learnedPrior (the outcome
      // re-weight). Cache hit (loadChangePacksForTenant already computed it). The
      // learned tag ("ranked higher because similar moves won") rides this.
      withTimeout(
        loadDemandGraphForTenantCached(tenantId).then((r) => r.graph.moves).catch(() => []),
        30000,
        [] as Awaited<ReturnType<typeof loadDemandGraphForTenantCached>>["graph"]["moves"],
      ),
    ]);
    // Item 15 - can this operator one-click stage a pushable change in Wix right
    // now? One read per build; fails to OFF (paste behavior) on any uncertainty,
    // including the nightly precompute path which has no request context.
    const stagingAvail = await getStagingAvailability(tenantId).catch(() => STAGING_OFF);
    // Item 45 - "Open in Wix" deep links. ONE url-map read + ONE token read per
    // build (not per move), matching the staging read above. Fails to an empty
    // map / null site id on any uncertainty, which resolves every link to
    // honest null (the card then shows only "View page", today's behavior).
    const [wixUrlMap, wixToken] = await Promise.all([
      getWixUrlMap().catch(() => []),
      getWixConnectorToken(tenantId).catch(() => null),
    ]);
    const wixEntryByUrl = new Map(wixUrlMap.map((e) => [canon(e.url), e]));

    // Learned-prior tag per demand key (from the outcome re-weight on the graph).
    const learnedByKey = new Map(graphMoves.map((m) => [m.demandKey, m.learnedPrior ?? null]));
    const cautionByKey = new Map(graphMoves.map((m) => [m.demandKey, m.outcomeCaution ?? null]));
    // Outcome lifecycle state per page (from the proof ledger) - for the hero's
    // learning summary + the "Beacon learned" headline. Honest: derived from
    // settled verdicts only.
    // Move 2 - interpret every ledger record through the shared maturity model so an
    // EARLY (7/14-day) read is never threaded onto a card as a final win/loss. A
    // settled outcome is surfaced ONLY at mature_result; everything else stays
    // "measuring" with honest maturity language.
    const proofNow = new Date();
    const overlapById = detectMeasurementOverlaps(
      ledger.map((r) => ({ id: r.id, path: r.path, shippedAt: r.shippedAt })),
    );
    const presentationOf = (r: (typeof ledger)[number]): MeasurementPresentation => {
      const basisWin = (r.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
      return buildMeasurementPresentation({
        shippedAt: r.shippedAt,
        now: proofNow,
        latestGscDate: null, // card needs mature-vs-not, not the blocked/collecting split
        windows: (r.windows ?? []).map((w) => ({ day: w.day, ran: w.ran })),
        verdict: r.verdict,
        controlsUsed: basisWin?.controlsUsed ?? 0,
        baselineImpressions: r.baseline?.impressions ?? 0,
        overlap: overlapById.get(r.id) ?? null,
        live: true,
        // Parallel-trends veto (master plan item 33), additive - same posture
        // as the rest of this call site's omissions (e.g. shockWindows): a
        // missing field here just means this card doesn't show the caveat,
        // it never breaks the maturity/verdict computed above.
        weakComparison: r.controlMatchWeak === true,
      });
    };
    // Learning summary (hero) - count MATURE outcomes only; everything else is still
    // measuring. Honest: a 7-day "lost" is not a loss.
    const ledgerPres = ledger.map((r) => presentationOf(r));
    const learningSummary = {
      measuring: ledgerPres.filter((p) => p.maturity !== "mature_result").length,
      won: ledgerPres.filter((p) => p.verdict === "helped").length,
      lost: ledgerPres.filter((p) => p.verdict === "did_not_help").length,
    };
    // Outcome-threading (2026-06-28; Move 2): the most recent shipped change per page,
    // carrying its maturity presentation so a card shows honest measurement language
    // without opening Results. Keyed by canonical page URL. Display only.
    const proofByPage = new Map<string, { pres: MeasurementPresentation; shippedAt: string; actionType: string }>();
    for (const r of ledger) {
      const key = canon(r.page) || canon(r.path);
      const prev = proofByPage.get(key);
      if (!prev || Date.parse(r.shippedAt) > Date.parse(prev.shippedAt)) {
        proofByPage.set(key, { pres: presentationOf(r), shippedAt: r.shippedAt, actionType: r.actionType });
      }
    }
    // Owned-page paths currently on measurement-hold (verdict still measuring,
    // within the 28d window). Moves for these pages are suppressed below.
    const heldPaths = buildMeasuringHold(
      ledger.map((r) => ({ path: r.path, shippedAt: r.shippedAt, verdict: r.verdict })),
      Date.now(),
    );
    let heldWhileMeasuring = 0;

    // Skip Moves the operator already shipped/dismissed - so a one-tap "Ship it"
    // removes the card on the next render (the action revalidates "/").
    const actioned = new Set<string>();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    for (const r of responses as ReadonlyArray<{ recId: string; status: string; deferUntil?: string | null }>) {
      if (r.status === "accepted" || r.status === "dismissed") actioned.add(r.recId);
      else if (r.status === "deferred" && r.deferUntil && new Date(r.deferUntil).getTime() > nowMs) actioned.add(r.recId);
    }

    // Index packets by the owned page URL (the join key to a queued edit).
    const packetByUrl = new Map<string, EvidencePacket>();
    for (const p of packets) {
      const u = canon(p.yourPage?.url);
      if (u && !packetByUrl.has(u)) packetByUrl.set(u, p);
    }

    // Collect engine-action, live, not-actioned edits grouped by PAGE - so a page
    // is ONE premium card (primary action + "also on this page"), never several
    // near-duplicate cards. Non-engine queue rows (schema fixes etc.) are excluded;
    // they live in the full queue, not the §7 ritual hero.
    type Edit = (typeof edits)[number];
    const byPage = new Map<string, Edit[]>();
    for (const e of edits) {
      const status = (e as { implementation_status?: string }).implementation_status;
      if (status && status !== "recommended") continue;
      if (!e.target_url) continue;
      if (!(e.action_type in ACTION_META)) continue;
      const moveId = (e as { rec_id?: string; id?: string }).rec_id ?? (e as { id?: string }).id ?? "";
      if (moveId && actioned.has(moveId)) continue;
      // Proof-window guard (2026-06-28 - flipped hide→label): no longer SUPPRESS a
      // page that's mid-measurement. Show it, labelled (proofStatus/alreadyMeasuring/
      // pageMeasuring set in the enrichment pass below) with a softened "Ship anyway"
      // - hiding made the loop feel disconnected; labelling reality is honest. Keep
      // the counter for the stat.
      if (isHeldForMeasurement(e.target_url, heldPaths)) heldWhileMeasuring += 1;
      const pk = canon(e.target_url);
      const arr = byPage.get(pk) ?? [];
      arr.push(e);
      byPage.set(pk, arr);
    }

    // Item 70: learned per-specialist vote weights (neutral until verdicts settle, so
    // cold routing is byte-identical). cache()'d loader - one scoreboard read per render.
    const specialistWeightTable = await loadSpecialistWeightTable(tenantId).catch(() => null);
    const specialistWeight = specialistWeightTable
      ? (s: string, f: string) => specialistWeightTable.get(s, f)
      : undefined;

    const moves: TodayMove[] = [];
    for (const [pk, pageEdits] of byPage) {
      pageEdits.sort(
        (a, b) =>
          (ACTION_PRIORITY[b.action_type] ?? 0) - (ACTION_PRIORITY[a.action_type] ?? 0) ||
          CONF_RANK[(b.confidence as "high" | "medium" | "low") ?? "low"] -
            CONF_RANK[(a.confidence as "high" | "medium" | "low") ?? "low"],
      );
      const e = pageEdits[0]!;
      const targetUrl = e.target_url!;
      const packet = packetByUrl.get(pk);
      // P1-P3 (read-only): run the specialist team over this Move's packet, debate
      // it into one routed decision, and derive its prepared status. Pure +
      // in-memory - no writes, no publish, no paid calls. Extras (live SERP verdict,
      // CMS pushability) aren't threaded here yet, so DataForSEO/Wix abstain
      // honestly (broad SERP runs are P5/P6). Null-safe when there's no packet.
      const opinions = packet ? attachOpinions(packet, { nowIso }) : [];
      const decision: MoveRouterDecision | null = packet ? routeMove({ packet, opinions, specialistWeight }) : null;
      const inMemoryPack =
        packet && decision
          ? buildPreparedMovePack({ tenantId, packet, opinions, decision, nowIso })
          : null;
      // Prefer a PERSISTED prepared pack (from "Prepare my top 10") when it's not
      // stale - it carries the structured draft + experiment that lift the Move to
      // ready_to_review. Otherwise fall back to the in-memory (un-drafted) pack.
      const persistedPack = packet
        ? parsePreparedPack(savedDrafts.get(`${packet.move.key}::prepared_pack`)?.content)
        : null;
      const persistedFresh = !!(packet && persistedPack && !isPackStale(persistedPack, packet.evidenceHash, nowIso));
      const effectivePack = persistedFresh ? persistedPack : inMemoryPack;
      const preparedStale = !!(persistedPack && !persistedFresh);

      const specialistSet = new Set(opinions.map((o) => o.specialist));
      // The paste-ready structured artifact text (answer block / proposed title).
      // Computed BEFORE the checklist so "Draft prepared" reflects real paste-ready
      // CONTENT - not merely the existence of a structuredDraft object. Otherwise a
      // pack whose structuredDraft has empty answer/after shows "Draft prepared" on
      // the card while the Implement panel correctly says "No prepared paste-ready
      // content yet" (the two surfaces contradicted each other - the reported bug).
      const draftValue = (persistedFresh ? persistedPack!.structuredDraft : null) as
        | { kind?: string; value?: { answer?: string; after?: string } }
        | null;
      const preparedDraftText = draftValue?.value?.answer ?? draftValue?.value?.after ?? null;
      const draftPrepared = persistedFresh && !!preparedDraftText;
      // Deterministic quality verdict over the prepared draft (only when a fresh pack
      // with a structured draft exists). Drives honest readiness + copy gating.
      const preparedQuality =
        persistedFresh && persistedPack!.structuredDraft
          ? evaluatePreparedPackQuality({
              structuredDraft: persistedPack!.structuredDraft as { kind?: string; value?: unknown },
              preparedStatus: persistedPack!.preparedStatus,
              moveType: persistedPack!.moveType,
            })
          : null;
      // Evidence relevance gate (hoisted): a competitor teardown only counts as
      // "Competitors read ✓" / feeds "what wins" when it's ON-TOPIC for this Move.
      const moveTopicForEvidence = packet?.move?.label ?? prettyPage(targetUrl);
      const compUrl = packet?.competitor?.topUrl ?? "";
      const compRelevant =
        !!compUrl &&
        competitorRelevance(moveTopicForEvidence, { url: compUrl, title: packet?.competitor?.domain ?? null }).relevant;
      const preparedChecklist = effectivePack
        ? {
            googleChecked: specialistSet.has("gsc"),
            aiChecked: specialistSet.has("profound"),
            competitorsRead: !!packet?.competitor?.facts && compRelevant,
            draftPrepared,
            proofPlanReady: draftPrepared && (effectivePack.proofPlan?.metrics?.length ?? 0) > 0,
            // HONESTY: only a quality-passing draft is truly ready to review/ship.
            readyToReview:
              effectivePack.preparedStatus === "ready_to_review" &&
              (!preparedQuality || preparedQuality.status === "ready" || preparedQuality.status === "useful_but_needs_review"),
          }
        : null;
      const meta = ACTION_META[e.action_type] ?? { label: "Make this move", tone: "page" as const };
      const also = [
        ...new Set(
          pageEdits
            .slice(1)
            .map((x) => ACTION_META[x.action_type]?.label)
            .filter((l): l is string => Boolean(l) && l !== meta.label),
        ),
      ];
      const { why, proof } = splitWhyProof(e.why ?? "");
      const looselyMatched = packet?.competitor?.looselyMatched ?? false;
      // (moveTopicForEvidence / compUrl / compRelevant are hoisted above the prepared
      // checklist so "Competitors read ✓" + "what wins" share one relevance verdict.)
      const wwRaw = packet?.competitor?.whatWins?.trim() ?? "";
      // Gate the "what wins" TEXT too - it sometimes carries a junk URL distinct from
      // topUrl (a facebook.com/TasteAtlas eggplant page on "Safavid Flag"). Suppress a
      // noise-domain or off-topic teardown so it can't pose as evidence.
      const wwRelevant = wwRaw ? competitorRelevance(moveTopicForEvidence, { url: wwRaw, title: wwRaw }).relevant : false;
      const whatWins = wwRaw && wwRaw !== "-" && !looselyMatched && compRelevant && wwRelevant ? wwRaw : null;
      const whoCited =
        packet?.competitor?.domain && packet.competitor.fetchStatus === "ok" && !looselyMatched && compRelevant
          ? packet.competitor.domain
          : null;
      // Phase 1d: the actionable "steal this" line from the on-topic competitor's page structure
      // (reuses the daily card's pure whatToSteal builder). Only when we have a real, relevant teardown.
      const cf = packet?.competitor?.facts;
      const competitorSteal =
        whoCited && cf
          ? whatToSteal({
              hasAnswerBlock: cf.hasAnswerBlock,
              hasFaq: cf.hasFaq,
              faqQuestionCount: cf.faqQuestionCount,
              schemaTypes: cf.schemaTypes,
              hasToolOrCalculator: cf.hasToolOrCalculator,
              wordCount: cf.wordCount,
              sectionCount: cf.sectionCount,
              hasReviewSchema: cf.eeat?.hasReviewSchema,
            })
          : null;

      const query =
        packet?.move?.label ??
        (e as { topic_cluster_label?: string }).topic_cluster_label ??
        prettyPage(targetUrl);

      // Real page evidence for the title generator: the page's own <title> (drives a
      // "trim under 60 chars" suggestion) and the on-topic cited competitor's title.
      const currentTitle = packet?.yourPage?.facts?.title ?? null;
      const competitorTitle = compRelevant ? packet?.competitor?.facts?.title ?? null : null;

      // CTR Title Lab - deterministic, page-specific scored title variants for
      // "capture clicks" Moves (intent-aware framing + a reason per option).
      let titleVariants: TodayMove["titleVariants"] = [];
      if (e.action_type === "edit_title") {
        const brand = brandFromUrl(targetUrl);
        titleVariants = buildTitleVariants(query, brand, { currentTitle, competitorTitle }).slice(0, 3);
      }

      const moveId = (e as { rec_id?: string; id?: string }).rec_id ?? (e as { id?: string }).id ?? pk;
      // Item 15 - "Stage in Wix": only OFFER the button for a change the existing
      // push routes could carry, with real proposed text. The server action
      // re-checks every gate and fails closed to paste.
      const stageRoute = stageRouteForActionType(e.action_type, e.target_element_key ?? null);
      const hasStageText = Boolean((e.proposed_text ?? "").trim());
      const staging = {
        enabled: stagingAvail.enabled && stageRoute != null && hasStageText,
        nudge: stagingAvail.wixTarget && !stagingAvail.armed && stageRoute != null && hasStageText,
      };
      // Item 45 - "Open in Wix": a pure resolve from the same url-map entry the
      // push service uses, so the link only ever appears for a page Beacon
      // could actually publish to. Honest null renders no link.
      const wixEntry = wixEntryByUrl.get(pk);
      const wixEditorUrl = wixEntry
        ? buildWixEditorLink({
            siteId: wixToken?.site_id ?? null,
            dataCollectionId: wixEntry.dataCollectionId,
            dataItemId: wixEntry.dataItemId,
          })?.toString() ?? null
        : null;
      moves.push({
        id: moveId,
        action: e.action_type,
        staging,
        wixEditorUrl,
        actionLabel: meta.label,
        actionTone: meta.tone,
        query: packet?.move?.label ?? (e as { topic_cluster_label?: string }).topic_cluster_label ?? prettyPage(targetUrl),
        targetUrl,
        pageLabel: prettyPage(targetUrl),
        why: why || "Queued in your recommendations and ready to act on.",
        proof,
        confidence: (e.confidence as "high" | "medium" | "low") ?? "medium",
        demand: packet?.demand?.demandWeight ?? null,
        demandBasis: packet?.demand?.basis ?? null,
        whoCited,
        whatWins,
        competitorSteal,
        yourGap: whatWins ? yourGapLine(packet?.gaps ?? []) : "", // only when we have a real teardown to compare against
        topQueries: [], // filled below for the shown top moves (one bounded GSC read)
        declines: [], // filled below (recent vs prior window)
        cannibalization: [], // filled below (own-page competition)
        ga4: null, // filled below (GA4 engagement/value)
        friction: null, // filled below (Clarity dead/rage clicks)
        looselyMatched,
        also,
        outline: (packet?.draft?.outline ?? []).filter(Boolean).slice(0, 5),
        answerBrief: packet?.draft?.answerBlockBrief?.trim() || null,
        draftTitle: packet?.draft?.titleSuggestion?.trim() || null,
        draftMeta: packet?.draft?.metaBrief?.trim() || null,
        faqs: (packet?.draft?.faqQuestions ?? []).filter(Boolean).slice(0, 6),
        schema: (packet?.draft?.schemaRecommendations ?? []).filter(Boolean).slice(0, 6),
        titleVariants,
        currentTitle,
        competitorTitle,
        rankWhy: rankWhyFromComponents(packet?.move?.components),
        score: packet?.move?.score ?? 0,
        savedAnswerBlock: savedDrafts.get(`${moveId}::answer_block`)?.content ?? null,
        savedFaqJsonLd: savedDrafts.get(`${moveId}::faq`)?.content ?? null,
        specialists: opinions.map((o) => o.specialist),
        debate: summarizeSpecialistDebate(opinions),
        routerAction: decision?.action ?? null,
        routerRationale: decision?.rationale ?? null,
        routerConfidence: decision?.confidenceLevel ?? null,
        preparedStatus: effectivePack?.preparedStatus ?? null,
        preparedChecklist,
        preparedDraftKind: draftValue?.kind ?? null,
        preparedDraftText,
        preparedQuality,
        preparedExperiment: persistedFresh ? persistedPack!.experiment?.hypothesis ?? null : null,
        preparedStale,
        learnedTag: (packet ? learnedByKey.get(packet.move.key)?.tag : null) ?? null,
        outcomeCaution: (() => {
          const c = packet ? cautionByKey.get(packet.move.key) : null;
          return c && c.kind !== "neutral" && c.label
            ? { kind: c.kind, label: c.label, reason: c.reason, evidence: c.evidence, nextLever: c.nextLever ?? null }
            : null;
        })(),
        competitorInformed:
          persistedFresh && persistedPack!.regenMeta?.regeneratedFromTeardown && persistedPack!.regenMeta.competitorDomain
            ? { domain: persistedPack!.regenMeta.competitorDomain }
            : null,
      });
    }

    // Rank: engine score desc, then confidence, then demand.
    moves.sort(
      (a, b) =>
        b.score - a.score ||
        CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
        (b.demand ?? 0) - (a.demand ?? 0),
    );

    // Light per-query GSC grounding: ONE bounded `page IN (...)` read for a small
    // CANDIDATE POOL (indexed, capped - never the timeout-prone full RPC). Names the
    // exact queries each page ranks for AND lets striking-distance (the fastest,
    // highest-certainty CTR wins) influence which moves surface. Fail-soft → no
    // queries attached (then the pool order is just the engine score).
    const limit = opts.limit ?? 6;
    const pool = moves.slice(0, Math.max(limit, 12)); // bounded: ≤12 pages read
    const poolUrls = pool.map((m) => m.targetUrl);
    const [queryMap, declineMap, cannibalCases, ga4Values, clarityValues, cachedKeywords, cachedSerpPatterns, sparkMap] = await Promise.all([
      withTimeout(loadTopQueriesForPages(tenantId, poolUrls), 5000, new Map<string, PageQuery[]>()),
      withTimeout(loadQueryDeclinesForPages(tenantId, poolUrls), 6000, new Map<string, QueryDecline[]>()),
      withTimeout(loadGscCannibalizationForTenant(tenantId), 6000, [] as GscCannibalizationCase[]),
      withTimeout(loadGa4PageValuesForTenant(tenantId), 5000, new Map<string, Ga4PageValue>()),
      withTimeout(loadClarityPageSignalsForTenant(tenantId), 5000, new Map<string, ClarityPageSignal>()),
      // Cached DataForSEO keyword volume ONLY - a $0 cache read, no live call (the paid
      // population is the operator-gated producer behind DATAFORSEO_DRY_RUN). Fail-soft.
      withTimeout(readAllCachedKeywordDemand().catch(() => []), 4000, [] as Awaited<ReturnType<typeof readAllCachedKeywordDemand>>),
      // Cached SERP "what wins" patterns (also $0, producer-populated) → query → pattern.
      withTimeout(readCachedSerpPatterns().catch(() => new Map()), 4000, new Map() as Awaited<ReturnType<typeof readCachedSerpPatterns>>),
      // Item 4: 70d daily clicks per pooled page (one bounded IN(<=16) read) for sparklines.
      withTimeout(loadDailyClicksByPagesForTenant(tenantId, poolUrls), 5000, new Map<string, { date: string; clicks: number }[]>()),
    ]);
    // keyword (lowercased) → cached search volume, for the research pack's addressable demand.
    const volumeByKeyword = new Map<string, number | null>();
    for (const k of cachedKeywords) {
      const key = k.keyword.trim().toLowerCase();
      if (key && !volumeByKeyword.has(key)) volumeByKeyword.set(key, k.searchVolume);
    }
    // Canon-key the GA4 + Clarity values so a Move's targetUrl matches regardless of trailing-slash/case.
    const ga4ByCanon = new Map<string, Ga4PageValue>();
    for (const [url, v] of ga4Values) {
      const k = canon(url);
      if (k && !ga4ByCanon.has(k)) ga4ByCanon.set(k, v);
    }
    const clarityByCanon = new Map<string, ClarityPageSignal>();
    for (const [url, v] of clarityValues) {
      const k = canon(url);
      if (k && !clarityByCanon.has(k)) clarityByCanon.set(k, v);
    }

    // Index cannibalization cases by each competing own-URL → the cases it's in
    // (with the OTHER competing pages), so a Move whose page self-competes shows it.
    const cannibalByUrl = indexCannibalizationByUrl(cannibalCases, canon, prettyPage);

    // Canon-key the sparklines so trailing-slash/case never drops a match.
    const sparkByCanon = new Map<string, { date: string; clicks: number }[]>();
    for (const [url, series] of sparkMap) {
      const k = canon(url);
      if (k && !sparkByCanon.has(k)) sparkByCanon.set(k, series);
    }

    for (const m of pool) {
      m.topQueries = queryMap.get(m.targetUrl) ?? [];
      m.declines = declineMap.get(m.targetUrl) ?? [];
      // Evidence relevance gate: an internal-link / consolidation target must be
      // topically related to THIS page - never suggest Tehran → "Iranian Snacks" just
      // because both incidentally rank for "capital of iran". Drop off-topic joins.
      m.sparkline = sparkByCanon.get(canon(m.targetUrl));
      m.cannibalization = (cannibalByUrl.get(canon(m.targetUrl)) ?? [])
        .filter((c) => internalLinkRelevance(m.query || m.pageLabel, c.leadPage || c.otherPages[0] || "").relevant)
        .slice(0, 2);
      // Outcome-threading: surface the page's most recent shipped-change outcome on
      // the card (display only). Conservative URL+family basis, mirroring Results.
      const pr = proofByPage.get(canon(m.targetUrl));
      if (pr) {
        const fam = (a: string): string =>
          /title|meta|ctr/.test(a) ? "tm" : /answer|aeo|faq|schema/.test(a) ? "aeo" : /internal|link|consolidat/.test(a) ? "lk" : /friction|experience|cro|ux|conversion/.test(a) ? "cro" : "edit";
        const sameFamily = fam(m.action) === fam(pr.actionType) || fam(m.action) === "edit" || fam(pr.actionType) === "edit";
        const p = pr.pres;
        m.proofMaturity = p.maturity;
        m.proofDirection = p.direction;
        if (p.maturity !== "mature_result") {
          // Still in flight (collecting / early / interim / blocked / overlapping):
          // never a final verdict. Use the honest maturity headline, not "won/lost".
          m.proofStatus = "measuring";
          m.alreadyMeasuring = sameFamily;
          m.pageMeasuring = !sameFamily;
          m.proofLabel = p.headline;
          // The soonest future checkpoint - the read the operator would muddy by
          // shipping again now.
          m.proofNextCheckpoint = p.nextCheckpoint ?? proofCheckDates(pr.shippedAt)[28];
        } else if (p.verdict === "helped") {
          m.proofStatus = "won";
          m.proofLabel = p.headline; // "Helped" / "Likely helped"
        } else if (p.verdict === "did_not_help") {
          m.proofStatus = "no_lift";
          m.proofLabel = p.headline; // "Did not help" / "Likely hurt"
        } else {
          m.proofStatus = "no_clear_lift";
          m.proofLabel = p.headline; // "No clear lift"
        }
      }
      // Always-actionable answer blocks: when the engine found no competitor FAQ
      // and no Profound fanout to seed the answer targets (competitor blocks
      // crawlers, or the topic isn't in the fanout account), fall back to the
      // EXACT GSC queries this page already ranks for - real, grounded demand, not
      // invented. If even the per-page query read missed, use the demand-cluster
      // label itself (also real GSC demand). So the top move never reads as a bare
      // "add an answer block" with no concrete target.
      if (m.action === "add_answer_block" && m.faqs.length === 0) {
        const fromQueries = [...new Set(m.topQueries.map((q) => q.query.trim()).filter((q) => q.length >= 8))];
        const seeds = fromQueries.length > 0 ? fromQueries : (m.query && m.query.trim().length >= 8 ? [m.query.trim()] : []);
        m.faqs = seeds.slice(0, 5);
      }
      const g = ga4ByCanon.get(canon(m.targetUrl));
      m.ga4 = g && (g.sessions28d > 0 || g.conversions28d > 0)
        ? { sessions: g.sessions28d, conversions: g.conversions28d }
        : null;
      const cl = clarityByCanon.get(canon(m.targetUrl));
      // Surface only meaningful friction (≥10% dead OR ≥5% rage per session). Clamp
      // the DISPLAY to 100% - deadRate is dead-clicks-per-session and can exceed 1
      // (multiple dead clicks per visit), which rendered as nonsense like "400% dead
      // clicks". The rate gate above still uses the raw value; only the % is bounded.
      m.friction = cl && (cl.deadRate >= 0.1 || cl.rageRate >= 0.05)
        ? { deadPct: Math.min(100, Math.round(cl.deadRate * 100)), ragePct: Math.min(100, Math.round(cl.rageRate * 100)) }
        : null;
      // A title/meta change already measured FLAT on this page+family (no_lift): the
      // lost lever must not be re-recommended. Suppress the title options + the
      // "sharper title" copy below; the ↳ next-lever chip already names the better move.
      const titleLeverLost = m.action === "edit_title" && m.outcomeCaution?.kind === "no_lift";
      // Re-seed the CTR Title Lab from the page's top GSC query (prefer a
      // striking-distance one) when we have it - so title variants target the
      // EXACT phrasing the page measurably ranks for, plus the page's real current
      // title (a "trim under 60 chars" suggestion) and the cited competitor's title.
      // Lowest-priority grounded "why": a self-competing page, when nothing more
      // urgent applies. The striking / citation / decline overrides below win.
      if (m.cannibalization.length > 0) m.why = m.cannibalization[0]!.fix;
      if (m.action === "edit_title" && m.topQueries.length > 0 && !titleLeverLost) {
        const seed = m.topQueries.find((q) => q.strikingDistance) ?? m.topQueries[0]!;
        const brand = brandFromUrl(m.targetUrl);
        m.titleVariants = buildTitleVariants(seed.query, brand, {
          currentTitle: m.currentTitle,
          competitorTitle: m.competitorTitle,
          position: seed.position,
          impressions: seed.impressions,
          secondaryQueries: m.topQueries.map((q) => q.query),
        }).slice(0, 3);
      }
      // Sharpest, grounded "why" for a striking-distance clicks move: name the
      // exact query, current rank, and real demand - the most compelling framing.
      // (Skipped when the title lever already lost - see the gate below.)
      const sd = m.topQueries.find((q) => q.strikingDistance);
      if (sd && m.action === "edit_title" && !titleLeverLost) {
        m.why = `You already rank position ${Math.round(sd.position)} for "${sd.query}" (${sd.impressions.toLocaleString()} monthly impressions). A sharper title can climb a few spots and capture far more of those clicks.`;
        // Grounded proof line, symmetric with the why - names the exact metric to watch.
        m.proof = `You'll know it worked when the click-through rate for "${sd.query}" rises over the next few weeks of Search Console data while the ranking holds.`;
      }
      // Grounded "why" for an AI-citation move that ALSO ranks on Google: fuse the
      // citation gap with the real search position - you're visible, just not cited.
      const tq = m.topQueries[0];
      if (m.action === "add_answer_block" && tq && m.whoCited) {
        m.why = `AI cites ${m.whoCited} for this. You already rank position ${Math.round(tq.position)} for "${tq.query}" (${tq.impressions.toLocaleString()} monthly impressions) but aren't the cited source - a quotable answer block can win the citation.`;
      }
      // Highest-priority "why": an ACTIVE loss is more urgent than an opportunity.
      // If the page is shedding clicks on a real query, lead with that.
      const topDecline = m.declines[0];
      if (topDecline && topDecline.dropPct >= 40) {
        m.why = `You're losing "${topDecline.query}" - clicks dropped ${topDecline.dropPct}% (${topDecline.priorClicks.toLocaleString()} → ${topDecline.recentClicks.toLocaleString()}) over the last month${topDecline.positionSlip >= 1 ? ` as you slipped ${Math.round(topDecline.positionSlip)} positions` : ""}. Refreshing this page can win them back.`;
        // Symmetric grounded proof - name the exact recovery metric to watch.
        m.proof = `You'll know it worked when clicks for "${topDecline.query}" recover toward their prior level (~${topDecline.priorClicks.toLocaleString()}/month) over the next few weeks of Search Console data.`;
      }
      // Lost-lever gate (runs last): when a title/meta change on this page already
      // measured FLAT, never re-recommend the same lever. Drop the title options,
      // relabel the action, and lead with the measured-flat why unless a stronger
      // (lever-agnostic) framing - an active decline or self-competition - already won.
      if (titleLeverLost) {
        m.titleVariants = [];
        m.actionLabel = "Try a different lever";
        const hasBetterWhy = (topDecline && topDecline.dropPct >= 40) || m.cannibalization.length > 0;
        if (!hasBetterWhy) {
          m.why = "A title and meta change here was already measured and didn't move clicks - a different lever (see the suggestion below) is more likely to help.";
          m.proof = "You'll know the next change worked when clicks or AI citations rise over the following few weeks, versus comparable pages you leave unchanged.";
        }
      }

      // PageResearchPack v1 - the per-page "what should this page own" research summary,
      // assembled from the free signals already on the move (GSC ranking/losing queries +
      // fan-out questions + competitor titles + self-competition siblings + proof family).
      // Existing-page moves only; create-page has its own New Pages flow.
      if (m.action !== "create_page" && m.topQueries.length > 0) {
        const fam = (a: string): string =>
          /title|meta|ctr/.test(a) ? "title_meta" : /answer|aeo|faq|schema/.test(a) ? "aeo" : /internal|link|consolidat/.test(a) ? "links" : /friction|experience|cro|ux/.test(a) ? "cro" : "content";
        const lostFamilies = m.outcomeCaution?.kind === "no_lift" ? [fam(m.action)] : [];
        const measuringFamilies = m.outcomeCaution?.kind === "held_measuring" ? [fam(m.action)] : [];
        // Competing OWN pages (from cannibalization) are the candidate sibling owners.
        const ownedSiblings = [
          ...new Set(m.cannibalization.flatMap((c) => [c.leadPage, ...c.otherPages])),
        ]
          .filter((label) => label && label.toLowerCase() !== m.pageLabel.toLowerCase())
          .map((label) => ({ slug: label, label }));
        const pack = buildPageResearchPack({
          url: m.targetUrl,
          pageLabel: m.pageLabel,
          pageFacts: { title: m.currentTitle ?? null },
          gscRanking: m.topQueries.map((q) => ({ query: q.query, position: q.position, impressions: q.impressions })),
          gscLosing: m.declines.map((d) => ({ query: d.query, dropPct: d.dropPct })),
          aiFanouts: m.faqs,
          competitorTitles: [m.whatWins, m.whoCited].filter((x): x is string => Boolean(x)),
          ownedSiblings,
          proof: { measuringFamilies, lostFamilies },
        });
        const primaryLever = pack.levers.find((l) => l.primary) ?? null;
        // The cannibalization detector ALREADY proved these queries compete with another
        // OWNED page - they are cross-link siblings by definition (token overlap can miss
        // it: "girl" vs a "persian female first names" page). Merge them into the sibling
        // cluster so the card shows "cross-link, don't merge" AND the old "fold" copy is
        // suppressed (the boy↔girl-names contradiction). Drop them from `own` to avoid
        // double-listing.
        // ...EXCEPT this page's own primary intent: if the cannibalized query IS what this
        // page should own (its top query), it stays in `own` (advice = reclaim/differentiate,
        // NOT cross-link away). Only queries a SIBLING rightfully owns become cross-link.
        const primaryLc = (pack.primaryIntent ?? "").toLowerCase();
        const cannibalQueries = m.cannibalization.map((c) => c.query).filter((q) => q.toLowerCase() !== primaryLc);
        const sibling = [...new Set([...pack.clusters.internal_link, ...cannibalQueries])];
        const siblingLc = new Set(sibling.map((s) => s.toLowerCase()));
        m.researchPack = {
          primaryIntent: pack.primaryIntent,
          // Real (cached) DataForSEO/keyword volume this page should own - null when none
          // of the owned keywords are in the cache yet (the paid producer populates it).
          addressableVolume: addressableVolume(pack.clusters.own, volumeByKeyword),
          // Cached SERP "what wins" pattern for the primary intent (producer-populated, $0
          // to read) - null until enriched. A compact projection (format + element + winners).
          serpPattern: (() => {
            const sp = pack.primaryIntent ? cachedSerpPatterns.get(pack.primaryIntent.toLowerCase()) : null;
            return sp ? { format: sp.format, titlePattern: sp.titlePattern, elementImplication: sp.elementImplication, winningDomains: sp.winningDomains.slice(0, 3) } : null;
          })(),
          own: pack.clusters.own.filter((k) => !siblingLc.has(k.toLowerCase())).slice(0, 6),
          sibling: sibling.slice(0, 4),
          primaryLever: primaryLever ? { lever: primaryLever.lever, reason: primaryLever.reason } : null,
          blockedLevers: pack.levers.filter((l) => l.blocked).map((l) => ({ lever: l.lever, reason: l.reason })),
          elements: pack.keywords
            // owned keywords (title/H2) + answer-block question targets - both are
            // on-page element opportunities; siblings/noise are not.
            .filter((k) => (k.bucket === "own" || k.bucket === "answer") && k.element)
            .slice(0, 5)
            .map((k) => ({ keyword: k.keyword, element: k.element as string, why: k.why })),
          // P4 - "put X here": compose the pack with the live SERP pattern + Clarity
          // friction + current title + cached volume into a concrete, evidence-cited plan.
          onPagePlan: (() => {
            const sp = pack.primaryIntent ? cachedSerpPatterns.get(pack.primaryIntent.toLowerCase()) : null;
            const plan = buildOnPagePlan(pack, {
              serpPattern: sp
                ? { format: sp.format, titlePattern: sp.titlePattern, elementImplication: sp.elementImplication, winningDomains: sp.winningDomains }
                : null,
              friction: m.friction,
              currentTitle: m.currentTitle ?? null,
              volumeByKeyword,
            });
            const slim = (e: { slot: string; recommendation: string; evidence: string } | null) =>
              e ? { slot: e.slot, recommendation: e.recommendation, evidence: e.evidence } : null;
            return {
              doFirst: slim(plan.doFirst),
              sections: plan.sections.slice(0, 3).map((e) => slim(e)!),
              faqs: plan.faqs.slice(0, 3).map((e) => slim(e)!),
              internalLinks: plan.internalLinks.slice(0, 3).map((e) => slim(e)!),
              warnings: plan.warnings.slice(0, 2),
            };
          })(),
        };
      }
    }

    // Quick-win boost: a page already ranking in striking distance (pos 4-15, real
    // demand) is the highest-CERTAINTY win - surface those above equal-score moves.
    // Score stays primary (trust); striking distance is the next key, before
    // confidence/demand. Re-sort only the bounded pool, then take the shown set.
    const hasStriking = (m: TodayMove) => m.topQueries.some((q) => q.strikingDistance);
    // An active loss (≥40% click drop on a real query) is urgent - surface those
    // above equal-score moves, just behind striking distance. Score stays primary.
    const hasDecline = (m: TodayMove) => m.declines.some((d) => d.dropPct >= 40);
    pool.sort(
      (a, b) =>
        b.score - a.score ||
        Number(hasStriking(b)) - Number(hasStriking(a)) ||
        Number(hasDecline(b)) - Number(hasDecline(a)) ||
        CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
        (b.demand ?? 0) - (a.demand ?? 0),
    );
    const top = pool.slice(0, limit);

    // D7 (honest opportunity math, DREAM SITE V1) - this USED to be a raw sum of demand-graph
    // weight/impressions ("500k people at risk" territory - a number nobody could act on). It is
    // now the sum of each shown move's own CTR-curve forecast midpoint (opportunity-math.ts):
    // real monthly clicks a real change plausibly captures, honest-zero when a move has no
    // position/impression history yet. Never inflates on a page that merely gets a lot of
    // impressions at a position that already earns its fair share of clicks.
    const demandAtStake = top.reduce((s, m) => {
      const tq = [...m.topQueries].sort((a, b) => b.impressions - a.impressions)[0];
      if (!tq || tq.impressions <= 0) return s;
      const forecast = computeOpportunity({
        tenantId,
        page: m.targetUrl,
        lever: m.action,
        currentPosition: tq.position,
        impressions90d: tq.impressions,
        clicks90d: tq.clicks,
      });
      if (forecast.lowPerMonth == null || forecast.highPerMonth == null) return s;
      return s + (forecast.lowPerMonth + forecast.highPerMonth) / 2;
    }, 0);
    const citationsContested = top.filter((m) => m.action === "add_answer_block").length;
    const pagesCovered = new Set(top.map((m) => canon(m.targetUrl))).size;
    // "Ready" = any paste-ready artifact: a saved AI answer/FAQ, OR (for clicks
    // moves) the deterministic scored title variants - both are ship-ready on open.
    const draftsReady = top.filter(
      (m) =>
        m.savedAnswerBlock ||
        m.savedFaqJsonLd ||
        (m.action === "edit_title" && m.titleVariants.length > 0),
    ).length;

    const strikingWins = top.reduce((s, m) => s + m.topQueries.filter((q) => q.strikingDistance).length, 0);
    const losingQueries = top.reduce((s, m) => s + m.declines.length, 0);
    const selfCompeting = top.reduce((s, m) => s + m.cannibalization.length, 0);

    return {
      moves: top,
      stats: {
        movesReady: top.length,
        demandAtStake: Math.round(demandAtStake),
        citationsContested,
        pagesCovered,
        draftsReady,
        strikingWins,
        losingQueries,
        selfCompeting,
        heldWhileMeasuring,
        preparedReady: top.filter((m) => m.preparedChecklist?.readyToReview).length,
      },
      learning: (() => {
        // "Beacon learned: …" from the strongest learned prior (largest tilt).
        const strongest = graphMoves
          .map((m) => m.learnedPrior)
          .filter((p): p is NonNullable<typeof p> => !!p && !!p.tag)
          .sort((a, b) => Math.abs(b.multiplier - 1) - Math.abs(a.multiplier - 1))[0];
        return { ...learningSummary, headline: strongest?.tag ? `Beacon learned: ${strongest.tag}` : null };
      })(),
    };
}

export const loadTodayMovesHeroData = cache(
  async (opts: { limit?: number } = {}): Promise<TodayMovesHeroData> =>
    buildTodayMovesData(await currentTenantId(), opts),
);
