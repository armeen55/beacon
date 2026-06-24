import "server-only";

/**
 * 2026-06-10 — Publish safety caps (§push layer, Invariant 3).
 *
 * Enforced IN THE PUSH PATH (push-service calls these before any
 * adapter fires), not just in UI. Clones the API-spend budget-cap
 * pattern: a tenant-scoped ledger counts pushes per UTC day.
 *
 *   • ≤ MAX_PUSHES_PER_DAY per property (default 10)
 *   • no URL changes        — structurally enforced (the Wix client
 *     strips slug-ish fields; the git adapter never renames paths)
 *   • no nav / sitewide     — structurally enforced (adapters touch
 *     CMS items + blog drafts only)
 *   • no deletions          — structurally enforced (no delete
 *     endpoints exist in any adapter) + `assertNonDestructivePatch`
 *     refuses pushes that would blank existing content
 *
 * DURABILITY (2026-06-21 ship-path audit): the ledger was file-only via
 * json-store, which on Vercel writes ONLY an in-process cache that is LOST on
 * lambda recycle. So every cold lambda saw 0 prior pushes and re-allowed the
 * full daily quota — the per-tenant cap was structurally fail-OPEN in prod.
 * The ledger is now durable in Supabase (tenant-scoped), mirroring
 * wix/mappings-store.ts, with a file fallback so no-env local dev and the
 * pre-migration deploy window behave exactly as before.
 */

import { randomUUID } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";

export const MAX_PUSHES_PER_DAY = 10;

/** A `reserved` ledger row older than this is treated as abandoned (a refusal
 *  that returned before the write, or a crash) and no longer counts against the
 *  cap — so a never-finalized reservation can never permanently eat a slot. */
const RESERVATION_FRESH_MINUTES = 10;

const LEDGER_STORE = "push-ledger"; // file fallback (pre-migration substrate)
const LEDGER_TABLE = "push_ledger"; // durable Supabase table

export type PushLedgerEntry = {
  id: string;
  tenant_id: string;
  edit_id: string;
  target_url: string;
  adapter: string;
  pushed_at: string; // ISO
  /** UTC day for the daily cap (YYYY-MM-DD). */
  day: string;
  /** `reserved` = an atomic slot claimed before the write; finalized to
   *  `pushed` / `push_failed` once the write resolves (see reservePushSlot). */
  result: "pushed" | "push_failed" | "reserved";
  detail: string | null;
};

/** Treat a PostgREST "table missing" (42P01) OR "schema cache" (PGRST205) error
 *  as table-not-provisioned → fall back to the file store. */
function isMissingTable(err: { code?: string } | null | undefined): boolean {
  const code = err?.code;
  return code === "42P01" || code === "PGRST205";
}

/** File-backed read of the whole ledger (best-effort). The cap's file fallback
 *  + the append helper's read-modify-write base. NOT for display callers on
 *  Vercel — the file store is an empty in-process cache on a cold lambda; use
 *  the durable readers below. */
export async function readPushLedger(): Promise<PushLedgerEntry[]> {
  try {
    return (await readStore<PushLedgerEntry>(LEDGER_STORE)) ?? [];
  } catch {
    return [];
  }
}

/** Durable, tenant-scoped ledger ROW read (audit-wave #2, 2026-06-23). The
 *  2026-06-21 durability work moved the WRITE + cap COUNT to Supabase but left
 *  the display callers on the file-only path — so on Vercel a real push showed
 *  as never-pushed (push receipt null, golden-path "nothing shipped"). Reads
 *  Supabase first (tenant-scoped), falling back to the file store
 *  (tenant-filtered) pre-migration / no-env. */
export async function readPushLedgerForTenant(tenantId: string): Promise<PushLedgerEntry[]> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(LEDGER_TABLE)
      .select("*")
      .eq("tenant_id", tenantId);
    if (!error) return (data ?? []) as PushLedgerEntry[];
    // Missing table (pre-migration) or any read error → file fallback.
  } catch {
    // No Supabase env (local dev) → file fallback.
  }
  return (await readPushLedger()).filter((e) => e.tenant_id === tenantId);
}

/** Durable read of the whole ledger (all tenants) for the operator diagnostics
 *  view. Supabase first, file fallback. */
export async function readPushLedgerDurable(): Promise<PushLedgerEntry[]> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from(LEDGER_TABLE).select("*");
    if (!error) return (data ?? []) as PushLedgerEntry[];
  } catch {
    // No Supabase env → file fallback.
  }
  return readPushLedger();
}

