"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/display/progress-bar";
import {
  toggleChecklistItem,
  addChecklistItem,
} from "@/domains/briefs/actions";
import type { ChecklistItem } from "@/domains/briefs/types";
import type { ChecklistItemStatus } from "@/lib/constants";
import { getBriefProgress } from "@/domains/briefs/utils";

function ChecklistIcon({ status }: { status: ChecklistItemStatus }) {
  switch (status) {
    case "done":
      return <Check className="h-3.5 w-3.5 text-status-success shrink-0" />;
    case "in_progress":
      return (
        <span className="flex h-3.5 w-3.5 items-center justify-center shrink-0">
          <span className="h-3 w-3 rounded-full border-2 border-accent-primary" />
        </span>
      );
    case "pending":
      return (
        <span className="flex h-3.5 w-3.5 items-center justify-center shrink-0">
          <span className="h-3 w-3 rounded-full border-2 border-border-subtle" />
        </span>
      );
    case "skipped":
      return <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
  }
}

export function InteractiveChecklist({
  briefId,
  checklist,
  changeNames,
}: {
  briefId: string;
  checklist: ChecklistItem[];
  changeNames: Record<string, string>;
}) {
  const [isPending, startTransition] = useTransition();
  const [newItemLabel, setNewItemLabel] = useState("");

  const progress = getBriefProgress(checklist);
  const sorted = [...checklist].sort((a, b) => a.sort_order - b.sort_order);

  const handleToggle = (itemId: string) => {
    startTransition(async () => {
      await toggleChecklistItem(briefId, itemId);
    });
  };

  const handleAddItem = () => {
    if (!newItemLabel.trim()) return;
    const label = newItemLabel;
    setNewItemLabel("");
    startTransition(async () => {
      await addChecklistItem(briefId, label);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">
          Checklist
        </h3>
        <span className="text-[12px] text-muted-foreground">
          {progress.done}/{progress.total} complete
        </span>
      </div>

      <ProgressBar
        value={progress.percentage}
        variant={
          progress.percentage === 100
            ? "success"
            : progress.percentage >= 50
              ? "default"
              : "warning"
        }
      />

      <ul className={cn("space-y-1", isPending && "opacity-70 pointer-events-none")}>
        {sorted.map((item) => {
          const changeName = item.linked_changelog_id
            ? changeNames[item.linked_changelog_id]
            : null;

          return (
            <li key={item.id} className="flex items-start gap-2 py-1">
              <button
                onClick={() => handleToggle(item.id)}
                disabled={item.status === "skipped"}
                className="mt-0.5 hover:opacity-70 transition-opacity disabled:cursor-not-allowed"
              >
                <ChecklistIcon status={item.status} />
              </button>
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "text-[13px] leading-snug",
                    item.status === "done"
                      ? "text-muted-foreground line-through"
                      : item.status === "skipped"
                        ? "text-muted-foreground"
                        : "text-foreground-secondary"
                  )}
                >
                  {item.label}
                </span>
                {changeName && item.linked_changelog_id && (
                  <Link
                    href={`/changes/${item.linked_changelog_id}`}
                    className="ml-1.5 text-[11px] text-accent-primary hover:underline"
                  >
                    → {changeName}
                  </Link>
                )}
                {item.notes && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.notes}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-2 pt-1">
        <input
          value={newItemLabel}
          onChange={(e) => setNewItemLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddItem();
            }
          }}
          placeholder="Add checklist item…"
          disabled={isPending}
          className="flex-1 text-[13px] bg-transparent border-b border-border/50 py-1 placeholder:text-muted-foreground/40 focus:outline-none focus:border-accent-primary/40 transition-colors"
        />
        <button
          onClick={handleAddItem}
          disabled={isPending || !newItemLabel.trim()}
          className="text-muted-foreground hover:text-accent-primary transition-colors disabled:opacity-30"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
