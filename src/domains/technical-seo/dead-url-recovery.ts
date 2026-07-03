/**
 * dead-url-recovery (2026-07-03, BEACON_500 P11 v1 320/321 - "dead URLs with
 * demand recovery").
 *
 * PURE / no I/O. Beacon already knows two things about every owned URL: how many
 * searches Google sent to it (the GSC page signal) and whether it still loads (the
 * stored page snapshot's http_status and, when available, Google's own index
 * verdict from the URL Inspection cache). This engine crosses those two facts:
 * when Google is STILL sending real searches to a URL that now returns Not Found /
 * Gone, or that Google's index has dropped, that is money bleeding out of a page
 * that used to work. It is the single highest-impact technical recovery Move
 * because the demand is already proven and the fix (restore the page, or redirect
 * the address to whatever replaced it) is unambiguous.
 *
 * DISTINCT from the R19 demand-first technical signal (technical-demand.ts): that
 * engine fires off the STORED SNAPSHOT http_status for any 4xx/5xx/3xx. This one
 * is narrower and stronger: it fires ONLY on a page that is genuinely gone
 * (404/410, or Google's index says "not found / crawled-not-indexed / removed")
 * AND still carries live demand, and it speaks recovery language ("restore or
 * redirect"), not generic "fix the status code". The loader dedupes the two by
 * cooldown_key, so a page never double-cards; this one wins the framing when both
 * would fire because it names the recovery play.
 *
 * No new crawl. Demand is the GSC page signal already loaded; liveness is the
 * stored snapshot + the URL-inspection cache already loaded. Byte-identical when
 * no page qualifies. No em or en dashes. No lab words on the sentence (we say
 * "Google's index", never "crawler").
 */

import { deadUrlRecoveryCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";

/**
 * A page's liveness verdict, reduced from the stored snapshot status and Google's
 * URL-inspection coverage state. Only "gone" states earn a recovery Move; a
 * redirect (3xx) is handled by the redirect-hygiene engine, not here.
 */
export type DeadUrlReason =
  | "http_not_found" // stored snapshot returns 404
  | "http_gone" // stored snapshot returns 410
  | "index_dropped"; // Google's index verdict says the page is gone / not indexed

export type DeadUrlPageInput = {
  /** Canonical page URL - the identity used across every signal map. */
  url: string;
  /** HTTP status of the last stored fetch (0 when never fetched). */
  httpStatus: number;
  /** Google's URL-Inspection coverage_state token for this URL, e.g.
   *  "Submitted and indexed", "Not found (404)", "Crawled - currently not
   *  indexed". Null when we have never inspected this URL. */
  coverageState: string | null;
  /** Google impressions over the trailing 90 days (the demand gate). */
  impressions90d: number;
  /** Google clicks over the trailing 90 days (raises severity when > 0). */
  clicks90d: number;
};

export type DeadUrlFinding = {
  url: string;
  reason: DeadUrlReason;
  impressions90d: number;
  clicks90d: number;
  /** Plain first-person-safe sentence, dash-free, no lab words. */
  reason_copy: string;
  /** Operator-only structured trace. */
  evidence: string;
};

/** A page needs at least this many 90-day impressions before a dead-URL recovery
 *  card is worth raising. Below this the page has no real demand to protect.
 *  Matches the buried-page / technical-demand floor for consistency. */
export const DEAD_URL_MIN_IMPRESSIONS_90D = 100;

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/** Coverage-state tokens Google reports for a URL its index no longer holds as a
 *  live indexed page. Matched case-insensitively on a substring so wording
 *  variants ("Not found (404)", "Submitted URL not found (404)") all catch. A
 *  soft-404 is deliberately NOT here - that is the redirect-hygiene engine's job
 *  (the page loads with a 200 but is an empty shell), a different fix. */
const INDEX_GONE_SUBSTRINGS = [
  "not found",
  "url is unknown to google",
  "removed",
  "excluded by",
  "crawled - currently not indexed",
  "discovered - currently not indexed",
];

/** Does Google's coverage state say the index no longer serves this URL? Pure,
 *  case-insensitive substring match. Empty / null coverage is NOT a verdict
 *  (never guess a page is gone off missing data). */
export function coverageSaysGone(coverageState: string | null): boolean {
  if (!coverageState) return false;
  const c = coverageState.trim().toLowerCase();
  if (c === "") return false;
  // A soft-404 string ("soft 404") is explicitly excluded here - handled by the
  // redirect-hygiene engine.
  if (c.includes("soft 404")) return false;
  return INDEX_GONE_SUBSTRINGS.some((s) => c.includes(s));
}

/**
 * Classify ONE page's dead-URL recovery finding, or null when it is not a
 * demand-carrying dead URL. Precedence: a hard 410 Gone (the owner deliberately
 * removed it) leads, then a 404 Not Found, then Google's index verdict when the
 * stored snapshot still reads 200 but the index has dropped the page. Pure.
 */
export function classifyDeadUrl(page: DeadUrlPageInput): DeadUrlFinding | null {
  if (page.impressions90d < DEAD_URL_MIN_IMPRESSIONS_90D) return null;

  let reason: DeadUrlReason | null = null;
  if (page.httpStatus === 410) reason = "http_gone";
  else if (page.httpStatus === 404) reason = "http_not_found";
  else if (page.httpStatus < 400 && coverageSaysGone(page.coverageState)) {
    // The stored fetch loaded (2xx/3xx) but Google's own index verdict says the
    // page is gone from search. This catches the case a raw fetch misses (a Wix
    // 200 that Google treats as not found).
    reason = "index_dropped";
  }
  if (reason == null) return null;

  const path = pathOf(page.url);
  return {
    url: page.url,
    reason,
    impressions90d: page.impressions90d,
    clicks90d: page.clicks90d,
    reason_copy: deadUrlRecoveryCopy(
      path,
      reason,
      page.impressions90d,
      page.clicks90d,
    ),
    evidence:
      "dead_url_recovery reason=" +
      reason +
      "; http_status=" +
      String(page.httpStatus) +
      "; coverage_state=" +
      (page.coverageState ?? "null") +
      "; impressions_90d=" +
      String(page.impressions90d) +
      "; clicks_90d=" +
      String(page.clicks90d),
  };
}
