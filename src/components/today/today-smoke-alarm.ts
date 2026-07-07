/**
 * today-smoke-alarm (P14, v1 324 - "smoke alarm with page blame") - ONE honest alarm line at the
 * top of Today when a real problem exists, naming the exact page and the number:
 *
 *   "Heads up: /nowruz lost 18 clicks in the last 4 weeks. I have a fix ready."
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
export function buildTodaySmokeAlarm(input: {
  decay: ReadonlyArray<SmokeAlarmDecayRow>;
  /** Set of page paths (host-stripped) that already have a queued/ready change. */
  pagesWithFixReady: ReadonlySet<string>;
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
  const sentence = `Heads up: ${label} lost ${lost.toLocaleString()} click${lost === 1 ? "" : "s"} in the last 4 weeks. ${closing}`;

  // The CTA points at the exact bleeding page's dossier (its own change queue), not a /changes
  // deep link the Changes list ignores. dossierHref normalizes the RAW page (host-strip, one
  // trailing slash, lowercase) so the operator lands on the same page the alarm blames. The
  // fallback (only the site root / a sentinel has no dossier) is the live Changes backlog, never
  // a dead /page/ link.
  const href = dossierHref(worst.page) ?? "/changes";

  return {
    page: label,
    clicksLost: lost,
    sentence,
    href,
    actionLabel: fixReady ? "See the fix" : "Review the page",
  };
}
