"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { updateOpportunityStatus } from "@/domains/opportunities/actions";
import { updateBriefStatus } from "@/domains/briefs/actions";
import {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_STATUS_LABELS,
  BRIEF_STATUSES,
  BRIEF_STATUS_LABELS,
} from "@/lib/constants";
import type { OpportunityStatus, BriefStatus } from "@/lib/constants";

function StatusDropdown<T extends string>({
  value,
  options,
  labels,
  onSelect,
}: {
  value: T;
  options: readonly T[];
  labels: Record<string, string>;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSelect = (newValue: T) => {
    if (newValue === value) {
      setOpen(false);
      return;
    }
    setOpen(false);
    startTransition(() => {
      onSelect(newValue);
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-all",
          "border border-border hover:border-accent-primary/30 cursor-pointer",
          isPending && "opacity-50 pointer-events-none"
        )}
      >
        {labels[value]}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              className={cn(
                "w-full text-left px-3 py-1.5 text-[12px] transition-colors",
                opt === value
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-foreground-secondary hover:bg-surface-raised"
              )}
            >
              {labels[opt]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OpportunityStatusSelect({
  opportunityId,
  currentStatus,
}: {
  opportunityId: string;
  currentStatus: OpportunityStatus;
}) {
  return (
    <StatusDropdown
      value={currentStatus}
      options={OPPORTUNITY_STATUSES}
      labels={OPPORTUNITY_STATUS_LABELS}
      onSelect={(status) =>
        updateOpportunityStatus(opportunityId, status as OpportunityStatus)
      }
    />
  );
}

export function BriefStatusSelect({
  briefId,
  currentStatus,
}: {
  briefId: string;
  currentStatus: BriefStatus;
}) {
  return (
    <StatusDropdown
      value={currentStatus}
      options={BRIEF_STATUSES}
      labels={BRIEF_STATUS_LABELS}
      onSelect={(status) =>
        updateBriefStatus(briefId, status as BriefStatus)
      }
    />
  );
}
