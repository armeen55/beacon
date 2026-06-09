/**
 * Operator Semrush Surface — 2026-06-09.
 *
 * The operator-driven loop end-to-end: connect a Semrush API key →
 * refresh (pull domain overview + organic competitors for the owned
 * domain) → persist → view the cached snapshot. Soft-disconnect keeps
 * the snapshot after a week-limited key expires.
 *
 * Operator-only: gated behind BEACON_OPERATOR_MODE; 404s otherwise.
 * Resilient — failed reads render an empty state, never crash the build.
 * The API key is write-only (entered here, stored server-side, never
 * rendered back).
 *
 * Pinned by tests/app/diagnostics/semrush-page.test.tsx.
 */

import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import { getConnectorInfo } from "@/lib/connector-store";
import { loadSemrushDomainMetrics } from "@/lib/connectors/semrush/persist-domain-metrics";
import type { SemrushDomainMetricsSnapshot } from "@/lib/connectors/semrush/types";
import {
  connectSemrushFromForm,
  refreshSemrushFromForm,
  disconnectSemrushFromForm,
} from "./actions";

export const dynamic = "force-dynamic";

type LoadedState = {
  connected: boolean;
  lastSyncedAt: string | null;
  domain: string;
  snapshot: SemrushDomainMetricsSnapshot | null;
};

async function loadState(): Promise<LoadedState> {
  let connected = false;
  let lastSyncedAt: string | null = null;
  let domain = "";
  let snapshot: SemrushDomainMetricsSnapshot | null = null;
  try {
    const info = await getConnectorInfo("semrush");
    connected = info.status === "connected";
    lastSyncedAt = info.last_synced_at;
  } catch {
    /* soft-fail → disconnected */
  }
  try {
    const { getBusinessConfigForCurrentTenant } = await import(
      "@/lib/business-config"
    );
    const { currentTenantId } = await import("@/lib/tenant-context");
    const config = await getBusinessConfigForCurrentTenant();
    domain = (config.domain ?? "").trim();
    if (domain !== "") {
      const tenantId = await currentTenantId();
      snapshot = await loadSemrushDomainMetrics(tenantId, domain);
    }
  } catch {
    /* soft-fail → no snapshot */
  }
  return { connected, lastSyncedAt, domain, snapshot };
}

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString();
}

export default async function SemrushDiagnosticPage() {
  if (!isOperatorModeServer()) {
    notFound();
  }

  const { connected, lastSyncedAt, domain, snapshot } = await loadState();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Semrush"
        description="Connect a Semrush API key, pull domain + organic-competitor metrics for your site, and keep the snapshot. Operator-mode only."
      />

      {/* Connection status */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <div className="mb-2 flex items-center gap-3">
          <span
            data-semrush-status={connected ? "connected" : "disconnected"}
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
          <form action={connectSemrushFromForm} className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Paste your Semrush API key (from Subscription Info → API Units).
              Stored server-side; never shown again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                name="api_key"
                required
                placeholder="Semrush API key"
                className="rounded border border-border/40 bg-bg/40 px-2 py-1 text-sm"
              />
              <input
                type="text"
                name="database"
                defaultValue="us"
                placeholder="database (us)"
                className="w-24 rounded border border-border/40 bg-bg/40 px-2 py-1 text-sm"
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
            <span className="text-sm">
              Owned domain:{" "}
              <span className="font-mono">{domain || "(set in Settings → Config)"}</span>
            </span>
            <form action={refreshSemrushFromForm}>
              <button
                type="submit"
                disabled={domain === ""}
                className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              >
                Refresh metrics
              </button>
            </form>
            <form action={disconnectSemrushFromForm}>
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

      {/* Cached snapshot */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Domain metrics{snapshot ? ` — fetched ${snapshot.fetched_at}` : ""}
        </h2>
        {snapshot == null ? (
          <p className="text-sm text-muted-foreground">
            No Semrush snapshot cached yet.{" "}
            {connected
              ? "Click Refresh metrics to pull it."
              : "Connect a key, then refresh."}
          </p>
        ) : (
          <>
            {snapshot.overview && (
              <div className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <Metric label="Rank" value={fmt(snapshot.overview.rank)} />
                <Metric label="Organic keywords" value={fmt(snapshot.overview.organicKeywords)} />
                <Metric label="Organic traffic" value={fmt(snapshot.overview.organicTraffic)} />
                <Metric label="Paid keywords" value={fmt(snapshot.overview.adwordsKeywords)} />
              </div>
            )}
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Organic competitors ({snapshot.organic_competitors.length})
            </h3>
            {snapshot.organic_competitors.length === 0 ? (
              <p className="text-xs text-muted-foreground">none returned</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {snapshot.organic_competitors.map((c) => (
                  <li key={c.domain} className="flex justify-between">
                    <span className="font-mono">{c.domain}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmt(c.commonKeywords)} shared kw · {fmt(c.organicTraffic)} traffic
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Cross-check these against your tracked competitor set — Semrush
              surfaces organic rivals that AI-citation data may miss, and vice
              versa.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 bg-bg/40 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-base">{value}</div>
    </div>
  );
}
