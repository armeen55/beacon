/**
 * today-smoke-alarm (P14, v1 324 - "smoke alarm with page blame") - ONE honest alarm line at the
 * top of Today when a real problem exists, naming the exact page and the number:
 *
 *   "Heads up: /nowruz lost 18 clicks vs the previous 4 weeks (data through Jul 9).
 *    I have a fix ready."
 *
 * PURE (no I/O). Reads the SAME per-page GSC decay signal the war-room friction band + the GSC
 * scoreboard card already load (two consecutive 28-day click windows per page). It never invents
 * a generic "something is wrong": the alarm names the single worst-bleeding page and the exact
 * click delta, and it only fires when the drop clears a real floor (not measurement noise).
 *
 * Scope note: the DATA-PIPE alarm (a connector down, GSC writing zero rows) already lives in
 * OpsPipelineSection at the very top of the page, so this module deliberately does NOT re-raise
 * that - a second "something is broken" line for the same failure would violate the one-count
 * rule. This is the page-BLAME lane the pipe alert can't fill: it points at the specific page
 * losing traffic while the pipe itself is healthy.
 *
 * Self-hides (returns null) when no page's real drop clears the floor. Beacon voice: first
 * person ("I have a fix ready"), a concrete number, a next step; no lab jargon; no em/en dashes.
 */

import { dossierHref } from "@/lib/page-dossier-link";

export type SmokeAlarmDecayRow = {
  page: string;
  /** Trailing 28-day clicks. */
  clicksNow: number;
  /** The 28 days before that. */
  clicksPrior: number;
};

export type TodaySmokeAlarm = {
  /** The exact page taking the blame, e.g. "/nowruz". */
  page: string;
  /** Absolute clicks lost across the two windows (a positive number). */
  clicksLost: number;
  /** The defined window phrase the clicksLost delta is measured against, so the
   *  alarm sentence AND the Today command headline name the SAME window in the SAME
   *  words (single source). "the previous 4 weeks (data through Jul 9)" when the
   *  window end is known; "the previous 4 weeks" when it is not. */
  windowLabel: string;
  /** The one alarm sentence. */
  sentence: string;
  /** Where the fix link points (the page's own change queue / dossier). */
  href: string;
  /** The action link text. */
  actionLabel: string;
};

/**
 * A drop only counts as a fire when it clears BOTH an absolute floor (so a page that lost 2
 * clicks never rings the alarm) AND had enough prior clicks to matter (so a page that fell from
 * 6 to 1 isn't front-paged over a page that fell from 400 to 200). These mirror the war-room
 * friction band's posture of never front-paging a small-sample swing.
 */
const MIN_CLICKS_LOST = 10;
const MIN_PRIOR_CLICKS = 25;

function prettyPath(u: string): string {
  const p = (u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 44 ? p.slice(0, 41) + "..." : p;
}

/**
 * The full normalized page key used for the `pagesWithFixReady` lookup. This mirrors
 * EXACTLY the host-strip + de-slash normalization page.tsx builds `pagesWithFixReady` with
 * (host prefix removed, one trailing slash removed, "/" fallback) and carries NO length cap,
 * so a long-URL page is compared key-for-key against the plan paths. prettyPath (which DOES
 * cap length) is for the visible label only; using it for the `.has()` check silently dropped
 * the "I have a fix ready" affordance on any page whose path ran past the 44-char cap.
 */
function normalizedFixKey(u: string): string {
  return (u.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "")) || "/";
}

/**
 * Build the smoke alarm from the loaded decay signals. Picks the single page with the largest
 * real click loss that clears the floor. `hasFixReady` decides the closing sentence: when a
 * change is already queued for a bleeding page we can honestly say "I have a fix ready"; when
 * not, we point at reviewing the page instead of promising a fix that does not exist yet.
 *
 * PURE - deterministic for a fixed input. Returns null when nothing clears the floor.
 */
/** "Jul 9" from an ISO date (YYYY-MM-DD) or timestamp; null when unparseable. Kept
 *  local so this pure server-and-client module does not pull in the receipt-line
 *  React component just for a date label. UTC so the label matches the finalized
 *  GSC day exactly. */
function monthDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function buildTodaySmokeAlarm(input: {
  decay: ReadonlyArray<SmokeAlarmDecayRow>;
  /** Set of page paths (host-stripped) that already have a queued/ready change. */
  pagesWithFixReady: ReadonlySet<string>;
  /** The last finalized GSC day the decay "now" window ends on (from the same
   *  GscDecaySignal the rows came from). Names the exact window so the claim is
   *  reproducible; when absent the phrase omits the date but still names the
   *  two-window comparison. */
  windowEnd?: string | null;
}): TodaySmokeAlarm | null {
  let worst: { page: string; lost: number } | null = null;
  for (const row of input.decay) {
    const lost = row.clicksPrior - row.clicksNow;
    if (lost < MIN_CLICKS_LOST) continue;
    if (row.clicksPrior < MIN_PRIOR_CLICKS) continue;
    if (!worst || lost > worst.lost) worst = { page: row.page, lost };
  }
  if (!worst) return null;

  // The visible label is truncated for tidiness; the fix-ready lookup and the deep link both
  // use the FULL page path so a long-URL page is never mismatched or mis-pointed.
  const label = prettyPath(worst.page);
  const fixKey = normalizedFixKey(worst.page);
  const lost = Math.round(worst.lost);
  const fixReady = input.pagesWithFixReady.has(fixKey);
  const closing = fixReady ? "I have a fix ready." : "Worth a look before it slides further.";
  // `lost` is clicksPrior - clicksNow across two consecutive 28-day windows: the
  // page got `lost` FEWER clicks in the most recent 4 weeks than in the 4 weeks
  // before. "in the last 4 weeks" read as an absolute single-window count and was
  // not reproducible (an auditor's undated 4 weeks, including the ~3 unfinalized lag
  // days, lands 3-20 clicks off). Name the comparison AND the finalized window end
  // so the number reproduces exactly. windowLabel is the single source both this
  // sentence and the Today command headline render.
  const through = monthDay(input.windowEnd);
  const windowLabel = through
    ? `the previous 4 weeks (data through ${through})`
    : "the previous 4 weeks";
  const sentence = `Heads up: ${label} lost ${lost.toLocaleString()} click${lost === 1 ? "" : "s"} vs ${windowLabel}. ${closing}`;

  // The CTA points at the exact bleeding page's dossier (its own change queue), not a /changes
  // deep link the Changes list ignores. dossierHref normalizes the RAW page (host-strip, one
  // trailing slash, lowercase) so the operator lands on the same page the alarm blames. The
  // fallback (only the site root / a sentinel has no dossier) is the live Changes backlog, never
  // a dead /page/ link.
  const href = dossierHref(worst.page) ?? "/changes";

  return {
    page: label,
    clicksLost: lost,
    windowLabel,
    sentence,
    href,
    actionLabel: fixReady ? "See the fix" : "Review the page",
  };
}
