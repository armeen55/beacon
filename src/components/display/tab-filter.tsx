"use client";

import { cn } from "@/lib/utils";

type Tab = {
  label: string;
  value: string;
  count?: number;
};

type TabFilterProps = {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function TabFilter({ tabs, value, onChange, className }: TabFilterProps) {
  return (
    <div className={cn("flex items-center gap-0.5 border-b border-border", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "px-3 py-2 text-[12px] font-medium transition-colors relative",
            value === tab.value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                "ml-1.5 tabular-nums",
                value === tab.value
                  ? "text-foreground-secondary"
                  : "text-muted-foreground/60"
              )}
            >
              {tab.count}
            </span>
          )}
          {value === tab.value && (
            <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-foreground rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}
