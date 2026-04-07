"use client";

import { useTransition, useState } from "react";
import { updateActionState } from "@/domains/actions/actions";
import type { OperatorState } from "@/domains/actions/types";
import { OPERATOR_STATE_LABELS } from "@/domains/actions/types";

export function ActionStateButton({
  actionId,
  currentState,
  targetState,
  label,
  className,
}: {
  actionId: string;
  currentState: OperatorState;
  targetState: OperatorState;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (currentState === targetState) return null;

  return (
    <button
      disabled={pending}
      className={`text-[11px] font-medium px-2 py-1 rounded border transition-colors disabled:opacity-50 ${className ?? "border-border hover:bg-surface-inset"}`}
      onClick={() =>
        startTransition(async () => {
          await updateActionState(actionId, targetState);
        })
      }
    >
      {pending ? "…" : label ?? OPERATOR_STATE_LABELS[targetState]}
    </button>
  );
}

export function ActionStateControls({
  actionId,
  currentState,
}: {
  actionId: string;
  currentState: OperatorState;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {currentState === "new" && (
        <ActionStateButton
          actionId={actionId}
          currentState={currentState}
          targetState="in_progress"
          label="Start"
          className="border-accent-primary/30 text-accent-primary hover:bg-accent-primary/10"
        />
      )}
      {(currentState === "new" || currentState === "in_progress") && (
        <>
          <ActionStateButton
            actionId={actionId}
            currentState={currentState}
            targetState="done"
            label="Done"
            className="border-status-success/30 text-status-success hover:bg-status-success/10"
          />
          <ActionStateButton
            actionId={actionId}
            currentState={currentState}
            targetState="dismissed"
            label="Dismiss"
            className="border-border text-muted-foreground hover:bg-surface-inset"
          />
        </>
      )}
      {currentState === "done" && (
        <ActionStateButton
          actionId={actionId}
          currentState={currentState}
          targetState="new"
          label="Reopen"
          className="border-border text-muted-foreground hover:bg-surface-inset"
        />
      )}
      {currentState === "dismissed" && (
        <ActionStateButton
          actionId={actionId}
          currentState={currentState}
          targetState="new"
          label="Reopen"
          className="border-border text-muted-foreground hover:bg-surface-inset"
        />
      )}
    </div>
  );
}
