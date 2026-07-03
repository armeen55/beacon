import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/empty-state";
import { ReceiptLine, buildReceiptLine } from "@/components/data/receipt-line";
import type { WinCard as WinCardModel } from "./report-model";

/**
 * win-card (P23, v1 233 export-a-win) - a clean, self-contained "here is a win"
 * card for ONE measured win, styled so the operator can screenshot or share it.
 *
 *   "Persian comedians page: +38 clicks a month since we shipped the title
 *    rewrite, measured over 28 days."
 *
 * Tokens + primitives only (Card / Pill / ReceiptLine), so the design ratchet
 * never moves. Self-hides via WinCardEmpty when there are no measured wins yet.
 * Beacon voice: a win celebrated in one sentence, a concrete number, no lab
 * words, no em or en dashes.
 */

/** "on Jul 2" from an ISO date; empty when unparseable so the line stays clean. */
function sinceLabel(shippedOn: string): string {
  const t = Date.parse(shippedOn.length === 10 ? `${shippedOn}T00:00:00Z` : shippedOn);
  if (!Number.isFinite(t)) return "";
  return `on ${new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

/** The honest empty state - self-hides the whole win surface when nothing has won. */
export function WinCardEmpty() {
  return (
    <EmptyState
      headline="No measured wins yet."
      nextStep="Ship a change and I will show the first one here in a few weeks, once its full read comes in."
    />
  );
}

export function WinCardView({
  win,
  computedAt,
  nowMs,
}: {
  win: WinCardModel;
  /** Snapshot time the number was measured, for the receipt line. */
  computedAt: string;
  nowMs: number;
}) {
  const since = sinceLabel(win.shippedOn);
  const receipt = buildReceiptLine({
    source: "your Search Console data, measured against comparison pages you did not change",
    checkedAt: computedAt,
    nowMs,
  });
  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pill intent="won">Measured win</Pill>
        <span className="text-meta text-muted-foreground">
          {win.windowDays > 0 ? `${win.windowDays}-day read` : "measured"}
        </span>
      </div>

      {/* The one screenshot-ready line, the number made large and calm. */}
      <div>
        <p className="text-page font-semibold tracking-tight text-foreground">
          +{win.clicksPerMonth.toLocaleString("en-US")} clicks a month
        </p>
        <p className="mt-1 text-body text-foreground-secondary">
          on the {win.pageName}, since we shipped the {win.changeKind}
          {since ? ` ${since}` : ""}.
        </p>
      </div>

      <ReceiptLine line={receipt} />
    </Card>
  );
}
