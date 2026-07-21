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
  recomputeProofFromForm,
  startGscDeepBackfillFromForm,
  loadGscDeepBackfillStatus,
} from "./actions";
import { IndexNowSection } from "./indexnow-section";

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
  { label: "CallRail", provider: "callrail", href: "/diagnostics/callrail" },
  // Semrush removed (dead; DataForSEO is the search-market source, env-based).
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
  const gscConnected = rows.find((r) => r.provider === "google_gsc")?.connected ?? false;
  const backfillStatus = await loadGscDeepBackfillStatus();
  // Awaited directly (not used as a JSX tag) so this stays a plain server
  // render — no Suspense boundary needed, matching every other data load
  // on this page.
  const indexNowSection = await IndexNowSection();

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

      {/* On-demand Proof Engine recompute (2026-06-15) — crons off. The
          causal Proof Engine (classifies each shipped edit Helping / Hurting /
          Nothing-Yet vs natural-control pages) used to recompute only in the
          nightly job. Deterministic, no paid API — safe to click any time. */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recompute causal proof
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Re-grades every shipped edit against comparable untouched pages and
          refreshes the Proof tile + Changes scorecard. Run after a data
          refresh or after shipping edits. Deterministic — no AI spend.
        </p>
        <form action={recomputeProofFromForm}>
          <button
            type="submit"
            className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white"
          >
            Recompute proof
          </button>
        </form>
      </section>

      {/* GSC deep history backfill (2026-07-02, master plan item 63) — the
          seasonality engine needs multiple years of demand to prove a wave
          repeats every year, but the normal sync only ever holds 90 days.
          One click reaches back up to 16 months in resumable chunks; the
          operator clicking continue on each visit runs the next chunk until
          complete (Beacon has no scheduler to continue it automatically). */}
      <section className="rounded-lg border border-border/40 bg-surface-inset/30 p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Load my full Search Console history
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Google keeps up to 16 months of search history, but I only load 90
          days by default. Loading the full history lets me prove a search
          wave repeats every year instead of guessing off one season, and
          schedule prep work 6 to 8 weeks before it hits. I pull it in chunks
          of about a month each so a single request never times out; one
          click starts it, and clicking continue each time you are back
          finishes it.
        </p>
        {backfillStatus.started ? (
          <p className="mb-3 text-xs text-muted-foreground" data-testid="gsc-backfill-status">
            {backfillStatus.status === "complete"
              ? `Done. History now reaches back to ${backfillStatus.targetDate}.`
              : `In progress: back to ${backfillStatus.cursorDate ?? backfillStatus.targetDate} so far, heading to ${backfillStatus.targetDate}. Click continue to pull the next chunk.`}
          </p>
        ) : null}
        <form action={startGscDeepBackfillFromForm}>
          <button
            type="submit"
            disabled={!gscConnected || (backfillStatus.started && backfillStatus.status === "complete")}
            className="rounded bg-accent-primary px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            {backfillStatus.started ? "Continue loading history" : "Load my full Search Console history"}
          </button>
        </form>
      </section>

      {/* IndexNow lane (2026-07-02, BEACON_500 item 75) - tells Bing (and so
          ChatGPT, which browses on Bing's index) about every approved change
          the moment it goes live. Self-hides its own setup steps when no key
          is configured yet; never invents an index status it cannot verify. */}
      {indexNowSection}

      <p className="text-xs text-muted-foreground">
        Refreshing pulls fresh data from each connected source into
        Beacon&apos;s cache — that&apos;s what keeps Today, Recommendations, and
        the Changes detail current now that nightly crons are off. GSC, GA4,
        Clarity + CallRail all refresh in the batch above; the
        proof recompute is a separate on-demand action.
      </p>
    </div>
  );
}
