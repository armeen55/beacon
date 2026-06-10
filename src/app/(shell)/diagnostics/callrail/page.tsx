/**
 * Operator CallRail Surface — 2026-06-09 (§9.B).
 *
 * The operator-driven loop end-to-end: connect a CallRail API key +
 * account id → refresh (pull calls, attribute each to its canonical
 * landing-page URL + UTC day, classify qualified) → persist → view the
 * cached per-URL/day call rows. Those qualified counts are what the
 * Mode A engine sums into `post_live_qualified_calls` so Today + Changes
 * can say "N calls in the X days since you shipped this edit."
 *
 * Operator-only: gated behind BEACON_OPERATOR_MODE; 404s otherwise.
 * Resilient — failed reads render an empty state, never crash the build.
 * The API key is write-only (entered here, stored server-side, never
 * rendered back).
 *
 * Pinned by tests/app/diagnostics/callrail-page.test.tsx.
 */

import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { getConnectorInfo } from "@/lib/connector-store";
import {
  loadRecentCallAttribution,
  type CallAttributionRow,
} from "@/lib/connectors/callrail/persist-url-calls";
import {
  connectCallRailFromForm,
  refreshCallRailFromForm,
  disconnectCallRailFromForm,
} from "./actions";

export const dynamic = "force-dynamic";

type LoadedState = {
  connected: boolean;
  lastSyncedAt: string | null;
  rows: CallAttributionRow[];
};

async function loadState(): Promise<LoadedState> {
  let connected = false;
  let lastSyncedAt: string | null = null;
  let rows: CallAttributionRow[] = [];
  try {
    const info = await getConnectorInfo("callrail");
    connected = info.status === "connected";
    lastSyncedAt = info.last_synced_at;
  } catch {
    /* soft-fail → disconnected */
  }
  try {
    const { currentTenantId } = await import("@/lib/tenant-context");
    const tenantId = await currentTenantId();
    rows = await loadRecentCallAttribution(tenantId);
  } catch {
    /* soft-fail → no rows */
  }
  return { connected, lastSyncedAt, rows };
}

export default async function CallRailDiagnosticPage() {
  if (!isOperatorModeServer()) {
    notFound();
  }

  const { connected, lastSyncedAt, rows } = await loadState();
  const totalQualified = rows.reduce((s, r) => s + r.qualifiedCalls, 0);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="CallRail"
        description="Connect a CallRail API key + account id, pull inbound calls, and attribute each to the landing page it came from. Qualified counts feed the outcome engine — 'N calls since you shipped this edit.' Operator-mode only."
      />

      {/* Connection status */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <div className="mb-2 flex items-center gap-3">
          <span
            data-callrail-status={connected ? "connected" : "disconnected"}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
              connected
                ? "bg-status-success/15 text-status-success border-status-success/30"
                : "bg-surface-inset/60 text-muted-foreground border-border/40"
            }`}
          >
            {connected ? "Connected" : "Not connected"}
          </span>
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              last refreshed {lastSyncedAt}
            </span>
          )}
        </div>

        {!connected ? (
          <form action={connectCallRailFromForm} className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Paste your CallRail API key (Account → Integrations → API) and the
              numeric account id from the dashboard URL. Stored server-side;
              never shown again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                name="api_key"
                required
                placeholder="CallRail API key"
                className="rounded border border-border/40 bg-bg/40 px-2 py-1 text-sm"
              />
              <input
                type="text"
                name="account_id"
                required
                placeholder="account id"
                className="w-40 rounded border border-border/40 bg-bg/40 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
              >
                Connect
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={refreshCallRailFromForm}>
              <button
                type="submit"
                className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
              >
                Refresh calls
              </button>
            </form>
            <form action={disconnectCallRailFromForm}>
              <button
                type="submit"
                className="rounded border border-border/40 px-3 py-1 text-sm text-muted-foreground"
              >
                Disconnect
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Cached attribution rows */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Attributed calls{rows.length > 0 ? ` — ${totalQualified} qualified across ${rows.length} URL/day rows` : ""}
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No call attribution cached yet.{" "}
            {connected
              ? "Click Refresh calls to pull it."
              : "Connect a key, then refresh."}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li
                key={`${r.url}__${r.date}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate font-mono text-xs">{r.url}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.date} · {r.qualifiedCalls}/{r.totalCalls} qualified
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Qualified = CallRail scored the call a good lead, or it was answered
          and ran past the duration threshold. These counts attach to the page
          the caller landed on, so a shipped edit&apos;s booked calls show up on
          Today and the Changes detail.
        </p>
      </section>
    </div>
  );
}
