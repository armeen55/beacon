"use client";

import { useState } from "react";
import { buildWorklistMarkdown, type ExportItem } from "./worklist-export";

/**
 * Client "Export worklist" affordance — turns the ranked opportunities into a
 * Markdown file the operator downloads and hands to their dev/VA team. Pure client
 * download of the user's own data (Blob + object URL); no upload, no server round-trip.
 */
export function WorklistExportButton({ items, siteName }: { items: ExportItem[]; siteName?: string }) {
  const [done, setDone] = useState(false);
  if (items.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // dateLabel computed at click time (client) so the doc is stamped for the team.
        const dateLabel = new Date().toISOString().slice(0, 10);
        const md = buildWorklistMarkdown(items, { siteName, dateLabel });
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `worklist-${dateLabel}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
    >
      {done ? "Downloaded ✓" : "Export for your team ↓"}
    </button>
  );
}
