import "server-only";

/**
 * north-star/reconcile-ga4-monthly-series (2026-07-10, Wave 2A) - the reconciliation
 * GATE that decides whether the north-star card may show a visits number.
 *
 * The daily rollup (ga4_daily_totals) is only trustworthy if summing its days back
 * into a month reproduces the number GA4 reports for that month directly. This
 * function fetches a DIRECT month-grain GA4 report (yearMonth dimension) and compares
 * it, month by FULL month, against the daily rollup:
 *
 *   - PASS      every full month present matches the direct total within tolerance
 *               (exact, or <= RECONCILE_TOLERANCE_PCT). The card may show visits.
 *   - MISMATCH  at least one full month is off by more than tolerance. The card shows
 *               an honest alert ("the visits number does not add up yet"), never a claim.
 *   - NOT_CONNECTED  GA4 is not connected right now (dead/absent grant). We reuse the
 *               connector-health reason - never a fake pass or fake fail.
 *   - ERROR     a transient GA4 error, or no stored rollup yet to reconcile.
 *
 * The verdict is persisted (ga4_monthly_reconciliation) with checked-at + per-month
 * values, so the card gate can require a PASS that is fresher than the latest sync.
 *
 * Property-calendar rule: GA4's date dimensions use the property's reporting
 * timezone. A missing, invalid, or inconsistent timezone is therefore a non-pass,
 * never permission to compare UTC months against property-local months.
 */

import { getGoogleConnectorToken, getConnectorHealth } from "@/lib/connector-store";
import { log } from "@/lib/logger";

import { runGa4SitewideMonthlyReport } from "@/lib/connectors/ga4/data-api";
import {
  loadGa4MonthlyRollupForTenant,
  writeGa4Reconciliation,
  type Ga4ReconciliationMonth,
} from "@/domains/north-star/ga4-sitewide-rollup";
import { dateKeyDaysBefore, propertyDateKey, propertyMonthKey } from "./property-calendar";

/** Per-month tolerance for the daily-rollup-vs-direct comparison, in percent.
 *  A stored month within this band of GA4's direct monthly total (or exactly equal)
 *  passes; GA4's own late-arriving data can wobble a completed month slightly. */
export const RECONCILE_TOLERANCE_PCT = 1;

/** Honest not-connected copy (Beacon voice, no dashes, concrete next step). Used when
 *  GA4 cannot deliver a live report to reconcile against - reused, never faked. */
export const GA4_NOT_CONNECTED_LINE =
  "GA4 is not connected right now, so I cannot reconcile your visits yet. Reconnect Google Analytics and I will check the moment it is back.";

export type ReconcileResult =
  | {
      status: "pass";
      propertyId: string;
      perMonth: Ga4ReconciliationMonth[];
      reconciledThrough: string | null;
      checkedAt: string;
    }
  | {
      status: "mismatch";
      propertyId: string;
      perMonth: Ga4ReconciliationMonth[];
      checkedAt: string;
    }
  | { status: "not_connected"; reason: string; healthReason: string | null; message: string }
  | { status: "error"; reason: string; message: string };

/** GA4 fail reasons that mean "not connected right now" (dead/absent grant). */
const NOT_CONNECTED_REASONS = new Set(["no_token", "token_expired", "disconnected"]);

