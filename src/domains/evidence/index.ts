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
  NewPageOpportunity,
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
  internalLinkRelevance,
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
export { loadNativeIntelForTenant } from "./readers/native-intel-loader";

// Canonical DataForSEO boundary: env/config state lives in dataforseo/client;
// every provider call flows through the cached money-safe boundary
// (dataforseo/funnel-boundary); the research funnel's phase executors and
// snapshot-ready evidence are the ONLY surface Runtime consumes.
export type { FunnelUnitOutcome } from "./dataforseo/funnel-boundary";
export { keywordDiscoveryUnit } from "./funnel/discovery";
export { promptObservationUnit, serpAnalysisUnit, winningPagesUnit } from "./funnel/observe";
export type { FunnelEvidence } from "./funnel/observe";

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

// Product URL watcher
export { maybeRefreshUrlWatcher } from "./product/url-watcher";

// Competitor-intel polite fetch
export { fetchPageHtml } from "./competitor-intel/polite-fetch";

// AI-visibility citation canonicalization
export { canonicalizeCitationUrl } from "./ai-visibility/canonicalize-citation-url";

// AI engines the tenant prompt library is tracked across (canonical union)
export { ALL_ENGINES, type EngineId } from "./readers/engine-types";