/** Append to the file ledger (fallback path + local parity). */
async function appendPushLedgerFile(entry: PushLedgerEntry): Promise<void> {
  const all = await readPushLedger();
  all.push(entry);
  // Retention: newest 1000 (cap math only needs today).
  await writeStore(LEDGER_STORE, all.slice(-1000));
}

export async function appendPushLedger(entry: PushLedgerEntry): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // No Supabase env (local dev) → file store, today's behavior.
    await appendPushLedgerFile(entry);
    return;
  }
  try {
    const { error } = await admin.from(LEDGER_TABLE).insert({
      tenant_id: entry.tenant_id,
      id: entry.id,
      edit_id: entry.edit_id,
      target_url: entry.target_url,
      adapter: entry.adapter,
      pushed_at: entry.pushed_at,
      day: entry.day,
      result: entry.result,
      detail: entry.detail,
    });
    if (error) {
      if (isMissingTable(error)) {
        // Pre-migration deploy window → file store keeps working.
        await appendPushLedgerFile(entry);
        return;
      }
      // Other write error: still record to file so local parity + the fallback
      // count have it; the cap then degrades to file (never silently uncapped).
      await appendPushLedgerFile(entry);
      return;
    }
    // Healthy durable write — mirror to file best-effort (no-op on Vercel FS).
    try {
      await appendPushLedgerFile(entry);
    } catch {
      /* file mirror is best-effort */
    }
  } catch {
    await appendPushLedgerFile(entry);
  }
}

export type CapVerdict = { allowed: true } | { allowed: false; reason: string };

/** Count today's SUCCESSFUL pushes for a tenant from the file ledger. */
async function countTodaysPushesFile(tenantId: string, day: string): Promise<number> {
  const ledger = await readPushLedger();
  return ledger.filter(
    (e) => e.tenant_id === tenantId && e.day === day && e.result === "pushed",
  ).length;
}

/** Daily-cap check. Counts SUCCESSFUL pushes today for this tenant. Durable
 *  (Supabase) with a file fallback so the cap holds across lambda recycles. */
