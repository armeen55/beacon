import "server-only";

/**
 * north-star/ga4-sitewide-rollup (2026-07-10, Wave 2A) - the read side of the TRUE
 * sitewide GA4 series.
 *
 * Rolls `ga4_daily_totals` (one GA4-aggregated row per property per day) up into
 * calendar months, and reads/writes the `ga4_monthly_reconciliation` marker that
 * gates whether the north-star card is allowed to show a visits number.
 *
 * WHY THIS LIVES IN ITS OWN MODULE: `load-monthly-pulse.ts` carries an architecture
 * pin that its OWN source never touches a Supabase admin client, the per-(url,date)
 * GA4 table, or an RPC (so the withdrawn inflated sum can never be quietly re-wired
 * in). All the Supabase I/O for the new correct-grain tables lives here instead;
 * load-monthly-pulse imports only `loadReconciledVisitsForTenant`.
 *
 * ADDITIVE-SAFE BY CONSTRUCTION: this loader reads `ga4_daily_totals` (one row per
 * property per day, summed across DISTINCT days) and NEVER the per-page traffic table
 * and NEVER sums across page paths, so one visit touching several pages is counted once.
 *
 * Fail-soft: a missing table (PGRST205/42P01 before the architect applies the
 * migration), an admin-client failure, or any query error returns null/empty so
 * the card holds back - never a bare zero, never a throw.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

const DAILY_TABLE = "ga4_daily_totals";
const RECON_TABLE = "ga4_monthly_reconciliation";

/** PostgREST "table missing" (42P01) or "schema cache" (PGRST205) - treat as
 *  not-migrated-yet (the architect applies the migration at integration). */
function isTableMissing(error: { code?: unknown } | null | undefined): boolean {
  const code = error?.code;
  return code === "42P01" || code === "PGRST205";
}

// ─────────────────────────────────────────────────────────────────────
// Monthly rollup of ga4_daily_totals
// ─────────────────────────────────────────────────────────────────────

export type Ga4RollupMonth = {
  /** First day of the month, "YYYY-MM-01". */
  month: string;
  /** Summed GA4 sitewide sessions ( == visits) across the days present in the month. */
  sessions: number;
  engagedSessions: number;
  /** true for the CURRENT calendar month (still accumulating - "so far"). */
  partial: boolean;
};

export type Ga4MonthlyRollup = {
  /** Calendar months ascending; the last is the current (partial) month when present. */
  months: Ga4RollupMonth[];
  /** Max synced_at across the rows this rollup summed; null when unknown. */
  latestSyncAt: string | null;
  /** The property's reporting timezone GA4 bucketed these dates in; null if absent. */
  propertyTimezone: string | null;
  /** The property_id these rows belong to; null when unknown. */
  propertyId: string | null;
};

type DailyRow = {
  date: string;
  sessions: number | string | null;
  engaged_sessions: number | string | null;
  property_id: string | null;
  property_timezone: string | null;
  synced_at: string | null;
};

