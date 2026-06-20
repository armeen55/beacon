"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  recordShippedChangeAction,
  recomputeProofLedgerAction,
} from "./actions";

/**
 * Operator islands for the GSC Proof ledger (Phase 5, Path B). Read-only proof
 * surface otherwise; these are the only writes, and none publishes anything
 * (they only record / measure).
 */

/**
 * Record a shipped change for ANY page (not just review-approved ones). Paste a
 * page path ("/cities") or full URL, click Record. The server captures the GSC
 * baseline + auto-picks control pages and starts measuring. The manual-ship
 * companion to actually pasting the change in your CMS.
 */
export function RecordAnyPageForm() {
  const router = useRouter();
  const [pageUrl, setPageUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const submit = () => {
    const value = pageUrl.trim();
    if (!value) return;
    startTransition(async () => {
      setFeedback(null);
      const res = await recordShippedChangeAction({ pageUrl: value });
      if (res.success) {
        setFeedback({ message: "Recorded — now measuring below.", isError: false });
        setPageUrl("");
        router.refresh();
      } else {
        setFeedback({ message: res.error ?? "Failed.", isError: true });
      }
    });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-surface-inset/30 p-4">
      <div className="text-[13px] font-semibold text-foreground">Record a shipped change</div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Shipped an edit manually (e.g. in Wix)? Paste the page and Beacon snapshots the Search
        baseline, picks comparable control pages, and measures the next 7 / 14 / 28 days. Nothing
        publishes.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={pageUrl}
          onChange={(e) => setPageUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="/cities  or  https://www.iranopedia.com/cities"
          className="min-w-[260px] flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          disabled={pending || !pageUrl.trim()}
          onClick={submit}
          className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Recording…" : "Record"}
        </button>
      </div>
      {feedback ? (
        <p
          aria-live="polite"
          className={
            "mt-2 text-[11px] " + (feedback.isError ? "text-rose-600" : "text-emerald-700")
          }
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

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
