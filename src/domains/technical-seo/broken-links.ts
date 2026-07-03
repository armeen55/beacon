/**
 * broken-links (2026-07-03, BEACON_500 P11 v1 319/475 - "broken-link fixer +
 * nightly link liveness").
 *
 * PURE / no I/O. Every stored page snapshot carries the internal links that page
 * points at (internal_links: href + anchor text). Beacon also knows the HTTP
 * status of every OWNED page it has snapshotted. Crossing those two facts finds
 * broken internal links WITHOUT any network call at all: a link on /persian-food
 * that points at /old-recipe, where the snapshot for /old-recipe reads 404, is a
 * dead link the reader (and Google) hits. That is the deterministic core.
 *
 * The optional live-liveness leg (external / not-yet-snapshotted targets) is
 * handled by the trigger + a mockable, polite, capped, fail-soft fetch - never in
 * this pure module. This module only reasons over already-known statuses passed
 * in as a map. A target we have no status for is honestly SKIPPED (unknown is
 * never evidence of a dead link), never flagged.
 *
 * We emit ONE Move per SOURCE page (not per broken link), because the fix is "go
 * fix the links on this page" - naming how many and which targets. That keeps the
 * worklist from drowning in one card per dead href.
 *
 * Byte-identical when every link is live (or unknown). No em or en dashes. No lab
 * words on the sentence.
 */

import { brokenLinksCopy } from "@/domains/recommendation-intelligence/customer-copy-templates";

/** One internal link a source page points at. */
export type InternalLinkRef = {
  /** The canonical target URL this link resolves to. */
  targetUrl: string;
  /** The visible anchor text (best-effort; may be empty). */
  anchorText: string;
};

export type BrokenLinkSourcePage = {
  /** Canonical URL of the page that CONTAINS the links. */
  sourceUrl: string;
  /** The distinct internal links this page points at (already resolved +
   *  canonicalized + self-links removed by the assembly boundary). */
  links: ReadonlyArray<InternalLinkRef>;
};

/**
 * A target's liveness verdict. "dead" means a definitively broken response
 * (4xx/5xx); "live" means a working 2xx/3xx; "unknown" means we have no status
 * (never snapshotted, liveness check skipped / failed) - unknown is NEVER counted
 * as broken.
 */
export type TargetLiveness = "dead" | "live" | "unknown";

export type BrokenLinkFinding = {
  sourceUrl: string;
  /** The dead targets this page links to (canonical URL + anchor text), stable
   *  order (by target URL). */
  deadTargets: ReadonlyArray<InternalLinkRef>;
  /** Plain first-person-safe sentence naming the count + the source page. */
  reason_copy: string;
  /** Operator-only structured trace. */
  evidence: string;
};

/** A source page needs at least this many dead links before it earns a card. One
 *  dead link is worth naming; the floor is 1 so a single broken link still
 *  surfaces, but the copy pluralizes honestly. */
export const BROKEN_LINK_MIN_DEAD = 1;

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return url;
  }
}

/**
 * Classify ONE source page's broken internal links. `livenessOf` returns the
 * known verdict for a target URL; a target it reports "unknown" for is skipped
 * (never guessed dead). Returns null when the page has no dead links. Dead
 * targets are de-duplicated by target URL and returned in stable URL order so
 * downstream capping + copy is reproducible. Pure.
 */
export function classifyBrokenLinks(
  page: BrokenLinkSourcePage,
  livenessOf: (targetUrl: string) => TargetLiveness,
): BrokenLinkFinding | null {
  const deadByUrl = new Map<string, InternalLinkRef>();
  for (const link of page.links) {
    if (livenessOf(link.targetUrl) !== "dead") continue;
    // First anchor text wins for a repeated target; keep it stable.
    if (!deadByUrl.has(link.targetUrl)) deadByUrl.set(link.targetUrl, link);
  }
  if (deadByUrl.size < BROKEN_LINK_MIN_DEAD) return null;

  const deadTargets = [...deadByUrl.values()].sort((a, b) =>
    a.targetUrl.localeCompare(b.targetUrl),
  );

  return {
    sourceUrl: page.sourceUrl,
    deadTargets,
    reason_copy: brokenLinksCopy(pathOf(page.sourceUrl), deadTargets.length),
    evidence:
      "broken_links source=" +
      page.sourceUrl +
      "; dead_count=" +
      String(deadTargets.length) +
      "; dead_targets=" +
      deadTargets.map((t) => t.targetUrl).join(","),
  };
}
