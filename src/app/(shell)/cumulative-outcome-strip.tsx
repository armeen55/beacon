import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import {
  computeCumulativeOutcome,
  type CumulativeOutcome,
  type CumulativeOutcomeRow,
} from "@/domains/proof-gsc/cumulative-outcome";
import { buildShockWindows, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import { Card } from "@/components/ui/card";
import { ResultsHeaderStrip } from "./results/results-header-strip";

/**
 * CumulativeOutcomeStrip (2026-07-02, FP8 - the "$250 answer") - THE one cumulative
 * outcome strip, rendered on BOTH Today (below the lead story) and Results (extending
 * the header count strip). One component, one aggregation rule
 * (domains/proof-gsc/cumulative-outcome.ts, which reuses the ONE-COUNT lifecycle
 * split), so total value won is asserted in the same words with the same numbers on
 * both surfaces:
 *
 *   - the all-time counts line (the existing ResultsHeaderStrip, unchanged copy);
 *   - when wins exist, the measured monthly click lift those wins are adding;
 *   - when nothing has a final read yet, the honest frame with the REAL date the
 *     earliest 28-day window closes (never a bare "we don't know yet");
 *   - a dollar line ONLY when GA4-backed per-change dollar rates already exist,
 *     clearly labeled as an estimate with its basis. No rate -> no money, ever.
 *
 * Primitives + tokens only (design-system-guard). Read-only aggregation.
 */
export function CumulativeOutcomeStrip({ outcome }: { outcome: CumulativeOutcome | null }) {
  if (!outcome || outcome.shipped === 0) return null;
  return (
    <Card variant="quiet" padding="sm" data-cumulative-outcome-strip="true">
      {outcome.decided > 0 ? (
        <ResultsHeaderStrip
          measuring={outcome.measuring}
          decided={outcome.decided}
          won={outcome.won}
        />
      ) : (
        <p className="text-body text-foreground/80 tabular-nums">
          You have shipped {outcome.shipped} change{outcome.shipped === 1 ? "" : "s"}, all still
          measuring below.
        </p>
      )}
      {outcome.valueLine ? (
        <p className="mt-1 text-body font-medium text-status-success tabular-nums">
          {outcome.valueLine}
        </p>
      ) : null}
      {outcome.waitingLine ? (
        <p className="mt-1 text-body text-muted-foreground tabular-nums">{outcome.waitingLine}</p>
      ) : null}
      {outcome.dollarLine ? (
        <p className="mt-1 text-meta text-muted-foreground tabular-nums">{outcome.dollarLine}</p>
      ) : null}
    </Card>
  );
}

/**
 * Async loader wrapper. On Today it reads the SAME request-cached re-measured
 * ledger the scoreboard already loads (react.cache), so rendering costs no extra
 * read; /results passes its snapshot-served ledger (and its already-loaded shock
 * windows) down instead, so the strip never re-triggers the heavy measure path
 * there. Shock windows feed THE ONE DOLLAR RULE (won-dollar-rule.ts) - loaded
 * fail-soft when the caller has none. Fail-soft: any error or an empty ledger
 * renders nothing.
 */
export async function CumulativeOutcomeSection({
  ledger: preloadedLedger,
  shockWindows: preloadedShockWindows,
}: {
  ledger?: ReadonlyArray<CumulativeOutcomeRow>;
  shockWindows?: ReadonlyArray<ShockWindow>;
} = {}) {
  let outcome: CumulativeOutcome | null = null;
  try {
    const tenantId = await currentTenantId();
    const ledger =
      preloadedLedger ?? (await loadProofLedgerCached(tenantId).catch(() => []));
    const shockWindows =
      preloadedShockWindows ??
      (await loadDetectedChangepoints(tenantId)
        .then((changepoints) => buildShockWindows({ dailySeries: [], priorChangepoints: changepoints }))
        .catch(() => [] as ShockWindow[]));
    outcome =
      ledger.length === 0 ? null : computeCumulativeOutcome(ledger, new Date(), shockWindows);
  } catch {
    return null;
  }
  return <CumulativeOutcomeStrip outcome={outcome} />;
}