export async function checkDailyPushCap(args: {
  tenantId: string;
  now?: Date;
  max?: number;
}): Promise<CapVerdict> {
  const day = (args.now ?? new Date()).toISOString().slice(0, 10);
  const max = args.max ?? MAX_PUSHES_PER_DAY;

  let todays: number | null = null;
  try {
    const admin = getSupabaseAdmin();
    const { count, error } = await admin
      .from(LEDGER_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", args.tenantId)
      .eq("day", day)
      .eq("result", "pushed");
    if (error) {
      // Missing table (pre-migration) OR any read error → fall back to file.
      todays = await countTodaysPushesFile(args.tenantId, day);
    } else {
      todays = count ?? 0;
    }
  } catch {
    // No Supabase env → file fallback (today's behavior).
    todays = await countTodaysPushesFile(args.tenantId, day);
  }

  if (todays >= max) {
    return {
      allowed: false,
      reason: `daily push cap reached (${todays}/${max} for ${day}) — resumes tomorrow or raise the cap deliberately`,
    };
  }
  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────
// Reserve-before-write (2026-06-22, #5) — atomic cap claim for one-click.
// ─────────────────────────────────────────────────────────────────────

export type ReserveResult =
  | { allowed: true; reservationId: string }
  | { allowed: false; reason: string };

function capReachedReason(used: number, max: number, day: string): string {
  return `daily push cap reached (${used}/${max} for ${day}) — resumes tomorrow or raise the cap deliberately`;
}

/** Treat a PostgREST "function missing" (PGRST202 / 42883) OR a missing table
 *  as not-provisioned → file fallback. */
function isMissingFunction(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  const code = err?.code;
  return code === "PGRST202" || code === "42883" || isMissingTable(err);
}

/** File-store reserve: count today's pushed + still-fresh reserved rows, then
 *  append a `reserved` row if under cap. Non-atomic (today's substrate) but it
 *  still enforces the cap across reads. */
async function reservePushSlotFile(args: {
  tenantId: string;
  editId: string;
  targetUrl: string;
  adapter: string;
  day: string;
  max: number;
  now: Date;
  id: string;
}): Promise<ReserveResult> {
  const all = await readPushLedger();
  const freshCutoffMs = args.now.getTime() - RESERVATION_FRESH_MINUTES * 60_000;
  const used = all.filter(
    (e) =>
      e.tenant_id === args.tenantId &&
      e.day === args.day &&
      (e.result === "pushed" ||
        (e.result === "reserved" && Date.parse(e.pushed_at) > freshCutoffMs)),
  ).length;
  if (used >= args.max) {
    return { allowed: false, reason: capReachedReason(used, args.max, args.day) };
  }
  all.push({
    id: args.id,
    tenant_id: args.tenantId,
    edit_id: args.editId,
    target_url: args.targetUrl,
    adapter: args.adapter,
    pushed_at: args.now.toISOString(),
    day: args.day,
    result: "reserved",
    detail: null,
  });
  await writeStore(LEDGER_STORE, all.slice(-1000));
  return { allowed: true, reservationId: args.id };
}

/**
 * Atomically claim a daily-cap slot BEFORE a live write. Inserts a `reserved`
 * ledger row iff the tenant is still under the cap, under a per-(tenant,day)
 * advisory lock (push_cap_reserve RPC) so two concurrent one-click pushes can
 * never both pass. Finalize the returned reservationId once the write resolves.
 * Falls back to the file store (non-atomic, today's behavior) with no Supabase
 * env or before the 2026-06-22_push_cap_reserve migration is applied.
 */
export async function reservePushSlot(args: {
  tenantId: string;
  editId: string;
  targetUrl: string;
  adapter?: string;
  now?: Date;
  max?: number;
}): Promise<ReserveResult> {
  const now = args.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const max = args.max ?? MAX_PUSHES_PER_DAY;
  const adapter = args.adapter ?? "wix_cms";
  const id = `rsv-${randomUUID()}`;
  const fileArgs = {
    tenantId: args.tenantId,
    editId: args.editId,
    targetUrl: args.targetUrl,
    adapter,
    day,
    max,
    now,
    id,
  };

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return reservePushSlotFile(fileArgs); // no Supabase env (local dev)
  }
  try {
    const { data, error } = await admin.rpc("push_cap_reserve", {
      p_tenant: args.tenantId,
      p_day: day,
      p_max: max,
      p_id: id,
      p_edit_id: args.editId,
      p_target_url: args.targetUrl,
      p_adapter: adapter,
    });
    if (error) {
      // Function/table not provisioned (pre-migration) OR any RPC error →
      // file fallback. Never silently uncapped: the file path still enforces.
      return reservePushSlotFile(fileArgs);
    }
    if (data === true) return { allowed: true, reservationId: id };
    return { allowed: false, reason: capReachedReason(max, max, day) };
  } catch {
    return reservePushSlotFile(fileArgs);
  }
}

/**
 * Finalize a reservation to its terminal result once the write resolves.
 * Best-effort on BOTH backends (the reservation lives in exactly one; updating
 * the other matches no row and is a harmless no-op), so a Supabase or a file
 * reservation both finalize. Never throws — the ledger is observability and the
 * slot was already counted at reserve time.
 */
export async function finalizePushReservation(args: {
  tenantId: string;
  reservationId: string;
  result: "pushed" | "push_failed";
  detail: string | null;
}): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    await admin
      .from(LEDGER_TABLE)
      .update({ result: args.result, detail: args.detail })
      .eq("tenant_id", args.tenantId)
      .eq("id", args.reservationId);
  } catch {
    /* no env / write error — fall through to the file mirror */
  }
  try {
    const all = await readPushLedger();
    const idx = all.findIndex(
      (e) => e.tenant_id === args.tenantId && e.id === args.reservationId,
    );
    if (idx >= 0) {
      all[idx] = { ...all[idx]!, result: args.result, detail: args.detail };
      await writeStore(LEDGER_STORE, all.slice(-1000));
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Non-destructive guard: a push may ADD or REWRITE content; it may not
 * BLANK it. Refuses when the proposed value is empty/near-empty while
 * the current value had real content (deletion requires its own,
 * separate, explicit approval flow — which does not exist yet, by design).
 */
export function assertNonDestructivePatch(args: {
  currentText: string | null;
  proposedText: string | null;
}): CapVerdict {
  const current = (args.currentText ?? "").trim();
  const proposed = (args.proposedText ?? "").trim();
  if (proposed.length === 0) {
    return {
      allowed: false,
      reason: "proposed text is empty — deletions are not pushable (Invariant 3)",
    };
  }
  if (current.length > 80 && proposed.length < current.length * 0.2) {
    return {
      allowed: false,
      reason:
        "proposed text would shrink existing content by >80% — treat as deletion; needs a separate explicit approval",
    };
  }
  return { allowed: true };
}
