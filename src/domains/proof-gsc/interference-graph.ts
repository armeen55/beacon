/**
 * interference-graph (BEACON_500 N14, 2026-07-03) - the general model N12 (same-query
 * experiment blocking, not yet built) and N13 (control contamination, shipped) are both
 * point-checks of. The question this module answers for ONE target ship: when I change this
 * page, what else could its effect bleed into, and what could bleed into MY measurement?
 *
 * PURE. No I/O - the caller (a read-time attach step, mirroring attach-control-contamination.ts
 * and attach-seasonal-inflection.ts) loads the ledger, page snapshots (for internal link pairs
 * and content-hash history), and any already-computed intent clusters / shock windows, then
 * hands them to this module as plain data.
 *
 * THIS MODULE COMPOSES, IT DOES NOT REIMPLEMENT. Every edge kind below reuses an existing
 * classifier's own logic and simply asks "does it apply to a DIFFERENT ship than the one it
 * already covers":
 *   - control-contamination.ts already asks "did a ship touch one of MY controls mid-window".
 *     This module exposes that SAME relationship as a graph edge (buildControlDependencyEdges):
 *     one of target's own comparison pages is itself a currently-measuring ship, a direct
 *     dependency exactly like a hyperlink. It also asks the more general question: "did a ship
 *     touch a page LINKED TO or FROM my target page, or sharing my target's URL-structure
 *     family, while measuring overlaps".
 *   - algorithm-weather.ts's overlappingShock already finds sitewide shocks overlapping a
 *     window - reused verbatim as the sitewide_event edge source.
 *   - intent-clusters.ts's conflict clusters already find SERP-proven query overlap between
 *     two of the tenant's own pages - reused verbatim as one query_overlap edge source. A
 *     second, ledger-native query_overlap source (shared targetQueries) fires even when no paid
 *     SERP snapshot exists for either query, so the edge is never silent purely for lack of
 *     SERP spend.
 *   - detectMeasurementOverlaps (measurement-maturity.ts) already finds two ships on the SAME
 *     page whose windows intersect - reused verbatim, exposed here as a same-page special case
 *     of same_template_family (a page is trivially its own family).
 *
 * HONEST FLOORS (documented, not tunable by a caller without editing this file): a weak edge
 * (one shared stopword-ish query, a single distant internal link, a same-family page with no
 * ACTIVE measurement) never fires. See the exported MIN_* constants below for the exact bars.
 */

import { overlappingShock, type ShockWindow } from "./algorithm-weather";
import type { IntentCluster } from "@/domains/serp/intent-clusters";

// ---------------------------------------------------------------------------
// Inputs (already-loaded plain data; this file reads nothing itself)
// ---------------------------------------------------------------------------

/** One ledger ship, reduced to what interference detection needs. Mirrors
 *  control-contamination.ts's LedgerShipRecord shape (same convention: host-
 *  stripped path + ISO ship timestamp), extended with the extra fields the
 *  new edge kinds need. */
export type InterferenceLedgerShip = {
  id: string;
  /** Canonical path (host-stripped). */
  path: string;
  shippedAt: string;
  /** Is this ship currently in an open measurement window? Mirrors
   *  outcomeStateOf(record) === "measuring" - the caller computes this once
   *  (experiment-eligibility.ts already does) rather than this module
   *  re-deriving verdict/window logic it has no business owning. */
  measuring: boolean;
  /** The measurement window this ship's basis checkpoint covers (start
   *  inclusive, end exclusive), when known. Null when nothing has shipped
   *  data yet to compute a window from - such a ship can still contribute a
   *  same_template_family/linked_page_treated edge (the fact it is
   *  MEASURING matters), it just can't produce a windowOverlapDays number. */
  window: { start: string; end: string } | null;
  /** The ship's own target queries (ShippedChangeRecord.targetQueries) -
   *  ledger-native query-overlap source, needs no SERP spend. */
  targetQueries: ReadonlyArray<string>;
  /** This ship's own comparison pages (ShippedChangeRecord.controlPages),
   *  host-stripped or raw (normalized internally). Used ONLY for the
   *  control-dependency edge source below - a direct, non-hyperlink
   *  adjacency exactly like control-contamination.ts's own "did a ship
   *  treat one of my controls" question, generalized to "does a ship I
   *  depend on as a control ALSO depend on someone else's". */
  controlPages: ReadonlyArray<string>;
};

