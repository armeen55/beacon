/** Canonical page and observation writes go straight to Supabase and require readback. */

import "server-only";

import { getSupabaseAdmin } from "./supabase";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";

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

  const columns = [...new Set([...primaryKey.split(",").map((column) => column.trim()),
    ...(rows.some((row) => "tenant_id" in row) ? ["tenant_id"] : [])])];
  const identity = (row: unknown): string | null => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const values = columns.map((column) => (row as Record<string, unknown>)[column]);
    return values.every((value) =>
      (typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))
    ) ? JSON.stringify(values) : null;
  };
  // Freeze expected identities before any await; caller mutation cannot redefine write custody.
  const submitted = rows.map((row) => ({ ...row }));
  const expected = submitted.map(identity);
  if (expected.includes(null) || new Set(expected).size !== rows.length) throw new Error(`[dual-write] ${table}: invalid or duplicate submitted key constraint`);
  const sb = getSupabaseAdmin();
  for (let i = 0; i < submitted.length; i += CHUNK_SIZE) {
    const chunk = submitted.slice(i, i + CHUNK_SIZE);
    const expectedChunk = new Set(expected.slice(i, i + CHUNK_SIZE));
    const chunkLabel = `${table} chunk ${i}-${i + chunk.length}`;

    // Retry loop - up to MAX_RETRY_ATTEMPTS total attempts per chunk.
    let lastErr: unknown = null;
    let written: unknown[] = [];
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const { data, error } = await sb
          .from(table)
          .upsert(chunk, { onConflict: primaryKey })
          .select(columns.join(","));
        if (!error) {
          written = Array.isArray(data) ? data : [];
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
      // A persistent write failure that is silently swallowed loses data and produces the false-completed signature seen on May 2-4 2026 (runs stamped completed, rows never landed). Always throw.
      throw new Error(
        `[dual-write] ${table}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }

    // A malformed successful reply fails without another write attempt.
    if (written.length !== expectedChunk.size || new Set(written.map(identity)).size !== expectedChunk.size || written.some((row) => !expectedChunk.has(identity(row)))) {
      throw new Error(
        `[dual-write] ${table}: ${chunk.length} row(s) sent, ${written.length} written without complete key and tenant acknowledgement`,
      );
    }
  }
}

/** Shared registry and configuration tables are refused by tenant-scoped writes. */
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

/** Pure tenant assertion: missing/null row tenants and empty scopes fail; inputs are unchanged. */
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

/** Explicit tenant validation precedes every scoped upsert and acknowledgement. */
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

/** Pure copy stamps absent/empty tenants; foreign nonempty tenants and empty scopes fail. */
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
  const stamped = tenantizeRows(rows, tenantId, "page_snapshots").map((row) => {
    const capture = row.content_capture;
    if (!capture || typeof capture !== "object" || Array.isArray(capture)) return row;
    const { validation: _untrusted, ...source } = capture;
    const held: PageSnapshot = { ...row, content_capture: {
      ...source,
      jsonLd: Array.isArray(source.jsonLd) ? [...source.jsonLd] : source.jsonLd,
    } };
    if (source.complete === true) {
      const validation = extractPageSnapshot.captureValidation(held);
      if (!validation) throw new Error("[dual-write] page_snapshots: complete capture disagrees with its derived content fields");
      held.content_capture!.validation = validation;
    }
    return held;
  });
  await dualWriteUpsert("page_snapshots", stamped as unknown as AnyRow[], "id");
}
