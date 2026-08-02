import "server-only";

/**
 * error-ledger (BEACON_500 R7 / N39, 2026-07-03) - THE production error spine.
 *
 * Beacon's failure posture is fail-soft everywhere: cron phases, SWR background
 * refreshes, push actions, and the LLM gateway all catch, log a line that
 * vanishes when Vercel rotates the function logs, and move on. That is correct
 * for the operator experience (nothing crashes) but it means "how often is
 * something failing, and where" had NO durable answer. This module gives every
 * one of those catch points one cheap, never-throwing call:
 *
 *   recordAppError({ route, tenantId, action, message, stack?, context? })
 *
 * writing to the "app-errors" json-store:
 *   - Registered in GLOBAL_STORES (store-classification.ts): rows carry
 *     tenantId because the highest-value writers are cron fan-outs and
 *     next/after background tasks with NO ambient request context - per-tenant
 *     path routing would throw there (currentTenantSlug needs a request).
 *     Same rationale as cron-runs / pipeline-violations / site-uptime-probes.
 *   - Mirrored to Supabase (json-store.ts SUPABASE_MIRRORED_STORES) so errors
 *     recorded on Vercel lambdas survive recycling and /diagnostics/errors is
 *     real on hosted prod. The blob helpers already treat PGRST205/42P01 as
 *     not-migrated and fall through to file - the required file-fallback.
 *   - CAPPED at MAX_ERRORS_PER_TENANT (200) rows per tenant bucket, pruned on
 *     every write (newest kept), so the store can never grow unbounded.
 *
 * CONTRACT: recordAppError NEVER throws and never rejects. A failing error
 * write must never break the caller it is trying to observe.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "app-errors";

/** Keep at most this many rows per tenant bucket (null tenant = its own bucket). */
const MAX_ERRORS_PER_TENANT = 200;

/** Bounded field sizes so one pathological error can never bloat the store. */
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 2000;
const MAX_KEY_CHARS = 120;

export type AppErrorRow = {
  id: string;
  /** ISO timestamp the error was recorded. */
  at: string;
  /** Null for fleet-level errors (a cron failing before any tenant context). */
  tenantId: string | null;
  /** Where it happened: a page route ("/changes"), a cron ("cron/sync-connectors"),
   *  an action namespace ("action/record-shipped"), or a gateway ("llm/draft-gateway"). */
  route: string;
  /** What was being attempted inside that route (phase or action name). */
  action: string;
  message: string;
  stack: string | null;
  context: Record<string, unknown>;
};

export type AppErrorInput = {
  route: string;
  tenantId?: string | null;
  action: string;
  message: string;
  stack?: string | null;
  context?: Record<string, unknown>;
};

/** PURE convenience: pull bounded { message, stack } out of an unknown thrown value. */
export function errorFieldsFrom(e: unknown): { message: string; stack: string | null } {
  if (e instanceof Error) {
    return {
      message: e.message.slice(0, MAX_MESSAGE_CHARS),
      stack: typeof e.stack === "string" ? e.stack.slice(0, MAX_STACK_CHARS) : null,
    };
  }
  return { message: String(e).slice(0, MAX_MESSAGE_CHARS), stack: null };
}

/** PURE: fold the input into a bounded persisted row (testable without I/O). */
function buildAppErrorRow(input: AppErrorInput, id: string, now: Date = new Date()): AppErrorRow {
  return {
    id,
    at: now.toISOString(),
    tenantId: input.tenantId ?? null,
    route: String(input.route ?? "").slice(0, MAX_KEY_CHARS),
    action: String(input.action ?? "").slice(0, MAX_KEY_CHARS),
    message: String(input.message ?? "").slice(0, MAX_MESSAGE_CHARS),
    stack: input.stack == null ? null : String(input.stack).slice(0, MAX_STACK_CHARS),
    context: input.context ?? {},
  };
}

/** PURE: cap the store at the newest MAX_ERRORS_PER_TENANT rows per tenant
 *  bucket (null tenantId is its own bucket). Rows come back newest first. */
function pruneAppErrorRows(
  rows: ReadonlyArray<AppErrorRow>,
  maxPerTenant: number = MAX_ERRORS_PER_TENANT,
): AppErrorRow[] {
  const byTenant = new Map<string, AppErrorRow[]>();
  for (const row of rows) {
    const key = row.tenantId ?? "\u0000fleet";
    const bucket = byTenant.get(key);
    if (bucket) bucket.push(row);
    else byTenant.set(key, [row]);
  }
  const out: AppErrorRow[] = [];
  for (const bucket of byTenant.values()) {
    bucket.sort((a, b) => b.at.localeCompare(a.at));
    out.push(...bucket.slice(0, maxPerTenant));
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Record one application error. NEVER throws, never rejects - every failure
 * mode (unknown store, disk error, Supabase outage, a bug in this module) is
 * absorbed here so the caller's own fail-soft path is untouched.
 */
export async function recordAppError(input: AppErrorInput): Promise<void> {
  try {
    const row = buildAppErrorRow(input, newId());
    const rows = await readStore<AppErrorRow>(STORE, []).catch(() => [] as AppErrorRow[]);
    const next = pruneAppErrorRows([...rows, row]);
    await writeStore(STORE, next);
  } catch (e) {
    // Last resort: one console line. The ledger must never break its caller.
    try {
      console.warn(
        `[error-ledger] write failed (caller unaffected): ${e instanceof Error ? e.message : String(e)}`,
      );
    } catch {
      /* truly nothing left to do */
    }
  }
}

