import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import type { ProofMeasurementSummary } from "@/domains/decision/changes/proof-timeline/result-pill";

/**
 * Shared /changes row types.
 *
 * Surface collapse (2026-06-15) - these types used to live in the legacy
 * `scorecard-client.tsx`. Verdict-engine consolidation (2026-07-21, CORE
 * 100K Lane F) retired the parallel URL Z-score verdict and the legacy
 * ChangeImpact scorecard: a timeline row now carries the changelog entry
 * plus the SAME proof-gsc measurement summary Results renders, joined via
 * the shipped-change ledger (change-proof-link.ts).
 */

/**
 * A single row on the raw-change-log timeline (embedded in /results).
 * - `change` = the changelog entry (title, URL, timestamp, ids).
 * - `proof` = the maturity-gated Google measurement summary for the row's
 *   shipped-change ledger record. Null when the change has no proof
 *   coverage - the pill then says plainly it is not being measured.
 */
/** HOW MUCH OF THE RANKED QUEUE ONE SCREEN CARRIES. The queue itself is unlimited; a list of a
 *  hundred and twelve changes is not a decision surface, so the page opens with this many and says
 *  exactly how many are behind it. Shared by the server slice and the client's "Show more". */
export const CHANGES_PAGE_SIZE = 25;

/** A PAGE ADDRESS, READ THE WAY A PERSON SAYS IT. Every change surface printed the raw slug as its headline
 *  ("/famous-iranian-comedians"), which is a file name, not a page. The last segment becomes the name, the
 *  address stays beside it as the small line. Pure, shared by Changes, the change detail and Results. */
export function pageLabel(path: string | null | undefined): string {
  // No address is NOT the home page: claiming a specific page for a missing one is the lie this exists to kill.
  if (!(path ?? "").trim()) return "This page";
  const trimmed = (path ?? "").replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  const last = trimmed.split("/").filter(Boolean).pop();
  if (!last) return "Home page";
  let words = last;
  try { words = decodeURIComponent(last); } catch { /* a half-encoded path is said as it is written */ }
  words = words.replace(/\.(html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim();
  // A de-slug that emptied out falls back to the raw segment rather than inventing a page.
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : last;
}

export type EnrichedChangeRow = {
  change: ChangelogEntry;
  proof: ChangeRowProof | null;
};

/**
 * The proof slice a timeline row needs: the pill summary plus the soonest
 * future checkpoint date so pre-verdict rows can name when the next Google
 * reading lands (replaces the retired pattern-brain "ready on" guess).
 */
export type ChangeRowProof = ProofMeasurementSummary & {
  /** Soonest future proof checkpoint date (YYYY-MM-DD), or null. */
  nextCheckpoint: string | null;
};
