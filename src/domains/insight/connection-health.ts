import "server-only";

import {
  getConnectorInfo,
  type ConnectorProvider,
  type ConnectorInfo,
} from "@/lib/connector-store";

export type ConnectionSeverity =
  | "healthy"
  | "stale"
  | "needs_setup"
  | "disconnected";

export type ConnectionHealth = {
  key: ConnectorProvider;
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
  key: ConnectorProvider;
  label: string;
  role: string;
  unlocks: string;
  blockedWhenMissing: string;
};

/** The source registry for the operator Data Health surface. White-label:
 *  Profound is "AI answers", never the vendor name. */
export const CONNECTION_SOURCES: readonly SourceMeta[] = [
  { key: "google_gsc", label: "Search (Google)", role: "what people search + where you rank", unlocks: "CTR leaks, decay alerts, page priority", blockedWhenMissing: "the whole Opportunity Map + State of the Union" },
  { key: "google_ga4", label: "Visitors (Analytics)", role: "which pages get traffic + convert", unlocks: "value-weighting (prioritize pages that earn)", blockedWhenMissing: "revenue/value weighting of opportunities" },
  { key: "semrush", label: "Keywords (SEMrush)", role: "external market + competitor demand", unlocks: "page-2 striking-distance opportunities", blockedWhenMissing: "off-site keyword demand + competitor gaps" },
  { key: "clarity", label: "Visitor experience", role: "where visitors get stuck on-page", unlocks: "dead-click / rage-click friction flags", blockedWhenMissing: "UX-friction opportunities" },
  { key: "wix", label: "Publishing (Wix)", role: "your live CMS content + SEO fields (read) — not a Wix analytics feed", unlocks: "reading current page content + publishing approved changes to your live site", blockedWhenMissing: "publishing changes live (recommendations stay paste-ready)" },
  { key: "profound", label: "AI answers", role: "where AI assistants cite or ignore you", unlocks: "AEO visibility + citation tracking", blockedWhenMissing: "AI-citation visibility" },
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
  } else if (daysStale == null) {
    severity = "needs_setup";
    note = "Connected — no successful sync yet";
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

/** Load per-source connection health for a tenant. Fail-soft per source. */
export async function loadConnectionHealth(
  tenantId: string,
  now: Date = new Date(),
): Promise<ConnectionHealth[]> {
  return Promise.all(
    CONNECTION_SOURCES.map(async (meta) => {
      const info = await getConnectorInfo(meta.key, tenantId).catch(() => null);
      return deriveConnectionHealth(meta, info, now);
    }),
  );
}
