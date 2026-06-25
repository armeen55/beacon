"use client";

import { useState } from "react";

/**
 * Client copy affordance for the entity-foundation JSON-LD: shows the snippet in a
 * scrollable code block with a one-click Copy button (clipboard + transient label).
 */
export function EntityFoundationCopy({ script }: { script: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Organization + WebSite JSON-LD
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(script).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            });
          }}
          className="rounded-lg border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
        >
          {copied ? "Copied ✓" : "Copy snippet"}
        </button>
      </div>
      <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
        <code>{script}</code>
      </pre>
    </div>
  );
}