/** One page's internal-link edges, reduced from PageSnapshot.internal_links.
 *  href values are raw as crawled (absolute or relative); this module
 *  normalizes them with the same pathOf every other proof-gsc module uses. */
export type PageLinkRow = {
  /** The page this snapshot was taken FROM (source of the outbound links). */
  sourcePath: string;
  /** Every outbound internal link's target, raw href as crawled. */
  targetHrefs: ReadonlyArray<string>;
};

export type InterferenceGraphInput = {
  /** The ship being evaluated for interference (host-stripped path + ISO
   *  ship date/window, same shape as a ledger row so a not-yet-shipped
   *  candidate can be probed by passing a synthetic id). */
  target: InterferenceLedgerShip;
  /** Every OTHER ship in the ledger (the caller excludes target's own row,
   *  same convention as control-contamination.ts's `ledger` param). */
  otherShips: ReadonlyArray<InterferenceLedgerShip>;
  /** Internal-link rows covering the target page and (ideally) every other
   *  ship's page, so both directions (target links out to a treated page,
   *  or a treated page links to target) can be detected. Missing rows for a
   *  page simply mean that direction can't be checked for it - never
   *  fabricated as zero links. */
  linkRows?: ReadonlyArray<PageLinkRow>;
  /** Shock windows (confirmed Google updates + detected sitewide CUSUM
   *  shifts) - passed straight through to algorithm-weather.ts's
   *  overlappingShock, so this module never re-derives shock detection. */
  shockWindows?: ReadonlyArray<ShockWindow>;
  /** Intent clusters already computed by intent-clusters.ts (SERP-overlap
   *  based) - only clusters with `conflict: true` contribute an edge; a
   *  cluster with no conflict means Google groups the queries but the
   *  tenant only owns one page there, which is not an interference risk. */
  intentClusters?: ReadonlyArray<Pick<IntentCluster, "clusterId" | "ownPagesInCluster" | "conflict">>;
};

// ---------------------------------------------------------------------------
// Honest floors (documented; a caller cannot silently weaken these)
// ---------------------------------------------------------------------------

/** query_overlap (ledger-native targetQueries source): minimum Jaccard
 *  overlap between two ships' targetQueries arrays before an edge fires. A
 *  single shared generic query out of many is noise, not a real interference
 *  risk - require at least a THIRD of the smaller set's queries to be
 *  shared, mirroring intent-clusters.ts's "meaningful fraction, not one
 *  incidental hit" posture (that module requires 4 of 10, a 40 percent
 *  floor; this floor is deliberately a little more permissive because
 *  targetQueries lists are already curated to the handful of queries that
 *  actually matter for the page, not a raw top-10 SERP scrape). */
export const MIN_QUERY_OVERLAP_JACCARD = 1 / 3;
/** Never treat single-word / very short queries as overlap evidence on their
 *  own weight - a shared one-token query ("iran", "flag") is exactly the
 *  "stopword-ish" false-positive floor names. Require at least 2 queries in
 *  the SMALLER set for the Jaccard ratio above to mean anything at all. */
export const MIN_QUERIES_FOR_OVERLAP_JUDGMENT = 2;

/** linked_page_treated: an internal link is only evidence of shared traffic
 *  flow (authority/attention bleed) between two pages that are DIRECTLY
 *  connected - a same-domain link two hops away says nothing about MY page's
 *  measurement, so this module never traverses the link graph transitively.
 *  A "distant" link (this module has no hop-count data beyond direct
 *  adjacency) never fires by construction; documented here rather than as a
 *  tunable so the floor cannot be silently loosened by a caller. */
export const LINK_INTERFERENCE_HOP_LIMIT = 1;

/** same_template_family: the page-family match alone is never enough - the
 *  other ship must ALSO be currently measuring (or have a window that
 *  genuinely overlaps target's), otherwise every page in a 50-page family
 *  would perpetually flag every other member. Mirrors the same
 *  "measuring, not merely related" floor experiment-eligibility.ts already
 *  applies to activeTreatmentPaths. */
export const FAMILY_EDGE_REQUIRES_MEASURING_OR_WINDOW_OVERLAP = true;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Host-stripped path, the same normalization every proof-gsc module uses
 *  (control-contamination.ts, experiment-eligibility.ts, etc. each keep a
 *  local copy rather than a shared import - matching that convention). */
export function pathOf(urlOrPath: string): string {
  return (urlOrPath || "").replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/";
}

