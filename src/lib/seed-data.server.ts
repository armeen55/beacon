/**
 * Server-only data layer.
 *
 * When an imported experiment is active (import-runs store is non-empty),
 * all entity arrays contain ONLY imported data — seed/demo data is suppressed.
 *
 * When no experiment is active, seed/demo data is used as a product walkthrough.
 *
 * Data source is selected by the DATA_SOURCE env var:
 *   "supabase" — canonical runtime reads from Postgres via SeedDataRepository (committed default)
 *   "file"     — rollback: same repository interface, file-backed backend + json-store
 *
 * Only Server Components and Server Actions should import this module.
 * Client Components receive data as props from server parents.
 */

import "server-only";

import * as seed from "./seed-data";
import { getRepository } from "./persistence/repositories";

import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { Brief } from "@/domains/briefs/types";
import type { CompetitorSnapshot } from "@/domains/competitors/types";

const repo = getRepository();

const _importRuns = await repo.getImportRuns();

/**
 * True when at least one import run has been recorded.
 * For file backend: reflects the cached readStore reference,
 * so runtime mutations (import pushes) are visible.
 */
export function hasActiveExperiment(): boolean {
  return _importRuns.length > 0;
}

export { _importRuns as importRuns };

// ── Mutable entity arrays ──
// Hydrated at module load from `getRepository()` when an import experiment is active;
// otherwise seeded from static `seed-data`. Import actions mutate these arrays in-process.

export const results: Result[] = [];
export const changelogEntries: ChangelogEntry[] = [];
export const opportunities: Opportunity[] = [];
export const competitors: Competitor[] = [];
export const briefs: Brief[] = [];
export const competitorSnapshots: CompetitorSnapshot[] = [];

// ── Populate based on experiment state ──

if (_importRuns.length > 0) {
  const [res, changes, opps, comps] = await Promise.all([
    repo.getResults(),
    repo.getChangelogEntries(),
    repo.getOpportunities(),
    repo.getCompetitors(),
  ]);
  results.push(...res);
  changelogEntries.push(...changes);
  opportunities.push(...opps);
  competitors.push(...comps);
} else {
  results.push(...seed.results);
  changelogEntries.push(...seed.changelogEntries);
  opportunities.push(...seed.opportunities);
  competitors.push(...seed.competitors);
  briefs.push(...seed.briefs);
  competitorSnapshots.push(...seed.competitorSnapshots);
}
