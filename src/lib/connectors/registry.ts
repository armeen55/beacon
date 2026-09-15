/**
 * connector registry (2026-07-20) - THE one canonical description of Beacon's
 * LIVE data connectors. Before this module, every connector's name, label, SLA
 * and customer wording was copied into many modules, and duplicated arrays
 * drift: the certified leak was "4 of 4 connected" rendering while GA4
 * ingestion was broken. One record per connector, read everywhere, so the same
 * fact can never disagree with itself again. Only fields with a reader live
 * here (2026-09-14 pruned capability copy, data-health copy, activity and
 * freshness labels, teammate keys and card anchors, none of which any surface
 * read).
 *
 * SCOPE: this registry lists the THREE live connectors only, and every one of them
 * READS. The stored-row provider union in connector-store keeps google_gbp ONLY
 * so a retired token row still decodes and deletes. "Live" = shows a connect
 * card, is counted in the health rollup, and feeds a real surface.
 *
 * PURE + isomorphic: no `server-only`, no I/O, no React. Safe to import from
 * server components, client components, and vitest alike.
 */

// The connector-store provider key for a live connector. A strict subset of the
// wider ConnectorProvider union in connector-store (which keeps legacy keys for
// stored-row compatibility). Kept as its own type so pure/client callers never
// have to import the server-only connector-store.
export type LiveConnectorId = "google_gsc" | "google_ga4" | "clarity";

// The freshness/SLA key (the data-age SLA table + the strip's freshness verdict
// speak this shorter dialect). One connector, two keys: `id` names the token row,
// `sourceKey` names the freshness source.
export type SourceKey = "gsc" | "ga4" | "clarity";

/** Per-source DATA-age SLA (the data-freshness verdict reads this). */
export type ConnectorSla = {
  /** Max acceptable DATA age in days; null when the source has no data SLA. */
  slaMaxDataAgeDays: number | null;
  /** Required sources must all be inside their SLA for overall health. */
  required: boolean;
  /** Removed sources (ga4 - the cross-page session sum is a false total) are
   *  excluded from the tally entirely. */
  removed: boolean;
};

type ConnectorRegistryEntry = {
  /** connector-store provider key + stored-row key. */
  id: LiveConnectorId;
  /** Freshness/SLA key. */
  sourceKey: SourceKey;
  /** Primary customer label (connect card + Today strip). */
  label: string;
  /** One-line "what it feeds/does", in plain English. */
  summary: string;
  /** True only for sources that need a per-source selection before ANY data can
   *  flow (GA4 pulls zero rows until the operator picks a property). */
  requiresPropertySelection: boolean;
  sla: ConnectorSla;
};

// CADENCE, one sentence everywhere: research and every connected source run on
// their own schedule every day; a signed-in visit only resumes a day that was
// missed. Copy never says "no scheduled run" or "runs only when you visit".
export const CONNECTOR_REGISTRY: readonly ConnectorRegistryEntry[] = [
  {
    id: "google_gsc",
    sourceKey: "gsc",
    label: "Google Search Console",
    summary: "Feeds what people search to find you. Strongly recommended, and never required to use Beacon.",
    requiresPropertySelection: false,
    sla: { slaMaxDataAgeDays: 3, required: true, removed: false },
  },
  {
    id: "google_ga4",
    sourceKey: "ga4",
    label: "Google Analytics 4",
    summary: "Feeds which pages bring in visitors.",
    requiresPropertySelection: true,
    // GA4's cross-page session sum is a false total (Wave 1 P1), so it is a
    // removed source: excluded from the data-freshness tally.
    sla: { slaMaxDataAgeDays: null, required: false, removed: true },
  },
  {
    id: "clarity",
    sourceKey: "clarity",
    label: "Microsoft Clarity",
    summary: "Feeds where visitors get stuck on a page.",
    requiresPropertySelection: false,
    sla: { slaMaxDataAgeDays: 7, required: true, removed: false },
  },
] as const;

/**
 * THE ONE could-not-check sentence, shared by every surface that can fail to
 * READ a connection (the health rollup, the connector card, the GSC readiness
 * line). A check that failed is NOT a disconnection: nothing about the grant
 * moved, so the screen must never answer it with "Not connected" or a Connect
 * button. Isomorphic, so the server composes it and the client renders it.
 */
export const COULD_NOT_CHECK =
  "Could not check just now. The connection is unchanged. Reload to check again.";

