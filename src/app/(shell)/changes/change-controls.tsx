"use client";

/** change-controls - THE FOUR MUTATING CONTROLS, in one place: take the exact words, record that the change was
 *  made, and skip one. Split out of change-card so the card file is only what is SAID about a change and this
 *  file is only what can be DONE about it. Publishing stays MANUAL: nothing here writes to the operator's site.
 *  Every surface that hands over copy or records work renders these same controls, so a press means one thing. */

import { useEffect, useMemo, useState, useTransition } from "react";
import { confirmDangerousChangeAction, dismissProposalAction, markProposalImplementedAction, reviewDraftAction } from "./actions";

/** THE PRESS SURVIVES THE CONNECTION. A "Mark done" that THREW never reached the server, and telling the
 *  operator to press it again puts the burden of a flaky minute on the person who did the work. A plain
 *  whole-change mark is kept on this device and sent again on the next page load. Only plain ones: a partial
 *  bundle, a page move, a new page's address and their own note all carry words this queue does not hold, so
 *  those still ask for a second press rather than recording something narrower than what they did. */
const MARK_QUEUE_KEY = "beacon.mark-done.queue";
const MARK_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type QueuedMark = { proposalId: string; at: number };

function readMarkQueue(): QueuedMark[] {
  try {
    const rows: unknown = JSON.parse(window.localStorage.getItem(MARK_QUEUE_KEY) ?? "[]");
    const cutoff = Date.now() - MARK_QUEUE_MAX_AGE_MS;
    return Array.isArray(rows)
      ? rows.filter((r: QueuedMark) => typeof r?.proposalId === "string" && typeof r?.at === "number" && r.at > cutoff)
      : [];
  } catch { return []; }
}
function writeMarkQueue(rows: QueuedMark[]): void {
  try { window.localStorage.setItem(MARK_QUEUE_KEY, JSON.stringify(rows)); } catch { /* private mode: the press is simply not kept */ }
}
function queueMark(proposalId: string): void {
  writeMarkQueue([...readMarkQueue().filter((r) => r.proposalId !== proposalId), { proposalId, at: Date.now() }]);
}

/** ONE flush per page load, whichever card mounts first. A server that ANSWERS settles the entry either way:
 *  "already recorded" and "no longer eligible" are answers, not outages, and re-sending them forever would
 *  make the device argue with the server. Only a throw, which is the connection again, keeps it queued. */
let markQueueFlushed = false;
function useMarkQueueFlush(): void {
  useEffect(() => {
    if (markQueueFlushed) return;
    markQueueFlushed = true;
    const pending = readMarkQueue();
    writeMarkQueue(pending);
    if (pending.length === 0) return;
    void (async () => {
      const unsent: QueuedMark[] = [];
      for (const row of pending) {
        try { await markProposalImplementedAction({ proposalId: row.proposalId }); }
        catch { unsent.push(row); }
      }
      writeMarkQueue(unsent);
    })();
  }, []);
}

/** The exact words, on the clipboard, in one press. The button itself says it worked for two seconds, because a
 *  toast at the foot of a long list is no answer to a press at the top of it. Nothing is written to the site.
 *  ONE COPY CONTROL FOR THE WHOLE PRODUCT: Today's top edit and the change detail render this same button, so
 *  a pasteable line is never handed over without the press that takes it. `onToast` is the LIST's echo and is
 *  absent everywhere else, because a server-rendered page cannot hand a function to a client component. */
export function CopyButton({ text, label, onToast }: { text: string; label: string; onToast?: (t: string) => void }) {
  const [said, setSaid] = useState<string | null>(null);
  const say = (s: string, ms: number) => { setSaid(s); setTimeout(() => setSaid(null), ms); };
  return (
    <button type="button" data-copy-after="true"
      onClick={() => { navigator.clipboard?.writeText(text).then(
        () => { say("Copied", 2000); onToast?.("Copied"); },
        () => { say("Copy it by hand", 4000); onToast?.("Your clipboard could not be reached, so please copy it by hand."); }); }}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
      {said ?? label}
    </button>
  );
}

