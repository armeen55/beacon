import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import type { PersistedActionState } from "./types";

// Night-shift fix (2026-06-11): the cache was a process-global `_state`
// keyed by NOTHING — first tenant pinned its action states for every
// later tenant in a warm process (4th instance of the class tonight).
// The underlying store is disk-routed per-tenant by the ambient slug
// (action-states is TENANT_SCOPED; even the Supabase backend reads the
// routed disk store here), so the read itself is ambient-correct — the
// cache key was the leak.
const _byTenant = new Map<string, PersistedActionState[]>();

export const getActionStates = cache(
  async (): Promise<PersistedActionState[]> => {
    const tenantId = await currentTenantId();
    const cached = _byTenant.get(tenantId);
    if (cached) return cached;
    const loaded = await getRepository().getActionStates();
    _byTenant.set(tenantId, loaded);
    return loaded;
  },
);

export async function persistActionStates(): Promise<void> {
  await writeStore("action-states", await getActionStates());
}

export function _resetActionStatesForTests(): void {
  _byTenant.clear();
}
