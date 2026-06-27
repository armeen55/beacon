"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshProfoundCoverageAction, type RefreshCoverageResult } from "./actions";

/** Operator-only "Refresh Profound coverage" button — runs the ~22s live pull +
 *  durable upsert ONCE, then refreshes the (now-fast) cached read. The only place
 *  the live Profound API is hit for coverage. */
export function RefreshCoverageButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshCoverageResult | null>(null);

  function run() {
    startTransition(async () => {
      const r = await refreshProfoundCoverageAction();
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Syncing Profound… (~20s)" : "Refresh Profound coverage"}
      </button>
      {result?.ok && (
        <span className="text-xs text-emerald-700">
          Synced {result.result.prompts} prompts · {result.result.answers} answers · {result.result.fanouts} fan-outs · {result.result.citationUrls} citation URLs
        </span>
      )}
      {result && !result.ok && <span className="text-xs text-rose-600">{result.reason}</span>}
    </div>
  );
}