/** "Skip" is the operator's own dismissal, with the consequence stated before they press it. The
 *  store then refuses to re-draft the same change until the evidence itself moves. The LIST owns the
 *  optimistic version of this control; this two-step one is what the detail page asks. */
export function SetAsideChange({ proposalId }: { proposalId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; asked: boolean; error: string | null }>({ done: false, asked: false, error: null });

  if (state.done) {
    return (
      <p className="text-[12px] text-muted-foreground" data-set-aside-done="true">
        Skipped. It will not come back unless its evidence changes.
      </p>
    );
  }
  if (!state.asked) {
    return (
      <button type="button" data-set-aside="true" onClick={() => setState((s) => ({ ...s, asked: true }))}
        className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
        Skip
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[12px] text-muted-foreground">
        Skipping this hides it unless its evidence changes. Skip it?
      </span>
      <button type="button" disabled={pending}
        onClick={() => startTransition(async () => {
          const res = await dismissProposalAction({ proposalId });
          if (res.success) setState({ done: true, asked: true, error: null });
          else setState({ done: false, asked: true, error: res.error ?? "Something went wrong." });
        })}
        className="rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground disabled:opacity-60">
        {pending ? "Saving…" : "Yes, skip it"}
      </button>
      <button type="button" onClick={() => setState({ done: false, asked: false, error: null })}
        className="text-[12px] text-muted-foreground underline underline-offset-2">
        Keep it
      </button>
      {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
    </div>
  );
}

/** THE SECOND STEP OF THE TWO-STEP HOLD, and the only control that promotes anything. A change that moves or hides a page is held for a look; this is the look being answered. It renders under the pieces, the addresses, the destination, the copy and the risks the detail page already prints, because a confirmation is worth nothing unless what is being confirmed is on the same screen.
 *  TWO PRESSES, never one: the tick says the operator read the consequences, the button sends the exact version they read, and the server re-reads the row and refuses a version that has moved since. Nothing here writes to the site: it makes the change pasteable, and the operator still pastes it. */
export function ConfirmDangerous({ proposalId, version }: { proposalId: string; version: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: string | null; ticked: boolean; error: string | null }>({ done: null, ticked: false, error: null });
  if (state.done) return <p className="text-[13px] font-semibold text-foreground" data-confirm-done="true">{state.done}</p>;
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-[13px] leading-relaxed text-foreground">
        <input type="checkbox" checked={state.ticked} onChange={(e) => setState((s) => ({ ...s, ticked: e.target.checked }))} className="mt-0.5" data-confirm-tick="true" />
        <span>Read the pieces, the addresses and the risks above. This one moves or hides a page, so it takes a deliberate yes before it becomes work.</span></label>
      <button type="button" disabled={!state.ticked || pending} data-confirm-dangerous="true" className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground disabled:opacity-60"
        onClick={() => startTransition(async () => { const res = await confirmDangerousChangeAction({ proposalId, version });
          setState((s) => ({ ...s, done: res.success ? res.note ?? "Confirmed. This change is ready to make." : null, error: res.success ? null : res.error ?? "That could not be confirmed just now." })); })}>{pending ? "Saving…" : "Confirm this version"}</button>
      {state.error ? <p className="text-[12px] text-red-500">{state.error}</p> : null}
    </div>
  );
}

/** THE TWO ANSWERS A DRAFT CAN GET, beside the words they are about. "Approve as ready" is the operator saying
 *  this wording is good enough to make: it answers EDITORIAL judgement and nothing else, so it is offered only
 *  where the one pure hold rule says a person may answer, and the server re-reads the row and refuses anything
 *  harder by name whatever this screen offers. "Improve this draft" hands it to the next drafting pass and
 *  leaves these words exactly where they are until better ones land. Neither writes to the site. */
export function ReviewAnswer({ proposalId, version, approvable }: { proposalId: string; version: string; approvable: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ note: string | null; error: string | null }>({ note: null, error: null });
  const answer = (decision: "approve" | "improve") => startTransition(async () => {
    const res = await reviewDraftAction({ proposalId, version, decision }).catch(() => null);
    setState({ note: res?.success ? res.note ?? "Saved." : null,
      error: res?.success ? null : res?.error ?? "That could not be saved just now. Press it again in a moment." });
  });
  if (state.note) return <p className="text-[13px] font-semibold text-foreground" data-review-answered="true">{state.note}</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {approvable ? (
        <button type="button" data-approve-draft="true" disabled={pending} onClick={() => answer("approve")}
          className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : "Approve as ready"}
        </button>
      ) : null}
      <button type="button" data-improve-draft="true" disabled={pending} onClick={() => answer("improve")}
        className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground disabled:opacity-60">
        Improve this draft
      </button>
      <span className="text-[12px] leading-relaxed text-muted-foreground">
        {approvable ? "Approving records your name against these exact words and moves it to the ready list."
          : "This one cannot be approved as it stands: what is holding it is a fact about the work, not a matter of taste."}
      </span>
      {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
    </div>
  );
}

