/**
 * google-updates (2026-07-02, master plan item 32) - the seedable, operator-
 * extendable list of CONFIRMED Google Search core/broad algorithm update
 * rollout ranges. Pure data, no I/O.
 *
 * This list is intentionally small and honest: an entry only belongs here when
 * Google itself confirmed the rollout window (Google Search Status Dashboard /
 * Google Search Central), not a rumor or a third-party guess. When nobody has
 * verified a date with confidence, leave the array empty rather than invent a
 * plausible-looking date, because a wrong confirmed range would wrongly
 * quarantine real, honest verdicts. Detected sitewide shifts that are NOT in
 * this list still show up as "suspected" shocks from the CUSUM detector in
 * changepoint.ts / algorithm-weather.ts, so the guard does not depend on this
 * list being complete.
 *
 * The operator (or a future connector) can append entries here as Google
 * confirms new rollouts. Each entry needs a start date; end defaults to start
 * + a conservative rollout length when Google has not yet announced completion
 * (see DEFAULT_ROLLOUT_DAYS below) so an in-progress update still quarantines
 * the windows it is actively touching.
 */

export type ConfirmedGoogleUpdate = {
  /** Stable slug, e.g. "2026-03-core-update". */
  id: string;
  /** Human label shown in the caveat line, e.g. "the March 2026 Google core update". */
  label: string;
  /** YYYY-MM-DD rollout start, as announced by Google. */
  start: string;
  /** YYYY-MM-DD rollout end, as announced by Google (or the best current
   *  estimate while a rollout is still in progress). */
  end: string;
};

/**
 * A core update's rollout is announced as "may take up to N days" before
 * Google confirms completion. Used only as a fallback when an entry has not
 * yet been given a confirmed end date, so an in-flight update still covers a
 * reasonable window instead of collapsing to a single day.
 */
export const DEFAULT_ROLLOUT_DAYS = 14;

/**
 * Seed list. Each entry below was checked directly against Google's own
 * Search Status Dashboard (status.search.google.com) rollout incident pages,
 * the highest-confidence source available. The operator can add further
 * confirmed entries here at any time (each one takes effect immediately, no
 * migration needed - this is a plain TypeScript const, not a database table).
 * Detected-but-unconfirmed shifts still surface as "suspected" shocks via the
 * CUSUM detector regardless of what this list contains, so a real sitewide
 * shock is never missed just because this list has not been updated yet.
 *
 * Deliberately excluded: a June 19, 2026 volatility spike reported by SEO
 * trackers that Google never confirmed, named, or dated on its own dashboard
 * - a rumor does not belong in a "confirmed" list; a real shift on that date
 * would still show up as a "suspected" entry from the CUSUM detector.
 */
export const CONFIRMED_GOOGLE_UPDATES: ConfirmedGoogleUpdate[] = [
  {
    id: "2025-12-core-update",
    label: "the December 2025 Google core update",
    start: "2025-12-11",
    end: "2025-12-29",
  },
  {
    id: "2026-02-discover-core-update",
    label: "the February 2026 Google Discover core update",
    start: "2026-02-05",
    end: "2026-02-27",
  },
  {
    id: "2026-03-spam-update",
    label: "the March 2026 Google spam update",
    start: "2026-03-24",
    end: "2026-03-25",
  },
  {
    id: "2026-03-core-update",
    label: "the March 2026 Google core update",
    start: "2026-03-27",
    end: "2026-04-08",
  },
  {
    id: "2026-05-core-update",
    label: "the May 2026 Google core update",
    start: "2026-05-21",
    end: "2026-06-02",
  },
  {
    id: "2026-06-spam-update",
    label: "the June 2026 Google spam update",
    start: "2026-06-24",
    end: "2026-06-26",
  },
];
