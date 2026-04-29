"use client";

/**
 * Phase 6A.8 (2026-04-28) — collapsible metrics disclosure for /today.
 *
 * Wraps the metrics-class sections (How AI described you / Words AI uses
 * near brand / Answer shape / Prompts teaser / Visibility chart /
 * Competitor leaderboard) in a single collapsed-by-default disclosure
 * so they don't dominate /today's hero area. Operator opens with one
 * click; the open/closed state persists across reloads via
 * `localStorage`.
 *
 * Pure presentation around children. No data reads.
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "beacon:today:metrics-disclosure-open";

export type TodayMetricsDisclosureProps = {
  children: React.ReactNode;
  /** Override the default-closed contract for tests. */
  defaultOpen?: boolean;
  className?: string;
};

export function TodayMetricsDisclosure({
  children,
  defaultOpen = false,
  className,
}: TodayMetricsDisclosureProps) {
  // Start with the SSR-friendly default; hydrate from localStorage after
  // mount so the first paint matches what the server rendered (avoids
  // hydration mismatches on a flag-driven open state).
  const [open, setOpen] = useState<boolean>(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setOpen(true);
      else if (stored === "0") setOpen(false);
    } catch {
      // localStorage may be unavailable (private mode, SSR replay) —
      // silently fall back to defaultOpen.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // ignore — see above.
    }
  }, [open]);

  return (
    <section
      className={`rounded-lg border border-border/60 bg-surface-inset/30 ${className ?? ""}`}
      data-today-metrics-disclosure={open ? "open" : "closed"}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-inset/40 transition-colors rounded-lg"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden
            className={`inline-block text-[10px] text-muted-foreground transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
          <span className="text-[12px] font-semibold text-foreground">
            Topic + prompt depth
          </span>
          <span className="text-[10px] text-muted-foreground/70">
            descriptors · answer shape · prompt decisions
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-5" data-today-metrics-content>
          {children}
        </div>
      )}
    </section>
  );
}
