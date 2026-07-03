/**
 * today-still-arriving (P14, v1 520 - "still-arriving shading") - where a number on Today is not
 * yet final, shade and LABEL it honestly instead of showing a hard number that will still change.
 *
 *   a settled 28-day win        -> "up 40 clicks a month" (a real, final number)
 *   an open measurement window  -> "still arriving" (a soft, honest label, no hard number)
 *   a checkpoint waiting on GSC  -> "still arriving" (the data has not landed yet)
 *
 * PURE (no I/O). It reuses the ONE measurement-truth resolver the whole product already shares
 * (domains/proof-gsc/measurement-maturity.ts): a number is "final" only at `mature_result`;
 * every in-flight maturity (collecting / early / interim / blocked / attribution-limited /
 * scheduled) is "still arriving". No new maturity concept, no second window rule - this is a thin
 * presentation layer over the existing resolver so Today can never show a confident number off a
 * window that has not closed.
 *
 * Beacon voice: the label is a plain phrase ("still arriving"), never a lab word (no "interim",
 * "checkpoint", "n=" on the primary surface). No em/en dashes.
 */

import { isMatureOutcome, type MeasurementMaturity } from "@/domains/proof-gsc/measurement-maturity";

export type StillArrivingRead = {
  /** true when the number this describes is final and safe to show as a hard figure. */
  final: boolean;
  /** The honest soft label to show INSTEAD of a hard number while it is still arriving. */
  label: string;
  /** Optional next-checkpoint date (YYYY-MM-DD) for a "final read around <date>" hint. */
  nextCheckpoint: string | null;
};

/**
 * Resolve whether a proof number is final, from its already-derived maturity. `blocked_data`
 * (the calendar window closed but Google's data has not landed) gets the most literal
 * "still arriving" phrasing; every other in-flight state reads "still measuring". A mature
 * result is final. PURE.
 */
export function readStillArriving(
  maturity: MeasurementMaturity,
  nextCheckpoint: string | null = null,
): StillArrivingRead {
  if (isMatureOutcome(maturity)) {
    return { final: true, label: "", nextCheckpoint: null };
  }
  const label = maturity === "blocked_data" ? "still arriving" : "still measuring";
  return { final: false, label, nextCheckpoint };
}

/** "Jul 18" from a YYYY-MM-DD date; null when unparseable. Pacific, matching Today's labels. */
export function checkpointLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

/**
 * The full honest phrase for a still-arriving number, e.g.
 *   "still arriving, final read around Jul 18"
 * or just "still measuring" when no checkpoint date is known. PURE.
 */
export function stillArrivingPhrase(read: StillArrivingRead): string {
  if (read.final) return "";
  const when = checkpointLabel(read.nextCheckpoint);
  return when ? `${read.label}, final read around ${when}` : read.label;
}