/** "Mark done" records that the OPERATOR applied the change. THE PARTIAL-BUNDLE PICKER: three of five pieces
 *  applied must not record five, and the two they skipped stay theirs to do. THE NOTE carries their own words
 *  beside the reading. THE ADDRESS, for a new page only. THE CONFIRMATION, for a piece that moves or hides a
 *  page, which the server asks for again and refuses without. */
export function MarkImplemented({ proposalId, label: idle = "Mark done", components, newPage = false, onRecorded }: {
  proposalId: string;
  label?: string;
  /** Fired once the server accepted the record, so the card that hosts this can flip itself in place. */
  onRecorded?: () => void;
  /** The bundle's pieces (several = a picker), each with the STABLE id it carries inside the stored bundle so
   *  two pieces of one kind are ticked apart. `moves` marks one that changes where the page lives;
   *  `recorded` marks one already on file. */
  components?: { id: string; kind: string; label: string; moves?: boolean; recorded?: boolean }[];
  /** A page that did not exist has no address until they publish it, so the address has to be given here. */
  newPage?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; error: string | null; note: string | null; queued?: boolean }>({ done: false, error: null, note: null });
  useMarkQueueFlush();
  const pickable = components && components.length > 1 ? components : null;
  // OPEN ON WHAT IS GENUINELY STILL THEIRS TO DO: pre-ticking a piece already on file offered to record a
  // component already under measurement, and the server refuses to write it twice anyway.
  const [applied, setApplied] = useState<Set<string>>(() => {
    const all = pickable ?? components ?? [], open = all.filter((c) => !c.recorded);
    return new Set((open.length > 0 ? open : all).map((c) => c.id));
  });
  const [note, setNote] = useState(""), [liveUrl, setLiveUrl] = useState(""), [confirmed, setConfirmed] = useState(false);
  const label = useMemo(() => (state.done ? "Marked done" : idle), [state.done, idle]);
  const nothingPicked = pickable != null && applied.size === 0, addressOwed = newPage && liveUrl.trim().length === 0;
  // THE DELIBERATE YES, asked only about the pieces they say they applied. The server asks again and refuses
  // without it, so this box is the operator's act and never the gate.
  const movesPage = (components ?? []).some((c) => c.moves && applied.has(c.id));

  // A PLAIN WHOLE-CHANGE MARK is the only shape this device can re-send faithfully: nothing here narrows what
  // was recorded, and nothing here is the operator's own words.
  const queueable = !newPage && !movesPage && !(pickable && applied.size < pickable.length) && note.trim().length === 0;

  function onClick() {
    startTransition(async () => {
      // A THROWN action is a FAILED action: a signed-out session made this reject silently and the press
      // looked like it landed while the row never changed. Every ending now reaches the operator's eyes.
      try {
        const res = await markProposalImplementedAction({
          proposalId,
          ...(newPage ? { liveUrl: liveUrl.trim() } : {}),
          ...(pickable && applied.size < pickable.length ? { componentIds: [...applied] } : {}),
          ...(note.trim() ? { operatorNote: note.trim() } : {}),
          ...(movesPage ? { destructiveConfirmed: confirmed } : {}),
        });
        if (res.success) { setState({ done: true, error: null, note: res.note ?? null }); onRecorded?.(); }
        else setState({ done: false, error: res.error ?? "Something went wrong.", note: null });
      } catch {
        if (queueable) {
          queueMark(proposalId);
          setState({ done: false, error: "Saved on this device. It records itself when the connection returns.", note: null, queued: true });
        } else {
          setState({ done: false, error: "It did not save. Check you are signed in, then press it again.", note: null });
        }
      }
    });
  }

  return (
    <div className="space-y-3">
      {pickable ? (
        <div className="space-y-1.5" data-component-picker="true">
          <p className="text-[12px] font-semibold text-foreground">Which pieces did you apply?</p>
          {/* KEYED BY THE PIECE'S OWN ID: two sections sharing one key ticked and unticked as one. */}
          {pickable.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={applied.has(c.id)}
                onChange={(e) => setApplied((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(c.id); else next.delete(c.id);
                  return next;
                })} />
              {c.label}
            </label>
          ))}
          <p className="text-[12px] text-muted-foreground">
            Only the pieces you tick get measured, so leave the ones you skipped unticked.
          </p>
        </div>
      ) : null}

      {newPage ? (
        <div className="space-y-1.5" data-live-url="true">
          <label className="block text-[12px] font-semibold text-foreground" htmlFor={`live-url-${proposalId}`}>
            What address is the new page live at?
          </label>
          <input id={`live-url-${proposalId}`} type="text" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)}
            placeholder="https://yoursite.com/the-new-page"
            className="w-full rounded-md border border-border bg-surface-inset px-3 py-1.5 text-[12px] text-foreground" />
          <p className="text-[12px] text-muted-foreground">That page gets read directly, so the exact address on your own site is required.</p>
        </div>
      ) : null}

      {movesPage ? (
        <label data-destructive-confirm="true" className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Confirmed: this moves or hides a page, and what it does to the site above has been read.
        </label>) : null}
      <div className="space-y-1.5" data-operator-note="true">
        <label className="block text-[12px] text-muted-foreground" htmlFor={`note-${proposalId}`}>
          Wrote it your own way? Add what you put there and your words are kept beside the reading.
        </label>
        <input id={`note-${proposalId}`} type="text" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional: what you actually put on the page"
          className="w-full rounded-md border border-border bg-surface-inset px-3 py-1.5 text-[12px] text-foreground" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onClick} disabled={pending || state.done || nothingPicked || addressOwed || (movesPage && !confirmed)}
          className="rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : label}
        </button>
        <span className="text-[12px] text-muted-foreground">
          {addressOwed ? "Add the address it is live at and the page gets read."
            : nothingPicked ? "Tick at least one piece to start measuring it."
              : movesPage && !confirmed ? "Confirm you meant to move or hide the page to record it."
                : "You apply the change on your site; the page is read back and what it found is reported."}
        </span>
        {/* A press that is safely held is not a failure, so it is never painted as one. */}
        {state.error ? (
          <span data-mark-queued={state.queued ? "true" : undefined}
            className={state.queued ? "text-[12px] text-muted-foreground" : "text-[12px] text-red-500"}>{state.error}</span>
        ) : null}
      </div>
      {/* WHAT IS STILL THEIRS TO DO after a partial apply: the change stays open carrying the rest. */}
      {state.note ? <p className="text-[12px] leading-relaxed text-muted-foreground">{state.note}</p> : null}
    </div>
  );
}
