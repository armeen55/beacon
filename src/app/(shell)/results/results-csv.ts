import { buildCsv } from "@/lib/csv";
import { verdictPhrase, type KernelRead } from "@/domains/proof-gsc";

/**
 * results-csv (CORE 100K) - the "Download as spreadsheet" export of the SAME
 * kernel reads the /results page renders. One row per measured change.
 */
const HEADERS = [
  "page", "change", "verdict", "metric", "basis_window_days",
  "lift", "impressions_lift", "confidence", "overlapping_changes", "summary",
] as const;

export function buildResultsCsv(reads: ReadonlyArray<KernelRead>): string {
  return buildCsv(
    HEADERS,
    reads.map((r) => [
      r.page,
      (r.actionType || "change").replace(/_/g, " "),
      verdictPhrase(r.verdict),
      r.metric,
      r.basisDay ?? "",
      r.lift,
      r.impressionsLift,
      r.confidence,
      r.overlappingIds.length,
      r.headline,
    ]),
  );
}
