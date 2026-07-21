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

import { readStore } from "@/lib/persistence/json-store";
import type { GlobalPattern } from "./contracts";

const STORE_NAME = "global-patterns";

export async function listGlobalPatterns(): Promise<GlobalPattern[]> {
  return await readStore<GlobalPattern>(STORE_NAME);
}
