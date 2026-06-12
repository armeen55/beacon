/**
 * align-treatment-dates — audit fix #26 (2026-06-12 night shift).
 *
 * THE MEASUREMENT BUG: the proof engine's treatment date comes from
 * `changelog.timestamp`, which `acceptRecommendation` stamps at ACCEPT
 * time. But the change only affects the page when it goes LIVE — the
 * Wix push, or the operator pasting it in, observed later by the match
 * engine as `recommended_edits.live_at`. When accept→live takes days,
 * the post-window opens early and counts pre-live days as "treated",
 * diluting the measured lift (and the pre-window leaks treated days
 * when live_at precedes a backfilled changelog stamp).
 *
 * THE FIX: before classification, override each linked entry's
 * `timestamp` with the matched edit's `live_at` — the match engine's
 * evidence-backed "first observed live on the page" moment (source:
 * `page_snapshots.fetched_at`). Pure function; the proof engine feeds
 * it the tenant-scoped repository reads.
 *
 * CONSERVATIVE MATCHING — only realign when the link is unambiguous:
 *   - entry must carry `source_rec_id` (stamped by acceptRecommendation)
 *   - edit must be in a trusted-live state (`pushed`, `verified_live`,
 *     `verified_live_modified`) with a parseable `live_at`
 *   - per-edit entries (carrying `target_element_key`) match their
 *     exact edit; legacy single-changelog entries (no element key)
 *     take the EARLIEST trusted live_at across the rec's edits — the
 *     first moment any part of the bundled change was live
 *   - anything else (no link, no trusted live edit, unparseable date)
 *     passes through untouched — accept time stays the honest anchor
 *     when no better evidence exists.
 *
 * Structural input types on purpose: nothing here imports the
 * recommended-edits persistence module (not even types) — the
 * promotion-writer single-importer boundary stays exactly as locked.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";

/** The slice of a recommended_edits row this module needs. Structural —
 *  `RecommendedEditRow` satisfies it without an import. */
export type LiveEditLike = {
  rec_id: string;
  target_element_key?: string | null;
  implementation_status?: string;
  live_at?: string | null;
};

/** Lifecycle states where `live_at` is evidence the change is on the
 *  page (push receipt or match-engine verification). `wrong_page` /
 *  `needs_review` / `partially_implemented` are deliberately excluded. */
const TRUSTED_LIVE_STATUSES: ReadonlySet<string> = new Set([
  "pushed",
  "verified_live",
  "verified_live_modified",
]);

function parseableIso(s: string | null | undefined): s is string {
  return typeof s === "string" && s.length > 0 && !Number.isNaN(Date.parse(s));
}

function trustedLiveEdits(edits: ReadonlyArray<LiveEditLike>): LiveEditLike[] {
  return edits.filter(
    (e) =>
      TRUSTED_LIVE_STATUSES.has(e.implementation_status ?? "") &&
      parseableIso(e.live_at),
  );
}

/**
 * Realign changelog entries' treatment timestamps to the linked edits'
 * `live_at`. Returns a NEW array; untouched entries are passed through
 * by reference. Idempotent (re-running on aligned entries re-derives
 * the same live_at).
 */
export function alignTreatmentDates<
  T extends ChangelogEntry & { archived?: boolean },
>(entries: ReadonlyArray<T>, edits: ReadonlyArray<LiveEditLike>): T[] {
  const trusted = trustedLiveEdits(edits);
  if (trusted.length === 0) return [...entries];

  // rec_id → its trusted-live edits (a rec fans out to N edits).
  const byRec = new Map<string, LiveEditLike[]>();
  for (const e of trusted) {
    const list = byRec.get(e.rec_id);
    if (list) list.push(e);
    else byRec.set(e.rec_id, [e]);
  }

  return entries.map((entry) => {
    const recId = entry.source_rec_id;
    if (!recId) return entry;
    const candidates = byRec.get(recId);
    if (!candidates || candidates.length === 0) return entry;

    let liveAt: string | undefined;
    const elementKey = entry.target_element_key;
    if (elementKey != null && elementKey !== "") {
      // Per-edit entry → its exact edit only.
      const exact = candidates.find(
        (e) => e.target_element_key === elementKey,
      );
      if (exact) liveAt = exact.live_at!;
    } else {
      // Legacy single-changelog entry → earliest live moment of the
      // bundled rec (first time any of its edits hit the page).
      liveAt = candidates
        .map((e) => e.live_at!)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    }

    if (liveAt == null || liveAt === entry.timestamp) return entry;
    return { ...entry, timestamp: liveAt };
  });
}
