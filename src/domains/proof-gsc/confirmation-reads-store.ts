import "server-only";

/**
 * confirmation-reads-store (Lane P2, protocol Section 4.2) - the append-only
 * ledger of per-window proof reads.
 *
 * The verdict enum is set ONCE at the 28 day primary close. Every other window
 * read (7/14 context, 56 demote-only, 84 context) is recomputed on load and must
 * be recorded WITHOUT ever mutating a prior read. This store is the append-only
 * table that guarantees that: one row per
 * (tenant_id, proof_id, window_days, computation_version), inserted with an
 * IDEMPOTENT upsert on that key and NEVER updated after write. A re-run of the
 * same window under the same computation version is a no-op (first result wins),
 * which is what closes operator Decision 4's concurrency requirement (the nightly
 * measure pass, an on-use re-measure, and a manual "Measure now" can all race the
 * same (proof, window) and never produce two conflicting rows).
 *
 * Mirrors refresh-runs-store.ts / cron-runs-store.ts EXACTLY:
 *   - Service-role admin client; getSupabaseAdmin() throwing (no env, local dev)
 *     routes straight to the file mirror.
 *   - PGRST205 / 42P01 / PGRST204 (table not migrated in yet) also route to the
 *     file mirror, so deploy order (code before migration) can never break the
 *     measurement pass this ledger observes.
 *   - Fail-soft by contract: recordConfirmationRead NEVER throws. A ledger write
 *     failure must never fail the measurement it is trying to record.
 *
 * SEPARATE from shipped_change_proof - its own table, keyed by proof_id, never a
 * column on the ledger row (a mutable jsonb column would let a later look
 * overwrite an earlier one; this table cannot).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const TABLE = "confirmation_reads";
const STORE = "confirmation-reads";

/** The append-only record of ONE proof window read under ONE computation version. */
export type ConfirmationRead = {
  tenantId: string;
  proofId: string;
  /** 7 / 14 / 28 / 56 / 84 (a ProofWindowDay, kept as number so the store never
   *  hard-couples to the union and a future window records without a migration). */
  windowDays: number;
  /** The classifier/computation version whose read this row holds. Part of the
   *  PK so two versions of the same window are distinct rows, never a mutation. */
  computationVersion: string;
  /** ISO timestamp the read was recorded. */
  readAt: string;
  /** The read payload (the classifier's per-window output). Opaque here in P2;
   *  P3 owns its shape. jsonb column. */
  result: Record<string, unknown>;
};

export type ConfirmationReadInput = {
  tenantId: string;
  proofId: string;
  windowDays: number;
  computationVersion: string;
  result: Record<string, unknown>;
  /** Defaults to now(). */
  readAt?: string;
};

type FileRow = {
  tenant_id: string;
  proof_id: string;
  window_days: number;
  computation_version: string;
  read_at: string;
  result: Record<string, unknown>;
};

function isMissingTable(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (
    typeof e.code === "string" &&
    (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")
  ) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /schema cache|could not find the table/i.test(e.message)
  );
}

/** True when two rows share the append-only primary key. */
function samePk(a: FileRow, b: FileRow): boolean {
  return (
    a.tenant_id === b.tenant_id &&
    a.proof_id === b.proof_id &&
    a.window_days === b.window_days &&
    a.computation_version === b.computation_version
  );
}

/** PURE: fold an input into the persisted row shape (testable, no I/O). */
export function buildConfirmationReadRow(input: ConfirmationReadInput, now: Date = new Date()): FileRow {
  return {
    tenant_id: input.tenantId,
    proof_id: input.proofId,
    window_days: input.windowDays,
    computation_version: input.computationVersion,
    read_at: input.readAt ?? now.toISOString(),
    result: input.result,
  };
}

