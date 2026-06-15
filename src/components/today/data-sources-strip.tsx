import Link from "next/link";

import {
  getConnectorInfo,
  type ConnectorInfo,
  type ConnectorProvider,
} from "@/lib/connector-store";

/**
 * "Your data sources" quick-connect strip (2026-06-15).
 *
 * A compact, always-useful affordance on the Today command center so the
 * owner can see — at a glance — which sources are connected and connect a
 * missing one in ONE click, without hunting for the operator connectors
 * page.
 *
 * Reuse contract (no new OAuth flow):
 *   - Connection status comes from `getConnectorInfo(provider, tenantId)`.
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
  connected: boolean;
  lastSynced: string | null;
};

/**
 * Read every source's status in parallel, fail-soft per provider. A read
 * error → treated as not-connected (shows a Connect link) so the strip never
 * blocks the command-center render.
 */
async function readStatuses(tenantId?: string): Promise<SourceStatus[]> {
  const now = Date.now();
  return Promise.all(
    DATA_SOURCES.map(async (source) => {
      let info: ConnectorInfo | null = null;
      try {
        info = await getConnectorInfo(source.provider, tenantId);
      } catch {
        info = null;
      }
      return {
        source,
        connected: info?.status === "connected",
        lastSynced:
          info?.status === "connected"
            ? formatLastSynced(info.last_synced_at, now)
            : null,
      };
    }),
  );
}

/**
 * Server component island. Pass the tenant id (the caller already resolves
 * `currentTenantId()` on the command-center path); omit it to let
 * `getConnectorInfo` resolve the current tenant.
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
  const allConnected = statuses.every((s) => s.connected);

  if (allConnected) {
    return (
      <section
        aria-label="Your data sources"
        className="rounded-lg border border-border/40 bg-surface-inset/10 px-4 py-2.5"
      >
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
        <Link
          href={CONNECTORS_PATH}
          className="text-[12px] text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
        >
          Manage all
        </Link>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {statuses.map(({ source, connected, lastSynced }) => (
          <li key={source.provider}>
            {connected ? (
              <span
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-status-success/40 bg-status-success/[0.06] px-3 py-2 text-[12px] text-foreground"
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
            ) : (
              <Link
                href={connectHref(source)}
                aria-label={`Connect ${source.label}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
              >
                <span>{source.label}</span>
                <span className="text-accent-primary">Connect →</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
