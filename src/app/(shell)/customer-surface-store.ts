import "server-only";

import { cache } from "react";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId } from "@/lib/tenant-context";
import type { ChangesView } from "./changes-data";
import type { TodayComposite } from "./today-view-data";
import type { NewPagesData } from "./today-newpages-data";

const STORE = "customer-surface";
export const CUSTOMER_SURFACE_FRESH_MS = 15 * 60 * 1000;

/** One atomic customer-visible release. Engineering producers may update their
 * own caches independently, but Today and Changes only adopt a new release when
 * every core section below was assembled successfully. */
export type CustomerSurface = {
  schemaVersion: 1;
  releaseId: string;
  computedAt: string;
  tenantId: string;
  changes: ChangesView;
  today: TodayComposite;
  newPages: NewPagesData | null;
};

export async function readCustomerSurface(tenantId: string): Promise<CustomerSurface | null> {
  const rows = await readStore<CustomerSurface>(STORE, [], { tenantId }).catch(() => [] as CustomerSurface[]);
  const row = rows[0];
  if (!row || row.schemaVersion !== 1 || row.tenantId !== tenantId || !row.changes || !row.today) return null;
  return row;
}

export const loadCurrentCustomerSurface = cache(async (): Promise<CustomerSurface | null> =>
  readCustomerSurface(await currentTenantId()),
);

export async function writeCustomerSurface(surface: CustomerSurface): Promise<void> {
  await writeStore<CustomerSurface>(STORE, [surface], { tenantId: surface.tenantId });
}

/** Soft invalidation: keep the complete prior release visible while the next
 * request rebuilds a replacement. */
export async function invalidateCustomerSurface(tenantId?: string): Promise<void> {
  const id = tenantId ?? await currentTenantId().catch(() => "");
  if (!id) return;
  const existing = await readCustomerSurface(id).catch(() => null);
  if (!existing) return;
  await writeStore<CustomerSurface>(
    STORE,
    [{ ...existing, computedAt: new Date(0).toISOString() }],
    { tenantId: id },
  ).catch(() => {});
}

export function isCustomerSurfaceStale(computedAt: string, nowMs: number): boolean {
  const t = Date.parse(computedAt);
  return !Number.isFinite(t) || nowMs - t > CUSTOMER_SURFACE_FRESH_MS;
}
