"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  refreshAllConnectedDataNow,
  type RefreshAllConnectedResult,
} from "@/app/(shell)/settings/connectors/actions";

/**
 * One-click "Refresh my data" control for the Today command center
 * (2026-06-15).
 *
 * The owner asked for a single control on Today instead of hunting per-source
 * "Sync now" buttons in Settings → Connectors ("everything should be updating,
 * I don't need to refresh"). This button pulls EVERY connected read source in
 * one click via the `refreshAllConnectedDataNow` server action, then calls
 * `router.refresh()` so the dashboard repaints with the freshly-pulled data.
 *
 * Honest posture: on-demand only — NO automation/scheduling claims. The helper
 * line says exactly what it does ("Pulls the latest from every connected
 * source.").
 *
 * White-label: the action returns customer-safe labels (plain-English source
 * names, never a vendor name); this component renders them verbatim.
 *
 * Renders nothing when no sources are connected (the strip already shows
 * Connect affordances in that state).
 */

type RefreshResult = RefreshAllConnectedResult["results"][number];

/**
 * Pure presentational result list — split out so a test can
 * renderToStaticMarkup it without driving the button's client state.
 */
export function RefreshResultList({ results }: { results: RefreshResult[] }) {
  if (results.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {results.map((r) => (
        <li
          key={r.provider}
          className="flex items-start gap-1.5 text-[12px] text-foreground"
        >
          <span
            aria-hidden="true"
            className={r.ok ? "text-status-success" : "text-status-danger"}
          >
            {r.ok ? "✓" : "✗"}
          </span>
          <span className="font-medium">{r.label}</span>
          <span className="text-muted-foreground">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function RefreshMyDataButton({
  connectedCount,
}: {
  connectedCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [results, setResults] = useState<RefreshResult[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  // Nothing to refresh — the strip's Connect affordances cover this state.
  if (connectedCount === 0) return null;

  function onClick() {
    setResults(null);
    startTransition(async () => {
      const res = await refreshAllConnectedDataNow();
      setResults(res.results);
      setRanAt(res.ranAt);
      // Repaint the dashboard with the freshly-pulled data.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-busy={isPending}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden="true">↻</span>
        <span>Update data</span>
      </button>
      <p className="text-[11px] text-muted-foreground">
        Pulls the latest from every connected source.
      </p>
      <div aria-live="polite" className="w-full">
        {isPending ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Refreshing… this can take a moment
          </p>
        ) : results ? (
          results.length > 0 ? (
            <RefreshResultList results={results} />
          ) : (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Nothing connected to refresh yet.
            </p>
          )
        ) : null}
      </div>
      {/* ranAt is captured for downstream freshness copy if needed; kept in
          state so a future "last refreshed at" line can read it. */}
      <span hidden data-ran-at={ranAt ?? undefined} />
    </div>
  );
}
