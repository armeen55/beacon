"use client";

import { cn } from "@/lib/utils";

export type FilterChip = {
  id: string;
  label: string;
  active: boolean;
};

export function FilterChips({
  chips,
  onToggle,
  label,
  allowMultiple = true,
}: {
  chips: FilterChip[];
  onToggle: (id: string) => void;
  label?: string;
  allowMultiple?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {label && (
        <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide shrink-0">
          {label}
        </span>
      )}
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onToggle(chip.id)}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium transition-all duration-150 border",
            chip.active
              ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30"
              : "bg-transparent text-muted-foreground border-border/30 hover:border-border/60 hover:text-foreground",
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
