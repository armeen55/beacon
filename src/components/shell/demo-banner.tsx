"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useShell } from "./shell-provider";

/** Renders `DemoBanner` only when shell `isDemoMode` is true (see `layout.tsx` / `seed-data.server.ts`). */
export function DemoBannerGate() {
  const { isDemoMode } = useShell();
  if (!isDemoMode) return null;
  return <DemoBanner />;
}

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-status-warning/25 bg-status-warning/[0.06] px-4 py-2 text-[13px] text-foreground-secondary">
      <p>
        <span className="font-semibold text-foreground">Sample data.</span>{" "}
        You&rsquo;re viewing demo content.{" "}
        <Link
          href="/settings/import"
          className="font-medium text-accent-primary underline underline-offset-2 hover:text-accent-primary/80"
        >
          Upload a visibility export
        </Link>{" "}
        to see your real briefing.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-foreground-secondary/60 hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
        aria-label="Dismiss demo banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
