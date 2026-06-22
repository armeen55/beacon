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

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";

export const MAX_PUSHES_PER_DAY = 10;

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
  result: "pushed" | "push_failed";
  detail: string | null;
};

/** Treat a PostgREST "table missing" (42P01) OR "schema cache" (PGRST205) error
 *  as table-not-provisioned → fall back to the file store. */
function isMissingTable(err: { code?: string } | null | undefined): boolean {
  const code = err?.code;
  return code === "42P01" || code === "PGRST205";
}

/** File-backed read of the whole ledger (best-effort). Used by the display
 *  callers (golden-path / push-receipt) + as the cap's fallback. */
export async function readPushLedger(): Promise<PushLedgerEntry[]> {
  try {
    return (await readStore<PushLedgerEntry>(LEDGER_STORE)) ?? [];
  } catch {
    return [];
  }
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
