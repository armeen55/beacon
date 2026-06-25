"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sharpenMovesWithTeardownAction } from "./today-moves-actions";

/**
 * SharpenMovesButton (2026-06-25) — on-demand trigger for the core "reverse-
 * engineer the winner" teardown. When some shown Moves lack a competitor
 * teardown ("what wins"), this fetches + extracts the cited competitors' page
 * structure so the cards gain grounded guidance. Operator-gated server-side;
 * fires only on click (polite-fetch, ~20-40s), then refreshes the cockpit.
 */
export function SharpenMovesButton({ pending: pendingCount }: { pending: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      try {
        const r = await sharpenMovesWithTeardownAction({ limit: 12 });
        if (r.status === "off") {
          setMsg("Teardown is operator-only.");
          return;
        }
        setMsg(`Tore down ${r.audited} of ${r.targets} competitor ${r.targets === 1 ? "page" : "pages"}.`);
        router.refresh(); // pull the revalidated, enriched moves
      } catch {
        setMsg("Teardown failed — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        title="Fetch the competitors AI cites and extract what their winning pages do — so each move shows what to beat"
        className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-fuchsia-700 transition-colors hover:border-fuchsia-400 hover:bg-fuchsia-50 disabled:opacity-60"
      >
        {isPending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-fuchsia-300 border-t-fuchsia-600" />
            Tearing down competitors…
          </>
        ) : (
          <>✦ Sharpen {pendingCount > 0 ? `(${pendingCount})` : ""} with teardown</>
        )}
      </button>
      {msg ? <span className="text-[11px] text-gray-500">{msg}</span> : null}
    </div>
  );
}
