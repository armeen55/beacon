/**
 * trust-receipts (R14b, P1 trust receipts, 2026-07-03) - the small PURE copy
 * builders behind the /results trust additions:
 *
 *   - controlsLegendLine: names the comparison pages drawn as dashed lines on a
 *     card's chart ("Compared against /a and /b, chosen before shipping.").
 *   - prepSpendLine: the spend-to-outcome join on a card's expand ("Preparing
 *     this change cost $0.04 in checks."), from the linked move's own cached
 *     live-Google verdict spend. Null at $0 - a free change never grows a line.
 *
 * Beacon voice: plain words, no lab words, no em or en dashes. Pinned by
 * trust-receipts.test.ts.
 */

/** Strip an origin/query/hash so a stored URL and a stored path read the same. */
function toPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return (url.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/[?#].*$/, "") || "/";
  }
}

/**
 * The chart legend naming the dashed comparison series. Max 2 paths by
 * convention (callers slice); null when none were drawn.
 */
export function controlsLegendLine(paths: ReadonlyArray<string>): string | null {
  const cleaned = paths.map(toPath).filter(Boolean).slice(0, 2);
  if (cleaned.length === 0) return null;
  const named = cleaned.length === 1 ? cleaned[0] : `${cleaned[0]} and ${cleaned[1]}`;
  return `Compared against ${named}, chosen before shipping.`;
}

/**
 * "Preparing this change cost $0.04 in checks." Null when the linked move spent
 * nothing (or carries no spend record) - never a fabricated $0.00 line.
 */
export function prepSpendLine(costUsd: number | null | undefined): string | null {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd <= 0) return null;
  const shown = costUsd < 0.01 ? "under a cent" : `$${costUsd.toFixed(2)}`;
  return `Preparing this change cost ${shown} in checks.`;
}

/** Minimal shape of a persisted VerifyEnvelope read here (kept structural so
 *  this pure copy module never imports the server-only store; extra envelope
 *  fields are permitted). */
type VerifyEnvelopeLike =
  | { canonical?: unknown; exhausted?: unknown; [key: string]: unknown }
  | null
  | undefined;

/**
 * W5 stop-ship F6 (2026-07-09): honest TERMINAL copy for a change the
 * crawl-verify pass GAVE UP on (exhausted after several tries) and that is not
 * confirmed live. Without this, such a row would sit silently forever, neither
 * "verified live" nor honestly "we could not confirm it". Null for a
 * verified-live row, a still-retrying row, or one that was never verified at
 * all - so the line appears ONLY when Beacon has genuinely stopped trying.
 */
export function verifyGaveUpLine(
  verifyState: VerifyEnvelopeLike,
  verifiedLive: boolean,
): string | null {
  if (verifiedLive) return null;
  if (!verifyState || typeof verifyState !== "object") return null;
  const env = verifyState as { canonical?: unknown; exhausted?: unknown };
  if (env.exhausted !== true) return null;
  if (env.canonical != null) return null; // a latched success is never "gave up"
  return "I could not verify this after several tries; check it yourself.";
}

/**
 * Trust-audit fix (2026-07-18): the CONTRADICTION line. A row can be latched
 * `verifiedLive` (a one-way flag - once true it never flips back) while the
 * LATEST crawl attempt could NOT find the edit on the live page (lastAttempt
 * state not_found or crawl_failed). Left silent, Beacon shows a green "verified
 * live" badge on a page its own most recent check says is missing the edit -
 * exactly the dishonesty the product is built to avoid. This says so plainly.
 *
 * Returns the line ONLY when verifiedLive is true AND the last attempt failed
 * to find the edit AND no latched verified-live success POSTDATES that failed
 * attempt (a fresh success clears an older miss). Null otherwise, so a genuinely
 * re-confirmed row, a row with no failed attempt, or an unverified row stays
 * quiet. Beacon voice: first person, a concrete next step, no lab words, no
 * dashes. Pinned by trust-receipts.test.ts.
 */
export function liveContradictionLine(
  verifyState: VerifyEnvelopeLike,
  verifiedLive: boolean,
): string | null {
  if (!verifiedLive) return null;
  if (!verifyState || typeof verifyState !== "object") return null;
  const env = verifyState as {
    canonical?: { outcome?: unknown } | null;
    canonicalAt?: unknown;
    lastAttempt?: { state?: unknown; at?: unknown } | null;
  };
  const attempt = env.lastAttempt;
  if (!attempt || typeof attempt !== "object") return null;
  const state = attempt.state;
  if (state !== "not_found" && state !== "crawl_failed") return null;
  // A latched verified-live success that POSTDATES this failed attempt clears
  // it (the edit was re-confirmed after the miss); an older success does not.
  const canonOutcome = env.canonical?.outcome;
  if (canonOutcome === "verified_live" || canonOutcome === "verified_live_modified") {
    const canonicalAt = typeof env.canonicalAt === "string" ? env.canonicalAt : "";
    const attemptAt = typeof attempt.at === "string" ? attempt.at : "";
    if (canonicalAt && (!attemptAt || canonicalAt > attemptAt)) return null;
  }
  return "I confirmed this edit earlier, but my latest check of the live page could not find it. Open the page and confirm the edit is still there.";
}

/** Legacy-row honesty caveat (2026-07-18): rows shipped before Beacon locked in
 *  an up-front measurement plan (no `predeclaredAt`) were judged by the older
 *  method, so their verdict is a directional read, not a predeclared test. */
export const LEGACY_MEASUREMENT_CAVEAT =
  "I measured this with my earlier method, before I locked in measurement plans up front. Treat it as a directional read.";
