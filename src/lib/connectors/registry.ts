/**
 * connector registry (2026-07-20) - THE one canonical description of Beacon's
 * LIVE data connectors. Before this module, every connector's name, label, SLA,
 * capability copy, freshness mapping, and customer wording was copied into at
 * least eight modules (connector-store unions, CONNECTOR_CAPABILITY, the Data
 * Health CONNECTION_SOURCES, SOURCE_SLA, the team TEAMMATE_PROVIDER map, the
 * data-sources strip arrays, the connectors-client per-card blocks, the activity
 * labels). Duplicated arrays drift: the certified leak was "4 of 4 connected"
 * rendering while GA4 ingestion was broken, with a subline that undercounted the
 * impaired sources. One record per connector, read everywhere, so the same fact
 * can never disagree with itself again.
 *
 * SCOPE: this registry lists the THREE live connectors only, and every one of them
 * READS. The stored-row provider union in connector-store (google_gbp, yelp,
 * callrail, wix, ...) is deliberately WIDER, and holds ONLY so historical token rows
 * still decode: the server-side code behind those sources was deleted, not hidden.
 * "Live" = shows a connect card, is counted in the health rollup, and feeds a
 * real surface.
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

/** Plain-English "what does this connection actually DO?" clarity copy. */
type ConnectorCapabilityCopy = {
  /** "What Beacon does automatically with this". */
  automated: string;
  /** "What you need to do". */
  youDo: string;
};

/** What a connector can DO for Beacon - the honest capability contract. Every live
 *  connector READS; Beacon publishes nowhere, so `publishes` is false on all of them. */
type ConnectorCapabilities = {
  /** Beacon pulls data FROM this source (GSC, GA4, Clarity). */
  readsData: boolean;
  /** Beacon publishes approved changes TO this source. No live connector does. */
  publishes: boolean;
};

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

/** The Data Health surface's distinct customer wording for one connector. */
type ConnectorDataHealthCopy = {
  /** Label used on the operator Data Health surface (a deliberately different,
   *  outcome-first scheme, e.g. "Website visitors" for GA4). */
  label: string;
  /** What this source TELLS us (the input). */
  role: string;
  /** What it UNLOCKS in Beacon (the output). */
  unlocks: string;
  /** What's blocked while it's not connected. */
  blockedWhenMissing: string;
};

type ConnectorRegistryEntry = {
  /** connector-store provider key + stored-row key. */
  id: LiveConnectorId;
  /** Freshness/SLA key. */
  sourceKey: SourceKey;
  /** Teammate identity key (domains/team/identity) for the color dot. */
  teammateKey: string;
  /** The connectors-page card anchor (deep-linked as #connector-<anchor>). */
  cardAnchor: string;
  /** Primary customer label (connect card + Today strip). */
  label: string;
  /** Label variant for the activity feed's connection events. Defaults to
   *  `label` when the surface uses the same wording. */
  activityLabel: string;
  /** Short label used in the team-standup freshness sentences. */
  freshnessLabel: string;
  /** One-line "what it feeds/does", in plain English. */
  summary: string;
  capabilities: ConnectorCapabilities;
  /** True only for sources that need a per-source selection before ANY data can
   *  flow (GA4 pulls zero rows until the operator picks a property). */
  requiresPropertySelection: boolean;
  capabilityCopy: ConnectorCapabilityCopy;
  dataHealth: ConnectorDataHealthCopy;
  sla: ConnectorSla;
};

// HONESTY (crons-off pivot): Beacon runs on-demand - every refresh of your
// connected data is what triggers the read + analysis. There is NO nightly /
// scheduled run, so capability copy says "each time you refresh your connected
// data", never "every night" / "nightly" / "runs on its own".
export const CONNECTOR_REGISTRY: readonly ConnectorRegistryEntry[] = [
  {
    id: "google_gsc",
    sourceKey: "gsc",
    teammateKey: "gsc",
    cardAnchor: "google-gsc",
    label: "Google Search Console",
    activityLabel: "Google Search Console",
    freshnessLabel: "Search Console",
    summary: "Feeds what people search to find you. Strongly recommended, and never required to use Beacon.",
    capabilities: { readsData: true, publishes: false },
    requiresPropertySelection: false,
    capabilityCopy: {
      automated:
        "Each time you refresh your connected data, Beacon reads your real Google numbers, which pages show up, what people search to find you, how often they click, and where you rank, and turns the weak spots into specific fixes (rewrite this title, refresh this fading page, you're one step from page one on this search).",
      youDo:
        "Click Connect once and approve Google's read-only access. Your site just needs to already be set up in Google Search Console. That's it. Beacon never changes anything in Google, it only reads.",
    },
    dataHealth: {
      label: "Google Search",
      role: "what people search to find you, and where you rank on Google",
      unlocks: "pages losing clicks, pages slipping, and what to fix first",
      blockedWhenMissing: "almost everything Beacon does",
    },
    sla: { slaMaxDataAgeDays: 3, required: true, removed: false },
  },
  {
    id: "google_ga4",
    sourceKey: "ga4",
    teammateKey: "ga4",
    cardAnchor: "google-ga4",
    label: "Google Analytics 4",
    activityLabel: "Google Analytics",
    freshnessLabel: "Google Analytics",
    summary: "Feeds which pages bring in visitors.",
    capabilities: { readsData: true, publishes: false },
    requiresPropertySelection: true,
    capabilityCopy: {
      automated:
        "When you refresh your connected data, Beacon checks your website analytics to see which pages bring in the most visitors and turn them into customers, then focuses its to-do list on improving the pages that matter most to your bottom line.",
      youDo:
        "Sign in with the Google account that has your Analytics, then pick your website from the list. After that, every refresh reads your numbers, and Beacon can never change anything in your Analytics.",
    },
    dataHealth: {
      label: "Website visitors",
      role: "which pages get the most visitors and sign-ups",
      unlocks: "focusing on the pages that actually make you money",
      blockedWhenMissing: "knowing which pages matter most to your business",
    },
    // GA4's cross-page session sum is a false total (Wave 1 P1), so it is a
    // removed source: excluded from the data-freshness tally.
    sla: { slaMaxDataAgeDays: null, required: false, removed: true },
  },
  {
    id: "clarity",
    sourceKey: "clarity",
    teammateKey: "clarity",
    cardAnchor: "clarity",
    label: "Microsoft Clarity",
    activityLabel: "Microsoft Clarity",
    freshnessLabel: "Visitor behavior data",
    summary: "Feeds where visitors get stuck on a page.",
    capabilities: { readsData: true, publishes: false },
    requiresPropertySelection: false,
    capabilityCopy: {
      automated:
        "Beacon checks where visitors get stuck on your pages, errors that break the page, spots people click that don't work, and how far they scroll, and turns the worst ones into fix-it suggestions, each time you refresh your connected data.",
      youDo:
        "One-time setup: in Microsoft Clarity, go to Settings then Data Export, click 'Generate new API token', then paste that token into Beacon's Clarity connection. (You'll need to be an admin on the Clarity project.) After that, Beacon reads it on each refresh, and it never changes anything in Clarity.",
    },
    dataHealth: {
      label: "Visitor behavior (Clarity)",
      role: "where visitors get stuck or frustrated on your pages",
      unlocks: "spots where visitors get frustrated or click things that do nothing",
      blockedWhenMissing: "knowing where visitors get stuck",
    },
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

/** Registry entry by connector-store provider id (undefined for a legacy/
 *  non-live provider such as yelp/callrail/google_gbp). */
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
