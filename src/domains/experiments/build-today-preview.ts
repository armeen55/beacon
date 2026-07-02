/**
 * build-today-preview (2026-06-30) - server-side assembly of a Daily Experiment PREVIEW plan from
 * cached signals only ($0, no live fetch, no paid calls, no reservations, no proof rows). This is
 * the canonical pipeline the preview server action calls; it mirrors the proven dry-run script.
 *   GSC signals + page_snapshots facts + proof topology → candidates (Safe Meta/Link/Answer) →
 *   diversified planner → frozen DailyExperimentPlanRecord (status=preview).
 */
import "server-only";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { buildDailyCandidates, type GscPageInput, type PageFacts, type BuiltCandidate } from "./build-daily-candidates";
import { reviewRecommendation, passesDailyGate } from "@/domains/recommendations/recommendation-quality";
import { planDailyExperiments, pageFamilyOf as pageFamilyOfPath } from "./daily-experiment-planner";
import { deriveExperimentStates, actionFamilyOf } from "./experiment-eligibility";
import { buildLinkDestinations, toLinkPath } from "./safe-internal-link";
import { buildDailyPlanRecord } from "./build-daily-plan-record";
import type { DailyExperimentPlanRecord } from "./daily-plan-types";
import { classifyQueryIntent } from "./answer-intent";
import { proposeAnswerGap } from "./safe-answer-block";
import { enrichDailyCandidatesWithLlm, type MetaTitleDrafter } from "./daily-llm-enrich";
import { draftAtomicEditStructured, draftAnswerBlockStructured, draftTeamVerdictStructured } from "@/domains/llm/structured-drafter";
import { applyFinalReviewToPicks } from "@/domains/llm/batch-adjudicator";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { readAllCachedKeywordDifficulty } from "@/domains/serp/dataforseo-labs";
import { readCachedSerpPatterns, enrichPickSerpPatterns } from "@/domains/serp/research-enrichment-producer";
import type { SerpPattern } from "@/domains/serp/research-enrichment";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import {
  buildKeywordBrief, buildSerpEvidence, buildCompetitorEvidence, buildRankMovementSentence, buildStaleSourceNote,
  type CachedDemand, type SerpPatternLite, type EvidenceCompetitor, type DailyEvidenceBrief,
} from "./daily-evidence-brief";
import { rankDelta, loadFeatureStealCandidates } from "@/domains/serp/serp-history";
import { buildFeatureStealHintNotes } from "@/domains/serp/feature-steal";
import { normalizePath } from "./daily-plan-types";
import { aggregateSettled, proofHistoryLine } from "./proof-history-voice";
import { reviewCandidateWithTeam } from "./team-review";
import { findEvidenceGaps, buyEvidenceForPick, type EvidenceGapCandidate } from "./buy-missing-evidence";
import { loadEngineGapNotes } from "@/domains/ai-visibility/gap-store";
import type { EngineGapNote } from "@/domains/ai-visibility/candidate-feed";
import { loadQuerySpikes } from "@/domains/trend-radar/spike-store";
import { buildSpikeHintNotes } from "@/domains/trend-radar/spike-hints";
import { loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import { buildSeasonalHintNotes } from "@/domains/seasonal/seasonal-hints";
import { loadRefreshQueue } from "@/domains/refresh/refresh-store";
import { loadPeakCalendar } from "@/domains/seasonal/peak-calendar-store";
import { loadLanguageGaps } from "@/domains/language-gap/language-gap-store";
import { buildLanguageGapHintNotes } from "@/domains/language-gap/language-gap-hints";
import { currentTenantSlug, currentTenant } from "@/lib/tenant-context";
import { loadCrawlCitationFunnel } from "@/domains/ai-visibility/load-crawl-citation-funnel";
import { buildCitabilityHintNotes } from "@/domains/citability/citability-hints";
import { loadCalibrationRecords } from "./forecast-calibration-store";
import { summarizeForecastCalibration, captureDistributionFromCalibrationRecords } from "./forecast-calibration";
import { loadDailyClicksByPagesForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { forecastRange } from "./pick-expectations";
import { blendCaptureBand } from "./empirical-capture";
import { computeMde, estimateNoiseCv, assessPower } from "./power-analysis";
import { loadTeammateFreshness } from "@/domains/team/source-freshness";
import { teammateOf } from "@/domains/team/identity";
import { loadLatestStrategyMix } from "@/domains/strategy-review/strategy-mix-store";
import { clampStrategyMix } from "@/domains/strategy-review/apply-mix";
import { KNOWN_ACTION_FAMILIES } from "@/domains/strategy-review/run-strategy-review";
import { loadExperimentOutcomes } from "@/domains/learning/load-experiment-outcomes";
import { computeDimPriors, resolvePrior, canonicalMoveType, pageTypeFromUrl, queryClusterKey } from "@/domains/learning/experiment-prior";
import { buildShadowCandidates } from "./shadow-portfolio-capture";
import { writeShadowPortfolioBatch } from "./shadow-portfolio-store";

const ANIMAL = /\/iran-animals(\/|$)/;
const pathOf = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
const labelOf = (u: string) => (pathOf(u).split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");

/** Item 51 (weekly strategy review) - read the latest signed mix (if any, if fresh) and
 *  compose its per-family weight multiplicatively onto teamScoreMultiplier, the SAME
 *  composable slot item 29's family-win boost and R1's team debate already share. Attaches
 *  `strategyMixTag` for the card's "this week's plan leans into..." line. Absent mix, stale
 *  mix (not this-or-next week), or a neutral 1.0 weight for this family are all identical to
 *  doing nothing - additive-only, $0, fail-soft (a read error just skips the mix). */
async function applyWeeklyStrategyMixToCandidates(candidates: BuiltCandidate[], tenantId: string): Promise<void> {
  const latest = await loadLatestStrategyMix(tenantId);
  if (!latest) return;
  const clamped = clampStrategyMix(latest.leverMix, new Set<string>(KNOWN_ACTION_FAMILIES));
  if (clamped.size === 0) return;
  for (const c of candidates) {
    const hit = clamped.get((c.actionFamily ?? "").toLowerCase());
    if (!hit || hit.weight === 1) continue;
    c.teamScoreMultiplier = (c.teamScoreMultiplier ?? 1) * hit.weight;
    c.strategyMixTag = { family: c.actionFamily, weight: hit.weight, reason: hit.reason };
  }
}

/** BEACON_500 item 48 - ground the title/meta rewrite LLM in the page it is actually editing.
 *  Turns the page's own cached crawl facts (title/h1/meta + the first few body paragraphs)
 *  into the drafter's `outline` array, bounded to ~1500 chars total so a long page never blows
 *  the prompt budget. Empty-safe: no snapshot (or no facts at all) returns []. Pure, no I/O. */
const OUTLINE_CHAR_BUDGET = 1500;
export function buildOutlineFromFacts(facts: PageFacts | undefined | null): string[] {
  if (!facts) return [];
  const lines: string[] = [];
  if (facts.title) lines.push(`Title: ${facts.title}`);
  if (facts.h1) lines.push(`H1: ${facts.h1}`);
  if (facts.meta) lines.push(`Meta: ${facts.meta}`);
  for (const p of facts.bodyParagraphs ?? []) {
    if (p && p.trim()) lines.push(p.trim());
  }
  const outline: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used >= OUTLINE_CHAR_BUDGET) break;
    const take = line.slice(0, OUTLINE_CHAR_BUDGET - used);
    outline.push(take);
    used += take.length;
  }
  return outline;
}

const PLANNER_CONFIG = {
  maxExperiments: 8, maxPerPageFamily: 4, maxPerActionFamily: 4, maxHighTraffic: 2,
  effortBudgetMinutes: 45, maxLinksPerDestination: 1, backups: 2,
} as const;

export type TodayPreviewResult = {
  record: DailyExperimentPlanRecord;
  candidatesEvaluated: number;
  excludedByReason: Record<string, number>;
};

export async function buildTodayExperimentPreview(tenantId: string, now: Date = new Date()): Promise<TodayPreviewResult> {
  const [signals, ledger, snaps, keywordDemand, keywordDifficulty, serpPatterns, changePacks, engineGapsByUrl, querySpikes, seasonalQueries, featureSteals, languageGaps, citationFunnel, calibrationRecords, teammateFreshness, refreshQueue, peakCalendar] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId),
    loadProofLedger(tenantId).catch(() => []),
    getPageSnapshots(),
    // Slice E: $0 cached DataForSEO keyword demand (volume + paid-competition) for the "how we know"
    // brief. Cache-only read (no call, no spend); empty until a live keyword run populates it.
    readAllCachedKeywordDemand().catch(() => []),
    // Item 18: $0 cached real keyword-difficulty scores (0-100), populated whenever a create-page
    // verdict run has already fetched bulk_keyword_difficulty for a query. Empty until then.
    readAllCachedKeywordDifficulty().catch(() => new Map<string, number | null>()),
    // Slice E-2: $0 cached live-SERP reaction (winning shape + domains) per query. Populated by the
    // operator-gated SERP producer; empty (brief section absent) until then.
    readCachedSerpPatterns().catch(() => new Map()),
    // Slice E-2: competitor teardown per owned page (top competitor + what to steal), from the cached
    // demand graph + cached page audits (compute, NO paid call, NO live fetch). Fail-soft to none.
    loadChangePacksForTenant(tenantId, { limit: 120 }).then((r) => r.packets).catch(() => []),
    // Item 4: $0 read of last night's AI-engine gap diff (one engine cites a page, others do not),
    // bounded to 3 notes/night. Empty until the nightly 4-engine poll has run. Fail-soft to none.
    loadEngineGapNotes(tenantId, now).catch(() => new Map<string, EngineGapNote>()),
    // Item 14: $0 read of last night's query-spike radar (this week vs the trailing 4-week
    // baseline). Empty until the nightly pass has run. Fail-soft to none.
    loadQuerySpikes(tenantId, now).catch(() => []),
    // Item 21: $0 read of last night's seasonality pass over the permanent GSC monthly
    // archive (peak windows + prep deadlines). Empty until the nightly pass has run.
    // Fail-soft to none.
    loadSeasonalQueries(tenantId, now).catch(() => []),
    // Item 25: $0 read of the append-only SERP history's featured-snippet + PAA owners,
    // reduced to per-query steal candidates (rank 2-8, someone else holds the box).
    // Empty until live SERP history has captured a snippet/PAA at a qualifying rank.
    // Fail-soft to none.
    loadFeatureStealCandidates(tenantId, now).catch(() => []),
    // Item 24: $0 read of last night's Farsi/Finglish language-gap matrix pass
    // (script/language demand vs each page's crawled content language). Empty
    // until the nightly pass has run. Fail-soft to none.
    loadLanguageGaps(tenantId, now).catch(() => []),
    // Item 26: $0 read of the item-7 crawl-to-citation funnel (which pages AI
    // reaches but never quotes). Empty until the tenant's own-domain slug or
    // the funnel's feeds are unavailable. Fail-soft to an empty report.
    currentTenantSlug()
      .catch(() => "")
      .then((slug) => (slug ? loadCrawlCitationFunnel(tenantId, slug) : null))
      .catch(() => null),
    // Items 27/64 - the calibration ledger, read ONCE here (moved up from its old post-planning
    // spot) because item 35's power gate needs the SAME numeric forecast pick-expectations.ts will
    // persist, and that forecast depends on both the item-27 correction factor AND the item-64
    // per-family capture band derived below. Fail-soft to [] (both derive their safe defaults from
    // an empty ledger: correctionFactor 1.0, every family band the static 25/75 fallback).
    loadCalibrationRecords(tenantId).catch(() => []),
    // Item 46 (CARRY-OVER 115) - honest degradation: the SAME connector reads the standup strip
    // and /settings/connectors already use, so a pick argued in part by a stale/dead-source voice
    // says so in "how we know" instead of presenting every number as equally live. Fail-soft to
    // an empty map (every card renders exactly as before).
    loadTeammateFreshness(tenantId, now).catch(() => new Map<string, { status: "fresh" | "stale" | "dead"; ageDays: number | null; sentence: string }>()),
    // Item 56: $0 read of last night's refresh queue (pages losing clicks quarter over quarter
    // + their evidence briefs). Empty until the nightly pass has run. Fail-soft to none.
    loadRefreshQueue(tenantId, now).catch(() => []),
    // Item 63: $0 read of last night's peak calendar (seasonal windows, some upgraded to
    // 'proven' by the Labs historical-volume cross-check). Empty until the nightly pass has
    // run. Fail-soft to none.
    loadPeakCalendar(tenantId, now).catch(() => []),
  ]);

  // Item 27 - the measured forecast bias (default 1.0 = no correction), derived from the ledger
  // read above.
  const correctionFactor = summarizeForecastCalibration(calibrationRecords).correctionFactor;
  // Item 64 - the per-actionFamily empirical capture distribution, derived from the SAME ledger
  // read. A fresh tenant (empty ledger) yields an empty Map, which resolves every family to the
  // untouched static 25/75 band (blendCaptureBand's n < MIN_SAMPLES branch) - byte-identical to
  // pre-item-64 behavior.
  const captureDistribution = captureDistributionFromCalibrationRecords(calibrationRecords);

  // Keyword demand indexed by lowercased term, for the daily card's keyword-research evidence. Item 18:
  // layer in the cached real difficulty score when one exists for this exact term, $0, additive.
  const demandByTerm = new Map<string, CachedDemand>();
  for (const k of keywordDemand) {
    const term = k.keyword.toLowerCase();
    demandByTerm.set(term, { volume: k.searchVolume, competition: k.competitionLevel, difficulty: keywordDifficulty.get(term) ?? null });
  }

  // SERP patterns indexed by lowercased query (the shape build-today-preview's brief looks up).
  const serpByTerm = new Map<string, SerpPatternLite>();
  for (const [q, p] of serpPatterns as Map<string, { format: string; winningDomains: string[]; elementImplication: string }>) {
    serpByTerm.set(q.toLowerCase(), { format: p.format, winningDomains: p.winningDomains ?? [], elementImplication: p.elementImplication ?? "" });
  }

  // Competitor teardown indexed by normalized owned-page path. Only keep a RELEVANT, on-topic
  // competitor (relevance gate + not loosely-matched) so a page never shows an off-topic rival.
  // Also index the FULL packet per page (first = the page's highest-ranked move) - the input the
  // specialist team debates in the R1 review below.
  const competitorByPath = new Map<string, EvidenceCompetitor>();
  const packetByPath = new Map<string, (typeof changePacks)[number]>();
  for (const p of changePacks) {
    const ownedUrl = p.yourPage?.url;
    if (ownedUrl && !packetByPath.has(normalizePath(ownedUrl))) packetByPath.set(normalizePath(ownedUrl), p);
    const c = p.competitor;
    if (!ownedUrl || !c || !c.domain || c.looselyMatched || (c.relevance ?? 0) < 0.3) continue;
    const ev = buildCompetitorEvidence({ domain: c.domain, url: c.topUrl, facts: c.facts });
    if (ev) competitorByPath.set(normalizePath(ownedUrl), ev);
  }

  // Facts from Beacon's own cached crawl ($0, no live fetch).
  const factsByPath = new Map<string, PageFacts>();
  for (const s of snaps as Array<{ url?: string; page?: string; title: string | null; meta_description: string | null; h1: string | null; body_paragraph_sample?: string[]; internal_links?: Array<{ href: string }>; fetched_at?: string }>) {
    const u = s.url ?? s.page;
    if (!u) continue;
    factsByPath.set(pathOf(u), {
      title: s.title, meta: s.meta_description, h1: s.h1,
      openingParagraph: (s.body_paragraph_sample ?? []).find((p) => p && p.trim().length >= 80) ?? null,
      bodyParagraphs: s.body_paragraph_sample ?? [],
      internalLinkPaths: (s.internal_links ?? []).map((l) => toLinkPath(l.href)),
      snapshotFetchedAt: s.fetched_at,
    });
  }

  // Item 14 - the trend-radar hint feed (engineGapsByUrl precedent): a spiking search only
  // becomes a hint when its best page VERIFIABLY lacks an on-page answer for it (the same
  // deterministic proposeAnswerGap test the answer lever uses, over cached crawl facts).
  // Bounded to 3/night; a page without crawl facts gets no hint (never fabricate urgency).
  const spikeHintsByPath = buildSpikeHintNotes(querySpikes, (topPageUrl, query) => {
    const f = factsByPath.get(pathOf(topPageUrl));
    if (!f) return false;
    return proposeAnswerGap({ label: labelOf(topPageUrl), h1: f.h1, topQuery: query, bodyParagraphs: f.bodyParagraphs ?? [] }) != null;
  });

  // Item 21 - the seasonality hint feed: a detected peak window only becomes a "prep now"
  // hint when its prep deadline (peak start minus 6 weeks) falls within the next 21 days.
  // Bounded to 2/night; composes beside the spike hints without disturbing them.
  const seasonalHintsByPath = buildSeasonalHintNotes(seasonalQueries, now);

  // Item 25 - the feature-steal hint feed: a query where the tenant ranks 2-8 AND a
  // weak (non-major-authority) domain owns the featured snippet or a PAA answer only
  // becomes a hint here - strong owners (Wikipedia, major news) stay informational,
  // never queued as an easy win. Bounded to 2/night; keyed by query (not page path),
  // matched against each candidate's targetQuery below.
  const featureStealHintsByQuery = buildFeatureStealHintNotes(featureSteals);

  // Item 24 - the language-gap hint feed: a page carrying real Farsi-script or
  // Finglish demand with no matching-script content (or a missing transliteration
  // spelling family) becomes a hint here. Bounded to 2/night; composes beside the
  // spike/seasonal hints without disturbing them.
  const languageGapHintsByPath = buildLanguageGapHintNotes(languageGaps);

  // Item 26 - the citability hint feed: a page the item-7 funnel says AI already
  // reaches but never quotes (crawled_not_cited or cited_no_clicks), whose own
  // cached crawl text scores below the citability threshold, becomes a hint here
  // carrying the exact patterns (stat-first, definition, list lead, etc.) the
  // answer-block drafter should apply. Bounded to 2/night; text comes from the
  // same cached page_snapshots facts every other lever already reads ($0).
  const citabilityPageTextByPath = new Map<string, string>();
  for (const [path, f] of factsByPath) {
    const text = [f.title, f.h1, ...(f.bodyParagraphs ?? [])].filter(Boolean).join(". ");
    if (text.trim()) citabilityPageTextByPath.set(path, text);
  }
  const citabilityHintsByPath = citationFunnel
    ? buildCitabilityHintNotes(citationFunnel, citabilityPageTextByPath)
    : new Map();

  // Active topology (treated/control paths) + protected-destination predicate.
  const states = deriveExperimentStates(ledger, now);
  const activeTreated = new Set<string>();
  const activeControl = new Set<string>();
  for (const [p, st] of states) {
    if (st.activeTreatments.length) activeTreated.add(toLinkPath(p));
    if (st.activeControlAssignments.length) activeControl.add(toLinkPath(p));
  }
  const activeProofIds = ledger.filter((r) => r.verdict === "measuring").map((r) => r.id);
  const isProtected = (p: string): string | null =>
    ANIMAL.test(p) ? "animal_family" : activeControl.has(p) || activeTreated.has(p) ? "active_experiment" : null;
  const linkDestinations = buildLinkDestinations(snaps as Parameters<typeof buildLinkDestinations>[0], isProtected);

  // GSC candidate pool (non-animal, measurable band). Capture each page's impression-weighted intent
  // (the searcher's dominant question) so the LLM "write it" pass can draft the RIGHT answer type.
  const inputs: GscPageInput[] = [];
  const intentByUrl = new Map<string, string | undefined>();
  // Each page's top searches (impression-sorted): the query set the keyword-research brief looks up.
  const queriesByUrl = new Map<string, string[]>();
  for (const s of signals.values()) {
    if (ANIMAL.test(s.page)) continue;
    const sortedQueries = [...s.topQueries].sort((a, b) => b.impressions - a.impressions);
    const tq = sortedQueries[0];
    if (!tq || s.impressions90d < 200 || s.position90d < 3 || s.position90d > 50) continue;
    inputs.push({
      url: s.page, pageLabel: labelOf(s.page), impressions: s.impressions90d, clicks: s.clicks90d, ctr: s.ctr90d, position: s.position90d,
      topQuery: tq.query, topQueryImpressions: tq.impressions, topQueryPosition: tq.position, topQueryCtr: tq.ctr,
      ownership: s.impressions90d > 0 ? tq.impressions / s.impressions90d : 0,
    });
    intentByUrl.set(s.page, classifyQueryIntent(sortedQueries.map((q) => ({ query: q.query, impressions: q.impressions })))?.dominant);
    queriesByUrl.set(s.page, sortedQueries.slice(0, 8).map((q) => q.query));
  }
  inputs.sort((a, b) => (b.topQueryImpressions / Math.max(1, b.topQueryPosition)) - (a.topQueryImpressions / Math.max(1, a.topQueryPosition)));

  const facts = new Map<string, PageFacts>();
  for (const p of inputs) { const f = factsByPath.get(pathOf(p.url)); if (f) facts.set(p.url, f); }

  // D-2: LLM-WRITTEN answers for pages with an answer GAP (no on-page answer for the real intent, e.g.
  // the chaharshanbe date). Grounded in the page body + the searcher's intent; the drafter's
  // numeric-fidelity firewall blocks any fabricated date/number, and the operator approves before it
  // goes live. Capped to the top pages by demand (inputs is demand-sorted) so cost stays bounded;
  // OpenAI only, off unless BEACON_LLM_PROVIDER=openai. Fails soft (no write -> honest gap remains).
  const ANSWER_WRITE_CAP = 6;
  const writtenAnswersByUrl = new Map<string, { text: string; question: string }>();
  const gapPages = inputs
    .map((p) => ({ p, f: facts.get(p.url) }))
    .filter((x): x is { p: GscPageInput; f: PageFacts } => !!x.f)
    .map((x) => ({ ...x, gap: proposeAnswerGap({ label: x.p.pageLabel, h1: x.f.h1, topQuery: x.p.topQuery, bodyParagraphs: x.f.bodyParagraphs ?? [] }) }))
    .filter((x) => x.gap != null)
    .slice(0, ANSWER_WRITE_CAP);
  await Promise.all(
    gapPages.map(async ({ p, f, gap }) => {
      try {
        // Item 26: when this page is also a citability target (AI reaches it but never
        // quotes it), the drafter's guidance carries the exact patterns to apply so the
        // written answer is quotable from the start, not just factually grounded.
        const citability = citabilityHintsByPath.get(normalizePath(p.url));
        const res = await draftAnswerBlockStructured({
          query: p.topQuery,
          pageLabel: p.pageLabel,
          brief: gap!.question,
          outline: (f.bodyParagraphs ?? []).slice(0, 8),
          faqs: [],
          evidenceHints: citability?.topFixes,
          intent: gap!.intent,
          tenantId,
        });
        if (res.status === "drafted" && res.value.answer?.trim()) {
          writtenAnswersByUrl.set(p.url, { text: res.value.answer.trim(), question: gap!.question });
        }
      } catch {
        /* fail soft: no written answer for this page -> the honest gap remains */
      }
    }),
  );

  // Item 56: the refresh queue rides in as a bounded additive source (max 2/night,
  // decayed-winners-first); an empty queue is byte-identical to the pre-item-56 batch.
  // Item 63: the peak calendar rides in the same way (max 2/night, 6-8 week lead); an
  // empty calendar is byte-identical to the pre-item-63 batch.
  const built = buildDailyCandidates({ tenantId, pages: inputs, facts, proofLedger: ledger, linkDestinations, writtenAnswersByUrl, engineGapsByUrl, refreshQueue, peakCalendar });

  // Move 4 - RECOMMENDATION-QUALITY GATE: no candidate enters the plan unless it passes
  // the deterministic review (page-query intent fit, action↔goal incl. year-intent, copy
  // quality, factual firewall, origin-definitiveness). Lever eligibility (proof-block /
  // control / contamination / insufficient-controls) is enforced downstream by the planner;
  // this gate adds the CONTENT-quality vetoes the planner can't see. Pure, no I/O.
  const qaByUrl = new Map(built.map((b) => [b.url, reviewRecommendation({
    lever: b.leverField,
    pagePath: pathOf(b.url),
    pageLabel: b.pageLabel ?? labelOf(b.url),
    targetQuery: b.targetQuery,
    currentText: b.currentText,
    proposedText: b.proposedText,
    controlsAvailable: b.suggestedControls.length,
  })]));
  const gatedBuilt = built.filter((b) => { const r = qaByUrl.get(b.url); return r ? passesDailyGate(r) : true; });
  const qaRejected = built.length - gatedBuilt.length;

  // R1 (2026-07-01) - THE TEAM DECIDES: every surviving candidate is debated by the full specialist
  // team (GSC, GA4, Clarity, DataForSEO, Profound, Wix, strategist) over the page's fused evidence
  // packet. The debate (a) VETOES candidates the team routes off content work (fix the experience
  // first / hold until winnable), (b) tilts the planner's deterministic score with the router's
  // bounded multiplier, and (c) freezes the named-voices debate on the candidate so the card shows
  // the REAL argument that chose tonight's batch. Pages without a packet keep pre-team behavior
  // exactly (the team abstains - it never fabricates).
  const nowIso = now.toISOString();
  // Item 80 - the PROOF-HISTORY voice: what the measured ledger already says about this page
  // family + lever family. The team's own past results speak in the debate ("a description
  // change on a flags page showed no lift last month"), so learning is visible, not implied.
  const settledByKey = aggregateSettled(ledger, pageFamilyOfPath, actionFamilyOf);
  const historyLine = (pageFamily: string, actionFamily: string): string | null =>
    proofHistoryLine(settledByKey, pageFamily, actionFamily);

  let teamVetoed = 0;
  const teamReviewed = gatedBuilt.filter((b) => {
    const result = reviewCandidateWithTeam(packetByPath.get(normalizePath(b.url)), nowIso);
    if (result.review) {
      b.teamReview = result.review;
      const hist = historyLine(b.pageFamily ?? "", b.actionFamily);
      if (hist) {
        b.teamReview.voices.push({ specialist: "proof", label: "Results so far", claim: hist, confidencePct: 65 });
      }
    }
    // Item 29: a family-propagation win already carries a visible, bounded boost
    // (build-daily-candidates sets teamScoreMultiplier = familyWin.boost); COMPOSE the team's
    // multiplier on top of it multiplicatively instead of overwriting, so a proven-family win
    // stays boosted even when the team is silent (result.scoreMultiplier defaults to 1).
    b.teamScoreMultiplier = (b.familyWin ? b.familyWin.boost : 1) * result.scoreMultiplier;
    if (result.vetoed) { teamVetoed += 1; return false; }
    return true;
  });

  // Item 51 - THE WEEKLY STRATEGY REVIEW: compose this week's signed lever-mix weight
  // (Sunday-night review, deterministically clamped to [0.5, 2.0]) on top of the team's
  // multiplier, same multiplicative-compose pattern as the item 29 family-win boost above.
  // A tenant with no fresh mix yet (or a neutral 1.0 weight for this family) is byte-
  // identical to pre-item-51 behavior - additive-only, never a regression risk.
  await applyWeeklyStrategyMixToCandidates(teamReviewed, tenantId).catch(() => 0);

  // Item 47 - WIRE THE LEARNED PRIORS INTO THE NIGHTLY PLANNER SCORE. The worklist's demand-graph
  // ranking already tilts by settled proof-ledger outcomes (load-graph.ts); the nightly batch that
  // actually SHIPS changes never consumed that same learning. Mirrors load-graph.ts's discipline
  // exactly: loadExperimentOutcomes (decided-only, maturity + weather + parallel-trends gated),
  // resolvePrior's bounded [0.85, 1.15] multiplier with dimension backoff (queryCluster -> pageType
  // -> actionType). Attaches learnedPrior (multiplier + tag) to each candidate; scoreCandidate folds
  // it in as its own factor (see learnedPriorScoreFactor). Fail-soft -> every candidate stays neutral
  // (multiplier 1, tag null), and a fresh tenant with zero settled outcomes produces a BYTE-IDENTICAL
  // plan (pinned by daily-experiment-planner.test.ts).
  try {
    const outcomes = await loadExperimentOutcomes(tenantId);
    if (outcomes.length > 0) {
      const table = computeDimPriors(outcomes);
      for (const c of teamReviewed) {
        c.learnedPrior = resolvePrior(
          {
            actionType: canonicalMoveType(c.actionFamily),
            pageType: pageTypeFromUrl(c.url),
            queryCluster: queryClusterKey(c.targetQuery),
          },
          table,
        );
      }
    }
  } catch {
    /* additive - never let the learning layer block or alter a nightly plan */
  }

  // Item 35 - THE POWER GATE: before the planner scores/selects, ask whether each candidate's own
  // page has enough traffic to actually SEE its forecast effect within the 28-day read. Bounded to
  // the top POWER_CHECK_CAP candidates by raw opportunity (ctrOpportunityClicks) so a busy night
  // never turns into an unbounded per-page fan-out; a candidate outside the cap is left unassessed
  // (power stays undefined -> neutral score, never penalized for a check that didn't run).
  const POWER_CHECK_CAP = 20;
  const topByOpportunity = [...teamReviewed].sort((a, b) => b.ctrOpportunityClicks - a.ctrOpportunityClicks).slice(0, POWER_CHECK_CAP);
  const dailySeriesByUrl = topByOpportunity.length
    ? await loadDailyClicksByPagesForTenant(tenantId, topByOpportunity.map((c) => c.url), 90).catch(() => new Map<string, { date: string; clicks: number }[]>())
    : new Map<string, { date: string; clicks: number }[]>();
  for (const c of topByOpportunity) {
    // Item 64: resolve THIS candidate's family capture band so the power check reasons about the
    // exact same range the plan record will later persist (see toExperimentRecord in
    // build-daily-plan-record.ts) - never a mismatched, pre-item-64 static-band range.
    const band = blendCaptureBand(captureDistribution.get(canonicalMoveType(c.actionFamily)));
    const range = forecastRange(c.ctrOpportunityClicks, correctionFactor, { low: band.low, high: band.high });
    if (!range) continue; // nothing forecast honestly -> nothing to power-check either
    const sig = signals.get(c.url);
    const baselineDailyClicks = sig ? sig.clicks90d / 90 : 0;
    const baselineDailyImpressions = sig ? sig.impressions90d / 90 : c.impressions / 90;
    const { noiseCv } = estimateNoiseCv(dailySeriesByUrl.get(c.url) ?? []);
    const mde = computeMde({ baselineDailyClicks, baselineDailyImpressions, windowDays: 28, noiseCv });
    c.power = assessPower({ forecastLow: range.low, forecastHigh: range.high, mde });
    // Item 35 - the roundtable gains a measurement voice ONLY when the read is genuinely thin
    // (marginal or worse); a well-powered pick needs no extra reassurance and stays silent, so this
    // never floods the debate on an ordinary night.
    if (c.power.band !== "well_powered" && c.teamReview && !c.teamReview.voices.some((v) => v.label === "How sure we can be")) {
      c.teamReview.voices.push({ specialist: "proof", label: "How sure we can be", claim: c.power.sentence, confidencePct: 60 });
    }
  }

  const plan = planDailyExperiments({ tenantId, date: now.toISOString().slice(0, 10), candidates: teamReviewed, proofLedger: ledger, config: { ...PLANNER_CONFIG, now } });

  const byUrl = new Map(built.map((b) => [b.url, b]));
  const selected = plan.selected.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];
  const backups = plan.backups.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];

  // Slice D-1: LLM "write it" pass - sharpen the description/title copy at plan time so cards arrive
  // full. Budgeted + fail-closed inside the structured drafter (off when BEACON_LLM_PROVIDER != openai
  // or the cap is hit); on any miss it keeps the deterministic text. Only drop-in field levers here;
  // answer-block writing (a new add-operation) is a later slice.
  // Item 48: GROUND the rewrite in the page it is actually editing. factsByPath already holds this
  // page's title/h1/meta/body from page_snapshots (see the `facts` map above); pass it as `outline`
  // so the prompt's "Page covers: ..." line is real and the numeric-fidelity firewall has grounded
  // numbers to check against, instead of rejecting every good draft for having none. Composes the
  // citability topFixes (when this page is also an item-26 citability target) BESIDE the outline as
  // evidenceHints - never clobbers, since the two carry different information (what the page says vs
  // what AI citability wants fixed).
  const llmDrafter: MetaTitleDrafter = async ({ query, pageLabel, field, currentValue, intent, url }) => {
    const pageFacts = url ? facts.get(url) : undefined;
    const outline = buildOutlineFromFacts(pageFacts);
    const citability = url ? citabilityHintsByPath.get(normalizePath(url)) : undefined;
    const evidenceHints = citability?.topFixes;
    const r = await draftAtomicEditStructured({ query, pageLabel, field, currentValue, outline, evidenceHints, intent, tenantId });
    return r.status === "drafted" ? { text: r.value.after, rationale: r.value.rationale } : null;
  };
  await enrichDailyCandidatesWithLlm(selected, intentByUrl, llmDrafter).catch(() => 0);

  // Item 29 - live SERP for tonight's picks (<= 8 target queries, ~$0.02 a night) so the
  // Google-results teammate almost never abstains on the batch. Same gauntlet as every
  // DataForSEO call (14d cache, fail-closed cap, ledger); dry-run/unconfigured -> $0 no-op.
  const serpRun = await enrichPickSerpPatterns(selected.map((c) => c.targetQuery)).catch(() => ({ fetched: 0, spentUsd: 0 }));
  if (serpRun.fetched > 0) {
    const refreshed = await readCachedSerpPatterns().catch(() => new Map<string, SerpPattern>());
    for (const [q, p] of refreshed) {
      serpByTerm.set(q, { format: p.format, winningDomains: p.winningDomains ?? [], elementImplication: p.elementImplication ?? "" });
    }
  }

  // Slice E: attach the "how we know" evidence to each selected move: keyword research (volume +
  // competition), the live Google SERP reaction (winning shape + domains + what to do), and the top
  // competitor teardown (what to steal). All $0 cached reads; each section is omitted when absent, so
  // the card degrades gracefully (an all-empty brief is not attached). Runs BEFORE the strategist
  // verdict pass so the keyword voice is part of what the strategist synthesizes.
  for (const c of selected) {
    const queries = queriesByUrl.get(c.url) ?? [c.targetQuery];
    const kw = buildKeywordBrief(queries, demandByTerm);
    const serp = buildSerpEvidence(queries, serpByTerm);
    // Item 17 - the literal observed Google position. When the append-only SERP history
    // holds two observed positions for this pick's search (inside 45 days), say the real
    // movement on the live-SERP evidence line. $0 read, fail-soft to honest silence.
    if (serp) {
      const delta = await rankDelta(tenantId, serp.query, 45, now).catch(() => null);
      const movement = buildRankMovementSentence(delta);
      if (movement) serp.rankMovement = movement;
      // Item 25 - the STEAL fact: when this pick's search has a weak-owner featured-snippet
      // or PAA candidate, the evidence sentence names it (format-matched so the answer-block
      // drafter can match paragraph vs list vs table). Honest silence otherwise - a
      // strong-owner (Wikipedia, major news) query never gets this line.
      const steal = featureStealHintsByQuery.get(serp.query.trim().toLowerCase());
      if (steal) serp.featureSteal = { ownerDomain: steal.ownerDomain, format: steal.format, sentence: steal.sentence };
    }
    const competitor = competitorByPath.get(normalizePath(c.url));
    if (kw || serp || competitor) {
      c.evidenceBrief = {
        keywords: kw?.keywords ?? [],
        addressableVolume: kw?.addressableVolume ?? null,
        ...(serp ? { serp } : {}),
        ...(competitor ? { competitor } : {}),
      };
    }
    // Item 29 - the LIVE-GOOGLE voice: when a SERP pattern exists for this pick's queries and the
    // debate's Google teammate abstained, say what wins on Google now as its own line.
    if (serp && c.teamReview && !c.teamReview.voices.some((v) => v.label === "Live Google results")) {
      const led = serp.winningDomains.slice(0, 2).join(" and ");
      const FORMAT_PLAIN: Record<string, string> = {
        ugc: "community discussion", product: "store and product", list: "list-style",
        faq: "question-and-answer", guide: "in-depth guide", mixed: "a mix of",
      };
      const shape = FORMAT_PLAIN[serp.format] ?? serp.format;
      c.teamReview.voices.push({
        specialist: "dataforseo",
        label: "Live Google results",
        // Item 17: when history holds two observed positions, the literal movement rides
        // the same sentence ("You moved 9 to 6 on Google for this search since Jun 20.").
        claim: `On Google right now, ${shape} pages win for this search${led ? `, led by ${led}` : ""}.${serp.rankMovement ? ` ${serp.rankMovement}` : ""}`,
        confidencePct: 75,
      });
    }
    // Item 28 - the KEYWORD-RESEARCH voice: real monthly demand speaks in the roundtable as its
    // own teammate line, not buried in the expander. Deterministic, from the cached universe.
    const best = (kw?.keywords ?? []).filter((k) => typeof k.volume === "number" && k.volume > 0).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
    if (best && c.teamReview) {
      const comp = best.competition != null ? `, ${best.competition} competition` : "";
      const more = kw?.addressableVolume && kw.addressableVolume > (best.volume ?? 0)
        ? ` (${kw.addressableVolume.toLocaleString()} across the page's queries)`
        : "";
      c.teamReview.voices.push({
        specialist: "dataforseo",
        label: "Keyword research",
        claim: `${(best.volume ?? 0).toLocaleString()} searches a month for "${best.term}"${comp}${more}.`,
        confidencePct: 80,
      });
    }
    // Item 14 - the TREND-RADAR voice: when this pick's page has a spiking search it does not
    // answer yet, the week-over-week jump argues for shipping THIS week. Deterministic, from
    // last night's persisted spike pass ($0).
    const spikeHint = spikeHintsByPath.get(normalizePath(c.url));
    if (spikeHint && c.teamReview && !c.teamReview.voices.some((v) => v.label === "Search demand spike")) {
      c.teamReview.voices.push({
        specialist: "gsc",
        label: "Search demand spike",
        claim: `${spikeHint.sentence} The page has no direct answer for it yet, so this change is worth shipping this week.`,
        confidencePct: 80,
      });
    }
    // Item 21 - the SEASONALITY voice: when this pick's page has an upcoming seasonal window
    // due to prep soon, the multi-year (or single-year) pattern argues for getting it ready
    // now, ahead of the wave. Deterministic, from last night's persisted seasonality pass ($0).
    const seasonalHint = seasonalHintsByPath.get(normalizePath(c.url));
    if (seasonalHint && c.teamReview && !c.teamReview.voices.some((v) => v.label === "Seasonal window ahead")) {
      c.teamReview.voices.push({
        specialist: "gsc",
        label: "Seasonal window ahead",
        claim: seasonalHint.sentence,
        confidencePct: 75,
      });
    }
    // Item 25 - the FEATURE-STEAL voice: when this pick's search has a weak-owner featured-
    // snippet or PAA answer, a beatable box argues for shipping a format-matched answer this
    // week. Deterministic, from the append-only SERP history ($0). Bounded to 2/night at the
    // hint-map level, so this never floods the roundtable.
    const stealHint = featureStealHintsByQuery.get(c.targetQuery.trim().toLowerCase());
    if (stealHint && c.teamReview && !c.teamReview.voices.some((v) => v.label === "Answer box to steal")) {
      c.teamReview.voices.push({
        specialist: "dataforseo",
        label: "Answer box to steal",
        claim: stealHint.sentence,
        confidencePct: 70,
      });
    }
    // Item 24 - the LANGUAGE-GAP voice: when this pick's page carries real Farsi-script
    // or Finglish demand it does not visibly answer (no matching-script content, or a
    // transliteration spelling family it never mentions), that gap argues for shipping
    // this week. Deterministic, from last night's persisted language-gap pass ($0).
    const languageGapHint = languageGapHintsByPath.get(normalizePath(c.url));
    if (languageGapHint && c.teamReview && !c.teamReview.voices.some((v) => v.label === "Language gap")) {
      c.teamReview.voices.push({
        specialist: "gsc",
        label: "Language gap",
        claim: languageGapHint.sentence,
        confidencePct: 75,
      });
    }
    // Item 26 - the CITABILITY voice + evidence-brief line: when this pick's page is a
    // "make it quotable" target (the item-7 funnel says AI reaches it but never quotes
    // it, and the deterministic rubric found it missing the patterns AI lifts), the
    // brief gains one honest line and the roundtable gains the argument. Deterministic,
    // from the funnel + rubric ($0).
    const citabilityHint = citabilityHintsByPath.get(normalizePath(c.url));
    if (citabilityHint) {
      c.evidenceBrief = { ...(c.evidenceBrief ?? { keywords: [], addressableVolume: null }), citability: { score: citabilityHint.score, evidenceLine: citabilityHint.evidenceLine, topFixes: citabilityHint.topFixes } };
      if (c.teamReview && !c.teamReview.voices.some((v) => v.label === "AI citability")) {
        c.teamReview.voices.push({
          specialist: "profound",
          label: "AI citability",
          claim: citabilityHint.sentence,
          confidencePct: 70,
        });
      }
    }
    // Item 29 - the FAMILY-WIN voice + evidence-brief provenance line: this pick's lever
    // already proved itself (a mature, positive verdict) on a sibling page in the same
    // family. The card's "how we know" gains the provenance and the roundtable gains a
    // dedicated high-confidence voice, since a proven-family repeat is closer to a fact than
    // an opinion. Deterministic, from the ledger's own settled record ($0). Absent otherwise
    // - honest silence, never a fabricated "proven" claim.
    if (c.familyWin) {
      c.evidenceBrief = {
        ...(c.evidenceBrief ?? { keywords: [], addressableVolume: null }),
        familyWin: { sourceWinPage: c.familyWin.sourceWinPage, sentence: c.familyWin.sentence },
      };
      if (c.teamReview && !c.teamReview.voices.some((v) => v.label === "Proven on this family")) {
        c.teamReview.voices.push({
          specialist: "proof",
          label: "Proven on this family",
          claim: c.familyWin.sentence,
          confidencePct: 85,
        });
      }
    }
    // Item 46 (CARRY-OVER 115) - honest degradation: when a voice that argued this pick was
    // reading from a stale or dead source (the same connector state the standup strip reads),
    // "how we know" says so plainly instead of presenting every number as equally live. Absent
    // when every voice's source was fresh - honest silence, never a manufactured caveat.
    if (c.teamReview && c.teamReview.voices.length > 0) {
      const staleNote = buildStaleSourceNote(
        c.teamReview.voices.map((v) => v.specialist),
        teammateFreshness,
        (key) => teammateOf(key).short,
      );
      if (staleNote) {
        c.evidenceBrief = { ...(c.evidenceBrief ?? { keywords: [], addressableVolume: null }), staleSource: staleNote };
      }
    }
  }

  // Item 39 - BUY THE MISSING DECISIVE EVIDENCE before the batch finalizes. A top pick's
  // live-Google teammate (emitDataforseoOpinion) abstains whenever no SERP evidence exists for
  // its query - honest, but on tonight's TOP picks that silence is worth closing with one
  // targeted, gauntleted lookup rather than shipping the pick with a silent voice. Bounded to
  // the top 5 picks by opportunity; only when the evidence is genuinely absent (no cached
  // pattern, no fresh history); one attempt per pick (runSerpQuery's own 14d cache makes a
  // second attempt the same night or the same fortnight a free cache hit, never a second spend);
  // fail-soft throughout - a decline (dry-run/disabled/capped/error/no-results) just keeps the
  // pick's original abstain and the batch keeps moving.
  const gapCandidates: EvidenceGapCandidate[] = selected.map((c) => {
    const q = c.targetQuery.trim().toLowerCase();
    return {
      url: c.url,
      targetQuery: c.targetQuery,
      packet: packetByPath.get(normalizePath(c.url)) ?? null,
      rankScore: c.ctrOpportunityClicks,
      hasCachedSerpPattern: serpByTerm.has(q),
      hasFreshSerpHistory: false,
    };
  });
  const evidenceGaps = findEvidenceGaps(gapCandidates, { maxGaps: 5 });
  if (evidenceGaps.length > 0) {
    const ownDomain = await currentTenant().then((t) => t.domain).catch(() => null);
    await Promise.all(
      evidenceGaps.map(async (gap) => {
        const c = selected.find((s) => normalizePath(s.url) === normalizePath(gap.candidate.url));
        if (!c) return;
        const purchase = await buyEvidenceForPick(gap, { ownDomain }).catch(() => null);
        if (!purchase || purchase.status !== "bought" || !purchase.serpVerdict) return; // fail-soft: keep original abstain
        // Re-run THIS pick's team review with the fresh live-Google verdict threaded in, so the
        // debate the card shows reflects the teammate that just spoke instead of the stale one
        // that abstained. Every other pick is untouched.
        const packet = packetByPath.get(normalizePath(c.url));
        const result = reviewCandidateWithTeam(packet, nowIso, { serpVerdict: purchase.serpVerdict });
        if (result.review) {
          c.teamReview = result.review;
          const hist = historyLine(c.pageFamily ?? "", c.actionFamily);
          if (hist && !c.teamReview.voices.some((v) => v.label === "Results so far")) {
            c.teamReview.voices.push({ specialist: "proof", label: "Results so far", claim: hist, confidencePct: 65 });
          }
          if (purchase.receiptSentence) {
            c.teamReview.voices.push({
              specialist: "dataforseo",
              label: "Live Google results",
              claim: purchase.receiptSentence,
              confidencePct: 80,
            });
          }
        }
        c.teamScoreMultiplier = (c.familyWin ? c.familyWin.boost : 1) * result.scoreMultiplier;
      }),
    );
  }

  // Item 25 - the strategist WRITES the team verdict for each pick: a grounded 1-3 sentence
  // synthesis of the real specialist claims (budget-gated, numeric-fidelity firewalled, fail-soft
  // to the deterministic verdict). Selected picks only (max 8/night, ~$0.08 worst case).
  const LEVER_PLAIN: Record<string, string> = {
    meta: "a sharper description", title: "a sharper title", h1: "a clearer headline",
    internal_link: "an internal link", answer_block: "a direct answer at the top",
    refresh: "a refresh with the missing section",
  };
  await Promise.all(
    selected.map(async (c) => {
      const t = c.teamReview;
      if (!t || t.voices.length === 0) return;
      try {
        const r = await draftTeamVerdictStructured({
          pageLabel: c.pageLabel,
          targetQuery: c.targetQuery,
          leverPlain: LEVER_PLAIN[c.leverField] ?? c.leverField,
          proposedText: c.proposedText,
          voices: t.voices.map((v) => ({ label: v.label, claim: v.claim })),
          objections: t.objections.map((o) => ({ label: o.label, reason: o.reason })),
          whyNot: t.whyNot,
        });
        if (r.status === "drafted" && r.value.verdict.trim()) {
          t.verdict = r.value.verdict.trim();
        }
      } catch {
        /* keep the deterministic verdict */
      }
    }),
  );

  // Items 27/64's correctionFactor + captureDistribution are derived up front now (see the initial
  // Promise.all) so item 35's power gate and this final plan record share the exact same forecast
  // numbers.
  const record = buildDailyPlanRecord({
    tenantId, date: now.toISOString().slice(0, 10), now, selected, backups,
    activeSnapshot: { proofIds: activeProofIds, treatedUrls: [...activeTreated], controlUrls: [...activeControl], influencedUrls: [] },
    correctionFactor,
    captureDistribution,
  });

  // Item 65 - THE SHADOW PORTFOLIO: capture tonight's top rejected-but-eligible candidates (the
  // best of `teamReviewed` that did NOT make it into `selected`, ranked the same way the planner
  // itself ranks a pick) as a free counterfactual cohort. Additive, fail-soft, computed-only here -
  // the write never blocks or alters the plan record itself, and a store error just means tonight
  // has no shadow batch (the /proof line and the drift calibration feed both self-hide on absence).
  await writeShadowPortfolioBatch({
    tenant_id: tenantId,
    plan_id: record.id,
    date: record.date,
    captured_at: nowIso,
    candidates: buildShadowCandidates(teamReviewed, new Set(selected.map((c) => c.url)), correctionFactor),
  }).catch(() => {});

  // Item 12 - the FINAL REVIEW: after picks are FINAL, one bounded LLM read checks each pick
  // against its own evidence ("does the proposed text match what the top search asks?") and
  // attaches an optional one-line caution (teamCheck). Attach-only: it never drops, reorders,
  // or blocks a pick; budget-gated + fail-open-loud inside the adjudicator; persisted with the
  // preview so the morning render is $0.
  await applyFinalReviewToPicks(record.selected, { now }).catch(() => 0);

  const excludedByReason: Record<string, number> = {};
  for (const e of plan.excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] ?? 0) + 1;

  if (qaRejected > 0) excludedByReason.quality_rejected = qaRejected;
  if (teamVetoed > 0) excludedByReason.team_vetoed = teamVetoed;
  return { record, candidatesEvaluated: built.length, excludedByReason };
}
