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
        Nothing could be refreshed just now; try again in a minute.
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

/**
 * `connectedCount` is TRI-STATE. Null means the count could not be read, which is not the same claim as
 * zero: the caller defaults a failed read to 0, and the zero copy then told a fully connected account that
 * there was nothing of theirs to pull. An unknown count says the one thing that is true either way.
 */
export function RefreshMyDataButton({
  connectedCount, researchPaused = false,
}: {
  connectedCount: number | null;
  /** TRUE when the account's own research switch is off. This control may then promise the pull it really does and NOTHING about a round that is not running. */
  researchPaused?: boolean;
}) {
  const router = useRouter();
  const [pulling, setPulling] = useState(false);
  const [researching, setResearching] = useState(false);
  const [results, setResults] = useState<RefreshResult[] | null>(null);
  const [blocker, setBlocker] = useState<string | null>(null);
  const busy = pulling || researching;

  function onClick() {
    setResults(null);
    setPulling(true);
    void (async () => {
      const res = await refreshAllConnectedDataNow().catch(() => null);
      setResults(res?.results ?? []);
      setPulling(false);
      // Repaint with the freshly-pulled data BEFORE the continuation: the operator should not
      // wait on the long half to see the short half.
      router.refresh();
      // ONE PRESS, ONE SERVER-OWNED CYCLE. The browser used to loop six requests and could stop the day's work
      // by closing the tab, and the seventh press reported done over an unfinished queue. The server now drives
      // the whole continuation inside one call, persists every step durably, and answers honestly: `more` with a
      // blocker means work is still owed (usually evidence already requested and not yet answered), and pressing
      // again any time is safe. Closing the tab changes nothing durable.
      setResearching(true);
      const res2 = await continueResearchNow(0).catch(() => null);
      setBlocker(res2?.more === true ? res2.blocker ?? "More work is owed; press again any time." : null);
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
        {(connectedCount == null ? "Updates your data now" : connectedCount > 0 ? "Pulls your latest numbers now" : "Picks up anything unfinished now")
          + (researchPaused ? ", and nothing else runs while research is paused." : ", and the daily round runs on its own either way.")}
      </p>
      <div aria-live="polite" className="w-full">
        {pulling ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Refreshing… this can take a moment
          </p>
        ) : researching ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Picking up anything unfinished. This runs once, and the daily research carries on either way.
          </p>
        ) : results ? (
          <>
            <RefreshResultList results={results} />
            {blocker ? <p className="mt-1 text-[12px] text-muted-foreground">{blocker}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
