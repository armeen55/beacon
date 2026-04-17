/**
 * Phase 0 — Data-quality gate.
 *
 * Detects dates whose citation data is unreliable and should be excluded when
 * computing verdicts, baselines, and post-change lift.
 *
 * The primary defect this module is built to catch is the Ritz Apr 7–12 bug:
 * for the owned domain (`ritzbuilders.com`), every citation had
 * `source_category === "owned"` but `is_owned === false`. Downstream code that
 * trusts the `is_owned` flag sees a 100% drop in owned citations; downstream
 * code that trusts `source_category` sees normal traffic. The discrepancy is
 * the signal.
 *
 * This module is a pure function over a plain data structure — no I/O. Call
 * sites (CLI scripts, tests, future production jobs) load the citation shards
 * however they like and pass them in.
 */

import type { DataQualityFlag } from "@/domains/events/types";

/**
 * Minimum subset of citation-shard fields the detector needs. Matches the
 * `CitationObservation` shape in `src/domains/citation-observations/types.ts`
 * — only the four fields we read.
 */
export type RawCitation = {
  domain: string;
  source_category: string;
  is_owned: boolean;
  observed_at: string;
};

export type DataQualityInput = {
  /** YYYY-MM-DD → every citation record captured on that day. */
  citationsByDate: Record<string, RawCitation[]>;
  /** The owned domain whose citations should be internally consistent. */
  ownedDomain: string;
};

/**
 * Emit one `DataQualityFlag` per day that passes the defect gate.
 *
 * Defect rule — `is_owned_false_but_category_owned`:
 *   For a given day, count citations where `domain === ownedDomain` split by
 *   two independent predicates:
 *     (a) `source_category === "owned"`
 *     (b) `is_owned === true`
 *   If (a) > 0 AND (b) === 0, the `is_owned` flag is systemically wrong for
 *   that day. Flag the day.
 *
 * The gate is intentionally conservative: a partial mismatch (e.g., a > b but
 * b > 0) is NOT flagged — those days are usable with the `source_category`
 * override. We only flag the fully-broken case.
 */
export function detectDataQualityFlags(
  input: DataQualityInput,
): DataQualityFlag[] {
  const flags: DataQualityFlag[] = [];
  const dates = Object.keys(input.citationsByDate).sort();

  for (const date of dates) {
    const records = input.citationsByDate[date] ?? [];

    let ownedByCategory = 0;
    let ownedByFlag = 0;

    for (const record of records) {
      if (record.domain !== input.ownedDomain) continue;
      if (record.source_category === "owned") ownedByCategory += 1;
      if (record.is_owned === true) ownedByFlag += 1;
    }

    if (ownedByCategory > 0 && ownedByFlag === 0) {
      flags.push({
        date,
        reason_code: "is_owned_false_but_category_owned",
        narrative: `${input.ownedDomain} source_category=owned count=${ownedByCategory} but is_owned=true count=0`,
        domain: input.ownedDomain,
      });
    }
  }

  return flags;
}

/**
 * Convenience: turn a list of flags into a `Set<string>` of YYYY-MM-DD dates
 * for O(1) "is this day bad?" lookups from other domain modules.
 */
export function buildDataQualityDateSet(
  flags: DataQualityFlag[],
): Set<string> {
  return new Set(flags.map((f) => f.date));
}
