import { readStore } from "../json-store";
import type { SeedDataRepository } from "./types";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";

/**
 * File-backed repository — wraps readStore() calls.
 * Returns the same cached array references as direct readStore usage,
 * preserving the existing mutation semantics (import actions push
 * to the same in-memory arrays).
 */
export const fileBackend: SeedDataRepository = {
  getImportRuns: async () => readStore<ImportRun>("import-runs"),
  getResults: async () => readStore<Result>("imported-results"),
  getChangelogEntries: async () =>
    readStore<ChangelogEntry>("imported-changes"),
  getOpportunities: async () =>
    readStore<Opportunity>("imported-opportunities"),
  getCompetitors: async () => readStore<Competitor>("imported-competitors"),
};
