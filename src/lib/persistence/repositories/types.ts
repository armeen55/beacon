import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";

/**
 * Async read interface for the 5 seed-data entity stores.
 * Implementations: file-backed (json-store) and Supabase-backed.
 */
export interface SeedDataRepository {
  getImportRuns(): Promise<ImportRun[]>;
  getResults(): Promise<Result[]>;
  getChangelogEntries(): Promise<ChangelogEntry[]>;
  getOpportunities(): Promise<Opportunity[]>;
  getCompetitors(): Promise<Competitor[]>;
}
