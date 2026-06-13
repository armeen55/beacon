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
import { currentTenantId } from "./tenant-context";

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

function emptyState(): State {
  return {
    results: null,
    changelogEntries: null,
    opportunities: null,
    competitors: null,
    briefs: null,
    competitorSnapshots: null,
    importRuns: null,
  };
}

// Per-tenant process-level cache (2026-06-12 — burns down the
// per-tenant-cache-key ratchet's seed-data allowlist). Keyed by the
// resolved tenant: a warm lambda serving multiple tenants must NOT bleed
// one tenant's data into another. The base getRepository().getX() reads
// are NOT tenant-filtered (query() does a bare select *), so isolation
// comes from BOTH (a) reading through forTenant(tenantId) and (b) keying
// the cache by tenant. Concurrent multi-tenant requests get distinct Map
// entries, so they can't race-clobber a single shared `_state`.
const _stateByTenant = new Map<string, State>();

async function loadFromRepoOrSeed(tenantId: string): Promise<State> {
  const cached = _stateByTenant.get(tenantId);
  if (cached && cached.importRuns !== null) return cached;
  const state = cached ?? emptyState();
  _stateByTenant.set(tenantId, state);

  // TENANT-SCOPED reads via forTenant — NOT the bare getRepository(), whose
  // base getters do `select *` with no tenant filter and would return every
  // tenant's rows (the founder's, in practice — the only one with data).
  const repo = getRepository().forTenant(tenantId);
  const importRuns = await repo.getImportRuns();
  state.importRuns = importRuns;

  if (importRuns.length > 0) {
    const [res, changes, opps, comps] = await Promise.all([
      repo.getResults(),
      repo.getChangelogEntries(),
      repo.getOpportunities(),
      repo.getCompetitors(),
    ]);
    state.results = res;
    state.changelogEntries = changes;
    state.opportunities = opps;
    state.competitors = comps;
    state.briefs = [];
    state.competitorSnapshots = [];
  } else {
    state.results = [...seed.results];
    state.changelogEntries = [...seed.changelogEntries];
    state.opportunities = [...seed.opportunities];
    state.competitors = [...seed.competitors];
    state.briefs = [...seed.briefs];
    state.competitorSnapshots = [...seed.competitorSnapshots];
  }
  return state;
}

/**
 * `React.cache` ensures concurrent callers within one render tree share
 * the same in-flight Promise; the tenant is resolved per render via
 * `currentTenantId` and its state is cached per-tenant in `_stateByTenant`
 * across requests in the same lambda.
 */
const ensureLoaded = cache(async (): Promise<State> => {
  const tenantId = await currentTenantId();
  return loadFromRepoOrSeed(tenantId);
});

// ---------------------------------------------------------------------------
// Public getters.
//
// Each is wrapped in `React.cache` so a single render tree resolves
// the array once. The returned reference IS the cached array — callers
// may mutate via `.push(...)`, `.length = 0; .push(...rest)`, etc. and
// those mutations persist for the lifetime of the lambda.
// ---------------------------------------------------------------------------

export const getResults = cache(async (): Promise<Result[]> => {
  const s = await ensureLoaded();
  // Array getter — coalesce to [] (see the block on getChangelogEntries
  // below; a null `results` would crash every consumer that maps/iterates).
  return s.results ?? [];
});

// Robustness (2026-06-13): these getters return `Promise<X[]>` and
// every caller treats the result as an array (`.length`, `for…of`,
// `.map`). The old `s.X!` was a non-null ASSERTION with no runtime
// guarantee — when a tenant's state has a null/undefined array (new
// or empty tenant, or a per-tenant state entry the seed never
// populated), the assertion let `null` through and crashed the whole
// shell (`changelogEntries.length` → TypeError on every page). A
// missing list is an EMPTY list, never null — coalesce so one absent
// array can never 500 an unrelated surface.
export const getChangelogEntries = cache(
  async (): Promise<ChangelogEntry[]> => {
    const s = await ensureLoaded();
    return s.changelogEntries ?? [];
  },
);

export const getOpportunities = cache(async (): Promise<Opportunity[]> => {
  const s = await ensureLoaded();
  return s.opportunities ?? [];
});

export const getCompetitors = cache(async (): Promise<Competitor[]> => {
  const s = await ensureLoaded();
  return s.competitors ?? [];
});

export const getBriefs = cache(async (): Promise<Brief[]> => {
  const s = await ensureLoaded();
  return s.briefs ?? [];
});

export const getCompetitorSnapshots = cache(
  async (): Promise<CompetitorSnapshot[]> => {
    const s = await ensureLoaded();
    return s.competitorSnapshots ?? [];
  },
);

export const getImportRuns = cache(async (): Promise<ImportRun[]> => {
  const s = await ensureLoaded();
  return s.importRuns ?? [];
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
  _stateByTenant.clear();
}
