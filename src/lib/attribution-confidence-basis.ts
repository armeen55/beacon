import type { ScorecardRow } from "@/domains/attribution/scorecard";
import type { EvidenceTier } from "@/domains/pages/types";

const EVIDENCE_SHORT: Record<EvidenceTier, string> = {
  exact: "exact URL evidence",
  probable: "probable URL evidence",
  weak: "weak URL evidence",
  inferred: "inferred evidence",
};

function summarizeMatchFit(
  matches: ScorecardRow["eventAttributions"][number]["matches"],
): string | null {
  const bits: string[] = [];
  if (matches.topic === "strong") bits.push("strong topic fit");
  else if (matches.topic === "partial") bits.push("partial topic fit");
  if (matches.url === "strong") bits.push("strong URL fit");
  else if (matches.url === "partial") bits.push("partial URL fit");
  if (matches.temporal === "strong") bits.push("tight timing");
  else if (matches.temporal === "partial") bits.push("looser timing");
  if (bits.length === 0) return null;
  return bits.join(" · ");
}

function deriveObservationWindow(
  attributions: ScorecardRow["eventAttributions"],
): string | null {
  const dates = attributions
    .map((a) => a.event.trigger_date)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return null;
  const first = new Date(dates[0]);
  const last = new Date(dates[dates.length - 1]);
  const spanDays = Math.round(
    (last.getTime() - first.getTime()) / 86_400_000,
  );
  if (spanDays <= 0) return null;
  return `observed over ${spanDays}d`;
}

/**
 * Concise evidence-oriented basis for attribution confidence (Tier 1.1f/g).
 * Uses only fields already on the scorecard row — no new persistence.
 */
export function buildAttributionConfidenceBasis(
  row: ScorecardRow,
): string | undefined {
  if (!row.topConfidence) return undefined;

  const parts: string[] = [];
  parts.push(
    `${row.totalEventsLinked} linked ${row.totalEventsLinked === 1 ? "match" : "matches"}`,
  );
  if (row.topics.length > 0) {
    parts.push(
      `${row.topics.length} ${row.topics.length === 1 ? "topic" : "topics"}`,
    );
  }
  if (row.platforms.length > 0) {
    parts.push(
      `${row.platforms.length} ${row.platforms.length === 1 ? "platform" : "platforms"}`,
    );
  }
  parts.push(EVIDENCE_SHORT[row.evidenceTier]);
  parts.push(`${row.daysSinceChange}d since change`);

  const primary = row.eventAttributions.find((a) => a.role === "primary");
  const fit = primary ? summarizeMatchFit(primary.matches) : null;
  if (fit) parts.push(fit);

  const window = deriveObservationWindow(row.eventAttributions);
  if (window) parts.push(window);

  return parts.join(" · ");
}
