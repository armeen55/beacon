"use client";

import { useState, useTransition } from "react";
import { promoteToOpportunity } from "@/domains/opportunity-candidates/actions";
import type { OpportunityCandidate } from "@/domains/opportunity-candidates/types";

export function PromoteCandidateButton({
  candidate,
}: {
  candidate: OpportunityCandidate;
}) {
  const [isPending, startTransition] = useTransition();
  const [promoted, setPromoted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (candidate.alreadyExists) {
    return (
      <span className="text-[10px] text-muted-foreground italic">
        Already tracked
      </span>
    );
  }

  if (promoted) {
    return (
      <span className="text-[10px] text-status-success font-medium">
        Saved as draft
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            const result = await promoteToOpportunity(candidate);
            if (result.success) {
              setPromoted(true);
            } else {
              setError(result.error ?? "Failed");
            }
          });
        }}
        className="text-[11px] font-medium text-accent-primary hover:text-accent-primary/80 transition-colors disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Add draft opportunity"}
      </button>
      {error && (
        <span className="text-[10px] text-status-danger">{error}</span>
      )}
    </div>
  );
}
