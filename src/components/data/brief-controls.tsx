"use client";

import { useState, useTransition } from "react";
import {
  acceptProposedBrief,
  rejectProposedBrief,
} from "@/domains/brief-generation/actions";
import type { ProposedBrief } from "@/domains/brief-generation/types";

export function BriefAcceptReject({
  brief,
}: {
  brief: ProposedBrief;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<"accepted" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (brief.status === "accepted" || result === "accepted") {
    return (
      <span className="text-[10px] text-status-success font-medium">
        Accepted
      </span>
    );
  }

  if (brief.status === "rejected" || result === "rejected") {
    return (
      <span className="text-[10px] text-muted-foreground italic">
        Rejected
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
            const res = await acceptProposedBrief(brief);
            if (res.success) setResult("accepted");
            else setError(res.error ?? "Failed");
          });
        }}
        className="text-[11px] font-medium text-status-success hover:text-status-success/80 transition-colors disabled:opacity-50"
      >
        {isPending ? "…" : "Accept"}
      </button>
      <button
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            await rejectProposedBrief(brief.id);
            setResult("rejected");
          });
        }}
        className="text-[11px] font-medium text-muted-foreground hover:text-status-danger transition-colors disabled:opacity-50"
      >
        Reject
      </button>
      {error && (
        <span className="text-[10px] text-status-danger">{error}</span>
      )}
    </div>
  );
}
