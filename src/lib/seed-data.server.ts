/**
 * Server-only changelog/import read layer.
 *
 * Reads real tenant-owned rows through the tenant-scoped repository
 * (`getRepository().forTenant(tenantId)`) — the Supabase backend in
 * production, the file backend under the hermetic test substrate. The
 * founder demo-fixture fallback was removed in the Core 100K collapse
 * (2026-07-22): the product is single-tenant on real data, so every
 * surface renders real rows or an honest empty state, never bundled
 * sample content.
 *
 * Only Server Components and Server Actions should import this module.
 * Client Components receive data as props from server parents.
 *
 * `React.cache` memoizes within one render tree; the process-level
 * per-tenant `_stateByTenant` map preserves the read across requests
 * within one lambda without bleeding one tenant's rows into another.
 */

import "server-only";

import { cache } from "react";

import { getRepository } from "./persistence/repositories";
import { currentTenantId } from "./tenant-context";

import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import type { ImportRun } from "./import/types";

type State = {
  changelogEntries: ChangelogEntry[] | null;
  importRuns: ImportRun[] | null;
};

// Per-tenant process-level cache. Keyed by the resolved tenant so a warm
// lambda serving more than one tenant can never bleed one tenant's rows
// into another. Isolation comes from reading through forTenant(tenantId).
const _stateByTenant = new Map<string, State>();

async function loadFromRepo(tenantId: string): Promise<State> {
  const cached = _stateByTenant.get(tenantId);
  if (cached && cached.importRuns !== null) return cached;
  const state: State = cached ?? { changelogEntries: null, importRuns: null };
  _stateByTenant.set(tenantId, state);

  // TENANT-SCOPED reads via forTenant — NOT the bare getRepository(), whose
  // base getters do `select *` with no tenant filter.
  const repo = getRepository().forTenant(tenantId);
  const [changes, importRuns] = await Promise.all([
    repo.getChangelogEntries(),
    repo.getImportRuns(),
  ]);
  state.changelogEntries = changes;
  state.importRuns = importRuns;
  return state;
}

const ensureLoaded = cache(async (): Promise<State> => {
  const tenantId = await currentTenantId();
  return loadFromRepo(tenantId);
});

/**
 * Changelog rows for the current tenant. A missing list is an EMPTY list,
 * never null, so one absent array can never 500 an unrelated surface.
 */
export const getChangelogEntries = cache(
  async (): Promise<ChangelogEntry[]> => {
    const s = await ensureLoaded();
    return s.changelogEntries ?? [];
  },
);

/**
 * True when at least one import run has been recorded for this tenant.
 */
export const hasActiveExperiment = cache(async (): Promise<boolean> => {
  const s = await ensureLoaded();
  return (s.importRuns ?? []).length > 0;
});
