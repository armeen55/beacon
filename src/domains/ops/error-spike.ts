import "server-only";

/**
 * error-spike (BEACON_500 R7 / N39, 2026-07-03) - the ONE honest Today line
 * for "things kept failing behind the scenes". Reads the app-errors ledger
 * (src/lib/obs/error-ledger.ts) and, ONLY when at least
 * ERROR_SPIKE_MIN_COUNT failures were recorded for this tenant in the last
 * 24 hours, composes a single plain sentence for the existing machinery
 * alert block on Today (OpsPipelineSection - never a second widget):
 *
 *   "Something failed 14 times since yesterday, mostly on the nightly data
 *    sync. Details are on the Diagnostics page."
 *
 * Self-hiding below the threshold: a handful of transient failures is
 * weather, not a fire, and the banner must never cry wolf. The "mostly on"
 * clause only appears when one route accounts for a strict majority AND has
 * a plain-English subject - a raw route key never reaches Today.
 */

import { listAppErrorsForTenant, type AppErrorRow } from "@/lib/obs/error-ledger";

/** Below this many failures in the window, Today stays quiet. */
export const ERROR_SPIKE_MIN_COUNT = 10;

/** The look-back window ("since yesterday"). */
export const ERROR_SPIKE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Plain subjects per route. Aligned with deadman.ts's JOB_SUBJECT wording so
 *  the same machinery is never described two ways on the same banner. Routes
 *  without an entry simply drop the "mostly on" clause (no raw keys on Today). */
const ROUTE_SUBJECT: Record<string, string> = {
  "cron/sync-connectors": "the connected-source refresh",
  "cron/measure-due": "the results check",
  "/changes": "the worklist refresh",
  "/results": "the results page refresh",
  "action/stage-in-wix": "staging changes in Wix",
  "action/accept-recommendation": "accepting recommendations",
  "action/approve-and-push": "publishing to your site",
  "llm/draft-gateway": "the AI draft writer",
};

/** PURE: compose the spike sentence, or null when the last 24h stayed under
 *  the threshold (the self-hiding state). */
export function buildErrorSpikeLine(
  rows: ReadonlyArray<AppErrorRow>,
  now: Date,
): string | null {
  const cutoff = now.getTime() - ERROR_SPIKE_WINDOW_MS;
  const recent = rows.filter((r) => {
    const t = Date.parse(r.at);
    return Number.isFinite(t) && t >= cutoff;
  });
  if (recent.length < ERROR_SPIKE_MIN_COUNT) return null;

  const byRoute = new Map<string, number>();
  for (const r of recent) byRoute.set(r.route, (byRoute.get(r.route) ?? 0) + 1);
  let topRoute = "";
  let topCount = 0;
  for (const [route, count] of byRoute) {
    if (count > topCount) {
      topRoute = route;
      topCount = count;
    }
  }

  const subject = ROUTE_SUBJECT[topRoute];
  const mostly = subject != null && topCount * 2 > recent.length ? `, mostly on ${subject}` : "";
  return `Something failed ${recent.length} times since yesterday${mostly}. Details are on the Diagnostics page.`;
}

/** Load the tenant's spike line for Today. Fail-soft to null (quiet). */
export async function loadErrorSpikeLine(
  tenantId: string,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const rows = await listAppErrorsForTenant(tenantId);
    return buildErrorSpikeLine(rows, now);
  } catch {
    return null;
  }
}
