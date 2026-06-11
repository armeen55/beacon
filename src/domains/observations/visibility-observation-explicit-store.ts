import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import type { VisibilityObservationRun } from "./visibility-types";

// Night-shift cache sweep (2026-06-11): process-global `_state` keyed by
// NOTHING leaked the first tenant's visibility runs to every later tenant
// in a warm process (the cross-pin class fixed across 15 other stores
// tonight; missed here). Per-tenant Map keyed by currentTenantId; the read
// stays ambient-routed per-tenant on disk, so the module-global was the leak.
const _byTenant = new Map<string, VisibilityObservationRun[]>();

const ensureLoaded = cache(async (): Promise<VisibilityObservationRun[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getVisibilityObservationRunsExplicit();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

/** Rows from `visibility-observation-runs.json` (disk-backed until a DB table exists). */
export const getVisibilityObservationRunsExplicit = cache(
  async (): Promise<VisibilityObservationRun[]> => {
    return ensureLoaded();
  },
);

export function _resetVisibilityObservationRunsExplicitForTests(): void {
  _byTenant.clear();
}
