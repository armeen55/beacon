/**
 * Data Adapter Interfaces — swappable data source contracts.
 *
 * Each domain has an adapter interface that returns normalized Beacon data
 * regardless of whether the source is Profound imports, native querying,
 * or a future data pipeline. Routes and view-models consume adapters,
 * never raw stores directly.
 *
 * The current implementation delegates to existing stores (json-store,
 * cold-store, repository). A future native-first adapter would implement
 * the same interfaces from answer snapshots + native citation data.
 */

import type { CitationEvidenceIndex, CitationPageRollup } from "@/domains/pages/types";
import type { GeoCoverageIndex } from "@/domains/geo/types";
import type { JourneyCoverageResult } from "@/domains/prompts/journey-coverage";
import type { BeaconScoreResult } from "@/domains/product/beacon-score-types";
import type { CoMentionMatrix } from "@/domains/competitors/co-mention-types";
import type { SourceTrustIndex } from "@/domains/competitors/source-trust-types";
import type { BattlecardIndex } from "@/domains/competitors/battlecard-types";
import type { EntityIndex } from "@/domains/entity/types";
import type { DiscrepancyReport } from "@/domains/entity/discrepancy-types";
import type { SnippetIntelligence } from "@/domains/competitors/snippet-types";
import type { CitationDecayResult } from "@/domains/attribution/decay-types";
import type { OutcomeSummary } from "@/domains/product/outcome-types";
import type { PulseSummary } from "@/domains/product/pulse-types";

/** Visibility data from results/citations */
export interface VisibilityAdapter {
  getTotalCitations(): number;
  getTotalMentions(): number;
  getTrendPct(): number | null;
  getPlatformBreakdown(): { platform: string; label: string; citations: number; mentions: number }[];
  getDateRange(): { from: string; to: string } | null;
  getResultCount(): number;
  getCitationIndex(): CitationEvidenceIndex | null;
  getCitationRollups(): CitationPageRollup[];
}

/** Geographic intelligence */
export interface GeoAdapter {
  getCoverage(): GeoCoverageIndex;
}

/** Journey stage intelligence */
export interface JourneyAdapter {
  getCoverage(): JourneyCoverageResult;
}

/** Composite score */
export interface ScoreAdapter {
  getScore(): BeaconScoreResult;
}

/** Competitive intelligence */
export interface CompetitiveAdapter {
  getCoMentionMatrix(): CoMentionMatrix | null;
  getSourceTrustIndex(): SourceTrustIndex;
  getBattlecards(): BattlecardIndex | null;
}

/** Entity + representation */
export interface EntityAdapter {
  getEntityIndex(): EntityIndex;
  getDiscrepancyReport(): DiscrepancyReport;
}

/** Attribution signals */
export interface AttributionAdapter {
  getDecayResults(): CitationDecayResult[];
  getDecayAlerts(): CitationDecayResult[];
}

/** Outcome tracking */
export interface OutcomeAdapter {
  getSummary(): OutcomeSummary | null;
}

/** Snippet / extractability */
export interface SnippetAdapter {
  getSnippetIntelligence(): SnippetIntelligence | null;
}

/** System pulse */
export interface PulseAdapter {
  getPulse(): PulseSummary;
}

/**
 * Master adapter bundle — routes can request specific adapters.
 * Each adapter is independently swappable.
 */
export interface BeaconDataAdapters {
  visibility: VisibilityAdapter;
  geo: GeoAdapter;
  journey: JourneyAdapter;
  score: ScoreAdapter;
  competitive: CompetitiveAdapter;
  entity: EntityAdapter;
  attribution: AttributionAdapter;
  outcome: OutcomeAdapter;
  snippet: SnippetAdapter;
  pulse: PulseAdapter;
}
