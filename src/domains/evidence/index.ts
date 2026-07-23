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
export type { KeywordDemand } from "./readers/dataforseo-keywords";
export { readAllCachedKeywordDemand } from "./readers/dataforseo-keywords";
export { loadNativeIntelForTenant } from "./readers/native-intel-loader";
