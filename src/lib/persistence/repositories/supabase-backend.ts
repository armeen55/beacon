import { getSupabaseAdmin } from "../supabase";
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
import { mapRowToEntity } from "./key-mapper";

async function query<T>(table: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function queryMapped<T>(table: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []).map((row) =>
    mapRowToEntity<T>(row as Record<string, unknown>),
  );
}

export const supabaseBackend: SeedDataRepository = {
  // Phase 1B
  getImportRuns: () => query<ImportRun>("import_runs"),
  getResults: () => query<Result>("results"),
  getChangelogEntries: () => query<ChangelogEntry>("changelog_entries"),
  getOpportunities: () => query<Opportunity>("opportunities"),
  getCompetitors: () => query<Competitor>("competitors"),

  // Phase 1D
  getEventDecisions: () => query<EventDecision>("attribution_decisions"),
  getCandidateLinks: () => query<CandidateLink>("candidate_links"),
  getPageIssues: () => queryMapped<PersistedIssue>("page_issues"),
  getChangeContracts: () => queryMapped<ChangeContract>("change_contracts"),

  // Phase 1E
  getPages: () => query<PageEntity>("pages"),
  getPageSnapshots: () => query<PageSnapshot>("page_snapshots"),
  getGuardrailAlerts: () => query<GuardrailAlert>("guardrail_alerts"),

  getCitationEvidenceIndex: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("citation_evidence_index")
      .select("*")
      .eq("id", "current")
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on citation_evidence_index: ${error.message}`,
      );
    if (!data) return null;
    return {
      built_at: data.built_at,
      total_citations_processed: data.total_citations_processed,
      by_page_and_topic: data.by_page_and_topic,
      by_topic: data.by_topic,
      page_to_topics: data.page_to_topics,
    } as CitationEvidenceIndex;
  },

  getObservationRuns: () => query<ObservationRun>("observation_runs"),
  getCompetitorConfigEntries: () =>
    query<ConfiguredCompetitorEntry>("competitor_config"),
};
