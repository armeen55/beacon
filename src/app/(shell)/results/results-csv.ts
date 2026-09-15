import { buildCsv } from "@/lib/csv";
import { verdictPhrase, type KernelRead } from "@/domains/measurement";
import "./results-presentation"; // evaluated first: presentation destructures RESULT_LINES at load and lines imports presentation back, so this entry must match the page's order
import { RESULT_LINES } from "./results-lines";

/**
 * results-csv (CORE 100K) - the "Download as spreadsheet" export of the SAME
 * kernel reads the /results page renders. One row per measured change, in the
 * same plain words the page uses: the change is named by what was changed, and
 * the yardstick by what was read, never by a raw metric key.
 */
const HEADERS = [
  "page", "change", "verdict", "judged_on", "basis_window_days",
  "lift", "impressions_lift", "confidence", "overlapping_changes", "summary",
] as const;
const JUDGED_ON: Record<string, string> = { clicks: "clicks from Google", ctr: "how often searchers click", position: "where the page ranks", unclassified: "not measurable" };

export function buildResultsCsv(reads: ReadonlyArray<KernelRead>): string {
  return buildCsv(
    HEADERS,
    reads.map((r) => [
      r.page,
      RESULT_LINES.workLabel(r.actionType),
      verdictPhrase(r.verdict),
      JUDGED_ON[r.metric] ?? "not measurable",
      r.basisDay ?? "",
      r.lift,
      r.impressionsLift,
      r.confidence,
      r.overlappingIds.length,
      r.headline,
    ]),
  );
}
