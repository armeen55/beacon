"use client";

import { useRef, useState, useTransition } from "react";
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
  { value: "", label: "Choose the field you changed" },
  { value: "edit_title", label: "Page title" },
  { value: "edit_meta", label: "Meta description" },
  { value: "change_h1", label: "Main heading" },
];

/** Item 23 - shared visible keyboard-focus ring for every interactive element here. */
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1";

const FIELD_LABEL = "block text-[11px] font-medium text-foreground/80";
const FIELD_INPUT =
  `mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60 ${FOCUS}`;
const localMinute = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

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
  const [showDetails, setShowDetails] = useState(true);
  const [changeType, setChangeType] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [shippedAt, setShippedAt] = useState("");
  const [foldLater, setFoldLater] = useState(false);
  const [targetQueries, setTargetQueries] = useState("");
  const [notes, setNotes] = useState("");
  const eventId = useRef<string | null>(null), firstNow = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const reset = () => {
    setPageUrl("");
    setChangeType("");
    setBefore("");
    setAfter("");
    setShippedAt("");
    setFoldLater(false);
    setTargetQueries("");
    setNotes("");
    eventId.current = null; firstNow.current = null;
  };

  const first = shippedAt ? new Date(shippedAt) : null;
  const fold = first && Number.isFinite(first.getTime()) ? [30, 60, 90, 120].find((n) => localMinute(new Date(first.getTime() + n * 60_000)) === shippedAt.slice(0, 16)) ?? 0 : 0;
  const submit = () => {
    const value = pageUrl.trim();
    if (!value) return;
    const entered = shippedAt ? new Date(shippedAt) : new Date(firstNow.current ?? new Date().toISOString());
    if (!Number.isFinite(entered.getTime()) || shippedAt && localMinute(entered) !== shippedAt.slice(0, 16)) {
      setFeedback({ message: "That local time does not exist here. Choose another time.", isError: true }); return;
    }
    const instant = foldLater && fold ? new Date(entered.getTime() + fold * 60_000) : entered;
    if (!shippedAt) firstNow.current ??= instant.toISOString();
    eventId.current ??= crypto.randomUUID();
    startTransition(async () => {
      setFeedback(null);
      const res = await recordShippedChangeAction({
        pageUrl: value,
        eventId: eventId.current!,
        changeType: changeType || undefined,
        before: before.trim() || undefined,
        after: after.trim() || undefined,
        shippedAt: instant.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        offsetMinutes: -instant.getTimezoneOffset(),
        targetQueries: targetQueries.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.success) {
        setFeedback({ message: "Recorded. Beacon will check the live page; Results will show when measurement is available.", isError: false });
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
      <div className="text-[13px] font-semibold text-foreground">Record an edit made outside this queue</div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        Changed a page title, meta description, or main heading yourself? Enter the exact before and after wording.
        Beacon checks the live page and measures what the available data supports. Nothing publishes.
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
          disabled={pending || !pageUrl.trim() || !changeType || !before.trim() || !after.trim()}
          onClick={submit}
          className={`rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50 ${FOCUS}`}
        >
          {pending ? "Saving…" : "Mark done"}
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
                onChange={(e) => { setShippedAt(e.target.value); setFoldLater(false); }}
                className={FIELD_INPUT}
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Your local time; leave blank for now. Results uses the Pacific reporting day for its 7, 14 and 28 day reads.
              </p>
              {fold > 0 ? <label className={FIELD_LABEL}>When clocks repeated this time
                <select value={foldLater ? "later" : "earlier"} onChange={(e) => setFoldLater(e.target.value === "later")} className={FIELD_INPUT}>
                  <option value="earlier">First occurrence</option><option value="later">Second occurrence</option>
                </select>
              </label> : null}
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
              Searches this page should win (one per line, or comma-separated)
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
  /** No read has closed yet, so there is nothing to recompute. */
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
            ? disabledReason ?? "No read has closed yet."
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