export async function reconcileGa4MonthlySeries(
  tenantId: string,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  if (!tenantId) return { status: "error", reason: "invalid_args", message: "missing tenantId" };

  const token = await getGoogleConnectorToken("ga4", tenantId);
  const propertyId = token?.ga4_property_id ?? "";
  if (token == null || propertyId === "") {
    const healthReason = await safeHealthReason(tenantId);
    return { status: "not_connected", reason: "no_token", healthReason, message: GA4_NOT_CONNECTED_LINE };
  }

  // Read the stored property calendar BEFORE choosing the direct-report window.
  // The daily rows already carry GA4 response metadata.timeZone; without exactly
  // one valid timezone, month reconciliation would be calendar-ambiguous.
  const rollup = await loadGa4MonthlyRollupForTenant(tenantId, { propertyId, now });
  const fullMonths = (rollup?.months ?? []).filter((m) => !m.partial);
  const propertyTimezone = rollup?.propertyTimezone ?? null;
  // Preserve honest dead-token classification even before the first daily row
  // exists by probing in UTC when no stored timezone exists. A successful probe
  // still cannot pass reconciliation until the stored property timezone exists.
  const calendarTimezone = propertyTimezone ?? "UTC";
  const endDate = propertyDateKey(now, calendarTimezone);
  const currentMonthKey = propertyMonthKey(now, calendarTimezone);
  const startDate = endDate ? dateKeyDaysBefore(endDate, 420) : null;
  if (!startDate || !endDate || !currentMonthKey) {
    await writeGa4Reconciliation({
      tenantId,
      propertyId,
      checkedAt: now.toISOString(),
      status: "error",
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      latestSyncAt: rollup?.latestSyncAt ?? null,
      reconciledThrough: null,
      perMonth: [],
    });
    return { status: "error", reason: "property_timezone_missing", message: "GA4 property timezone is missing or invalid" };
  }

  // Window: the full retention ceiling so every stored full month has a direct
  // counterpart to compare against, using the SAME property-local calendar GA4
  // used to bucket the stored daily rows.

  const direct = await runGa4SitewideMonthlyReport({ tenantId, propertyId, startDate, endDate });
  if (!direct.ok) {
    if (NOT_CONNECTED_REASONS.has(direct.reason)) {
      const healthReason = await safeHealthReason(tenantId);
      await writeGa4Reconciliation({
        tenantId,
        propertyId,
        checkedAt: now.toISOString(),
        status: "not_connected",
        tolerancePct: RECONCILE_TOLERANCE_PCT,
        latestSyncAt: null,
        reconciledThrough: null,
        perMonth: [],
      });
      return { status: "not_connected", reason: direct.reason, healthReason, message: GA4_NOT_CONNECTED_LINE };
    }
    await writeGa4Reconciliation({
      tenantId,
      propertyId,
      checkedAt: now.toISOString(),
      status: "error",
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      latestSyncAt: null,
      reconciledThrough: null,
      perMonth: [],
    });
    return { status: "error", reason: direct.reason, message: direct.message ?? "GA4 report error" };
  }
  if (fullMonths.length === 0) {
    await writeGa4Reconciliation({
      tenantId,
      propertyId,
      checkedAt: now.toISOString(),
      status: "error",
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      latestSyncAt: rollup?.latestSyncAt ?? null,
      reconciledThrough: null,
      perMonth: [],
    });
    return { status: "error", reason: "no_rollup", message: "no stored full months to reconcile" };
  }
  if (!propertyTimezone) {
    await writeGa4Reconciliation({
      tenantId,
      propertyId,
      checkedAt: now.toISOString(),
      status: "error",
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      latestSyncAt: rollup?.latestSyncAt ?? null,
      reconciledThrough: null,
      perMonth: [],
    });
    return { status: "error", reason: "property_timezone_missing", message: "GA4 property timezone is missing or invalid" };
  }
  if (direct.propertyTimezone !== propertyTimezone) {
    await writeGa4Reconciliation({
      tenantId,
      propertyId,
      checkedAt: now.toISOString(),
      status: "error",
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      latestSyncAt: rollup?.latestSyncAt ?? null,
      reconciledThrough: null,
      perMonth: [],
    });
    return {
      status: "error",
      reason: "property_timezone_mismatch",
      message: "GA4 property timezone changed or could not be verified",
    };
  }

  const directByMonth = new Map(direct.rows.map((r) => [r.month, r.sessions]));
  const perMonth: Ga4ReconciliationMonth[] = fullMonths.map((m) => {
    const directSessions = directByMonth.get(m.month);
    if (directSessions == null) {
      // A stored full month with NO direct counterpart (a month present in the
      // rollup but MISSING from the direct report) cannot be vouched for - a
      // mismatch, never silently skipped.
      return {
        month: m.month,
        storedSessions: m.sessions,
        directSessions: 0,
        deltaPct: 100,
        withinTolerance: false,
      };
    }
    const deltaPct =
      directSessions === 0
        ? m.sessions === 0
          ? 0
          : 100
        : (Math.abs(m.sessions - directSessions) / directSessions) * 100;
    const withinTolerance = m.sessions === directSessions || deltaPct <= RECONCILE_TOLERANCE_PCT;
    return { month: m.month, storedSessions: m.sessions, directSessions, deltaPct, withinTolerance };
  });

  // Vice versa: a COMPLETED month GA4 reports directly (with real traffic) that is
  // MISSING from the stored rollup, within the range the rollup already covers, is a
  // silent gap in the daily totals. Flag each such month as a mismatch so the rollup
  // cannot pass while it is missing a month GA4 knows about. A LEADING month the
  // tenant simply has not synced yet falls outside [firstStored, lastStored] and is
  // correctly NOT flagged (that is honest coverage, not a gap).
  const storedMonths = new Set(fullMonths.map((m) => m.month));
  const firstStored = fullMonths[0]!.month;
  const lastStored = fullMonths[fullMonths.length - 1]!.month;
  for (const r of direct.rows) {
    if (
      r.sessions > 0 &&
      r.month < currentMonthKey && // a completed month, not the current partial one
      r.month >= firstStored &&
      r.month <= lastStored &&
      !storedMonths.has(r.month)
    ) {
      perMonth.push({
        month: r.month,
        storedSessions: 0,
        directSessions: r.sessions,
        deltaPct: 100,
        withinTolerance: false,
      });
    }
  }
  perMonth.sort((a, b) => a.month.localeCompare(b.month));

  // Vacuous-pass guard: an all-zero comparison (the direct report returned no rows,
  // or every reconciled month is 0-vs-0) proves nothing. That is an honest non-pass
  // ("I have no visits to reconcile yet"), NEVER a pass over no data. A month with
  // real stored data but a zero direct total is NOT vacuous - it is a mismatch,
  // caught below.
  const hasSignal = perMonth.some((p) => p.storedSessions > 0 || p.directSessions > 0);
  if (!hasSignal) {
    await writeGa4Reconciliation({
      tenantId,
      propertyId,
      checkedAt: now.toISOString(),
      status: "error",
      tolerancePct: RECONCILE_TOLERANCE_PCT,
      latestSyncAt: rollup?.latestSyncAt ?? null,
      reconciledThrough: null,
      perMonth,
    });
    return { status: "error", reason: "no_data", message: "no GA4 visits to reconcile yet" };
  }

  const allWithin = perMonth.every((p) => p.withinTolerance);
  const checkedAt = now.toISOString();
  const status = allWithin ? "pass" : "mismatch";
  const reconciledThrough = allWithin ? fullMonths[fullMonths.length - 1]!.month : null;

  await writeGa4Reconciliation({
    tenantId,
    propertyId,
    checkedAt,
    status,
    tolerancePct: RECONCILE_TOLERANCE_PCT,
    latestSyncAt: rollup?.latestSyncAt ?? null,
    reconciledThrough,
    perMonth,
  });

  if (allWithin) {
    log.info("[ga4-reconcile] visits reconciled", { tenantId, propertyId, months: perMonth.length });
    return { status: "pass", propertyId, perMonth, reconciledThrough, checkedAt };
  }
  log.warn("[ga4-reconcile] visits do NOT reconcile; withholding the number", {
    tenantId,
    propertyId,
    offenders: perMonth.filter((p) => !p.withinTolerance).map((p) => p.month),
  });
  return { status: "mismatch", propertyId, perMonth, checkedAt };
}

/** Reuse the connector-health reason for the human-facing not-connected message.
 *  Fail-soft: any error yields null (the fixed GA4_NOT_CONNECTED_LINE still stands). */
async function safeHealthReason(tenantId: string): Promise<string | null> {
  try {
    const health = await getConnectorHealth("google_ga4", tenantId);
    return health.healthReason;
  } catch {
    return null;
  }
}
