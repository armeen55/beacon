/**
 * spelling-demand — types (P20, v1 129, 2026-07-03).
 *
 * GENERIC, tenant-configured canonical-spelling demand engine. When an
 * audience types the same thing several ways (transliterations, alternate
 * spellings, script variants), the demand splits across those spellings and no
 * single spelling shows its true size. This engine consolidates the demand back
 * to the canonical term the tenant declared, so the operator sees the real
 * combined number and can own all of it with one page.
 *
 * HARD rule: nothing here is language-specific. Every variant group is
 * tenant-supplied config (BeaconTenant.spelling_variants). With no config the
 * engine returns an empty result and every downstream surface is byte-identical
 * to a world where this domain did not exist.
 *
 * PURE TYPES. No I/O. Safe to import from server or client.
 */

import type { SpellingVariantGroup } from "@/domains/tenants/types";

export type { SpellingVariantGroup };

/**
 * One term's demand. `term` is the raw spelling as it appears in the demand
 * source (a GSC query, a keyword row). `demand` is a comparable size number
 * (searches per month, or 90-day impressions) — the caller supplies whichever
 * it has, consistently, and the engine only sums like with like.
 */
export type SpellingDemandTerm = {
  term: string;
  demand: number;
};

/** Where a term's demand landed inside a consolidated group. */
export type ConsolidatedSpellingMember = {
  /** The spelling as it appeared in the demand source. */
  term: string;
  /** This spelling's own demand. */
  demand: number;
  /** True when this term is the group's canonical spelling. */
  isCanonical: boolean;
};

/**
 * One canonical group after consolidation. Only groups where at least TWO
 * distinct spellings carried demand are returned (a single spelling shows its
 * own true size already — there is nothing to consolidate).
 */
export type ConsolidatedSpellingGroup = {
  /** The canonical spelling the tenant wants to own (verbatim from config). */
  canonical: string;
  /** Combined demand across every spelling in the group. */
  combinedDemand: number;
  /**
   * The single spelling with the most demand, and its share of the combined
   * total. This is what a naive look at one query would have shown — the copy
   * contrasts it against the true combined number.
   */
  topSpellingDemand: number;
  /** How many spellings (canonical + variants) carried demand. */
  spellingsWithDemand: number;
  /** Every contributing spelling, highest demand first. */
  members: ConsolidatedSpellingMember[];
};

export type ConsolidateSpellingDemandResult = {
  groups: ConsolidatedSpellingGroup[];
};

export type ConsolidateSpellingDemandInput = {
  /** The tenant's declared variant groups. Absent / empty → no-op. */
  groups: ReadonlyArray<SpellingVariantGroup>;
  /** Observed demand per raw term (GSC queries or keyword rows). */
  demand: ReadonlyArray<SpellingDemandTerm>;
};
