import "server-only";

/**
 * backup-verify (BEACON_500 R22a / T0d, 2026-07-03) - the backup-verification
 * receipt: does the nightly json-store -> Supabase mirror actually persist?
 *
 * WHY. The research caches, autopilot state, nightly pass outputs, and the
 * publish outbox all rely on the Supabase mirror (json_store_blobs) to survive
 * Vercel's read-only filesystem. If that mirror silently stops persisting (a
 * schema drift, a bad env, an un-applied migration), every one of those stores
 * quietly reverts to file-only - which on Vercel means empty forever, the exact
 * silent-empty failure class Beacon has fought repeatedly. Nothing today CHECKS
 * that the mirror wrote. This pass does: it reads the mirror table, counts how
 * many of the expected mirrored stores actually have a durable blob, checks the
 * newest blob's freshness, and writes ONE honest receipt.
 *
 * READ-ONLY BY CONTRACT: this pass NEVER writes to json_store_blobs and never
 * mutates any mirrored store. It only READS the mirror to verify it, and writes
 * exactly one small receipt row of its own. A verification that could itself
 * corrupt the thing it verifies would be worse than none.
 *
 * Honest receipt (Beacon voice, first person, a concrete count, no lab words,
 * no dashes): "Backup check: 14 of 14 stores mirrored, newest 2h ago." A stale
 * or missing store is owned plainly: "Backup check: 12 of 14 stores mirrored;
 * 2 look stale (oldest 3 days)."
 *
 * PURE summary core (`summarizeBackupVerification`) so tests pin the counts +
 * the stale flag with no I/O; a thin wrapper reads the mirror and persists the
 * receipt. Wired as a final PHASE of the nightly cron-sync.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { SUPABASE_MIRRORED_STORES } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const RECEIPT_STORE = "backup-verify-receipts";
const MAX_RECEIPTS = 30;

/** A store whose newest mirror blob is older than this is flagged STALE. The
 *  nightly cadence is ~24h, so 30h gives comfortable slack: a store touched last
 *  night is fresh; one not written for well over a day is genuinely stale. Note
 *  that not every mirrored store is written EVERY night (some are on-demand), so
 *  a stale flag is a soft signal on the receipt, never an error. */
export const STALE_AFTER_MS = 30 * 60 * 60 * 1000;

/** One observed mirror blob group: a store name + its newest updated_at. */
export type MirrorObservation = { storeName: string; newestUpdatedAt: string | null };

export type BackupVerifyResult = {
  checkedAt: string;
  /** How many distinct stores the mirror table expects (SUPABASE_MIRRORED_STORES). */
  expected: number;
  /** How many of those expected stores have at least one durable blob. */
  mirrored: number;
  /** Names present in expected but with NO blob in the mirror table. */
  missing: string[];
  /** Names present in the mirror but whose newest blob is older than STALE_AFTER_MS. */
  stale: string[];
  /** Newest updated_at across ALL observed blobs, or null when none observed. */
  newestUpdatedAt: string | null;
  /** True when the mirror could not be read at all (no env / read error). The
   *  receipt reads honestly as "could not check" rather than a false 0-of-N. */
  unreadable: boolean;
  /** The one honest receipt line (Beacon voice). */
  receiptLine: string;
};

