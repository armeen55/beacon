/** Canonical page and observation writes go straight to Supabase and require readback. */

import "server-only";

import { getSupabaseAdmin } from "./supabase";

const CHUNK_SIZE = 500;

const MAX_RETRY_ATTEMPTS = 4; // 1 initial + 3 retries
const RETRY_BACKOFF_BASE_MS = 500; // 500 → 1000 → 2000 between attempts

/** Schema-shape / constraint errors; retry is pointless. Match on message text because Supabase-js error objects don't always populate `.code`. */
function isNonRetryableError(msg: string): boolean {
  return /schema cache|does not exist|column|violates|constraint|invalid input syntax/i.test(
    msg,
  );
}

async function dualWriteUpsert(
  table: string,
  rows: Record<string, unknown>[],
  primaryKey: string,
): Promise<void> {
  if (rows.length === 0) return;

  const sb = getSupabaseAdmin();
  // Proof of the write is the rows Postgres hands back, never the absence of an error. A lean projection of the conflict key's first column keeps the confirmation read to one small field per row.
  const confirmColumn = primaryKey.split(",")[0]!.trim();

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const chunkLabel = `${table} chunk ${i}-${i + chunk.length}`;

      // Retry loop - up to MAX_RETRY_ATTEMPTS total attempts per chunk.
      let lastErr: unknown = null;
      let written = 0;
      for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        try {
          const { data, error } = await sb
            .from(table)
            .upsert(chunk, { onConflict: primaryKey })
            .select(confirmColumn);
          if (!error) {
            written = Array.isArray(data) ? data.length : 0;
            lastErr = null;
            break;
          }
          if (isNonRetryableError(error.message ?? "")) {
            throw new Error(error.message ?? String(error));
          }
          lastErr = new Error(error.message ?? String(error));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (isNonRetryableError(msg)) throw e;
          lastErr = e;
        }
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
          console.error(
            `[dual-write] ${chunkLabel}: attempt ${attempt} transient failure (${
              lastErr instanceof Error ? lastErr.message : String(lastErr)
            }) - retrying in ${backoffMs}ms`,
          );
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }

      if (lastErr) {
        console.error(
          `[dual-write] ${chunkLabel} failed after ${MAX_RETRY_ATTEMPTS} attempts - ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`,
        );
        // A persistent write failure that is silently swallowed loses data and produces the false-completed signature seen on May 2-4 2026 (runs stamped completed, rows never landed). Always throw.
        throw new Error(
          `[dual-write] ${table}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
        );
      }

      // No error and no rows back: the batch did not land. Silent zero is the same lie as a swallowed failure, so it fails closed too.
      if (written === 0) {
        throw new Error(
          `[dual-write] ${table}: ${chunk.length} row(s) sent, 0 written`,
        );
      }
    }
  } catch (e) {
    console.error(
      `[dual-write] ${table}: unexpected error - ${e instanceof Error ? e.message : e}`,
    );
    // Always re-throw so the caller marks its run failed instead of showing a false "complete".
    throw e;
  }
}

/**
 * Tables whose Supabase rows do NOT carry a `tenant_id` column. Writes to these MUST go through `dualWriteUpsert`. Writes to any other table MUST go through `dualWriteUpsertScoped`.
 *
 * Categories:
 * - registry:       `tenants`
 * - singletons:     `business_config`, `citation_evidence_index`, `answer_intelligence_index`
 * - operator-shared config: `tracked_prompts`, `tracked_entities`, `answer_texts`
 * - global learning: `change_patterns`, `triage_rules`, `confidence_calibration`
 *
 */
export const GLOBAL_TABLES: ReadonlySet<string> = new Set([
  "tenants",
  "business_config",
  "tracked_prompts",
  "tracked_entities",
  "answer_texts",
  "change_patterns",
  "triage_rules",
  "confidence_calibration",
]);

/**
 * Throws if any row's `tenant_id` doesn't match `tenantId`. Pure / no I/O. Use as the first step of every tenant-scoped writer; failing fast on mismatch is the leak-prevention contract.
 *
 * Treats missing/null `tenant_id` as a mismatch - defense against row mappers that forgot to stamp the field. An empty `tenantId` argument is also rejected so callers can't "validate" with the wrong fail-open value.
 */
export function assertRowsScopedToTenant(
  rows: ReadonlyArray<{ tenant_id?: string | null }>,
  tenantId: string,
  context: string,
): void {
  if (!tenantId) {
    throw new Error(
      `[dual-write/${context}] assertRowsScopedToTenant: tenantId must be a non-empty string`,
    );
  }
  for (const row of rows) {
    const rowTenant = row.tenant_id ?? "";
    if (rowTenant !== tenantId) {
      throw new Error(
        `[dual-write/${context}] tenant mismatch: row.tenant_id=${JSON.stringify(rowTenant)} expected=${tenantId}`,
      );
    }
  }
}

/**
 * Tenant-scoped variant of `dualWriteUpsert`. Refuses to write to a table in `GLOBAL_TABLES`; refuses to write rows whose `tenant_id` doesn't match `tenantId`. Validation happens before any I/O so cross-tenant leaks fail loud at the call site.
 *
 * Phase 7.7a: helper exists; no caller uses it yet. Phase 7.7b threads `tenantId` through every Tier A `sync*` helper and converts them to call this helper instead of `dualWriteUpsert` directly.
 */
export async function dualWriteUpsertScoped(
  table: string,
  rows: ReadonlyArray<{ tenant_id?: string | null } & Record<string, unknown>>,
  primaryKey: string,
  tenantId: string,
): Promise<void> {
  if (rows.length === 0) return;
  if (GLOBAL_TABLES.has(table)) {
    throw new Error(
      `[dual-write/${table}] is a global table - use dualWriteUpsert, not dualWriteUpsertScoped`,
    );
  }
  assertRowsScopedToTenant(rows, tenantId, table);
  await dualWriteUpsert(table, rows as Record<string, unknown>[], primaryKey);
}

/**
 * Force-stamps `tenant_id = tenantId` on every row. Throws only when an input row already carries a NON-EMPTY `tenant_id` that doesn't match. Empty string, `null`, and `undefined` are all coerced to `tenantId`.
 *
 * Pure / no I/O. Does not mutate input rows (returns a new array).
 */
export function tenantizeRows<
  T extends Record<string, unknown> & { tenant_id?: string | null },
>(
  rows: ReadonlyArray<T>,
  tenantId: string,
  context: string,
): T[] {
  if (!tenantId) {
    throw new Error(
      `[dual-write/${context}] tenantizeRows: tenantId must be a non-empty string`,
    );
  }
  return rows.map((row) => {
    const existing = row.tenant_id ?? "";
    if (existing !== "" && existing !== tenantId) {
      throw new Error(
        `[dual-write/${context}] tenant mismatch: row.tenant_id=${JSON.stringify(existing)} expected=${tenantId}`,
      );
    }
    return { ...row, tenant_id: tenantId };
  });
}

import type { PageSnapshot, PageEntity } from "@/domains/evidence/pages/types";

type AnyRow = Record<string, unknown>;

export async function syncPages(
  rows: PageEntity[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "pages");
  await dualWriteUpsert("pages", stamped as unknown as AnyRow[], "id");
}

export async function syncPageSnapshots(
  rows: PageSnapshot[],
  tenantId: string,
): Promise<void> {
  const stamped = tenantizeRows(rows, tenantId, "page_snapshots");
  await dualWriteUpsert("page_snapshots", stamped as unknown as AnyRow[], "id");
}

