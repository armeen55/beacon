"use client";

import { useState } from "react";
import { buildPageBriefMarkdown, type PageBriefInput } from "./page-brief";

/**
 * Client "Download brief" affordance on the Workbench — a focused single-page task
 * sheet the operator hands a dev. Pure client Blob download of the user's own data.
 */
export function PageBriefButton({ brief }: { brief: PageBriefInput }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const dateLabel = new Date().toISOString().slice(0, 10);
        const md = buildPageBriefMarkdown(brief, { dateLabel });
        const slug = (brief.path || "page").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `brief-${slug}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="rounded-lg border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
    >
      {done ? "Downloaded ✓" : "Download brief ↓"}
    </button>
  );
}
