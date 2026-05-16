/**
 * Section 5.B Slice 1 (2026-05-16) — customer-safe repeat-citation
 * sub-line for Changes detail Act 3.
 *
 * Pure presentational component. Type-only import of
 * `RepeatCitationResult`; no loader, no server-only modules, no
 * repository, no Section 6 modules. Safely consumable by the
 * existing Changes detail client component.
 *
 * Locked customer label mapping (internal band → visible label):
 *   stable          → "Consistent"
 *   intermittent    → "Recurring"
 *   one_off         → "Early signal"
 *   not_repeated    → "Not repeated in this window"
 *   still_learning  → "Still learning"
 *
 * Customer copy never exposes the internal `One-off` or
 * `Intermittent` band names, never shows a percentage, never
 * mentions Section 6 vocabulary (Mode A/B/C, primary recommendation),
 * never uses causal/revenue/promise language. Architecture
 * invariants `repeat-citation-customer-copy-vocab` and
 * `repeat-citation-changes-detail-band-mapping` pin these rules.
 *
 * Suppression rules:
 *   - `result == null` → null
 *   - `result.eligible === false` → null
 *   - `result.band == null` → null
 *   - `result.band === "still_learning" && first_citation_date_iso == null` → null
 */

import type { ReactElement } from "react";

import type {
  RepeatCitationBand,
  RepeatCitationResult,
} from "@/domains/citation-lifecycle/compute-repeat-citation";

type CustomerLabel =
  | "Consistent"
  | "Recurring"
  | "Early signal"
  | "Not repeated in this window"
  | "Still learning";

const CUSTOMER_LABELS: Record<RepeatCitationBand, CustomerLabel> = {
  stable: "Consistent",
  intermittent: "Recurring",
  one_off: "Early signal",
  not_repeated: "Not repeated in this window",
  still_learning: "Still learning",
};

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format an ISO date (YYYY-MM-DD) as `Mon DD` (e.g., "Apr 28"). The
 * compute layer always emits a YYYY-MM-DD slice; this helper is
 * defensive against malformed input.
 */
function formatShortDate(iso: string): string | null {
  if (typeof iso !== "string" || iso.length < 10) return null;
  const yyyy = Number(iso.slice(0, 4));
  const mm = Number(iso.slice(5, 7));
  const dd = Number(iso.slice(8, 10));
  if (
    !Number.isFinite(yyyy) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(dd) ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }
  return `${MONTH_SHORT[mm - 1]} ${dd}`;
}

type RepeatCitationAct3Props = {
  result: RepeatCitationResult | null;
};

/**
 * Customer-facing repeat-citation sub-line. Renders inside Act 3
 * AFTER the existing primary-recommendation evidence block; no
 * bridging copy between the two.
 */
export function RepeatCitationAct3({
  result,
}: RepeatCitationAct3Props): ReactElement | null {
  if (result == null) return null;
  if (!result.eligible) return null;
  if (result.band == null) return null;

  const firstCited = result.first_citation_date_iso;
  if (result.band === "still_learning" && firstCited == null) return null;

  const label = CUSTOMER_LABELS[result.band];
  const firstCitedShort = firstCited != null ? formatShortDate(firstCited) : null;
  const polling = result.polling_days;
  const distinct = result.distinct_citation_days;

  let detailLine: string;
  if (
    result.band === "stable" ||
    result.band === "intermittent" ||
    result.band === "one_off"
  ) {
    const dateSuffix =
      firstCitedShort != null ? ` · First cited ${firstCitedShort}` : "";
    detailLine = `Cited on ${distinct} of ${polling} successful AI readings${dateSuffix}`;
  } else if (result.band === "not_repeated") {
    const dateSuffix =
      firstCitedShort != null ? ` · First cited ${firstCitedShort}` : "";
    detailLine = `${polling} successful AI readings in the last 30 days${dateSuffix}`;
  } else {
    // still_learning (firstCited proven non-null by the suppression
    // gate above).
    const dateSuffix =
      firstCitedShort != null ? ` · First cited ${firstCitedShort}` : "";
    detailLine = `${polling} successful AI readings so far${dateSuffix}`;
  }

  return (
    <div
      className="mt-3 rounded-md border border-border/40 bg-surface-inset/30 px-3 py-2"
      data-change-detail-repeat-citation="true"
    >
      <p
        className="text-[12.5px] font-medium text-foreground"
        data-change-detail-repeat-citation-label="true"
      >
        Citation stability: {label}
      </p>
      <p
        className="mt-0.5 text-[11.5px] text-muted-foreground"
        data-change-detail-repeat-citation-detail="true"
      >
        {detailLine}
      </p>
    </div>
  );
}
