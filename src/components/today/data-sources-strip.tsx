import Link from "next/link";
import { Check } from "lucide-react";
import { teammateOf } from "@/domains/team/identity";

import {
  getConnectorHealth,
  type ConnectorHealth,
  type ConnectorHealthInfo,
  type ConnectorProvider,
} from "@/lib/connector-store";
import { CONNECTOR_CAPABILITY } from "@/components/connectors/connector-capability-copy";

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
 *   - When ALL six sources are fully healthy, render a tiny confirmation
 *     (never a heavy empty block) that still names the four DISTINCT counts
 *     (Connected / Healthy / Fresh / Has data, UX4 item 3) instead of a single
 *     "all connected" claim, so this strip can never contradict a
 *     broken-pipe alert shown higher on the page.
 *   - Honest copy only: "Connected" / "Connect →". No phantom-automation
 *     claims — connecting just grants access; nothing runs on a schedule.
 *   - The one-click refresh control lives in the PAGE HEADER (UX4 item 6),
 *     not here; this strip is connect/status only.
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
   * The connectors-page card anchor. Every connector card carries both
   * `data-connector-card="<id>"` and `id="connector-<id>"` on its wrapper, so
   * we deep-link to `#connector-<id>` and the owner lands on the exact card.
   * (Kept nullable for safety: a null anchor falls back to the page root.)
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
  { provider: "google_gsc", label: "Google Search Console", cardAnchor: "google-gsc" },
  { provider: "google_ga4", label: "Google Analytics 4", cardAnchor: "google-ga4" },
  // SEMrush removed (dead, replaced by DataForSEO which is env-based / not a connect
  // card). Search-market status now lives on Connections.
  { provider: "clarity", label: "Microsoft Clarity", cardAnchor: "clarity" },
  // White-label: never surface the vendor name "Profound" on a customer
  // surface (main-product-final-confidence-sweep guards src/components/today).
  // The connectors page card is the one place it's named for key entry.
  { provider: "profound", label: "AI Answers", cardAnchor: "profound" },
  { provider: "wix", label: "Wix", cardAnchor: "wix" },
] as const;

// Item 51 - the strip speaks in TEAMMATE identities: each source renders its teammate's
// color dot, so the team health strip and the roundtable share one visual language.
const TEAMMATE_KEY: Partial<Record<ConnectorProvider, string>> = {
  google_gsc: "gsc",
  google_ga4: "ga4",
  clarity: "clarity",
  profound: "profound",
  wix: "wix",
};

/** Auth-dead detection: a needs_attention reason that means the connection itself is broken
 *  (expired/revoked/invalid) renders RED with a one-click reconnect, not a soft amber. */
function isAuthDead(reason: string | null): boolean {
  if (!reason) return false;
  return /expired|revoked|invalid|reconnect|unauthorized|sign in again/i.test(reason);
}

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
  /** Raw ISO sync timestamp (independent of the display string above), used to
   *  compute the UX4 four-state freshness summary without re-parsing prose. */
  lastSyncedAtIso: string | null;
};

/** UX4 item 3 - how long ago counts as "fresh" for the compact health summary. A source that
 *  synced within this window is fresh; older than this (or never synced) is stale. */
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

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
        lastSyncedAtIso: info?.last_synced_at ?? null,
      };
    }),
  );
}

/**
 * UX4 item 3 - four DISTINCT, honest counts instead of one collapsing "all connected" claim, so
 * this strip can never contradict a broken-pipe alert higher on the page:
 *   - connected: has a live token at all (connected or needs_attention; a dead/revoked token
 *     that getConnectorHealth would fail on is not_connected).
 *   - healthy: connected AND actually delivering data (no needs_attention reason).
 *   - fresh: healthy AND synced within the last 24 hours.
 *   - hasData: has synced at least once, ever (even if that sync is now stale) - distinguishes
 *     "never pulled anything" from "pulled something, just not recently".
 * PURE given the already-read statuses; no new I/O.
 */
