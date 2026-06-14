/**
 * Operator Connectors Surface — 2026-06-09 (§5, single-tenant half).
 *
 * One place to see every cache-backed connector that feeds the
 * outcome-attribution substrate and refresh them all in a single click,
 * instead of visiting each `/diagnostics/<provider>` page. The last
 * refreshed timestamp on each row is the proof the pull landed.
 *
 * Operator-only: gated behind BEACON_OPERATOR_MODE; 404s otherwise.
 * Resilient — failed status reads render "unknown", never crash.
 *
 * Pinned by tests/app/diagnostics/connectors-page.test.tsx.
 */

import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { PageHeader } from "@/components/data/page-header";
import {
  getConnectorInfo,
  type ConnectorProvider,
} from "@/lib/connector-store";
import {
  refreshAllDataSourcesFromForm,
  runPerplexityReadingFromForm,
  runOpenAiReadingFromForm,
} from "./actions";

export const dynamic = "force-dynamic";

type Row = {
  label: string;
  provider: ConnectorProvider;
  connected: boolean;
  lastSyncedAt: string | null;
  href: string;
};

const CONNECTORS: ReadonlyArray<{
  label: string;
  provider: ConnectorProvider;
  href: string;
}> = [
  { label: "Google Search Console", provider: "google_gsc", href: "/settings/connectors" },
  { label: "Google Analytics 4", provider: "google_ga4", href: "/diagnostics/outcome-attribution" },
  { label: "Microsoft Clarity", provider: "clarity", href: "/settings/connectors" },
  { label: "Profound", provider: "profound", href: "/settings/connectors" },
  { label: "CallRail", provider: "callrail", href: "/diagnostics/callrail" },
  { label: "Semrush", provider: "semrush", href: "/diagnostics/semrush" },
];

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const c of CONNECTORS) {
    let connected = false;
    let lastSyncedAt: string | null = null;
    try {
      const info = await getConnectorInfo(c.provider);
      connected = info.status === "connected";
      lastSyncedAt = info.last_synced_at;
    } catch {
      /* soft-fail → treated as not connected */
    }
    rows.push({ ...c, connected, lastSyncedAt });
  }
  return rows;
}

export default async function ConnectorsDiagnosticPage() {
  if (!isOperatorModeServer()) {
    notFound();
  }

  const rows = await loadRows();
  const anyConnected = rows.some((r) => r.connected);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Data sources"
        description="Every connector that feeds outcome attribution, in one place. Refresh them all at once — the last-refreshed time on each row confirms the pull landed. Operator-mode only."
      />

      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Connected sources
          </h2>
          <form action={refreshAllDataSourcesFromForm}>
            <button
              type="submit"
              disabled={!anyConnected}
              className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              Refresh all connected sources
            </button>
          </form>
        </div>

        <ul className="divide-y divide-border/30">
          {rows.map((r) => (
            <li
              key={r.provider}
              data-connector={r.provider}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="flex items-center gap-3">
                <span
                  data-status={r.connected ? "connected" : "disconnected"}
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                    r.connected
                      ? "bg-status-success/15 text-status-success border-status-success/30"
                      : "bg-surface-inset/60 text-muted-foreground border-border/40"
                  }`}
                >
                  {r.connected ? "Connected" : "Not connected"}
                </span>
                <span className="text-sm font-medium">{r.label}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {r.lastSyncedAt
                    ? `last refreshed ${r.lastSyncedAt}`
                    : "never refreshed"}
                </span>
                <a
                  href={r.href}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  manage →
                </a>
              </div>
            </li>
          ))}
        </ul>

        {!anyConnected && (
          <p className="mt-3 text-xs text-muted-foreground">
            No data sources connected yet. Connect one from its manage page,
            then refresh here.
          </p>
        )}
      </section>

      {/* On-demand AEO reading (2026-06-15) — crons are off; run the native
          poll from here. One platform per click (each ~runs in well under the
          serverless cap for a typical prompt library); the UTC-day budget
          guard makes a same-day repeat a no-op, so clicks never double-spend.
          Uses paid LLM APIs (operator-authorized). */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Run today&apos;s AI reading
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Polls the AI assistants for your tracked prompts and refreshes the
          &ldquo;how AI describes you&rdquo; data on Today + Prompts. Run each
          platform once; re-running the same day is a no-op (budget-guarded).
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={runPerplexityReadingFromForm}>
            <button
              type="submit"
              className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
            >
              Run Perplexity reading
            </button>
          </form>
          <form action={runOpenAiReadingFromForm}>
            <button
              type="submit"
              className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
            >
              Run ChatGPT reading
            </button>
          </form>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Refreshing pulls fresh data from each connected source into
        Beacon&apos;s cache — that&apos;s what keeps Today, Recommendations, and
        the Changes detail current now that nightly crons are off. GSC, GA4,
        Clarity, Profound, Semrush + CallRail all refresh in the batch above;
        the AI reading is a separate (paid) poll, run on demand.
      </p>
    </div>
  );
}
