import type { BriefRetrospective as BriefRetroType } from "@/domains/briefs/types";
import type { EffortLevel } from "@/lib/constants";
import { EFFORT_LEVEL_LABELS } from "@/lib/constants";
import { EffortBadge } from "@/components/display/effort-badge";

export function BriefRetrospective({
  retro,
  plannedEffort,
}: {
  retro: BriefRetroType;
  plannedEffort: EffortLevel;
}) {
  const effortChanged = retro.actual_effort !== plannedEffort;

  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground">
        Retrospective
      </h3>

      <div className="rounded-md border border-border-subtle bg-surface-raised p-4 space-y-3">
        <p className="text-[13px] text-foreground-secondary leading-relaxed">
          {retro.summary}
        </p>

        <div className="grid grid-cols-2 gap-4">
          {retro.what_worked && (
            <div>
              <p className="text-[11px] font-medium text-status-success mb-1">
                What worked
              </p>
              <p className="text-[12px] text-foreground-secondary leading-relaxed">
                {retro.what_worked}
              </p>
            </div>
          )}
          {retro.what_didnt && (
            <div>
              <p className="text-[11px] font-medium text-status-danger mb-1">
                What didn&apos;t
              </p>
              <p className="text-[12px] text-foreground-secondary leading-relaxed">
                {retro.what_didnt}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 pt-1 border-t border-border-subtle text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Actual effort:</span>
            <EffortBadge effort={retro.actual_effort} />
            {effortChanged && (
              <span className="text-muted-foreground">
                (planned: {EFFORT_LEVEL_LABELS[plannedEffort]})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Would repeat:</span>
            <span
              className={
                retro.would_repeat
                  ? "text-status-success font-medium"
                  : "text-status-danger font-medium"
              }
            >
              {retro.would_repeat ? "Yes" : "No"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
