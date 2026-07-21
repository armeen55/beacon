import "server-only";

import {
  getConnectorInfo,
  type ConnectorProvider,
  type ConnectorInfo,
} from "@/lib/connector-store";
import { isDataForSeoConfigured } from "@/domains/serp/dataforseo-serp";
import { log } from "@/lib/logger";

/** Sources shown on the Data Health surface. DataForSEO is env-based (not a token
 *  connector), so it's not a ConnectorProvider — widen the key here. */
type HealthKey = ConnectorProvider | "dataforseo";

export type ConnectionSeverity =
  | "healthy"
  | "stale"
  | "needs_setup"
  | "disconnected"
  // A connector-store READ failed this visit (transient), so we genuinely do
  // not know the state. Never the same as a positively-absent token. Renders
  // honest "I could not check just now" copy, never "not connected".
  | "unknown";

export type ConnectionHealth = {
  key: HealthKey;
  label: string;
  /** What this source TELLS us (the input). */
  role: string;
  /** What it UNLOCKS in Beacon (the output). */
  unlocks: string;
  /** What's blocked while it's not connected. */
  blockedWhenMissing: string;
  connected: boolean;
  lastSyncedAt: string | null;
  daysStale: number | null;
  severity: ConnectionSeverity;
  /** Short human status line. */
  note: string;
};

type SourceMeta = {
  key: HealthKey;
  label: string;
  role: string;
  unlocks: string;
  blockedWhenMissing: string;
};

/** The source registry for the operator Data Health surface. */
export const CONNECTION_SOURCES: readonly SourceMeta[] = [
  { key: "google_gsc", label: "Google Search", role: "what people search to find you, and where you rank on Google", unlocks: "pages losing clicks, pages slipping, and what to fix first", blockedWhenMissing: "almost everything Beacon does" },
  { key: "google_ga4", label: "Website visitors", role: "which pages get the most visitors and sign-ups", unlocks: "focusing on the pages that actually make you money", blockedWhenMissing: "knowing which pages matter most to your business" },
  { key: "dataforseo", label: "Search market (DataForSEO)", role: "live Google SERP results + search volume to validate which pages can win", unlocks: "BUILD/WAIT/SKIP verdicts on new pages, real search volume, and who actually ranks", blockedWhenMissing: "outside-market SERP validation" },
  { key: "clarity", label: "Visitor behavior (Clarity)", role: "where visitors get stuck or frustrated on your pages", unlocks: "spots where visitors get frustrated or click things that do nothing", blockedWhenMissing: "knowing where visitors get stuck" },
  { key: "wix", label: "Your website (Wix)", role: "your live website content and SEO settings (read only, not analytics)", unlocks: "reading your current pages and publishing changes you approve", blockedWhenMissing: "one-click publishing (you can still copy and paste changes yourself)" },
] as const;

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** Pure: classify one connector's health from its info. Testable without I/O. */
export function deriveConnectionHealth(
  meta: SourceMeta,
  info: ConnectorInfo | null,
  now: Date = new Date(),
): ConnectionHealth {
  const connected = info?.status === "connected";
  const lastSyncedAt = info?.last_synced_at ?? null;
  const daysStale = daysSince(lastSyncedAt, now);

  let severity: ConnectionSeverity;
  let note: string;
  if (!connected) {
    severity = "disconnected";
    note = "Not connected";
  } else if (meta.key === "wix") {
    // Wix is a publish-only TARGET, not a data feed — it never records a
    // last_synced_at, so the "no successful sync yet" branch would leave a
    // correctly-connected Wix stuck amber forever. Connected = healthy here.
    severity = "healthy";
    note = "Connected (publish target, no sync feed)";
  } else if (daysStale == null) {
    severity = "needs_setup";
    note = "Connected, no successful sync yet";
  } else if (daysStale > 3) {
    severity = "stale";
    note = `Last synced ${daysStale} days ago`;
  } else {
    severity = "healthy";
    note = daysStale <= 0 ? "Fresh (synced today)" : `Fresh (${daysStale}d ago)`;
  }

  return {
    key: meta.key,
    label: meta.label,
    role: meta.role,
    unlocks: meta.unlocks,
    blockedWhenMissing: meta.blockedWhenMissing,
    connected,
    lastSyncedAt,
    daysStale,
    severity,
    note,
  };
}

/** The honest health for a source whose connector read FAILED this visit. We do
 *  not know the state, so we say exactly that and promise a retry - never that it
 *  is disconnected. */
export function unknownConnectionHealth(meta: SourceMeta): ConnectionHealth {
  return {
    key: meta.key,
    label: meta.label,
    role: meta.role,
    unlocks: meta.unlocks,
    blockedWhenMissing: meta.blockedWhenMissing,
    connected: false,
    lastSyncedAt: null,
    daysStale: null,
    severity: "unknown",
    note: "I could not check this connection just now. Nothing changed. I will retry on your next visit.",
  };
}

/** Load per-source connection health for a tenant. Fail-soft per source. */
export async function loadConnectionHealth(
  tenantId: string,
  now: Date = new Date(),
): Promise<ConnectionHealth[]> {
  return Promise.all(
    CONNECTION_SOURCES.map(async (meta) => {
      // DataForSEO is env-based (DATAFORSEO_AUTH_B64 / LOGIN), not a token
      // connector — derive its status from whether credentials are configured.
      if (meta.key === "dataforseo") {
        const configured = isDataForSeoConfigured();
        return {
          key: meta.key,
          label: meta.label,
          role: meta.role,
          unlocks: meta.unlocks,
          blockedWhenMissing: meta.blockedWhenMissing,
          connected: configured,
          lastSyncedAt: null,
          daysStale: null,
          severity: (configured ? "healthy" : "disconnected") as ConnectionSeverity,
          note: configured ? "Connected. Live SERP validation ready" : "Not connected",
        };
      }
      // A transient connector-store read failure must NEVER be reported as
      // "not connected" - that is indistinguishable from a genuinely absent
      // token and once made /results tell a live, freshly-authorized operator
      // their Search Console was disconnected. On a read failure we return the
      // honest "unknown" state (we could not check just now), log it, and only
      // ever say "disconnected" from a POSITIVE absence of a token.
      try {
        const info = await getConnectorInfo(meta.key, tenantId);
        return deriveConnectionHealth(meta, info, now);
      } catch (err) {
        log.warn("connection-health: connector read failed; state unknown this visit", {
          tenant: tenantId,
          store: "connectors",
          source: meta.key,
          error: err instanceof Error ? err.message : String(err),
        });
        return unknownConnectionHealth(meta);
      }
    }),
  );
}
