import { currentTenantId } from "@/lib/tenant-context";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import {
  computeCumulativeOutcome,
  type CumulativeOutcome,
  type CumulativeOutcomeRow,
} from "@/domains/proof-gsc/cumulative-outcome";
import {
  buildWonDollarBreakdown,
  WON_DOLLAR_RULE_SENTENCE,
  type WonDollarBreakdownRow,
} from "@/domains/proof-gsc/won-dollar-rule";
import { buildShockWindows, type ShockWindow } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
import { Card } from "@/components/ui/card";
import { buildReceiptLine, ReceiptLine } from "@/components/data/receipt-line";
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
 * R14b (P1 trust receipts): the dollar line is now a disclosure - clicking it opens
 * the per-win rows it sums (buildWonDollarBreakdown, the SAME selection rule as the
 * sum) plus THE ONE DOLLAR RULE in one plain sentence. The strip also carries the
 * one-line receipt (when these numbers were last measured, from what source).
 *
 * Primitives + tokens only (design-system-guard). Read-only aggregation.
 */
export function CumulativeOutcomeStrip({
  outcome,
  dollarBreakdown,
  receiptLine,
}: {
  outcome: CumulativeOutcome | null;
  /** R14b - the per-win rows behind outcome.dollarLine. Empty/absent -> the dollar
   *  line renders flat (no expander), exactly the pre-R14b presentation. */
  dollarBreakdown?: ReadonlyArray<WonDollarBreakdownRow>;
  /** R14b - the one-line receipt ("From your Search Console data, checked N ago."). */
  receiptLine?: string | null;
}) {
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
        dollarBreakdown && dollarBreakdown.length > 0 ? (
          // R14b see-the-math: the dollar figure opens into the per-win rows it
          // sums plus the one rule sentence. Same numbers, one click deeper.
          <details className="mt-1">
            <summary className="cursor-pointer text-meta text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
              {outcome.dollarLine} See the math.
            </summary>
            <div className="mt-1 space-y-1 rounded-md border border-border/40 bg-surface-inset/30 p-2 text-meta text-foreground/70">
              <ul className="space-y-0.5 tabular-nums">
                {dollarBreakdown.map((w) => (
                  <li key={w.path}>
                    {w.path}: about ${Math.round(w.usdPerMonth).toLocaleString("en-US")} a month
                    {/* N4 behavior corroboration - one line, only when present. */}
                    {w.behaviorNote ? (
                      <span className="text-muted-foreground"> {w.behaviorNote}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p>{WON_DOLLAR_RULE_SENTENCE}</p>
            </div>
          </details>
        ) : (
          <p className="mt-1 text-meta text-muted-foreground tabular-nums">{outcome.dollarLine}</p>
        )
      ) : null}
      <ReceiptLine line={receiptLine ?? null} className="mt-1" />
    </Card>
  );
}

/** R14b - the newest measuredAt stamp across the loaded rows: the honest "when
 *  these numbers were last measured" for the strip's receipt. Null when no row
 *  carries one (legacy rows). PURE. */
export function latestMeasuredAt(rows: ReadonlyArray<CumulativeOutcomeRow>): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    const at = r.measuredAt;
    if (typeof at === "string" && Number.isFinite(Date.parse(at)) && (latest == null || at > latest)) {
      latest = at;
    }
  }
  return latest;
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
  let dollarBreakdown: WonDollarBreakdownRow[] = [];
  let receiptLine: string | null = null;
  try {
    const tenantId = await currentTenantId();
    const ledger =
      preloadedLedger ?? (await loadProofLedgerCached(tenantId).catch(() => []));
    const shockWindows =
      preloadedShockWindows ??
      (await loadDetectedChangepoints(tenantId)
        .then((changepoints) => buildShockWindows({ dailySeries: [], priorChangepoints: changepoints }))
        .catch(() => [] as ShockWindow[]));
    const now = new Date();
    outcome =
      ledger.length === 0 ? null : computeCumulativeOutcome(ledger, now, shockWindows);
    // R14b - the SAME selection rule as the dollar sum, so the expander's rows
    // always add up to the figure it explains. Cheap pure pass over loaded rows.
    dollarBreakdown = outcome?.dollarLine
      ? buildWonDollarBreakdown(ledger, now, shockWindows)
      : [];
    receiptLine = buildReceiptLine({
      source: "your Search Console data, measured against similar pages we did not change",
      checkedAt: latestMeasuredAt(ledger),
      verb: "last measured",
      nowMs: now.getTime(),
      // R17a (brand split, v1 265) - this strip's counts say which lens they
      // use: every search, brand name searches included (the scoreboard's
      // non-brand sub-line is the growth lens).
      note: "Counts clicks from every search, including ones that mention your name.",
    });
  } catch {
    return null;
  }
  return (
    <CumulativeOutcomeStrip
      outcome={outcome}
      dollarBreakdown={dollarBreakdown}
      receiptLine={receiptLine}
    />
  );
}
