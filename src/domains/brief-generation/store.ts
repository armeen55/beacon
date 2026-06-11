import "server-only";

import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import type { PersistedBriefState } from "./types";

// Night-shift cache sweep (2026-06-11): this was a process-global mutable
// `_state` keyed by NOTHING — in a warm multi-tenant process the first
// tenant pinned its brief states for every later tenant (the cross-pin
// class fixed across 15 other stores tonight; this one was missed because
// the read is ambient-routed per-tenant on disk, masking the leak until a
// warm process serves a 2nd tenant). Per-tenant Map now; stable per-tenant
// array refs preserve updateBriefState()'s in-place push/replace mutations.
const _byTenant = new Map<string, PersistedBriefState[]>();

const ensureLoaded = cache(async (): Promise<PersistedBriefState[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getBriefStates();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getBriefStates = cache(
  async (): Promise<PersistedBriefState[]> => {
    return ensureLoaded();
  },
);

export async function persistBriefStates(): Promise<void> {
  await writeStore("brief-states", await getBriefStates());
}

export function _resetBriefStatesForTests(): void {
  _byTenant.clear();
}
