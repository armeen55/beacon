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
 *
 * Sprint 7 Phase 7.8e-1 (2026-04-26) — request-scope lift. Module-level
 * top-level `await repo.getX()` reads (which captured the env-resolved
 * tenant once at module init and froze it) are replaced with cached
 * async getters: `getResults`, `getChangelogEntries`, `getOpportunities`,
 * `getCompetitors`, `getBriefs`, `getCompetitorSnapshots`, `getImportRuns`,
 * and `hasActiveExperiment`. `React.cache` memoizes within one render
 * tree; the process-level `_state` map preserves the mutate-array
 * semantic that callers rely on across requests within the same lambda.
 */

import "server-only";

import { cache } from "react";

import * as seed from "./seed-data";
import { getRepository } from "./persistence/repositories";

import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { Brief } from "@/domains/briefs/types";
import type { CompetitorSnapshot } from "@/domains/competitors/types";
import type { ImportRun } from "./import/types";

// ---------------------------------------------------------------------------
// Process-level mutable state.
//
// Until 7.8e-1, these were module-level `const X: T[] = await repo.getX()`
// arrays. The refactor preserves the "mutate-once, share-across-requests"
// semantic — first request through `ensureLoaded()` populates the arrays
// from the repo (or seed data); subsequent requests in the same lambda
// share the SAME array references. Mutations land in `_state` and persist
// across requests within one lambda lifetime, identical to today's
// behavior.
//
// What changed: tenant capture. Today's `repo.getX()` runs at module
// init with whatever tenant `BEACON_TENANT_ID` resolved to. Post-7.8e-1
// it runs at first-render time, where the tenant is correctly resolved
// per-request via `currentTenantId`. Single-tenant production is
// unaffected (env constant per process); multi-tenant is now structurally
// correct.
// ---------------------------------------------------------------------------

type State = {
  results: Result[] | null;
  changelogEntries: ChangelogEntry[] | null;
  opportunities: Opportunity[] | null;
  competitors: Competitor[] | null;
  briefs: Brief[] | null;
  competitorSnapshots: CompetitorSnapshot[] | null;
  importRuns: ImportRun[] | null;
};

const _state: State = {
  results: null,
  changelogEntries: null,
  opportunities: null,
  competitors: null,
  briefs: null,
  competitorSnapshots: null,
  importRuns: null,
};

async function loadFromRepoOrSeed(): Promise<void> {
  if (_state.importRuns !== null) return;

  const repo = getRepository();
  const importRuns = await repo.getImportRuns();
  _state.importRuns = importRuns;

  if (importRuns.length > 0) {
    const [res, changes, opps, comps] = await Promise.all([
      repo.getResults(),
      repo.getChangelogEntries(),
      repo.getOpportunities(),
      repo.getCompetitors(),
    ]);
    _state.results = res;
    _state.changelogEntries = changes;
    _state.opportunities = opps;
    _state.competitors = comps;
    _state.briefs = [];
    _state.competitorSnapshots = [];
  } else {
    _state.results = [...seed.results];
    _state.changelogEntries = [...seed.changelogEntries];
    _state.opportunities = [...seed.opportunities];
    _state.competitors = [...seed.competitors];
    _state.briefs = [...seed.briefs];
    _state.competitorSnapshots = [...seed.competitorSnapshots];
  }
}

/**
 * `React.cache` ensures concurrent callers within one render tree share
 * the same in-flight Promise; subsequent requests find `_state` already
 * populated and return immediately.
 */
const ensureLoaded = cache(loadFromRepoOrSeed);

// ---------------------------------------------------------------------------
// Public getters.
//
// Each is wrapped in `React.cache` so a single render tree resolves
// the array once. The returned reference IS the cached array — callers
// may mutate via `.push(...)`, `.length = 0; .push(...rest)`, etc. and
// those mutations persist for the lifetime of the lambda.
// ---------------------------------------------------------------------------

export const getResults = cache(async (): Promise<Result[]> => {
  await ensureLoaded();
  return _state.results!;
});

export const getChangelogEntries = cache(
  async (): Promise<ChangelogEntry[]> => {
    await ensureLoaded();
    return _state.changelogEntries!;
  },
);

export const getOpportunities = cache(async (): Promise<Opportunity[]> => {
  await ensureLoaded();
  return _state.opportunities!;
});

export const getCompetitors = cache(async (): Promise<Competitor[]> => {
  await ensureLoaded();
  return _state.competitors!;
});

export const getBriefs = cache(async (): Promise<Brief[]> => {
  await ensureLoaded();
  return _state.briefs!;
});

export const getCompetitorSnapshots = cache(
  async (): Promise<CompetitorSnapshot[]> => {
    await ensureLoaded();
    return _state.competitorSnapshots!;
  },
);

export const getImportRuns = cache(async (): Promise<ImportRun[]> => {
  await ensureLoaded();
  return _state.importRuns!;
});

/**
 * True when at least one import run has been recorded. Reflects the
 * cached array reference, so post-init mutations (operator imports a
 * workbook within the lambda lifetime) are visible.
 */
export const hasActiveExperiment = cache(async (): Promise<boolean> => {
  const runs = await getImportRuns();
  return runs.length > 0;
});

/**
 * Test-only reset. Clears the process-level state so the next caller
 * re-runs `loadFromRepoOrSeed()`. Not exported in production paths.
 */
export function _resetSeedDataStateForTests(): void {
  _state.results = null;
  _state.changelogEntries = null;
  _state.opportunities = null;
  _state.competitors = null;
  _state.briefs = null;
  _state.competitorSnapshots = null;
  _state.importRuns = null;
}
