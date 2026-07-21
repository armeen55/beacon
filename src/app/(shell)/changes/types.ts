import type { ChangelogEntry } from "@/domains/changelog/types";
import type { ProofMeasurementSummary } from "@/domains/changes/proof-timeline/result-pill";

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
