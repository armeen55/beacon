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

/** Change-type options for the manual record form (value ⇒ label). */
const CHANGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Auto (use the Change Pack)" },
  { value: "edit_title", label: "Title" },
  { value: "edit_meta", label: "Meta description" },
  { value: "change_h1", label: "Page headline (H1)" },
  { value: "intro_answer_block", label: "Answer block (top of page)" },
  { value: "section_add", label: "New section / depth" },
  { value: "faq", label: "Visible Q&A" },
  { value: "schema", label: "Structured data (schema)" },
  { value: "add_internal_link", label: "Internal links" },
  { value: "keep_current", label: "Keep current (monitor only)" },
  { value: "monitor", label: "Monitor only" },
  { value: "change", label: "Other change" },
];

const FIELD_LABEL = "block text-[11px] font-medium text-foreground/80";
const FIELD_INPUT =
  "mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60";

/**
 * Record a shipped change for ANY page (not just review-approved ones). Quick
 * path: paste a page path ("/cities") or full URL, click Record — the server
 * pulls before/after from the Change Pack, snapshots the GSC baseline, auto-picks
 * control pages, and starts measuring. "Add details" lets the operator override
 * the change type, before/after copy, ship date, target queries, notes, and mark
 * it verified live. The manual-ship companion to pasting the change in your CMS.
 */
export function RecordAnyPageForm() {
  const router = useRouter();
  const [pageUrl, setPageUrl] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [changeType, setChangeType] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [shippedAt, setShippedAt] = useState("");
  const [targetQueries, setTargetQueries] = useState("");
  const [notes, setNotes] = useState("");
  const [verifiedLive, setVerifiedLive] = useState(false);
  const [liveSourceUrl, setLiveSourceUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const reset = () => {
    setPageUrl("");
    setChangeType("");
    setBefore("");
    setAfter("");
    setShippedAt("");
    setTargetQueries("");
    setNotes("");
    setVerifiedLive(false);
    setLiveSourceUrl("");
  };

  const submit = () => {
    const value = pageUrl.trim();
    if (!value) return;
    startTransition(async () => {
      setFeedback(null);
      const res = await recordShippedChangeAction({
        pageUrl: value,
        changeType: changeType || undefined,
        before: before.trim() || undefined,
        after: after.trim() || undefined,
        shippedAt: shippedAt || undefined,
        targetQueries: targetQueries.trim() || undefined,
        notes: notes.trim() || undefined,
        verifiedLive: verifiedLive || undefined,
        liveSourceUrl: liveSourceUrl.trim() || undefined,
      });
      if (res.success) {
        setFeedback({ message: "Recorded. Now measuring below.", isError: false });
        reset();
        setShowDetails(false);
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
            if (e.key === "Enter" && !showDetails) submit();
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

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="mt-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {showDetails ? "− Hide details" : "+ Add details (change type, before/after, date)"}
      </button>

      {showDetails ? (
        <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={FIELD_LABEL} htmlFor="proof-change-type">
                Change type
              </label>
              <select
                id="proof-change-type"
                value={changeType}
                onChange={(e) => setChangeType(e.target.value)}
                className={FIELD_INPUT}
              >
                {CHANGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="proof-shipped-at">
                Shipped (date / time)
              </label>
              <input
                id="proof-shipped-at"
                type="datetime-local"
                value={shippedAt}
                onChange={(e) => setShippedAt(e.target.value)}
                className={FIELD_INPUT}
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                Leave blank for now. The 7 / 14 / 28-day windows count from here.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={FIELD_LABEL} htmlFor="proof-before">
                Before
              </label>
              <textarea
                id="proof-before"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
                rows={3}
                placeholder="The old copy (leave blank to use the Change Pack draft)"
                className={FIELD_INPUT + " resize-y"}
              />
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="proof-after">
                After
              </label>
              <textarea
                id="proof-after"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                rows={3}
                placeholder="The new copy you shipped"
                className={FIELD_INPUT + " resize-y"}
              />
            </div>
          </div>

          <div>
            <label className={FIELD_LABEL} htmlFor="proof-queries">
              Target queries (one per line, or comma-separated)
            </label>
            <textarea
              id="proof-queries"
              value={targetQueries}
              onChange={(e) => setTargetQueries(e.target.value)}
              rows={2}
              placeholder="biggest cities in iran&#10;largest cities in iran"
              className={FIELD_INPUT + " resize-y"}
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              Leave blank to use the page&apos;s top Search queries.
            </p>
          </div>

          <div>
            <label className={FIELD_LABEL} htmlFor="proof-notes">
              Notes
            </label>
            <textarea
              id="proof-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Why you made this change, anything to remember when you judge it"
              className={FIELD_INPUT + " resize-y"}
            />
          </div>

          <div className="rounded-md border border-border/50 bg-background/60 p-2.5">
            <label className="flex items-start gap-2 text-[12px] text-foreground/90">
              <input
                type="checkbox"
                checked={verifiedLive}
                onChange={(e) => setVerifiedLive(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I confirmed this change is live on the site.
                <span className="block text-[10px] text-muted-foreground/70">
                  Check this once you can see the new copy on the live page.
                </span>
              </span>
            </label>
            {verifiedLive ? (
              <input
                type="text"
                value={liveSourceUrl}
                onChange={(e) => setLiveSourceUrl(e.target.value)}
                placeholder="Live URL you verified it at (optional)"
                className={FIELD_INPUT}
              />
            ) : null}
          </div>
        </div>
      ) : null}

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
      <span className="text-[11px] text-emerald-700">✓ Recorded, measuring below</span>
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
              setFeedback({ message: "Recorded. Now measuring.", isError: false });
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

/**
 * Manual rollback helper: copies the BEFORE copy to the clipboard so the operator
 * can paste it back into the CMS to revert. Beacon never auto-reverts a live page.
 */
export function RollbackCopyButton({ before }: { before: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(before);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked — operator can still read the before text above */
        }
      }}
      className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
      title="Copy the original (before) copy so you can paste it back into your CMS to roll back. Beacon never auto-reverts."
    >
      {copied ? "Copied before copy ✓" : "Roll back: copy before"}
    </button>
  );
}

export function RecomputeLedgerButton({
  disabled = false,
  disabledReason,
}: {
  /** No measurement window has closed yet ⇒ nothing to recompute. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            setFeedback(null);
            const res = await recomputeProofLedgerAction();
            setFeedback(res.success ? "Recomputed." : res.error ?? "Failed.");
            if (res.success) router.refresh();
          })
        }
        className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        title={
          disabled
            ? disabledReason ?? "No measurement window has closed yet."
            : "Re-measure every recorded change against the latest Search data."
        }
      >
        {pending ? "Recomputing…" : "Recompute outcomes"}
      </button>
      {disabled && disabledReason ? (
        <span className="text-[11px] text-muted-foreground/70">{disabledReason}</span>
      ) : null}
      {feedback ? <span className="text-[11px] text-muted-foreground">{feedback}</span> : null}
    </span>
  );
}