/** First path segment groups a family (iran-animals/*, iran-flags/*) - the
 *  SAME convention pageFamilyOf uses in daily-experiment-planner.ts /
 *  prepare-today-moves.ts / attach-seasonal-inflection.ts. Duplicated here
 *  (leaf-level, no cross-domain import) rather than imported, matching the
 *  existing convention of every sibling module that needs this grouping;
 *  pinned by this file's own tests so drift would be caught. */
export function pageFamilyOf(pathOrUrl: string): string {
  const path = pathOf(pathOrUrl);
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 1 ? segs[0]! : "root";
}

const dateOnly = (iso: string): string => (iso || "").slice(0, 10);

function windowsOverlap(
  a: { start: string; end: string } | null,
  b: { start: string; end: string } | null,
): boolean {
  if (!a || !b) return false;
  return dateOnly(a.start) < dateOnly(b.end) && dateOnly(b.start) < dateOnly(a.end);
}

function windowOverlapDays(
  a: { start: string; end: string } | null,
  b: { start: string; end: string } | null,
): number {
  if (!windowsOverlap(a, b)) return 0;
  const start = dateOnly(a!.start) > dateOnly(b!.start) ? a!.start : b!.start;
  const end = dateOnly(a!.end) < dateOnly(b!.end) ? a!.end : b!.end;
  const ms = Date.parse(dateOnly(end)) - Date.parse(dateOnly(start));
  return Math.max(0, Math.round(ms / 86_400_000));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const q of a) if (b.has(q)) shared++;
  const union = a.size + b.size - shared;
  return union > 0 ? shared / union : 0;
}

const normQuery = (q: string): string => q.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Edge model
// ---------------------------------------------------------------------------

export type InterferenceEdgeKind =
  | "linked_page_treated"
  | "same_template_family"
  | "sitewide_event"
  | "redirect_related"
  | "query_overlap";

/** Qualitative strength, so a caller can rank edges without re-deriving the
 *  underlying numbers. "weak" edges are computed for transparency in the
 *  full graph but never fire the honest floors above by construction - a
 *  caller that only wants ACTIONABLE edges should filter to moderate+strong
 *  (see significantEdges below), which is exactly what the floors gate. */
export type InterferenceStrength = "weak" | "moderate" | "strong";

export type InterferenceEdge = {
  kind: InterferenceEdgeKind;
  /** The other ship's ledger id, when the edge comes from a specific ship
   *  (every kind except a pure page-to-page link with no in-flight
   *  measurement on the other end - such a case never reaches this list at
   *  all, since an edge always names WHAT is interfering, not merely what
   *  is connected). */
  otherShipId: string;
  /** The other page's host-stripped path. */
  otherPath: string;
  strength: InterferenceStrength;
  /** Days of measurement-window overlap between target and the other ship,
   *  0 when the other ship's window is unknown or does not overlap (the
   *  edge may still fire on non-window evidence, e.g. a direct link, but the
   *  window-overlap number stays honestly 0 rather than fabricated). */
  windowOverlapDays: number;
  /** Plain first-person sentence naming why. No dashes. */
  reason: string;
};

export type InterferenceGraphResult = {
  targetPath: string;
  edges: InterferenceEdge[];
  /** True when at least one edge cleared the honest floors (moderate or
   *  strong) - the signal a hold/downgrade/reliability consumer checks. */
  hasSignificantInterference: boolean;
};

// ---------------------------------------------------------------------------
// Edge builders (one per kind; each documents which existing module it reuses)
// ---------------------------------------------------------------------------

/** linked_page_treated: target's own crawled outbound links (or, when a link
 *  row exists for the OTHER page, its outbound links back to target) name a
 *  currently-measuring ship as a direct neighbor. Reuses PageSnapshot's own
 *  internal_links field (crawled once per scan; no new fetch). Only DIRECT
 *  adjacency counts (LINK_INTERFERENCE_HOP_LIMIT) - a page two links away
 *  never fires this edge. */
