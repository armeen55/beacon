/**
 * Server-only data layer.
 *
 * When an imported experiment is active (import-runs store is non-empty),
 * all entity arrays contain ONLY imported data — seed/demo data is suppressed.
 *
 * When no experiment is active, seed/demo data is used as a product walkthrough.
 *
 * Only Server Components and Server Actions should import this module.
 * Client Components receive data as props from server parents.
 */

import "server-only";

import * as seed from "./seed-data";
import { readStore } from "./persistence/json-store";

import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { Brief } from "@/domains/briefs/types";
import type { CompetitorSnapshot } from "@/domains/competitors/types";

const _importRuns = readStore<{ id: string; started_at?: string; source_system?: string }>(
  "import-runs"
);

/**
 * True when at least one import run has been recorded.
 * Uses the cached readStore reference, so it reflects
 * runtime mutations (import pushes, reset clears).
 */
export function hasActiveExperiment(): boolean {
  return _importRuns.length > 0;
}

export { _importRuns as importRuns };

// ── Mutable entity arrays ──
// These are the single source of truth for the entire server process.
// Import actions push to them; reset actions clear them.

export const results: Result[] = [];
export const changelogEntries: ChangelogEntry[] = [];
export const opportunities: Opportunity[] = [];
export const competitors: Competitor[] = [];
export const briefs: Brief[] = [];
export const competitorSnapshots: CompetitorSnapshot[] = [];

// ── Populate based on experiment state ──

if (_importRuns.length > 0) {
  const imported = {
    results: readStore<Result>("imported-results"),
    changes: readStore<ChangelogEntry>("imported-changes"),
    opportunities: readStore<Opportunity>("imported-opportunities"),
    competitors: readStore<Competitor>("imported-competitors"),
  };
  results.push(...imported.results);
  changelogEntries.push(...imported.changes);
  opportunities.push(...imported.opportunities);
  competitors.push(...imported.competitors);
} else {
  results.push(...seed.results);
  changelogEntries.push(...seed.changelogEntries);
  opportunities.push(...seed.opportunities);
  competitors.push(...seed.competitors);
  briefs.push(...seed.briefs);
  competitorSnapshots.push(...seed.competitorSnapshots);
}
