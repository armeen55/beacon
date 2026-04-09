import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type { EventDecision, CandidateLink } from "@/domains/attribution/types";
import type { PersistedIssue } from "@/domains/pages/issues";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type {
  PageEntity,
  PageSnapshot,
  CitationEvidenceIndex,
} from "@/domains/pages/types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { ObservationRun } from "@/domains/observations/types";
import type { ConfiguredCompetitorEntry } from "@/domains/competitors/universe-types";

/**
 * Async read interface for route-critical entity stores.
 * Implementations: file-backed (json-store) and Supabase-backed.
 */
export interface SeedDataRepository {
  // Phase 1B — seed-data entities
  getImportRuns(): Promise<ImportRun[]>;
  getResults(): Promise<Result[]>;
  getChangelogEntries(): Promise<ChangelogEntry[]>;
  getOpportunities(): Promise<Opportunity[]>;
  getCompetitors(): Promise<Competitor[]>;

  // Phase 1D — centralized store modules
  getEventDecisions(): Promise<EventDecision[]>;
  getCandidateLinks(): Promise<CandidateLink[]>;
  getPageIssues(): Promise<PersistedIssue[]>;
  getChangeContracts(): Promise<ChangeContract[]>;

  // Phase 1E — remaining route-critical stores
  getPages(): Promise<PageEntity[]>;
  getPageSnapshots(): Promise<PageSnapshot[]>;
  getGuardrailAlerts(): Promise<GuardrailAlert[]>;
  getCitationEvidenceIndex(): Promise<CitationEvidenceIndex | null>;
  getObservationRuns(): Promise<ObservationRun[]>;
  getCompetitorConfigEntries(): Promise<ConfiguredCompetitorEntry[]>;
}