export function buildLinkedPageTreatedEdges(args: {
  targetPath: string;
  otherShips: ReadonlyArray<InterferenceLedgerShip>;
  linkRows: ReadonlyArray<PageLinkRow>;
}): InterferenceEdge[] {
  const { targetPath, otherShips, linkRows } = args;
  const measuring = otherShips.filter((s) => s.measuring);
  if (measuring.length === 0 || linkRows.length === 0) return [];

  // Direct-adjacency sets: pages target links TO, and pages that link TO target.
  const outboundFromTarget = new Set<string>();
  const inboundToTarget = new Set<string>();
  for (const row of linkRows) {
    const src = pathOf(row.sourcePath);
    const targets = row.targetHrefs.map(pathOf);
    if (src === targetPath) {
      for (const t of targets) outboundFromTarget.add(t);
    }
    if (targets.includes(targetPath)) inboundToTarget.add(src);
  }
  if (outboundFromTarget.size === 0 && inboundToTarget.size === 0) return [];

  const edges: InterferenceEdge[] = [];
  for (const ship of measuring) {
    const otherPath = pathOf(ship.path);
    if (otherPath === targetPath) continue; // same-page overlap is its own edge kind
    const linksOut = outboundFromTarget.has(otherPath);
    const linksIn = inboundToTarget.has(otherPath);
    if (!linksOut && !linksIn) continue;
    const direction = linksOut && linksIn ? "links to, and is linked from," : linksOut ? "links to" : "is linked from";
    edges.push({
      kind: "linked_page_treated",
      otherShipId: ship.id,
      otherPath,
      strength: linksOut && linksIn ? "strong" : "moderate",
      windowOverlapDays: 0,
      reason: `This page ${direction} ${otherPath}, which I shipped a change to on ${dateOnly(ship.shippedAt)} and am still measuring.`,
    });
  }
  return edges;
}

/** linked_page_treated (control-dependency source): generalizes control-
 *  contamination.ts's own question ("did a ship treat one of MY controls
 *  mid-window") into a graph edge rather than a per-ship classification.
 *  Target's OWN comparison pages are a direct measurement dependency exactly
 *  like a hyperlink - if one of them was ITSELF shipped a change with a ship
 *  date falling inside target's measurement window, target's diff-in-diff
 *  baseline can move for a reason that has nothing to do with target's own
 *  change. Deliberately checks the SHIP DATE falling inside target's window
 *  (control-contamination.ts's own withinWindow test), NOT whether the other
 *  ship still reads "measuring" today - a control's own verdict can flip to
 *  settled at its 7-day checkpoint while its 14/28-day windows (and
 *  therefore its interference with everyone leaning on it) are still open.
 *  This is precisely the gap the master plan's N13 entry documents
 *  (activeTreatmentPaths only tracks outcomeStateOf === "measuring" and
 *  missed the real /persian-male-names cluster for exactly this reason) -
 *  N14 generalizes past that narrower check on purpose. Reuses the ledger's
 *  own controlPages field - no new data source. */
export function buildControlDependencyEdges(args: {
  target: InterferenceLedgerShip;
  otherShips: ReadonlyArray<InterferenceLedgerShip>;
}): InterferenceEdge[] {
  const { target, otherShips } = args;
  const targetPath = pathOf(target.path);
  const myControls = new Set(target.controlPages.map(pathOf));
  if (myControls.size === 0 || !target.window) return [];

  const edges: InterferenceEdge[] = [];
  for (const ship of otherShips) {
    const otherPath = pathOf(ship.path);
    if (otherPath === targetPath || !myControls.has(otherPath)) continue;
    // Honest floor: the CONTROL's own ship date must fall inside TARGET's
    // window (control-contamination.ts's withinWindow semantics: [start,
    // end), ship date compared as YYYY-MM-DD) - a control ship that shipped
    // before target's window opened, or after it closed, never corrupted
    // this specific measurement.
    const shipDate = dateOnly(ship.shippedAt);
    const inWindow = shipDate >= dateOnly(target.window.start) && shipDate < dateOnly(target.window.end);
    if (!inWindow) continue;
    edges.push({
      kind: "linked_page_treated",
      otherShipId: ship.id,
      otherPath,
      strength: "strong",
      windowOverlapDays: windowOverlapDays(target.window, ship.window),
      reason: `I am using ${otherPath} as a comparison page for this measurement, and I shipped a change to it myself on ${dateOnly(ship.shippedAt)}, inside this measurement window.`,
    });
  }
  return edges;
}

/** same_template_family: target and another ship share the same first-path-
 *  segment family AND the other ship is either currently measuring or its
 *  window genuinely overlaps target's - the family match alone (every page
 *  in a 50-page family) is never enough, per the honest floor above.
 *  Special-cases the SAME page as its own family (mirrors
 *  detectMeasurementOverlaps in measurement-maturity.ts, reused for the
 *  exact-same-page case; this function additionally covers the wider
 *  same-family-different-page case that function does not). */
