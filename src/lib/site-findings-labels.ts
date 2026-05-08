/**
 * UX.6.2 (2026-05-07) — One vocabulary for the scan_findings layer.
 *
 * Pre-fix the same underlying scan_findings rows surfaced across /today
 * under three competing names that read like three separate fires:
 *
 *   - "133 important scan diffs"   (TodayDoNextCard)
 *   - "775 page issues"            (TodayActionQueue findings strip)
 *   - "Scan diffs to review (7)"   (ChangeReview accordion)
 *
 * 7 ⊂ 133 ⊂ 775 — three filter levels of the same array:
 *   - 775 = all `pending` scan_findings
 *   - 133 = important + critical priority subset
 *   -   7 = content/structure-type subset (CONTENT_CHANGE_TYPES)
 *
 * UX.6.2 picks ONE primary label — "site findings" — and uses it
 * consistently. The technical wording ("scan diff", "raw difference")
 * stays inside operator-detail surfaces (the changelog confirm
 * tooltip, methodology page, etc.) but never on default /today copy.
 *
 * Every consumer goes through the helpers below so a single edit can
 * change the entire vocabulary later without grep-and-replace risk.
 */

/** The customer/operator-safe primary label. Singular shape. */
export const SITE_FINDING_NOUN = "site finding";
export const SITE_FINDING_NOUN_PLURAL = "site findings";

/**
 * Pluralize the noun for `count`.
 * `1 site finding` / `2 site findings` / `0 site findings`.
 */
export function siteFindingNoun(count: number): string {
  return count === 1 ? SITE_FINDING_NOUN : SITE_FINDING_NOUN_PLURAL;
}

/**
 * Compact "site findings" copy for the strip in TodayActionQueue.
 *
 * Examples:
 *   compactStripLabel({ total: 775, important: 133, critical: 0 })
 *     → "775 site findings · 133 important"
 *   compactStripLabel({ total: 775, important: 130, critical: 3 })
 *     → "775 site findings · 3 critical · 130 important"
 *   compactStripLabel({ total: 5, important: 0, critical: 0 })
 *     → "5 site findings"
 *
 * Critical is the louder count and renders before important when both
 * are non-zero. Zero counts are dropped.
 */
export function compactStripLabel(args: {
  total: number;
  important: number;
  critical: number;
}): string {
  const head = `${args.total} ${siteFindingNoun(args.total)}`;
  const tails: string[] = [];
  if (args.critical > 0) tails.push(`${args.critical} critical`);
  if (args.important > 0) tails.push(`${args.important} important`);
  return tails.length > 0 ? `${head} · ${tails.join(" · ")}` : head;
}

/**
 * Lead-with-the-actionable-number copy for the Do Next card branch
 * when there's no pending implementation queue and no top-pick rec.
 *
 * Pre-UX.6.2 said "133 important scan diffs to review" or
 * "1 critical scan diff needs review" — we keep the same numeric
 * lead but replace "scan diff" with "site finding(s)".
 */
export function doNextHeadline(args: {
  critical: number;
  important: number;
}): string {
  if (args.critical > 0) {
    return `${args.critical} critical ${siteFindingNoun(args.critical)} need${args.critical === 1 ? "s" : ""} review`;
  }
  return `${args.important} important ${siteFindingNoun(args.important)} to review`;
}

/**
 * Subtitle shown beneath the Do Next headline. Explains the
 * total-vs-shown relationship in plain English.
 *
 * "775 total findings detected. 133 important. Showing 7 most recent."
 */
export function doNextSubtitle(args: {
  total: number;
  important: number;
  critical: number;
  /** When the operator scrolls into the bottom accordion they'll see
   *  this many rows. Optional — omit when irrelevant. */
  shownInPreview?: number;
}): string {
  const parts: string[] = [
    `${args.total} total ${siteFindingNoun(args.total)} detected`,
  ];
  // Combined count when both critical and important exist.
  if (args.critical > 0 && args.important > 0) {
    parts.push(
      `${args.critical} critical · ${args.important} important`,
    );
  } else if (args.critical > 0) {
    parts.push(`${args.critical} critical`);
  } else if (args.important > 0) {
    parts.push(`${args.important} important`);
  }
  if (
    typeof args.shownInPreview === "number" &&
    args.shownInPreview > 0 &&
    args.shownInPreview < args.total
  ) {
    parts.push(`showing ${args.shownInPreview} most recent`);
  }
  return parts.join(". ") + ".";
}

/**
 * Heading for the bottom accordion that lists the content/structure
 * subset (CONTENT_CHANGE_TYPES filter). Pre-UX.6.2 this said
 * "Scan diffs to review (N)" — we keep the count but rename to use
 * the unified vocabulary AND make the subset shape explicit.
 */
export function recentSiteChangesHeading(count: number): string {
  return `Recent site changes (${count})`;
}

/**
 * Subtitle for the bottom accordion. Pre-UX.6.2 mentioned
 * "raw website differences found by Beacon's scanner" which is
 * operator-internal language. Replace with customer-safe copy.
 */
export const RECENT_SITE_CHANGES_SUBTITLE =
  "Content & structure changes Beacon spotted on your site. Confirm one to add it to your changelog and start tracking attribution.";
