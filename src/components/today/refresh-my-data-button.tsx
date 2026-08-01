"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  continueResearchNow,
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
 * IT RENDERS WITH ZERO CONNECTIONS TOO (2026-07-31). It used to hide itself when
 * nothing was connected, which quietly removed the only control that resumes the
 * research: the AI answer checks, the keyword work and the ranked changes need no
 * connector at all, so an account with none had no way to say "carry on". The copy
 * tells the truth in both states and the results list stays honest either way.
 */

type RefreshResult = RefreshAllConnectedResult["results"][number];

/**
 * Pure presentational result list — split out so a test can
 * renderToStaticMarkup it without driving the button's client state.
 */
export function RefreshResultList({ results }: { results: RefreshResult[] }) {
  // THE ACTION ALWAYS ANSWERS, with the connected sources or with its own research line, so an empty list
  // is not "nothing is connected" any more: it is the press itself failing. Say that instead.
  if (results.length === 0) {
    return (
      <p className="mt-1 text-[12px] text-muted-foreground">
        I could not refresh anything just now; try again in a minute.
      </p>
    );
  }
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
  const [pulling, setPulling] = useState(false);
  const [researching, setResearching] = useState(false);
  const [results, setResults] = useState<RefreshResult[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const busy = pulling || researching;

  function onClick() {
    setResults(null);
    setPulling(true);
    void (async () => {
      const res = await refreshAllConnectedDataNow().catch(() => null);
      setResults(res?.results ?? []);
      setRanAt(res?.ranAt ?? null);
      setPulling(false);
      // Repaint with the freshly-pulled data BEFORE the research continues: the operator should not
      // wait on the long half to see the short half.
      router.refresh();
      // RESUME ALL THE WORK, not just the pulls. One press used to refresh the sources and stop, so
      // the research those pulls unblocked waited for the next navigation. Each hop is its own
      // request that claims the run's lease for itself and answers whether more is owed; the SERVER
      // owns the bound, this loop carries its own so a bad answer cannot spin it, and closing the
      // tab simply stops asking.
      setResearching(true);
      for (let hop = 0, guard = 0; guard < 8; guard += 1) {
        const step = await continueResearchNow(hop).catch(() => null);
        if (!step?.more) break;
        hop = step.hop;
      }
      setResearching(false);
      router.refresh();
    })();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden="true">↻</span>
        <span>Update data</span>
      </button>
      <p className="text-[11px] text-muted-foreground">
        {connectedCount > 0
          ? "Pulls the latest from every connected source, then picks my research back up."
          : "Picks my research back up where it left off."}
      </p>
      <div aria-live="polite" className="w-full">
        {pulling ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Refreshing… this can take a moment
          </p>
        ) : researching ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            I am picking my research back up. You can keep using Beacon while I work.
          </p>
        ) : results ? (
          <RefreshResultList results={results} />
        ) : null}
      </div>
      {/* ranAt is captured for downstream freshness copy if needed; kept in
          state so a future "last refreshed at" line can read it. */}
      <span hidden data-ran-at={ranAt ?? undefined} />
    </div>
  );
}