/** Registry entry by connector-store provider id (undefined for the retired google_gbp key). */
export function connectorById(id: string): ConnectorRegistryEntry | undefined {
  return CONNECTOR_REGISTRY.find((c) => c.id === id);
}

// ─────────────────────────────────────────────────────────────────────────
// Honest health rollup - the ONE place the connectors headline + subline count
// impaired sources, so they can never disagree (the certified "4 of 4 connected"
// leak that hid a broken GA4 ingest).
// ─────────────────────────────────────────────────────────────────────────

/** Per-connector health fact the rollup consumes. Both flags are derived by the
 *  caller from the SAME connector state the cards render, never re-detected here. */
export type ConnectorRollupFact = {
  id: LiveConnectorId;
  /** A token row exists and is not soft-disconnected. */
  connected: boolean;
  /** Connected BUT provably not delivering: GA4 ingest failures, never-synced,
   *  long-stale, a dead grant. Only meaningful when `connected` is true. */
  needsAttention: boolean;
  /** The CHECK itself failed (the token store could not be read), so this
   *  source's state is unknown. It is neither connected nor disconnected here:
   *  a smaller count would be a claim nothing can back. */
  unknown?: boolean;
};

export type ConnectorRollup = {
  /** Total live connectors (the registry length). */
  total: number;
  /** How many hold a live (non-disconnected) token. */
  connectedCount: number;
  /** How many of the connected ones are impaired (see ConnectorRollupFact). */
  needsAttentionCount: number;
  /** How many could not be checked at all. Counted separately so a failed read
   *  never shrinks the connected number and never reads as a disconnection. */
  unknownCount: number;
  /** The headline: e.g. "3 of 3 connected, 2 need attention" (or just
   *  "3 of 3 connected" when none are impaired). */
  headline: string;
  /** The subline, in Beacon voice, that never undercounts the impaired sources. */
  subline: string;
};

/**
 * Roll up per-connector facts into ONE honest count + copy. connected-but-failing
 * and authorized-but-blocked both count as "needs attention" - a connected token
 * alone is never enough to call a source healthy. PURE, deterministic; no dashes.
 */
export function rollupConnectors(
  facts: ReadonlyArray<ConnectorRollupFact>,
): ConnectorRollup {
  const total = CONNECTOR_REGISTRY.length;
  const connectedCount = facts.filter((f) => f.connected).length;
  const needsAttentionCount = facts.filter(
    (f) => f.connected && f.needsAttention,
  ).length;
  const unknownCount = facts.filter((f) => f.unknown === true).length;

  // Noun plural ("source" -> "sources") gets an "s" for >1; the VERB "need"
  // inverts ("2 need", but "1 needs"), so it gets an "s" only when singular.
  const nounS = (n: number) => (n === 1 ? "" : "s");
  const verbS = (n: number) => (n === 1 ? "s" : "");
  const bits = [`${connectedCount} of ${total} connected`];
  if (needsAttentionCount > 0)
    bits.push(`${needsAttentionCount} need${verbS(needsAttentionCount)} attention`);
  // A source that could not be read is stated, never subtracted in silence.
  if (unknownCount > 0) bits.push(`${unknownCount} could not be checked`);
  const headline = bits.join(", ");

  let subline: string;
  if (unknownCount > 0 && needsAttentionCount === 0) {
    subline = `${unknownCount} source${nounS(unknownCount)} could not be checked just now. Nothing about ${unknownCount === 1 ? "it" : "them"} changed. Reload to check again.`;
  } else if (needsAttentionCount > 0) {
    subline = `${needsAttentionCount} connected source${nounS(needsAttentionCount)} ${needsAttentionCount === 1 ? "is" : "are"} not delivering data yet. Open the flagged cards below to fix ${needsAttentionCount === 1 ? "it" : "them"}.${unknownCount > 0 ? ` ${unknownCount} other source${nounS(unknownCount)} could not be checked just now, and nothing about ${unknownCount === 1 ? "it" : "them"} changed.` : ""}`;
  } else if (connectedCount === 0) {
    subline = "Connect a source below to see what to do next.";
  } else if (connectedCount < total) {
    subline = "Everything you have connected is delivering data. Connect the rest to unlock more.";
  } else {
    subline = "Everything is connected and delivering data.";
  }

  return { total, connectedCount, needsAttentionCount, unknownCount, headline, subline };
}
