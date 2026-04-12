"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = "outcomes" | "attribution" | "replicate";

export function ChangesTabShell({
  outcomesContent,
  attributionContent,
  replicateContent,
}: {
  outcomesContent: React.ReactNode;
  attributionContent: React.ReactNode;
  replicateContent: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: Tab =
    tabParam === "attribution"
      ? "attribution"
      : tabParam === "replicate"
        ? "replicate"
        : "outcomes";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-4 text-[11px]">
        <button
          onClick={() => {
            setTab("outcomes");
            window.history.replaceState(null, "", "/changes");
          }}
          className={cn(
            "px-3 py-1.5 rounded-md font-medium transition-colors",
            tab === "outcomes"
              ? "bg-foreground text-background font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50",
          )}
        >
          Outcomes
        </button>
        <button
          onClick={() => {
            setTab("attribution");
            window.history.replaceState(null, "", "/changes?tab=attribution");
          }}
          className={cn(
            "px-3 py-1.5 rounded-md font-medium transition-colors",
            tab === "attribution"
              ? "bg-foreground text-background font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50",
          )}
        >
          Attribution
        </button>
        <button
          onClick={() => {
            setTab("replicate");
            window.history.replaceState(null, "", "/changes?tab=replicate");
          }}
          className={cn(
            "px-3 py-1.5 rounded-md font-medium transition-colors",
            tab === "replicate"
              ? "bg-foreground text-background font-semibold"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-inset/50",
          )}
        >
          Replicate
        </button>
      </div>
      {tab === "outcomes"
        ? outcomesContent
        : tab === "attribution"
          ? attributionContent
          : replicateContent}
    </div>
  );
}
