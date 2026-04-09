import { readStore } from "../json-store";
import { readDotDataJson } from "../dotdata-json";
import type { SeedDataRepository } from "./types";
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
 * File-backed repository — wraps readStore() / readDotDataJson() calls.
 * Returns the same cached array references for readStore-backed stores,
 * preserving existing mutation semantics (import actions push
 * to the same in-memory arrays).
 */
export const fileBackend: SeedDataRepository = {
  // Phase 1B
  getImportRuns: async () => readStore<ImportRun>("import-runs"),
  getResults: async () => readStore<Result>("imported-results"),
  getChangelogEntries: async () =>
    readStore<ChangelogEntry>("imported-changes"),
  getOpportunities: async () =>
    readStore<Opportunity>("imported-opportunities"),
  getCompetitors: async () => readStore<Competitor>("imported-competitors"),

  // Phase 1D
  getEventDecisions: async () =>
    readStore<EventDecision>("event-decisions"),
  getCandidateLinks: async () =>
    readStore<CandidateLink>("candidate-links"),
  getPageIssues: async () =>
    readStore<PersistedIssue>("page-issues"),
  getChangeContracts: async () =>
    readStore<ChangeContract>("change-contracts"),

  // Phase 1E
  getPages: async () => readStore<PageEntity>("pages"),

  getPageSnapshots: async () =>
    readDotDataJson<PageSnapshot[]>("page-snapshots") ?? [],

  getGuardrailAlerts: async () =>
    readDotDataJson<GuardrailAlert[]>("page-guardrails") ?? [],

  getCitationEvidenceIndex: async () =>
    readDotDataJson<CitationEvidenceIndex>("citation-evidence-index"),

  getObservationRuns: async () =>
    readDotDataJson<ObservationRun[]>("observation-runs") ?? [],

  getCompetitorConfigEntries: async () => {
    const raw = readDotDataJson<{ competitors?: ConfiguredCompetitorEntry[] }>(
      "competitor-universe",
    );
    return raw?.competitors?.filter(Boolean) ?? [];
  },
};
