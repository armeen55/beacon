"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  recordShippedChangeAction,
  recomputeProofLedgerAction,
} from "./actions";

/**
 * Operator islands for the GSC Proof ledger (Phase 5, Path B). Read-only proof
 * surface otherwise; these two buttons are the only writes — and neither
 * publishes anything (they only record/measure).
 */

export function RecordShippedButton({
  pageUrl,
  alreadyRecorded,
}: {
  pageUrl: string;
  alreadyRecorded: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  if (alreadyRecorded) {
    return (
      <span className="text-[11px] text-emerald-700">✓ Recorded — measuring below</span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFeedback(null);
            const res = await recordShippedChangeAction({ pageUrl });
            if (res.success) {
              setFeedback({ message: "Recorded — now measuring.", isError: false });
              router.refresh();
            } else {
              setFeedback({ message: res.error ?? "Failed.", isError: true });
            }
          })
        }
        className="rounded-md border border-foreground bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90 disabled:opacity-50"
        title="Confirm you shipped this change live (e.g. manually in Wix). Beacon snapshots the Search baseline now and measures the next 7/14/28 days vs comparable pages. Nothing publishes."
      >
        {pending ? "Recording…" : "Record shipped change"}
      </button>
      {feedback ? (
        <span
          aria-live="polite"
          className={feedback.isError ? "text-[11px] text-rose-600" : "text-[11px] text-emerald-700"}
        >
          {feedback.message}
        </span>
      ) : null}
    </span>
  );
}

export function RecomputeLedgerButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFeedback(null);
            const res = await recomputeProofLedgerAction();
            setFeedback(res.success ? "Recomputed." : res.error ?? "Failed.");
            if (res.success) router.refresh();
          })
        }
        className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        title="Re-measure every recorded change against the latest Search data."
      >
        {pending ? "Recomputing…" : "Recompute outcomes"}
      </button>
      {feedback ? <span className="text-[11px] text-muted-foreground">{feedback}</span> : null}
    </span>
  );
}
