"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";

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
  { value: "", label: "Auto (name it for me)" },
  { value: "new_page", label: "New page" },
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

/** Item 23 - shared visible keyboard-focus ring for every interactive element here. */
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

const FIELD_LABEL = "block text-[11px] font-medium text-foreground/80";
const FIELD_INPUT =
  `mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 ${FOCUS}`;

/**
 * Record a shipped change for ANY page. Paste a page path ("/cities") or full
 * URL, add the change type and the before/after copy under "Add details", click
 * Record: the server snapshots the GSC baseline, auto-picks control pages, and
 * starts measuring. The manual-ship companion to pasting the change in your CMS.
 */
export function RecordAnyPageForm({ initialPage = "" }: { initialPage?: string }) {
  const router = useRouter();
  // initialPage prefills from a /results?page=... hand-off so recording a
  // shipped change never means re-typing the path.
  const [pageUrl, setPageUrl] = useState(initialPage);
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
      <div className="text-[13px] font-semibold text-foreground">Tell us about an edit you made</div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Changed a page yourself (for example, in Wix)? Paste the page address plus the before and after copy
        under Add details, and Beacon will record where it stands today, pick similar pages to
        compare against, and check after 1, 2, and 4 weeks whether more people found you. Nothing publishes.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={pageUrl}
          onChange={(e) => setPageUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !showDetails) submit();
          }}
          placeholder="/pricing  or  https://your-site.com/pricing"
          className={`min-w-[260px] flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 ${FOCUS}`}
        />
        <button
          type="button"
          disabled={pending || !pageUrl.trim()}
          onClick={submit}
          className={`rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50 ${FOCUS}`}
        >
          {pending ? "Saving…" : "I made this change"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className={`mt-2 inline-flex items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground hover:text-foreground ${FOCUS}`}
      >
        {showDetails ? (
          <>
            <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Hide details
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Add details (change type, before/after, date)
          </>
        )}
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
              <p className="mt-0.5 text-[10px] text-muted-foreground">
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
                placeholder="The copy as it was before your change"
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
              placeholder="the search you want this page to win&#10;another search for the same page"
              className={FIELD_INPUT + " resize-y"}
            />
            <p className="mt-0.5 text-[10px] text-muted-foreground">
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
                className={`mt-0.5 rounded-sm ${FOCUS}`}
              />
              <span>
                I confirmed this change is live on the site.
                <span className="block text-[10px] text-muted-foreground">
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
            setFeedback(res.success ? "Done, results updated." : res.error ?? "Something went wrong, try again.");
            if (res.success) router.refresh();
          })
        }
        className={`rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 ${FOCUS}`}
        title={
          disabled
            ? disabledReason ?? "No measurement window has closed yet."
            : "Re-measure every recorded change against the latest Search data."
        }
      >
        {pending ? "Checking…" : "Check results"}
      </button>
      {disabled && disabledReason ? (
        <span className="text-[11px] text-muted-foreground/70">{disabledReason}</span>
      ) : null}
      {feedback ? <span className="text-[11px] text-muted-foreground">{feedback}</span> : null}
    </span>
  );
}
