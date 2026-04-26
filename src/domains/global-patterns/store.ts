/**
 * CX4.1 — Global pattern store.
 *
 * GLOBAL store — no tenant_id on the records themselves. The store
 * aggregates anonymized outcomes across all tenants. Privacy is enforced
 * by construction: raw data stays in tenant-scoped stores, only
 * aggregated counts flow here.
 *
 * Persisted to `.data/global-patterns.json`.
 * Hard confidence gates enforced at query time (see query.ts).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { GlobalPattern } from "./contracts";

const STORE_NAME = "global-patterns";

export async function listGlobalPatterns(): Promise<GlobalPattern[]> {
  return await readStore<GlobalPattern>(STORE_NAME);
}

export async function getGlobalPattern(id: string): Promise<GlobalPattern | null> {
  return (await listGlobalPatterns()).find((p) => p.id === id) ?? null;
}

export async function upsertGlobalPattern(
  pattern: GlobalPattern,
): Promise<void> {
  const all = await listGlobalPatterns();
  const idx = all.findIndex((p) => p.id === pattern.id);
  if (idx >= 0) {
    all[idx] = pattern;
  } else {
    all.push(pattern);
  }
  await writeStore(STORE_NAME, all);
}

export async function writeAllGlobalPatterns(
  patterns: GlobalPattern[],
): Promise<void> {
  await writeStore(STORE_NAME, patterns);
}

export async function countGlobalPatterns(): Promise<number> {
  return (await listGlobalPatterns()).length;
}