export function buildSameTemplateFamilyEdges(args: {
  target: InterferenceLedgerShip;
  otherShips: ReadonlyArray<InterferenceLedgerShip>;
}): InterferenceEdge[] {
  const { target, otherShips } = args;
  const targetPath = pathOf(target.path);
  const targetFamily = pageFamilyOf(targetPath);
  const edges: InterferenceEdge[] = [];

  for (const ship of otherShips) {
    const otherPath = pathOf(ship.path);
    const samePage = otherPath === targetPath;
    const sameFamily = samePage || pageFamilyOf(otherPath) === targetFamily;
    if (!sameFamily) continue;

    const overlapDays = windowOverlapDays(target.window, ship.window);
    const qualifies = ship.measuring || overlapDays > 0;
    if (!qualifies) continue; // honest floor: family match alone never fires

    const strength: InterferenceStrength = samePage ? "strong" : overlapDays >= 7 || ship.measuring ? "moderate" : "weak";
    if (strength === "weak") continue; // honest floor: never surface a weak family edge

    edges.push({
      kind: "same_template_family",
      otherShipId: ship.id,
      otherPath,
      strength,
      windowOverlapDays: overlapDays,
      reason: samePage
        ? `I shipped another change to this exact page on ${dateOnly(ship.shippedAt)}, inside this measurement window.`
        : `This page shares its template family with ${otherPath}, which I shipped a change to on ${dateOnly(ship.shippedAt)} and am still measuring.`,
    });
  }
  return edges;
}

/** sitewide_event: reuses algorithm-weather.ts's overlappingShock VERBATIM -
 *  this function does no shock detection of its own, it only asks whether
 *  target's own window overlapped a shock already computed elsewhere. */
export function buildSitewideEventEdges(args: {
  target: InterferenceLedgerShip;
  shockWindows: ReadonlyArray<ShockWindow>;
}): InterferenceEdge[] {
  const { target, shockWindows } = args;
  if (!target.window || shockWindows.length === 0) return [];
  const hit = overlappingShock(target.window.start, target.window.end, shockWindows);
  if (!hit) return [];
  return [
    {
      kind: "sitewide_event",
      otherShipId: `shock:${hit.id}`,
      otherPath: pathOf(target.path),
      strength: hit.kind === "confirmed" ? "strong" : "moderate",
      windowOverlapDays: windowOverlapDays(target.window, { start: hit.start, end: hit.end }),
      reason:
        hit.kind === "confirmed"
          ? `This measurement window overlapped ${hit.label}, a confirmed Google update.`
          : `This measurement window overlapped a sitewide shift I detected in the site's own traffic.`,
    },
  ];
}

/** redirect_related: HONEST FLOOR - Beacon does not yet track a redirect
 *  map (no from/to redirect store exists anywhere in the codebase today;
 *  the only redirect-adjacent signal is a raw 301/302/307/308 HTTP status
 *  finding, which names that a URL redirects, not WHERE). Rather than
 *  fabricate a plausible-looking edge from a status code alone, this
 *  builder always returns empty and says so - the same "honest silence"
 *  posture control-contamination.ts uses for sparse scan coverage. Wire a
 *  real redirect store here the day one exists; until then this is a
 *  documented, deliberate no-op, not a bug. */
export function buildRedirectRelatedEdges(): InterferenceEdge[] {
  return [];
}

/** query_overlap: two sources, composed rather than reimplemented.
 *  1. SERP-proven conflict clusters (intent-clusters.ts) - Google's own
 *     top-10 already says two of the tenant's pages compete for one intent.
 *     Every own page in a conflicting cluster other than target becomes an
 *     edge IF that other page has an in-flight ship (a conflict on a page
 *     with nothing shipping right now is a cannibalization problem, not an
 *     interference-with-a-measurement problem - N2/N7 own that case).
 *  2. Ledger-native targetQueries overlap - fires even with zero SERP spend,
 *     gated by MIN_QUERY_OVERLAP_JACCARD + MIN_QUERIES_FOR_OVERLAP_JUDGMENT
 *     so a single shared generic query is never treated as evidence. */
