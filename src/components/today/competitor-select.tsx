"use client";

/**
 * W2 Step 2.3 (master plan) — competitor selector for "Who AI thinks
 * they are". localStorage-persisted so the operator's last comparison
 * target sticks across reloads.
 *
 * Pure consumer of `buildCompetitorDropdown()` output — never invents
 * options, never computes which to default to. The data layer's
 * `isDefault: true` flag wins on first mount; localStorage overrides
 * it on subsequent visits when the stored choice still appears in
 * the dropdown. Stale stored choices (e.g., a competitor that's no
 * longer in the registry) silently fall back to the data-layer default.
 */

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type { CompetitorDropdownEntry } from "@/domains/prompt-answer-observations/enrichment-rollup";

const STORAGE_KEY = "beacon:today:enrichment-v2:competitor";

export type CompetitorSelectProps = {
  options: ReadonlyArray<CompetitorDropdownEntry>;
  value: string;
  onChange: (next: string) => void;
  className?: string;
};

export function CompetitorSelect({
  options,
  value,
  onChange,
  className,
}: CompetitorSelectProps) {
  // Hydrate from localStorage on mount — only when the stored choice
  // actually appears in the current dropdown options. Stale stored
  // names (e.g. a competitor removed from the registry) are ignored.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      if (stored === value) return;
      if (options.some((o) => o.name === stored)) onChange(stored);
    } catch {
      // localStorage unavailable — silent fallback to data-layer default.
    }
    // Intentionally only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever value changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // ignore
    }
  }, [value]);

  if (options.length === 0) return null;

  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className="sr-only">Compare to</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "bg-transparent text-foreground font-medium",
          "border-0 border-b border-dashed border-muted-foreground/40",
          "px-0.5 py-0.5 cursor-pointer",
          "focus:outline-none focus:border-accent-primary",
        )}
      >
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name}
            {o.hasDescriptorData ? "" : " (warming up)"}
          </option>
        ))}
      </select>
      <span aria-hidden className="text-muted-foreground/60">
        ▾
      </span>
    </label>
  );
}
