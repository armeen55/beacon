/**
 * Evidence kernel — public facade.
 *
 * The Evidence kernel assembles a single EvidenceSnapshot from the six
 * connector readers (GSC, GA4 page values, GA4 revenue, Clarity, DataForSEO,
 * native AI intel) and the snapshot builder. This index is the ONLY surface
 * `src/app` may import. Reader internals stay private behind here.
 */

// Snapshot: types + builder + helpers
export type {
  EvidenceSourceKind,
  SourceStatus,
  SourceFreshness,
  OwnedQuerySignal,
  OwnedPageContent,
  OwnedPageSearch,
  OwnedPageEngagement,
  OwnedPageFriction,
  OwnedPageEvidence,
  CompetitorEvidence,
  KeywordDemandSignal,
  QuestionDemandSignal,
  IntentCluster,
  CannibalizationGroup,
  ContentGapKind,
  ContentGap,
  InternalLinkOpportunity,
  EvidenceSnapshotScope,
  EvidenceSnapshot,
  LoadedSource,
  EvidenceSnapshotInput,
} from "./snapshot";
export {
  MANDATORY_SOURCES,
  canonicalUrlKey,
  buildEvidenceSnapshot,
  hashSnapshot,
} from "./snapshot";

// Topic investigation: the non-actionable research packet derived from a snapshot
export type { TopicInvestigation } from "./topic-investigation";
export { buildTopicInvestigations } from "./topic-investigation";
export type { SerpPageType } from "./serp-shape";
// The per-case research receipt: what was found, what it cost, and why nothing more was bought
export { caseResearchReceipt } from "./case-receipt";

// Competitor landscape: what every recurring domain IS, why, and the operator's corrections
export type { ClassifiedDomain, CompetitorKind, DomainSignals } from "./competitors/classify";
export { classifyDomain } from "./competitors/classify";
export type { CompetitorOverride } from "./competitors/landscape";
export { competitorLandscape, competitorOverrideLine, parseCompetitorOverrides } from "./competitors/landscape";

// Loader
export type { LoadEvidenceSnapshotOptions } from "./snapshot-loader";
export { loadEvidenceSnapshot } from "./snapshot-loader";

// Relevance gate (evidence-join suppression)
export type { RelevanceReason, RelevanceVerdict } from "./relevance-gate";
export {
  topicTokens,
  domainOf,
  isNoiseDomain,
  scoreTopicMatch,
  competitorRelevance,
  promptRelevance,
} from "./relevance-gate";

// The six connector readers (public entry points + result types)
export type { GscPageSignal, GscQuerySignal, GscSiteTotals, GscDecaySignal } from "./readers/gsc-page-signals";
export {
  loadGscPageSignalsForTenant,
  loadGscSiteTotalsForTenant,
  loadGscDecaySignalsForTenant,
} from "./readers/gsc-page-signals";
export type { Ga4PageValue } from "./readers/ga4-page-values";
export { loadGa4PageValuesForTenant, loadGa4PageRevenueForTenant, ga4ValueWeight } from "./readers/ga4-page-values";
export type { PageRevenueValue, RevenueConfidence } from "./readers/ga4-revenue";
export { normalizePageRevenue, revenueScoreMultiplier, revenueStateLabel } from "./readers/ga4-revenue";
export type { ClarityPageSignal } from "./readers/clarity-page-signals";
export { loadClarityPageSignalsForTenant } from "./readers/clarity-page-signals";

// Canonical DataForSEO boundary: env/config state lives in dataforseo/client;
// every provider call flows through the cached money-safe boundary
// (dataforseo/funnel-boundary); the research funnel's phase executors and
// snapshot-ready evidence are the ONLY surface Runtime consumes.
export type { FunnelUnitOutcome } from "./dataforseo/funnel-boundary";
export { keywordDiscoveryUnit } from "./funnel/discovery";
export { promptObservationUnit, serpAnalysisUnit } from "./funnel/observe";
export { winningPagesUnit, type FunnelIntersectionAsk } from "./funnel/winning-pages";

// --- App/component surface re-exports (curated) ---

// GSC scoreboard + weekly + fresh-tail + ingestion-gap surfaces
export { loadScoreboardBrandLens } from "./gsc/load-brand-split";
export { loadGscWeeklyLens } from "./gsc/load-weekly-dimensions";
export { readGscFreshTailCached, refreshGscFreshTail } from "./gsc/load-fresh-tail";
export { FRESH_TAIL_NOTE, type FreshTailPoint } from "./gsc/fresh-tail";
export { loadGscIngestionGapReport } from "./gsc/load-ingestion-gaps";
export { ingestionGapLine } from "./gsc/ingestion-gaps";

// Scanning surfaces
export { getPendingFindings } from "./scanning/findings-store";
export { CONTENT_CHANGE_TYPES } from "./scanning/content-change-types";
export { runInProcessColdStartScan } from "./scanning/in-process-scan";
export { loadCrawlFrontier, runCrawlBatch } from "./scanning/crawl-frontier";

// Targeted owned-page body read (an explicit tenant + a handful of URLs)
export type { OwnedPageBody } from "./pages/owned-context";
export { loadOwnedPageBodies } from "./pages/owned-context";

// Product URL watcher
export { maybeRefreshUrlWatcher } from "./product/url-watcher";

// Competitor-intel polite fetch
export { fetchPageHtml } from "./competitor-intel/polite-fetch";

// AI-visibility citation canonicalization
export { canonicalizeCitationUrl } from "./ai-visibility/canonicalize-citation-url";

// Full-fidelity AI observations: the canonical stored answer + its journey, and the
// zero-cost re-analysis path over text that was already bought once.
export type {
  AiObservationRecord,
  AiObservationStatus,
  AiObservationView,
  DueObservation,
} from "./ai-visibility/ai-observations";
export { isAnalysisSettled, observationReceiptCost, persistAnswerAnalysis, readAiObservations, readAiObservationViews } from "./ai-visibility/ai-observations";

// AI engines the tenant prompt library is tracked across (canonical union)
export { ALL_ENGINES, type EngineId } from "./readers/engine-types";