export function summarizeDataSourceHealth(statuses: SourceStatus[]): {
  total: number;
  connected: number;
  healthy: number;
  fresh: number;
  hasData: number;
} {
  const now = Date.now();
  let connected = 0;
  let healthy = 0;
  let fresh = 0;
  let hasData = 0;
  for (const s of statuses) {
    if (s.health === "connected" || s.health === "needs_attention") connected += 1;
    if (s.health === "connected") healthy += 1;
    if (s.lastSyncedAtIso) {
      hasData += 1;
      const then = Date.parse(s.lastSyncedAtIso);
      if (s.health === "connected" && Number.isFinite(then) && now - then <= FRESH_WINDOW_MS) fresh += 1;
    }
  }
  return { total: statuses.length, connected, healthy, fresh, hasData };
}

/** UX4 item 3 - the compact one-line summary, e.g. "4 connected, 3 healthy, 1 needs attention".
 *  Always names the gap plainly (needs attention / no data yet) instead of a single "all good"
 *  claim, so it can never read as contradicting an alert shown above it on the page. */
export function dataSourceHealthLine(summary: ReturnType<typeof summarizeDataSourceHealth>): string {
  const { total, connected, healthy } = summary;
  const needsAttention = connected - healthy;
  const notConnected = total - connected;
  const parts = [`${connected} connected`, `${healthy} healthy`];
  if (needsAttention > 0) parts.push(`${needsAttention} needs attention`);
  if (notConnected > 0) parts.push(`${notConnected} not connected`);
  return parts.join(", ") + ".";
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
 * UX4 item 6 - the header's "Update data" button needs the same connected-source count the
 * strip computes for its own refresh button, so the two never disagree. Exported so the page
 * header (which renders the button ABOVE this strip now) can read one shared number instead of
 * re-deriving its own. Same fail-soft posture as readStatuses: a read error counts a source as
 * not connected.
 */
export async function countConnectedDataSources(tenantId?: string): Promise<number> {
  const statuses = await readStatuses(tenantId);
  return statuses.filter(
    (s) => (s.health === "connected" || s.health === "needs_attention") && s.source.provider !== "wix",
  ).length;
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
  // UX4 item 3 - the four-state summary line (Connected / Healthy / Fresh / Has data), so this
  // strip can never contradict a broken-pipe alert shown higher on the page with a single
  // over-confident "all good" claim.
  const summary = summarizeDataSourceHealth(statuses);

  if (allConnected) {
    // R14b (receipts everywhere) - the collapsed all-healthy line asserts health
    // without a when; name the freshest sync from the statuses already read.
    const freshestSync = statuses.reduce<string | null>(
      (latest, s) =>
        s.lastSyncedAtIso && Number.isFinite(Date.parse(s.lastSyncedAtIso)) && (latest == null || s.lastSyncedAtIso > latest)
          ? s.lastSyncedAtIso
          : latest,
      null,
    );
    const freshestLabel = freshestSync ? formatLastSynced(freshestSync, Date.now()) : null;
    return (
      <section
        aria-label="Your data sources"
        className="rounded-lg border border-border/40 bg-surface-inset/10 px-4 py-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">
            <Check aria-hidden="true" className="mr-1 inline-block h-3.5 w-3.5" />
            {dataSourceHealthLine(summary)}
            {freshestLabel ? ` Freshest source ${freshestLabel}.` : ""}{" "}
            <Link
              href={CONNECTORS_PATH}
              className="rounded-sm text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
            >
              Manage
            </Link>
          </p>
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
        <div>
          <h2 className="text-[12px] font-semibold text-foreground tracking-tight">
            Your data sources
          </h2>
          {/* UX4 item 3 - the same four-state line here too, so a source that needs
              attention is never buried under a bare heading. */}
          <p className="text-[11px] text-muted-foreground">{dataSourceHealthLine(summary)}</p>
        </div>
        <Link
          href={CONNECTORS_PATH}
          className="rounded-sm text-[12px] text-accent-primary underline underline-offset-2 hover:text-accent-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
        >
          Manage all
        </Link>
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
                <span aria-hidden="true" className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: teammateOf(TEAMMATE_KEY[source.provider] ?? "llm").color }} />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-success" />
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
                <span aria-hidden="true" className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: teammateOf(TEAMMATE_KEY[source.provider] ?? "llm").color }} />
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${isAuthDead(healthReason) ? "bg-status-danger" : "bg-status-warning"}`} />
                </span>
                <span className="font-medium">{source.label}</span>
                {healthReason ? (
                  <span className="text-muted-foreground">· {healthReason}</span>
                ) : null}
                {isAuthDead(healthReason) ? (
                  <span className="font-semibold text-status-danger">Reconnect →</span>
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
