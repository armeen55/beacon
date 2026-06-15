import Link from "next/link";

import {
  getConnectorHealth,
  type ConnectorHealth,
  type ConnectorHealthInfo,
  type ConnectorProvider,
} from "@/lib/connector-store";
import { CONNECTOR_CAPABILITY } from "@/components/connectors/connector-capability-copy";
import { RefreshMyDataButton } from "@/components/today/refresh-my-data-button";

/**
 * "Your data sources" quick-connect strip (2026-06-15).
 *
 * A compact, always-useful affordance on the Today command center so the
 * owner can see — at a glance — which sources are connected and connect a
 * missing one in ONE click, without hunting for the operator connectors
 * page.
 *
 * Reuse contract (no new OAuth flow):
 *   - Connection HEALTH comes from `getConnectorHealth(provider, tenantId)` —
 *     an honest three-state derive (connected / needs_attention /
 *     not_connected). A source can be `connected` in the token store yet not
 *     actually deliver data (GA4 with no property picked; never synced; very
 *     stale). Those render a ⚠ "needs attention" treatment with a plain-
 *     English reason — NOT the success-green ✓ — so the owner is never told a
 *     broken source is fine.
 *   - The CONNECT target for every not-connected source is the existing
 *     connectors page (`/settings/connectors`). That page already owns the
 *     real connect entry points — the Google OAuth `getGoogleAuthUrl` server
 *     action behind the "Connect Google Search Console" / "Connect Google
 *     Analytics" buttons, and the paste-a-key forms for SEMrush, Profound,
 *     Clarity, and Wix. We deep-link straight to each source's card via its
 *     `data-connector-card` anchor where one exists (#connector-<id>), so the
 *     owner lands on the exact card to finish the connect in one place.
 *
 * Render contract:
 *   - When ALL six sources are connected, render a tiny "All sources
 *     connected" confirmation (never a heavy empty block).
 *   - Honest copy only: "Connected" / "Connect →". No phantom-automation
 *     claims — connecting just grants access; nothing runs on a schedule.
 *
 * This is a server component island: it reads statuses server-side and emits
 * static markup + links (no client JS needed). Status reads are fail-soft per
 * provider — a read error counts as "not connected" so the strip degrades to
 * a Connect link and never crashes the page.
 */

type DataSource = {
  provider: ConnectorProvider;
  /** Plain-English label shown to the owner. */
  label: string;
  /**
   * The connectors-page card anchor. The connectors page tags each card with
   * `data-connector-card="<id>"`; we render an invisible `id` shim there is
   * none, so we link to the page root for cards without a stable anchor
   * (Google Search Console). For cards that DO carry a `data-connector-card`,
   * deep-link to it so the owner lands on the right card.
   */
  cardAnchor: string | null;
};

/**
 * The six read/publish sources, in the order the owner most often connects
 * them. Mirrors `REAL_DATA_SOURCE_PROVIDERS` in connector-store (the set that
 * defines a "real, non-demo" tenant), so the strip's all-connected state and
 * the gate agree.
 */
const DATA_SOURCES: readonly DataSource[] = [
  { provider: "google_gsc", label: "Google Search Console", cardAnchor: null },
  { provider: "google_ga4", label: "Google Analytics 4", cardAnchor: "google-ga4" },
  { provider: "semrush", label: "SEMrush", cardAnchor: "semrush" },
  { provider: "clarity", label: "Microsoft Clarity", cardAnchor: "clarity" },
  // White-label: never surface the vendor name "Profound" on a customer
  // surface (main-product-final-confidence-sweep guards src/components/today).
  // The connectors page card is the one place it's named for key entry.
  { provider: "profound", label: "AI Answers", cardAnchor: "profound" },
  { provider: "wix", label: "Wix", cardAnchor: "wix" },
] as const;

const CONNECTORS_PATH = "/settings/connectors";

function connectHref(source: DataSource): string {
  return source.cardAnchor
    ? `${CONNECTORS_PATH}#connector-${source.cardAnchor}`
    : CONNECTORS_PATH;
}

/**
 * Customer-safe relative "last connected/synced" copy. Never decimals, never
 * negative, never provider jargon. Returns null when there's nothing useful
 * to show.
 */