function monthKeyOf(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

function currentMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Roll the tenant's `ga4_daily_totals` into calendar months. Optionally scoped to
 * one property_id (two-property isolation). The current calendar month is flagged
 * `partial`. Returns null when there is no data or the table is not migrated yet.
 */
export async function loadGa4MonthlyRollupForTenant(
  tenantId: string,
  opts: { propertyId?: string; now?: Date } = {},
): Promise<Ga4MonthlyRollup | null> {
  if (!tenantId) return null;
  const now = opts.now ?? new Date();
  let sb;
  try {
    sb = getSupabaseAdmin();
  } catch {
    return null;
  }
  try {
    let q = sb
      .from(DAILY_TABLE)
      .select("date, sessions, engaged_sessions, property_id, property_timezone, synced_at")
      .eq("tenant_id", tenantId);
    if (opts.propertyId != null && opts.propertyId !== "") {
      q = q.eq("property_id", opts.propertyId);
    }
    const { data, error } = await q.order("date", { ascending: true });
    if (error != null) {
      if (!isTableMissing(error)) {
        log.warn("[ga4-sitewide-rollup] daily totals read failed", {
          tenantId,
          error: typeof error.message === "string" ? error.message : "read failed",
        });
      }
      return null;
    }
    const rows = (data ?? []) as DailyRow[];
    if (rows.length === 0) return null;

    const currentKey = currentMonthKey(now);
    const byMonth = new Map<string, { sessions: number; engagedSessions: number }>();
    let latestSyncAt: string | null = null;
    let propertyTimezone: string | null = null;
    let propertyId: string | null = null;
    for (const r of rows) {
      if (!r.date) continue;
      const key = monthKeyOf(r.date);
      const agg = byMonth.get(key) ?? { sessions: 0, engagedSessions: 0 };
      agg.sessions += Number(r.sessions) || 0;
      agg.engagedSessions += Number(r.engaged_sessions) || 0;
      byMonth.set(key, agg);
      if (r.synced_at && (latestSyncAt == null || r.synced_at > latestSyncAt)) latestSyncAt = r.synced_at;
      if (r.property_timezone) propertyTimezone = r.property_timezone;
      if (r.property_id) propertyId = r.property_id;
    }

    const months: Ga4RollupMonth[] = [...byMonth.entries()]
      .map(([month, agg]) => ({
        month,
        sessions: agg.sessions,
        engagedSessions: agg.engagedSessions,
        partial: month === currentKey,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return { months, latestSyncAt, propertyTimezone, propertyId };
  } catch (e) {
    log.warn("[ga4-sitewide-rollup] daily totals read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Reconciliation marker (ga4_monthly_reconciliation)
// ─────────────────────────────────────────────────────────────────────

export type Ga4ReconciliationStatus = "pass" | "mismatch" | "not_connected" | "error";

export type Ga4ReconciliationMonth = {
  month: string;
  storedSessions: number;
  directSessions: number;
  deltaPct: number;
  withinTolerance: boolean;
};

export type Ga4ReconciliationRecord = {
  tenantId: string;
  propertyId: string;
  checkedAt: string;
  status: Ga4ReconciliationStatus;
  tolerancePct: number;
  latestSyncAt: string | null;
  reconciledThrough: string | null;
  perMonth: Ga4ReconciliationMonth[];
};

/** Read the latest reconciliation marker for a tenant (optionally a specific
 *  property). Null when absent or the table is not migrated yet. Fail-soft. */
export async function readGa4Reconciliation(
  tenantId: string,
  propertyId?: string,
): Promise<Ga4ReconciliationRecord | null> {
  if (!tenantId) return null;
  let sb;
  try {
    sb = getSupabaseAdmin();
  } catch {
    return null;
  }
  try {
    let q = sb
      .from(RECON_TABLE)
      .select("tenant_id, property_id, checked_at, status, tolerance_pct, latest_sync_at, reconciled_through, per_month")
      .eq("tenant_id", tenantId);
    if (propertyId != null && propertyId !== "") q = q.eq("property_id", propertyId);
    const { data, error } = await q.order("checked_at", { ascending: false }).limit(1);
    if (error != null) {
      if (!isTableMissing(error)) {
        log.warn("[ga4-sitewide-rollup] reconciliation read failed", {
          tenantId,
          error: typeof error.message === "string" ? error.message : "read failed",
        });
      }
      return null;
    }
    const row = (data ?? [])[0] as
      | {
          tenant_id: string;
          property_id: string;
          checked_at: string;
          status: string;
          tolerance_pct: number | string | null;
          latest_sync_at: string | null;
          reconciled_through: string | null;
          per_month: unknown;
        }
      | undefined;
    if (row == null) return null;
    return {
      tenantId: row.tenant_id,
      propertyId: row.property_id,
      checkedAt: row.checked_at,
      status: (["pass", "mismatch", "not_connected", "error"].includes(row.status)
        ? row.status
        : "error") as Ga4ReconciliationStatus,
      tolerancePct: Number(row.tolerance_pct) || 0,
      latestSyncAt: row.latest_sync_at,
      reconciledThrough: row.reconciled_through,
      perMonth: Array.isArray(row.per_month) ? (row.per_month as Ga4ReconciliationMonth[]) : [],
    };
  } catch (e) {
    log.warn("[ga4-sitewide-rollup] reconciliation read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Upsert the reconciliation marker (latest-wins per tenant+property). Fail-soft:
 *  returns false on any failure, never throws, never alters the caller's verdict. */
export async function writeGa4Reconciliation(record: Ga4ReconciliationRecord): Promise<boolean> {
  if (!record.tenantId || !record.propertyId) return false;
  let sb;
  try {
    sb = getSupabaseAdmin();
  } catch {
    return false;
  }
  try {
    const { error } = await sb.from(RECON_TABLE).upsert(
      {
        tenant_id: record.tenantId,
        property_id: record.propertyId,
        checked_at: record.checkedAt,
        status: record.status,
        tolerance_pct: record.tolerancePct,
        latest_sync_at: record.latestSyncAt,
        reconciled_through: record.reconciledThrough,
        per_month: record.perMonth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,property_id" },
    );
    if (error != null) {
      if (!isTableMissing(error)) {
        log.warn("[ga4-sitewide-rollup] reconciliation write failed", {
          tenantId: record.tenantId,
          error: typeof error.message === "string" ? error.message : "write failed",
        });
      }
      return false;
    }
    return true;
  } catch (e) {
    log.warn("[ga4-sitewide-rollup] reconciliation write threw", {
      tenantId: record.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// The card gate: reconciled visits, or nothing
// ─────────────────────────────────────────────────────────────────────

export type ReconciledVisitsGate =
  | {
      status: "pass";
      /** Ascending months with reconciled visits; the last may be the partial current month. */
      months: { month: string; visits: number; partial: boolean }[];
      reconciledThrough: string | null;
    }
  | { status: "mismatch" }
  | { status: "none" };

/**
 * The ONE gate the north-star card reads. Returns reconciled visits ONLY when a
 * PASSING reconciliation exists AND it is at least as fresh as the rollup's latest
 * sync (a newer sync since the last check invalidates the pass). A 'mismatch'
 * verdict returns the mismatch state (drives the honest alert). Everything else -
 * no marker, not_connected, error, or a stale pass - returns 'none', so the shipped
 * hold-back line stays EXACTLY as it is.
 */
export async function loadReconciledVisitsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<ReconciledVisitsGate> {
  if (!tenantId) return { status: "none" };
  const recon = await readGa4Reconciliation(tenantId);
  if (recon == null) return { status: "none" };
  if (recon.status === "mismatch") return { status: "mismatch" };
  if (recon.status !== "pass") return { status: "none" };

  const rollup = await loadGa4MonthlyRollupForTenant(tenantId, {
    propertyId: recon.propertyId,
    now,
  });
  if (rollup == null || rollup.months.length === 0) return { status: "none" };

  // Freshness gate: a sync NEWER than the reconciliation invalidates the pass -
  // we must not show visits the reconciliation never actually checked.
  if (
    rollup.latestSyncAt != null &&
    Date.parse(rollup.latestSyncAt) > Date.parse(recon.checkedAt)
  ) {
    return { status: "none" };
  }

  return {
    status: "pass",
    months: rollup.months.map((m) => ({ month: m.month, visits: m.sessions, partial: m.partial })),
    reconciledThrough: recon.reconciledThrough,
  };
}

/** Test-only export of internals. */
export const __testing = { DAILY_TABLE, RECON_TABLE };
