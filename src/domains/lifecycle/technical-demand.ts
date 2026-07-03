/**
 * technical-demand (2026-07-03, BEACON_500 R19 / N21 - technical-crawl signals
 * from stored snapshots, demand-cross-referenced).
 *
 * PURE / no I/O. N21 surfaces the technical problems that matter MOST: a
 * technical defect on a page GOOGLE ACTUALLY SENDS SEARCHES TO. The codebase
 * already has snapshot-driven technical triggers (bad-http-status,
 * canonical-mismatch, noindex-on-indexable-page) but they fire off page TYPE and
 * an indexability verdict, regardless of whether the page has any real demand.
 * This engine is the DEMAND-FIRST complement: it reads the SAME stored snapshot
 * fields (http_status, has_canonical_mismatch, robots_meta) but only fires when
 * the page clears a real-demand floor, and it says so plainly ("Google shows
 * this page for real searches, but ..."). That is what makes the card worth
 * $250: it points at the technical problems that are costing real traffic today.
 *
 * No new crawl - every signal is a field already on the stored page_snapshot.
 * Demand comes from the GSC page signals already loaded. Byte-identical when no
 * page qualifies. No em or en dashes. Never a lab word on the sentence.
 */

import {
  noindexOnDemandPageCopy,
  statusOnDemandPageCopy,
  canonicalOnDemandPageCopy,
} from "@/domains/recommendation-intelligence/customer-copy-templates";

export type TechnicalDemandKind = "noindex" | "bad_status" | "canonical_elsewhere";

export type TechnicalDemandPageInput = {
  /** Canonical page URL - the identity used across every signal map. */
  url: string;
  /** HTTP status of the last fetch. */
  httpStatus: number;
  /** The page's raw meta-robots string (e.g. "noindex, follow"), or null. */
  robotsMeta: string | null;
  /** Whether the snapshot's canonical tag points at a DIFFERENT page. */
  hasCanonicalMismatch: boolean;
  /** Google impressions over the trailing 90 days (the demand gate). */
  impressions90d: number;
};

export type TechnicalDemandFinding = {
  url: string;
  kind: TechnicalDemandKind;
  /** Plain first-person-safe sentence, dash-free, no lab words. */
  reason: string;
  /** Operator-only structured trace. */
  evidence: string;
};

/** A page needs at least this many 90-day impressions before a demand-first
 *  technical card is worth raising. Below this the page has no real demand to
 *  protect and the page-type-driven triggers already cover the case. Matches the
 *  buried-page / js-shell floor for consistency. */
export const TECHNICAL_DEMAND_MIN_IMPRESSIONS_90D = 100;

/** HTTP statuses that mean "not a working 200 page": 4xx/5xx errors plus the
 *  redirect family (a page GSC still shows but that now bounces the visitor). */
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/** Deterministic noindex detection from the raw meta-robots string. True when
 *  the directive list contains a standalone "noindex" token. Pure. */
export function robotsSaysNoindex(robotsMeta: string | null): boolean {
  if (!robotsMeta) return false;
  return /(^|[,\s])noindex([,\s]|$)/i.test(robotsMeta.trim());
}

/** Is this a non-200 status worth flagging (error or redirect)? */
export function isBrokenStatus(httpStatus: number): boolean {
  return httpStatus >= 400 || REDIRECT_STATUSES.has(httpStatus);
}

/**
 * Classify ONE page's demand-cross-referenced technical findings. A page can
 * carry more than one (a 301 that is also noindexed), so this returns an array.
 * Every finding requires the page to clear the demand floor first. Pure.
 *
 * Precedence within a page (most severe first) when building the array: a broken
 * status (the page will not even load) leads, then noindex (it loads but is told
 * to hide), then a canonical pointing elsewhere (it loads and indexes but hands
 * its credit to another page). Order is stable so downstream capping is
 * reproducible.
 */
export function classifyTechnicalDemand(
  page: TechnicalDemandPageInput,
): TechnicalDemandFinding[] {
  if (page.impressions90d < TECHNICAL_DEMAND_MIN_IMPRESSIONS_90D) return [];
  const path = pathOf(page.url);
  const out: TechnicalDemandFinding[] = [];

  if (isBrokenStatus(page.httpStatus)) {
    out.push({
      url: page.url,
      kind: "bad_status",
      reason: statusOnDemandPageCopy(path, page.httpStatus, page.impressions90d),
      evidence:
        "technical_demand kind=bad_status; http_status=" +
        String(page.httpStatus) +
        "; impressions_90d=" +
        String(page.impressions90d),
    });
  }

  // A page that will not load (>=400) does not also get a noindex/canonical
  // card - the status fix comes first. Redirects (3xx) still index, so they can
  // co-carry a noindex/canonical finding.
  const loads = page.httpStatus < 400;

  if (loads && robotsSaysNoindex(page.robotsMeta)) {
    out.push({
      url: page.url,
      kind: "noindex",
      reason: noindexOnDemandPageCopy(path, page.impressions90d),
      evidence:
        "technical_demand kind=noindex; robots_meta=" +
        (page.robotsMeta ?? "null") +
        "; impressions_90d=" +
        String(page.impressions90d),
    });
  }

  if (loads && page.hasCanonicalMismatch) {
    out.push({
      url: page.url,
      kind: "canonical_elsewhere",
      reason: canonicalOnDemandPageCopy(path, page.impressions90d),
      evidence:
        "technical_demand kind=canonical_elsewhere; has_canonical_mismatch=true; impressions_90d=" +
        String(page.impressions90d),
    });
  }

  return out;
}