function formatLastSynced(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const hours = Math.floor(Math.max(0, now - then) / (60 * 60 * 1000));
  if (hours < 1) return "synced just now";
  if (hours < 24) return `synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "synced 1 day ago";
  return `synced ${days} days ago`;
}

type SourceStatus = {
  source: DataSource;
  /** Honest three-state health (connected / needs_attention / not_connected). */
  health: ConnectorHealth;
  /** Plain-English reason for a needs_attention source; null otherwise. */
  healthReason: string | null;
  lastSynced: string | null;
};

/**
 * Read every source's health in parallel, fail-soft per provider. A read
 * error → treated as not_connected (shows a Connect link) so the strip never
 * blocks the command-center render.
 */
async function readStatuses(tenantId?: string): Promise<SourceStatus[]> {
  const now = Date.now();
  return Promise.all(
    DATA_SOURCES.map(async (source) => {
      let info: ConnectorHealthInfo | null = null;
      try {
        info = await getConnectorHealth(source.provider, tenantId, now);
      } catch {
        info = null;
      }
      const health = info?.health ?? "not_connected";
      return {
        source,
        health,
        healthReason: info?.healthReason ?? null,
        // Only show "synced X ago" on the fully-healthy state — a
        // needs_attention source carries its own reason instead, and a
        // not_connected one has no sync to report.
        lastSynced:
          health === "connected"
            ? formatLastSynced(info?.last_synced_at ?? null, now)
            : null,
      };
    }),
  );
}

/**
 * Server component island. Pass the tenant id (the caller already resolves
 * `currentTenantId()` on the command-center path); omit it to let
 * `getConnectorHealth` resolve the current tenant.
 */
export async function DataSourcesStrip({
  tenantId,
}: {
  tenantId?: string;
}) {
  const statuses = await readStatuses(tenantId);
  return <DataSourcesStripView statuses={statuses} />;
}

/**
 * Pure presentational view — split out so tests can render fixed states
 * without a Supabase round-trip.
 */
export function DataSourcesStripView({
  statuses,
}: {
  statuses: SourceStatus[];
}) {
  // All-connected collapse only when EVERY source is fully healthy — a
  // connected-but-needs-attention source keeps the full strip visible so its
  // ⚠ reason is never hidden behind a green "all good" confirmation.
  const allConnected = statuses.every((s) => s.health === "connected");
  // The READ sources a one-click refresh pulls (Wix is publish-only and never
  // counts toward what "Refresh my data" can do). Mirrors REFRESH_ALL_SOURCES
  // in settings/connectors/actions.ts. A needs_attention source still has a
  // live token, so it counts toward what a refresh will attempt.
  const connectedCount = statuses.filter(
    (s) =>
      (s.health === "connected" || s.health === "needs_attention") &&
      s.source.provider !== "wix",
  ).length;

  if (allConnected) {
    return (
      <section
        aria-label="Your data sources"
        className="rounded-lg border border-border/40 bg-surface-inset/10 px-4 py-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">
            <span aria-hidden="true">✓ </span>
            All data sources connected.{" "}
            <Link
              href={CONNECTORS_PATH}
              className="text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
            >
              Manage
            </Link>
          </p>
          <RefreshMyDataButton connectedCount={connectedCount} />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Your data sources"
      className="rounded-lg border border-border/60 bg-surface-inset/20 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[12px] font-semibold text-foreground tracking-tight">
          Your data sources
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={CONNECTORS_PATH}
            className="text-[12px] text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Manage all
          </Link>
          <RefreshMyDataButton connectedCount={connectedCount} />
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {statuses.map(({ source, health, healthReason, lastSynced }) => {
          // What Beacon does with this source, in plain English (same copy as
          // the connectors page) — surfaced as a hover tooltip + folded into
          // the accessible name so the "why connect this?" answer is right
          // here on Today, not only on the settings page.
          const automated = CONNECTOR_CAPABILITY[source.provider]?.automated;
          return (
          <li key={source.provider}>
            {health === "connected" ? (
              <span
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-status-success/40 bg-status-success/[0.06] px-3 py-2 text-[12px] text-foreground"
                title={automated}
                aria-label={`${source.label}: connected${lastSynced ? `, ${lastSynced}` : ""}`}
              >
                <span aria-hidden="true" className="text-status-success">
                  ✓
                </span>
                <span className="font-medium">{source.label}</span>
                {lastSynced ? (
                  <span className="text-muted-foreground">· {lastSynced}</span>
                ) : null}
              </span>
            ) : health === "needs_attention" ? (
              // Connected in the token store, but provably NOT delivering data
              // yet (no GA4 property picked / never synced / very stale). Honest
              // ⚠ treatment — NOT the success green ✓ — plus the actionable
              // reason and a deep-link to fix it on the connectors page. The
              // reason is the visible text AND the accessible name.
              <Link
                href={connectHref(source)}
                title={automated}
                aria-label={`${source.label}: needs attention. ${healthReason ?? ""}`.trim()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-status-warning/50 bg-status-warning/[0.08] px-3 py-2 text-[12px] text-foreground transition-colors hover:border-status-warning/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning/40"
              >
                <span aria-hidden="true" className="text-status-warning">
                  ⚠
                </span>
                <span className="font-medium">{source.label}</span>
                {healthReason ? (
                  <span className="text-muted-foreground">· {healthReason}</span>
                ) : null}
              </Link>
            ) : (
              <Link
                href={connectHref(source)}
                title={automated}
                aria-label={`Connect ${source.label}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
              >
                <span>{source.label}</span>
                <span className="text-accent-primary">Connect →</span>
              </Link>
            )}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
