/**
 * results-csv (R14b, P1 trust receipts, 2026-07-03) - the PURE row builder
 * behind /results "Download as spreadsheet": the same measured ledger the page
 * renders, one row per shipped change, plain-word columns (never a raw verdict
 * key or lab word). The route (export/route.ts) reads the SAME snapshot-served
 * ledger surface the page reads - no new data source, no extra measure pass.
 */

import { buildCsv } from "@/lib/csv";
import { formatWindowLift, pickProofMetric } from "@/domains/proof-gsc/measure";

/** Structural subset of ShippedChangeRecord this builder needs (test-fixture friendly). */
export type ResultsCsvRow = {
  path: string;
  actionType: string;
  shippedAt: string;
  verdict: string;
  windows: ReadonlyArray<{
    day: number;
    ran: boolean;
    controlsUsed?: number | null;
    adjustedLift?: number;
    adjustedCtrLift?: number | null;
    adjustedPosLift?: number | null;
  }>;
  baseline?: { impressions?: number | null; clicks?: number | null } | null;
  controlPages?: ReadonlyArray<string>;
};

const PLAIN_ACTION: Record<string, string> = {
  edit_meta: "description change",
  edit_title: "title change",
  add_answer_block: "direct answer",
  add_internal_link: "internal link",
  add_schema: "structured data",
};

const PLAIN_VERDICT: Record<string, string> = {
  won: "Helped",
  lost: "Did not help",
  inconclusive: "No clear change",
  measuring: "Still measuring",
  insufficient_data: "Waiting for enough data",
};

export const RESULTS_CSV_HEADERS = [
  "Page",
  "Change",
  "Shipped",
  "Status",
  "Read window (days)",
  "Result vs comparison pages",
  "Comparison pages used",
  "Times shown in the 28 days before",
  "Clicks in the 28 days before",
] as const;

export function buildResultsCsv(ledger: ReadonlyArray<ResultsCsvRow>): string {
  const rows = ledger.map((r) => {
    const basis = [...r.windows].filter((w) => w.ran).sort((a, b) => b.day - a.day)[0] ?? null;
    const metric = pickProofMetric(r.actionType);
    return [
      r.path,
      PLAIN_ACTION[r.actionType] ?? r.actionType.replace(/_/g, " "),
      r.shippedAt.slice(0, 10),
      PLAIN_VERDICT[r.verdict] ?? r.verdict.replace(/_/g, " "),
      basis ? basis.day : "",
      basis
        ? formatWindowLift(metric, {
            adjustedLift: basis.adjustedLift ?? 0,
            adjustedCtrLift: basis.adjustedCtrLift ?? 0,
            adjustedPosLift: basis.adjustedPosLift ?? 0,
          })
        : "",
      basis?.controlsUsed ?? r.controlPages?.length ?? "",
      r.baseline?.impressions ?? "",
      r.baseline?.clicks ?? "",
    ];
  });
  return buildCsv(RESULTS_CSV_HEADERS, rows);
}