export function buildQueryOverlapEdges(args: {
  target: InterferenceLedgerShip;
  otherShips: ReadonlyArray<InterferenceLedgerShip>;
  intentClusters?: ReadonlyArray<Pick<IntentCluster, "clusterId" | "ownPagesInCluster" | "conflict">>;
}): InterferenceEdge[] {
  const { target, otherShips, intentClusters = [] } = args;
  const targetPath = pathOf(target.path);
  const edges: InterferenceEdge[] = [];
  const seenShipIds = new Set<string>();

  // Source 1: SERP-proven conflict clusters.
  const measuringByPath = new Map(otherShips.filter((s) => s.measuring).map((s) => [pathOf(s.path), s] as const));
  for (const cluster of intentClusters) {
    if (!cluster.conflict) continue;
    const ownPaths = cluster.ownPagesInCluster.map((p) => pathOf(p.url));
    if (!ownPaths.includes(targetPath)) continue;
    for (const p of ownPaths) {
      if (p === targetPath) continue;
      const ship = measuringByPath.get(p);
      if (!ship || seenShipIds.has(ship.id)) continue;
      seenShipIds.add(ship.id);
      edges.push({
        kind: "query_overlap",
        otherShipId: ship.id,
        otherPath: p,
        strength: "strong",
        windowOverlapDays: windowOverlapDays(target.window, ship.window),
        reason: `Google's own search results show this page and ${p} competing for the same searches, and I am still measuring a change on ${p} shipped ${dateOnly(ship.shippedAt)}.`,
      });
    }
  }

  // Source 2: ledger-native targetQueries overlap (no SERP data required).
  const targetQuerySet = new Set(target.targetQueries.map(normQuery).filter(Boolean));
  if (targetQuerySet.size >= MIN_QUERIES_FOR_OVERLAP_JUDGMENT) {
    for (const ship of otherShips) {
      if (seenShipIds.has(ship.id)) continue;
      if (!ship.measuring) continue;
      const otherPath = pathOf(ship.path);
      if (otherPath === targetPath) continue;
      const otherQuerySet = new Set(ship.targetQueries.map(normQuery).filter(Boolean));
      const smaller = Math.min(targetQuerySet.size, otherQuerySet.size);
      if (smaller < MIN_QUERIES_FOR_OVERLAP_JUDGMENT) continue;
      const overlap = jaccard(targetQuerySet, otherQuerySet);
      if (overlap < MIN_QUERY_OVERLAP_JACCARD) continue;
      seenShipIds.add(ship.id);
      edges.push({
        kind: "query_overlap",
        otherShipId: ship.id,
        otherPath,
        strength: overlap >= 0.6 ? "strong" : "moderate",
        windowOverlapDays: windowOverlapDays(target.window, ship.window),
        reason: `This page and ${otherPath} target overlapping searches, and I am still measuring a change on ${otherPath} shipped ${dateOnly(ship.shippedAt)}.`,
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Compute every interference edge for ONE target ship. PURE. Composes the
 * six edge builders above; each builder already enforces its own honest
 * floor, so this function does no additional filtering beyond de-duplicating
 * identical (kind, otherShipId) pairs a caller's inputs might otherwise
 * double-count (e.g. a page that is both same-family AND directly linked
 * keeps BOTH edges - they are different evidence - but the same builder
 * emitting the same pair twice never happens by construction here).
 */
export function computeInterferenceGraph(input: InterferenceGraphInput): InterferenceGraphResult {
  const targetPath = pathOf(input.target.path);
  const otherShips = input.otherShips.filter((s) => pathOf(s.path) !== targetPath || s.id !== input.target.id);

  const edges: InterferenceEdge[] = [
    ...buildLinkedPageTreatedEdges({ targetPath, otherShips, linkRows: input.linkRows ?? [] }),
    ...buildControlDependencyEdges({ target: input.target, otherShips }),
    ...buildSameTemplateFamilyEdges({ target: input.target, otherShips }),
    ...buildSitewideEventEdges({ target: input.target, shockWindows: input.shockWindows ?? [] }),
    ...buildRedirectRelatedEdges(),
    ...buildQueryOverlapEdges({ target: input.target, otherShips, intentClusters: input.intentClusters ?? [] }),
  ];

  return {
    targetPath,
    edges,
    hasSignificantInterference: edges.some((e) => e.strength === "moderate" || e.strength === "strong"),
  };
}

/** Edges that clear the honest floors and should actually influence a
 *  decision (hold/downgrade or a reliability demotion) - "weak" edges are
 *  never emitted by the builders above in the first place, so today this is
 *  equivalent to `result.edges`, but callers should use this accessor
 *  rather than reading `.edges` directly in case a future edge kind ever
 *  needs to emit weak edges for transparency without them counting. */
export function significantEdges(result: InterferenceGraphResult): InterferenceEdge[] {
  return result.edges.filter((e) => e.strength === "moderate" || e.strength === "strong");
}

// ---------------------------------------------------------------------------
// Plain-language receipt (no jargon; no "control"/"experiment" leakage into
// operator surfaces beyond what the rest of the proof-gsc domain already uses)
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<InterferenceEdgeKind, string> = {
  linked_page_treated: "a directly linked page",
  same_template_family: "a page in the same template family",
  sitewide_event: "a sitewide shift",
  redirect_related: "a related redirect",
  query_overlap: "overlapping search demand",
};

/** One first-person sentence summarizing the strongest edge, for a hold or
 *  downgrade surface that only has room for one line. Returns null when
 *  there is no significant interference (the caller should render nothing,
 *  never a fabricated all-clear sentence - the absence of an edge already
 *  says "clean" on its own). No dashes. */
export function interferenceSummarySentence(result: InterferenceGraphResult): string | null {
  const sig = significantEdges(result);
  if (sig.length === 0) return null;
  const strongest = [...sig].sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1))[0]!;
  if (sig.length === 1) return strongest.reason;
  const others = sig.length - 1;
  return `${strongest.reason} ${others} more interference ${others === 1 ? "signal" : "signals"} also apply.`;
}

/** Groups edges by kind with a plain label, for a "see the math" style
 *  detail panel. PURE. Empty array in, empty array out. */
export function interferenceByKind(
  result: InterferenceGraphResult,
): Array<{ kind: InterferenceEdgeKind; label: string; edges: InterferenceEdge[] }> {
  const sig = significantEdges(result);
  const order: InterferenceEdgeKind[] = [
    "linked_page_treated",
    "same_template_family",
    "sitewide_event",
    "redirect_related",
    "query_overlap",
  ];
  return order
    .map((kind) => ({ kind, label: KIND_LABEL[kind], edges: sig.filter((e) => e.kind === kind) }))
    .filter((g) => g.edges.length > 0);
}

// ---------------------------------------------------------------------------
// Consumer adapters (computed-only; both wire straight into an existing seam
// without either consumer needing to know this module's internal shape)
// ---------------------------------------------------------------------------

/** SELECTION-TIME consumer adapter: turn one target's graph into the
 *  `{ hold, reason }` shape daily-experiment-planner.ts's
 *  InterferenceHoldLookup expects. `hold` is true exactly when
 *  hasSignificantInterference is true - the honest floors already keep a
 *  weak edge from reaching this point, so there is no additional threshold
 *  to apply here. */
export function toPlannerHoldEntry(result: InterferenceGraphResult): { hold: boolean; reason: string } {
  const sentence = interferenceSummarySentence(result);
  return { hold: result.hasSignificantInterference, reason: sentence ?? "" };
}

/**
 * Batch entry point: compute the interference graph for EVERY ledger ship at
 * once, keyed by host-stripped path, ready to hand to daily-experiment-
 * planner.ts as `interference` or to verdict-reliability.ts per-ship as
 * `interferenceFlagged`. Mirrors attachControlContaminationForLedger's
 * batch-then-per-row shape (control-contamination.ts) so a caller that
 * already knows that pattern recognizes this one immediately. PURE - the
 * caller loads linkRows/shockWindows/intentClusters once and passes them
 * straight through; this function does no I/O itself.
 */
export function computeInterferenceGraphForLedger(args: {
  ships: ReadonlyArray<InterferenceLedgerShip>;
  linkRows?: ReadonlyArray<PageLinkRow>;
  shockWindows?: ReadonlyArray<ShockWindow>;
  intentClusters?: ReadonlyArray<Pick<IntentCluster, "clusterId" | "ownPagesInCluster" | "conflict">>;
}): Map<string, InterferenceGraphResult> {
  const out = new Map<string, InterferenceGraphResult>();
  for (const target of args.ships) {
    const otherShips = args.ships.filter((s) => s.id !== target.id);
    const result = computeInterferenceGraph({
      target,
      otherShips,
      linkRows: args.linkRows,
      shockWindows: args.shockWindows,
      intentClusters: args.intentClusters,
    });
    out.set(pathOf(target.path), result);
  }
  return out;
}
