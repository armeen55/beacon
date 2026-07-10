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
 * OPERATOR-GATED TODAY: both tenants' GA4 refresh tokens are dead (invalid_grant since
 * 2026-07-06), so the direct report returns token_expired and this returns NOT_CONNECTED
 * honestly. The moment GA4 reconnects, a run flips to pass/mismatch and the card follows.
 */

import { getGoogleConnectorToken, getConnectorHealth } from "@/lib/connector-store";
import { log } from "@/lib/logger";

import { runGa4SitewideMonthlyReport } from "@/lib/connectors/ga4/data-api";
import {
  loadGa4MonthlyRollupForTenant,
  writeGa4Reconciliation,
  type Ga4ReconciliationMonth,
} from "@/domains/north-star/ga4-sitewide-rollup";

/** Per-month tolerance for the daily-rollup-vs-direct comparison, in percent.
 *  A stored month within this band of GA4's direct monthly total (or exactly equal)
 *  passes; GA4's own late-arriving data can wobble a completed month slightly. */
export const RECONCILE_TOLERANCE_PCT = 1;

const ONE_DAY_MS = 86_400_000;

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

  // Window: the full retention ceiling so every stored full month has a direct
  // counterpart to compare against.
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startDate = new Date(todayUtcMs - 420 * ONE_DAY_MS).toISOString().slice(0, 10);
  const endDate = new Date(todayUtcMs).toISOString().slice(0, 10);

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

  const rollup = await loadGa4MonthlyRollupForTenant(tenantId, { propertyId, now });
  const fullMonths = (rollup?.months ?? []).filter((m) => !m.partial);
  if (fullMonths.length === 0) {
    // Nothing stored to reconcile yet (sync hasn't populated daily totals). Not a
    // pass; the card keeps holding back.
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

  const directByMonth = new Map(direct.rows.map((r) => [r.month, r.sessions]));
  const perMonth: Ga4ReconciliationMonth[] = fullMonths.map((m) => {
    const directSessions = directByMonth.get(m.month);
    if (directSessions == null) {
      // No direct counterpart to confirm this stored month - cannot vouch for it.
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
