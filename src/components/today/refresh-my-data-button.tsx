"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  continueResearchNow,
  refreshAllConnectedDataNow,
  type RefreshAllConnectedResult,
} from "@/app/(shell)/settings/connectors/actions";

/**
 * One-click "Update data" control for the Today command center (2026-06-15).
 *
 * The owner asked for a single control on Today instead of hunting per-source
 * "Sync now" buttons in Settings → Connectors ("everything should be updating,
 * I don't need to refresh"). This button pulls EVERY connected read source in
 * one click via the `refreshAllConnectedDataNow` server action, then calls
 * `router.refresh()` so the dashboard repaints with the freshly-pulled data.
 *
 * IT IS A RECOVERY CONTROL, NOT THE ENGINE (2026-08-02). The daily round is driven by the one global
 * scheduler; this press is the operator saying "do it now" and "pick up anything unfinished". So it is
 * exactly THREE things, once: refresh the connected sources, ask for the extra AI reading, and resume
 * unfinished work with ONE bounded continuation. The eight-hop loop that used to live here existed only
 * because nothing else finished the day; keeping it would put the day's work back behind a button.
 *
 * White-label: the action returns customer-safe labels (plain-English source
 * names, never a vendor name); this component renders them verbatim.
 *
 * IT RENDERS WITH ZERO CONNECTIONS TOO (2026-07-31). It used to hide itself when
 * nothing was connected, which quietly removed the only control that asks for a second reading of
 * today's AI answers: that work needs no connector at all. The copy tells the truth in both states.
 */

type RefreshResult = RefreshAllConnectedResult["results"][number];

/**
 * Pure presentational result list, split out so a test can
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
      // Repaint with the freshly-pulled data BEFORE the continuation: the operator should not
      // wait on the long half to see the short half.
      router.refresh();
      // ONE CONTINUATION, ONCE. The press claims the run's lease for itself and does one bounded hop
      // of whatever is unfinished; the SERVER owns that bound exactly as it did before. It does not
      // loop, because the day's round no longer depends on this button being pressed enough times.
      setResearching(true);
      await continueResearchNow(0).catch(() => null);
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
          ? "I refresh every connected source, ask for an extra AI reading, and pick up anything unfinished. My daily research runs on its own."
          : "I ask for an extra AI reading and pick up anything unfinished. My daily research runs on its own."}
      </p>
      <div aria-live="polite" className="w-full">
        {pulling ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Refreshing… this can take a moment
          </p>
        ) : researching ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            I am picking up anything unfinished. This runs once, and my daily research carries on either way.
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
