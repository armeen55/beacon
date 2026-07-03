import "server-only";

/**
 * behavior-window (BEACON_500 N4 + N17, 2026-07-03) - the I/O orchestrator for
 * the behavior lane, mirroring citation-window.ts's posture: read the pre
 * window (28d before ship) and the elapsed post window for the TREATED page
 * from GA4 (ga4_url_traffic) and Clarity (clarity_daily_url_metrics), then run
 * the pure math in behavior-outcome.ts.
 *
 * SPLIT CLOCKS RULE: this lane runs on the live_at clock (the ship date) like
 * the GA4 traffic outcome - it is NEVER gated on GSC finalization or on the
 * recrawl-confirmed Search clock (N11). Visitors see the new page the moment
 * it ships; Google's index lag is irrelevant to how they behaved on it.
 *
 * Computed-only + fail-soft null, like every attachment on the proof record:
 * never persisted (recordToRow omits it), recomputed on every measure, and a
 * failure here can never touch windows/verdict/confidence.
 */

import { readGa4WindowForPages, readLatestGa4Date } from "./ga4-window";
import { readClarityWindowForPage, readLatestClarityDate } from "./clarity-window";
import { addDays, PROOF_WINDOW_DAYS, PROOF_BASELINE_WINDOW_DAYS } from "./measure";
import {
  computeBehaviorOutcome,
  elapsedPostDays,
  type BehaviorOutcome,
} from "./behavior-outcome";

const GA4_ZERO = { sessions: 0, engagedSessions: 0, conversions: 0 };

const dateOnly = (iso: string): string => (iso.length > 10 ? iso.slice(0, 10) : iso);

/**
 * Compute the behavior outcome for one shipped change. Null when neither
 * source has a day on or after the ship yet (nothing honest to say) or on any
 * error. The per-metric sample floors live in the pure module - a page whose
 * windows are too thin comes back with null metrics and a "none" composite,
 * which the card's self-hiding rule renders as nothing.
 */
export async function computeBehaviorOutcomeForRecord(args: {
  tenantId: string;
  record: { page: string; actionType: string; shippedAt: string };
}): Promise<BehaviorOutcome | null> {
  const { tenantId, record } = args;
  try {
    const shipDate = dateOnly(record.shippedAt);
    const [latestGa4, latestClarity] = await Promise.all([
      readLatestGa4Date(tenantId).catch(() => null),
      readLatestClarityDate(tenantId).catch(() => null),
    ]);
    const dataThrough =
      latestGa4 != null && latestClarity != null
        ? latestGa4 > latestClarity
          ? latestGa4
          : latestClarity
        : (latestGa4 ?? latestClarity);
    const elapsed = elapsedPostDays(shipDate, dataThrough, Math.max(...PROOF_WINDOW_DAYS));
    if (elapsed <= 0) return null;

    const preStart = addDays(shipDate, -PROOF_BASELINE_WINDOW_DAYS);
    const postEnd = addDays(shipDate, elapsed);
    const [ga4Pre, ga4Post, clarityPre, clarityPost] = await Promise.all([
      readGa4WindowForPages({ tenantId, pages: [record.page], start: preStart, end: shipDate }),
      readGa4WindowForPages({ tenantId, pages: [record.page], start: shipDate, end: postEnd }),
      readClarityWindowForPage({ tenantId, page: record.page, start: preStart, end: shipDate }),
      readClarityWindowForPage({ tenantId, page: record.page, start: shipDate, end: postEnd }),
    ]);

    return computeBehaviorOutcome({
      windowDays: elapsed,
      preWindowDays: PROOF_BASELINE_WINDOW_DAYS,
      actionType: record.actionType,
      ga4Pre: ga4Pre.get(record.page) ?? GA4_ZERO,
      ga4Post: ga4Post.get(record.page) ?? GA4_ZERO,
      clarityPre,
      clarityPost,
      dataThrough,
    });
  } catch {
    return null;
  }
}
