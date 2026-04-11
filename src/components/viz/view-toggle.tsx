"use client";

import { cn } from "@/lib/utils";

export type ViewMode = string;

export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  size = "default",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "default" | "sm";
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center rounded-full bg-surface-inset/60 p-0.5 ring-1 ring-border/30",
        size === "sm" && "text-[10px]",
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative rounded-full px-2.5 py-1 font-medium transition-all duration-200",
              size === "sm" ? "text-[10px] px-2 py-0.5" : "text-[11px]",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
