"use client";

import { useState } from "react";
import { buildWorklistMarkdown, buildWorklistCsv, type ExportItem } from "./worklist-export";

/**
 * Client "Export worklist" affordance — turns the ranked opportunities into a
 * Markdown doc (for a human dev/VA) or a CSV (to import into a sheet / tracker).
 * Pure client download of the user's own data (Blob + object URL); no upload.
 */
export function WorklistExportButton({ items, siteName }: { items: ExportItem[]; siteName?: string }) {
  const [done, setDone] = useState<"md" | "csv" | null>(null);
  if (items.length === 0) return null;

  const download = (fmt: "md" | "csv") => {
    const dateLabel = new Date().toISOString().slice(0, 10);
    const content = fmt === "md" ? buildWorklistMarkdown(items, { siteName, dateLabel }) : buildWorklistCsv(items);
    const type = fmt === "md" ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8";
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `worklist-${dateLabel}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setDone(fmt);
    setTimeout(() => setDone(null), 1800);
  };

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-violet-200">
      <button
        type="button"
        onClick={() => download("md")}
        className="bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
      >
        {done === "md" ? "Downloaded ✓" : "Export for your team ↓"}
      </button>
      <button
        type="button"
        onClick={() => download("csv")}
        title="Download as CSV (for a sheet or tracker)"
        className="border-l border-violet-200 bg-white px-2 py-1.5 text-xs font-semibold text-violet-500 hover:bg-violet-50"
      >
        {done === "csv" ? "✓" : "CSV"}
      </button>
    </div>
  );
}
