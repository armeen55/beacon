/**
 * anonymized-share (BEACON_500 R17a / P2 slice 1, v1 item 492) - honest
 * accounting for the searches Google keeps private.
 *
 * Search Console hides low-volume ("anonymized") queries from the page+query
 * grain, so a page's per-query rows always sum to LESS than its true page
 * totals (which the sync stores separately - see gsc_daily_page_totals in
 * sync-search-analytics.ts). The difference is the anonymized share. When it
 * is large, a query table that looks complete is quietly missing a third or
 * more of the page's real traffic - so the page dossier SAYS so instead of
 * letting the visible rows read as the whole story.
 *
 * HONESTY RULES: the share is computed only from two numbers Google actually
 * reported (page-total impressions vs the visible query-row sum). No estimate,
 * no invention; missing inputs -> null -> the note self-hides.
 *
 * PURE, no I/O. Wired through gsc-page-signals.ts (which already loads both
 * numbers) into the page dossier.
 */

/** Below this share the note stays silent - a small hidden slice is normal
 *  for every site and not worth a sentence. */
export const ANONYMIZED_NOTE_MIN_SHARE = 0.3;

/**
 * The fraction of a page's impressions that came from queries Google hides:
 * (total - visible) / total, clamped to [0, 1]. Null when the total is not a
 * positive number or the visible sum is unknown (never a guess).
 */
export function anonymizedQueryShare(
  totalImpressions: number | null | undefined,
  visibleQueryImpressions: number | null | undefined,
): number | null {
  // Explicit null/undefined checks first: Number(null) coerces to 0, and a
  // missing visible sum must read as UNKNOWN, never as "all hidden".
  if (totalImpressions == null || visibleQueryImpressions == null) return null;
  const total = Number(totalImpressions);
  const visible = Number(visibleQueryImpressions);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(visible) || visible < 0) return null;
  return Math.min(1, Math.max(0, (total - visible) / total));
}

/** Plain-English magnitude, deliberately coarse - the share is a real ratio
 *  but a page note should read like a person, not a decimal. */
function sharePhrase(share: number): string {
  if (share >= 0.8) return "Almost all";
  if (share >= 0.6) return "Most";
  if (share >= 0.45) return "About half";
  return "About a third";
}

/**
 * The one dossier note. Non-null only when the share clears
 * ANONYMIZED_NOTE_MIN_SHARE - the honest "the table below is not the whole
 * story" sentence. Null input or a small share -> null (self-hides).
 */
export function anonymizedShareNote(share: number | null): string | null {
  if (share == null || !Number.isFinite(share)) return null;
  if (share < ANONYMIZED_NOTE_MIN_SHARE) return null;
  return `${sharePhrase(share)} of this page's Google traffic comes from searches Google keeps private. The numbers below cover what Google shows me.`;
}