async function readFile(): Promise<FileRow[]> {
  try {
    return (await readStore<FileRow>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/**
 * IDEMPOTENT file write (first result wins). A row already present for this PK is
 * left EXACTLY as it is - never overwritten - mirroring the Supabase
 * ON CONFLICT DO NOTHING path, so both storage backends agree that the first
 * write of a (proof, window, version) is the durable one.
 */
async function writeFileRow(row: FileRow): Promise<void> {
  try {
    const rows = await readFile();
    if (rows.some((r) => samePk(r, row))) return; // first write already durable -> no-op
    await writeStore(STORE, [...rows, row]);
  } catch (e) {
    log.warn("[confirmation-reads-store] file mirror write failed", {
      tenantId: row.tenant_id,
      proofId: row.proof_id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Record ONE per-window proof read. FAIL-SOFT BY CONTRACT: never throws. The
 * write is IDEMPOTENT on (tenant_id, proof_id, window_days, computation_version):
 * the first write of a key is durable and a repeat is a no-op (first result
 * wins). On Supabase this is an ON CONFLICT DO NOTHING upsert (ignoreDuplicates);
 * on the file mirror it is the samePk no-op above. Never an UPDATE, so a written
 * read is immutable.
 */
export async function recordConfirmationRead(input: ConfirmationReadInput): Promise<void> {
  const row = buildConfirmationReadRow(input);

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await writeFileRow(row); // no Supabase env (local dev) -> file only
    return;
  }

  try {
    const { error } = await admin.from(TABLE).upsert(row, {
      onConflict: "tenant_id,proof_id,window_days,computation_version",
      // ON CONFLICT DO NOTHING: the first write of a key wins, a repeat is a
      // silent no-op, and a row is NEVER updated after write.
      ignoreDuplicates: true,
    });
    if (error != null) {
      if (isMissingTable(error)) {
        console.warn(
          `[confirmation-reads-store] table not migrated yet, falling back to file (apply migrations/2026-07-13_confirmation_reads.sql): ${
            (error as { code?: string }).code ?? "?"
          } ${(error as { message?: string }).message ?? String(error)}`,
        );
        await writeFileRow(row);
        return;
      }
      log.warn("[confirmation-reads-store] upsert failed", {
        tenantId: row.tenant_id,
        proofId: row.proof_id,
        error: error.message ?? String(error),
      });
      await writeFileRow(row);
      return;
    }
  } catch (e) {
    log.warn("[confirmation-reads-store] upsert threw", {
      tenantId: row.tenant_id,
      proofId: row.proof_id,
      error: e instanceof Error ? e.message : String(e),
    });
    await writeFileRow(row);
  }
}

function mapRow(r: Record<string, unknown>): ConfirmationRead {
  return {
    tenantId: String(r.tenant_id),
    proofId: String(r.proof_id),
    windowDays: Number(r.window_days ?? 0),
    computationVersion: String(r.computation_version),
    readAt: String(r.read_at ?? ""),
    result:
      r.result != null && typeof r.result === "object"
        ? (r.result as Record<string, unknown>)
        : {},
  };
}

function filterFileRows(
  rows: FileRow[],
  tenantId: string,
  proofId: string | undefined,
): ConfirmationRead[] {
  return rows
    .filter((r) => r.tenant_id === tenantId && (proofId == null || r.proof_id === proofId))
    .map((r) => mapRow(r as unknown as Record<string, unknown>));
}

/**
 * All confirmation reads for a tenant (optionally one proof). Fail-soft -> [].
 * Supabase first, file mirror fallback. Read order is not guaranteed; callers
 * that need the latest per (window, version) sort themselves.
 */
export async function loadConfirmationReads(
  tenantId: string,
  opts: { proofId?: string } = {},
): Promise<ConfirmationRead[]> {
  if (!tenantId) return [];
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return filterFileRows(await readFile(), tenantId, opts.proofId);
  }
  try {
    let q = admin.from(TABLE).select("*").eq("tenant_id", tenantId);
    if (opts.proofId != null) q = q.eq("proof_id", opts.proofId);
    const { data, error } = await q;
    if (error != null) {
      if (isMissingTable(error)) {
        return filterFileRows(await readFile(), tenantId, opts.proofId);
      }
      log.warn("[confirmation-reads-store] list failed", {
        tenantId,
        error: error.message ?? String(error),
      });
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapRow);
  } catch (e) {
    log.warn("[confirmation-reads-store] list threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return filterFileRows(await readFile(), tenantId, opts.proofId);
  }
}

export const __testing = { isMissingTable, samePk };
