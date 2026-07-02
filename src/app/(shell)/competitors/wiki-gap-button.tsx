"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findWikiGapsAction } from "./wiki-gap-action";

/**
 * WikiGapButton (2026-07-02, master plan item 23) - "Check the Wikipedia pages
 * AI prefers": one click mines up to 20 Wikipedia articles AI cites in this
 * tenant's space (free API, bounded, 30-day cached) and shows the honest
 * receipt with how many are thin or stale enough to beat. Operator-gated
 * server-side too.
 */
export function WikiGapButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await findWikiGapsAction();
        if (!r.ok) {
          setMsg(r.reason);
          return;
        }
        setMsg(r.message);
        if (r.status === "ok") router.refresh();
      } catch {
        setMsg("That check failed. Try again in a minute.");
      }
    });
  }

  return (
    <div className="flex max-w-sm flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="I check up to 20 Wikipedia articles AI cites in your space for length, freshness, and focus. Free API, capped, cached for 30 days."
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-50 disabled:opacity-60"
      >
        {pending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
            Checking Wikipedia...
          </>
        ) : (
          <>Check the Wikipedia pages AI prefers</>
        )}
      </button>
      {msg ? <span className="text-right text-[11px] leading-snug text-gray-500">{msg}</span> : null}
    </div>
  );
}