/** "just now / N minutes / N hours / N days ago" for the receipt. Pure. */
export function agoLabel(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const minutes = Math.floor(Math.max(0, nowMs - t) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * PURE: fold the expected mirrored-store set + the observed blob groups into the
 * verification result and its honest receipt line. `unreadable: true` means the
 * mirror table could not be read (env/error) - the receipt says so instead of a
 * misleading "0 of N".
 */
export function summarizeBackupVerification(args: {
  expected: readonly string[];
  observed: readonly MirrorObservation[];
  unreadable: boolean;
  now: Date;
}): BackupVerifyResult {
  const checkedAt = args.now.toISOString();
  const nowMs = args.now.getTime();
  const expectedSet = new Set(args.expected);
  const expected = expectedSet.size;

  if (args.unreadable) {
    return {
      checkedAt,
      expected,
      mirrored: 0,
      missing: [],
      stale: [],
      newestUpdatedAt: null,
      unreadable: true,
      receiptLine: "Backup check: I could not read the backup mirror this time, so I will check again next run.",
    };
  }

  // Newest updated_at per expected store from the observations.
  const newestByStore = new Map<string, string | null>();
  for (const o of args.observed) {
    if (!expectedSet.has(o.storeName)) continue; // only grade expected stores
    const prev = newestByStore.get(o.storeName) ?? null;
    if (o.newestUpdatedAt == null) {
      if (!newestByStore.has(o.storeName)) newestByStore.set(o.storeName, null);
      continue;
    }
    if (prev == null || o.newestUpdatedAt.localeCompare(prev) > 0) {
      newestByStore.set(o.storeName, o.newestUpdatedAt);
    }
  }

  const missing: string[] = [];
  const stale: string[] = [];
  let newestUpdatedAt: string | null = null;
  for (const name of expectedSet) {
    if (!newestByStore.has(name)) {
      missing.push(name);
      continue;
    }
    const newest = newestByStore.get(name) ?? null;
    if (newest == null) {
      // A blob exists but has no timestamp - treat as present-but-unknown, not stale.
      continue;
    }
    if (newestUpdatedAt == null || newest.localeCompare(newestUpdatedAt) > 0) {
      newestUpdatedAt = newest;
    }
    const age = nowMs - Date.parse(newest);
    if (Number.isFinite(age) && age > STALE_AFTER_MS) stale.push(name);
  }

  const mirrored = expected - missing.length;
  return {
    checkedAt,
    expected,
    mirrored,
    missing: missing.sort(),
    stale: stale.sort(),
    newestUpdatedAt,
    unreadable: false,
    receiptLine: buildBackupReceiptLine({ expected, mirrored, missing, stale, newestUpdatedAt, nowMs }),
  };
}

/** PURE: the one honest receipt line. Beacon voice: first person context, a
 *  concrete count, owns a miss plainly, no lab words, no dashes. */
export function buildBackupReceiptLine(args: {
  expected: number;
  mirrored: number;
  missing: string[];
  stale: string[];
  newestUpdatedAt: string | null;
  nowMs: number;
}): string {
  const newest = agoLabel(args.newestUpdatedAt, args.nowMs);
  const base = `Backup check: ${args.mirrored} of ${args.expected} stores mirrored, newest ${newest}.`;
  const problems: string[] = [];
  if (args.missing.length > 0) {
    problems.push(
      `${args.missing.length} ${args.missing.length === 1 ? "store is not" : "stores are not"} backed up yet`,
    );
  }
  if (args.stale.length > 0) {
    problems.push(`${args.stale.length} look stale`);
  }
  if (problems.length === 0) return base;
  return `Backup check: ${args.mirrored} of ${args.expected} stores mirrored; ${problems.join(" and ")}. Newest backup ${newest}.`;
}

/**
 * Read the mirror table's per-store newest updated_at. READ-ONLY. Returns
 * unreadable:true (never a false empty) when there is no Supabase env or the
 * read fails, so the receipt reads honestly. Never throws.
 */
async function readMirrorObservations(): Promise<{ observed: MirrorObservation[]; unreadable: boolean }> {
  if (!isSupabaseConfigured()) return { observed: [], unreadable: true };
  try {
    const supabase = getSupabaseAdmin();
    // tenant-isolation-exempt: T0d verifies the WHOLE mirror (every store, every
    // tenant scope key) is persisting - a per-tenant filter would defeat the
    // point. It reads only store_name + updated_at (no tenant content), and
    // aggregates to a per-store newest timestamp; no per-tenant data crosses a
    // boundary.
    // Bounded read: store_name + updated_at only, aggregated in JS. Row count is
    // one per resolved scope key (single-operator scale -> small), and we only
    // need the newest per store_name.
    const { data, error } = await supabase
      .from("json_store_blobs")
      .select("store_name, updated_at")
      .limit(5000);
    if (error || !Array.isArray(data)) return { observed: [], unreadable: true };
    const newest = new Map<string, string | null>();
    for (const r of data as Array<{ store_name?: unknown; updated_at?: unknown }>) {
      const name = typeof r.store_name === "string" ? r.store_name : "";
      if (!name) continue;
      const ts = typeof r.updated_at === "string" ? r.updated_at : null;
      const prev = newest.get(name) ?? null;
      if (ts == null) {
        if (!newest.has(name)) newest.set(name, null);
      } else if (prev == null || ts.localeCompare(prev) > 0) {
        newest.set(name, ts);
      }
    }
    return {
      observed: [...newest.entries()].map(([storeName, newestUpdatedAt]) => ({ storeName, newestUpdatedAt })),
      unreadable: false,
    };
  } catch {
    return { observed: [], unreadable: true };
  }
}

export type BackupVerifyDeps = {
  expected: () => readonly string[];
  readObservations: () => Promise<{ observed: MirrorObservation[]; unreadable: boolean }>;
  now: () => Date;
  persistReceipt: (result: BackupVerifyResult) => Promise<void>;
};

const defaultDeps: BackupVerifyDeps = {
  expected: () => [...SUPABASE_MIRRORED_STORES],
  readObservations: readMirrorObservations,
  now: () => new Date(),
  persistReceipt: appendBackupReceipt,
};

/**
 * Run the backup verification: read the mirror, summarize, persist ONE receipt.
 * Read-only against the mirror (its only write is its own receipt row).
 * FAIL-SOFT: never throws - a verification failure must never break the nightly
 * sync it is a final phase of.
 */
export async function runBackupVerification(
  depsOverride: Partial<BackupVerifyDeps> = {},
): Promise<BackupVerifyResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const now = deps.now();
  const { observed, unreadable } = await deps.readObservations().catch(() => ({ observed: [], unreadable: true }));
  const result = summarizeBackupVerification({
    expected: deps.expected(),
    observed,
    unreadable,
    now,
  });
  await deps.persistReceipt(result).catch((e) =>
    log.warn("[backup-verify] receipt persist failed (fail-soft)", {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  if (result.missing.length > 0 || result.stale.length > 0) {
    log.warn("[backup-verify] mirror gaps detected", {
      mirrored: result.mirrored,
      expected: result.expected,
      missing: result.missing,
      stale: result.stale,
    });
  }
  return result;
}

/** Persist ONE bounded receipt row (newest kept). Fail-soft. This is the ONLY
 *  write this module makes - it never touches json_store_blobs. */
async function appendBackupReceipt(result: BackupVerifyResult): Promise<void> {
  const rows = (await readStore<BackupVerifyResult>(RECEIPT_STORE, []).catch(() => [])) ?? [];
  const next = [result, ...rows]
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))
    .slice(0, MAX_RECEIPTS);
  await writeStore(RECEIPT_STORE, next);
}

/** Newest-first backup-verify receipts. Fail-soft to []. Diagnostics. */
export async function listBackupReceipts(limit = 10): Promise<BackupVerifyResult[]> {
  try {
    const rows = (await readStore<BackupVerifyResult>(RECEIPT_STORE, [])) ?? [];
    return rows.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, limit);
  } catch {
    return [];
  }
}
