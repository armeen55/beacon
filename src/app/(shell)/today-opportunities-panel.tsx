"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discoverDemandAction } from "./today-opportunities-actions";

/**
 * DiscoverDemandButton (2026-06-25, Sprint 4G) — operator-only. One click fetches
 * real keyword demand for the tenant's own topics (capped + cached inside the
 * action, DRY-RUN by default), then refreshes the New Opportunities panel. No
 * publish, no content change.
 */
export function DiscoverDemandButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await discoverDemandAction({ maxSeeds: 25 });
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        setMsg(
          r.status === "ok"
            ? `Discovered ${r.returned} (req ${r.requested}) · $${r.costUsd.toFixed(3)}`
            : r.status === "cache_hit"
            ? `Served from cache (${r.returned}) · $0`
            : r.status === "dry_run"
            ? `Dry-run — set DATAFORSEO_DRY_RUN=false to fetch live (~$${r.costUsd.toFixed(3)} est)`
            : r.status === "disabled"
            ? "DataForSEO not connected"
            : r.status === "capped"
            ? "Monthly DataForSEO cap reached"
            : `No demand returned (${r.status})`,
        );
        router.refresh();
      } catch {
        setMsg("Discover failed — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Fetch real keyword demand for your topics (DataForSEO) — capped + cached, re-runs are free"
        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-300 border-t-sky-600" />
            Discovering…
          </>
        ) : (
          <>🔭 Discover demand</>
        )}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
