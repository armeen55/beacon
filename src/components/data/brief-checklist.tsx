import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/display/progress-bar";
import type { ChecklistItem } from "@/domains/briefs/types";
import type { ChecklistItemStatus } from "@/lib/constants";
import { getBriefProgress } from "@/domains/briefs/utils";
import { changelogEntries } from "@/lib/seed-data.server";

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

export function BriefChecklist({
  checklist,
}: {
  checklist: ChecklistItem[];
}) {
  const progress = getBriefProgress(checklist);
  const sorted = [...checklist].sort((a, b) => a.sort_order - b.sort_order);

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

      <ul className="space-y-1">
        {sorted.map((item) => {
          const change = item.linked_changelog_id
            ? changelogEntries.find((c) => c.id === item.linked_changelog_id)
            : null;

          return (
            <li key={item.id} className="flex items-start gap-2 py-1">
              <span className="mt-0.5">
                <ChecklistIcon status={item.status} />
              </span>
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
                {change && (
                  <Link
                    href={`/changes/${change.id}`}
                    className="ml-1.5 text-[11px] text-accent-primary hover:underline"
                  >
                    → {change.asset_name}
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
    </div>
  );
}
