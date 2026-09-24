"use client";

import { createElement, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { BundleComponent } from "@/domains/decision";
import { confirmDangerousChangeAction, dismissProposalAction, finishOneProposalAction, markProposalImplementedAction, reviewDraftAction } from "./actions";
import operatorUiPolicy from "./types";

const MARK_QUEUE_KEY = "beacon.mark-done.queue";
const MARK_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type QueuedMark = { proposalId: string; expectedVersion: string; at: number };

function readMarkQueue(): QueuedMark[] {
  try {
    const rows: unknown = JSON.parse(window.localStorage.getItem(MARK_QUEUE_KEY) ?? "[]");
    const cutoff = Date.now() - MARK_QUEUE_MAX_AGE_MS;
    return Array.isArray(rows)
      ? rows.filter((r: QueuedMark) => typeof r?.proposalId === "string" && typeof r?.expectedVersion === "string" && !!r.expectedVersion && typeof r?.at === "number" && r.at > cutoff)
      : [];
  } catch { return []; }
}
function unboundMarks(): number {
  try {
    const rows: unknown = JSON.parse(window.localStorage.getItem(MARK_QUEUE_KEY) ?? "[]");
    return Array.isArray(rows) ? rows.filter((r: QueuedMark) => typeof r?.proposalId === "string" && typeof r?.at === "number" && r.at > Date.now() - MARK_QUEUE_MAX_AGE_MS && !r.expectedVersion).length : 0;
  } catch { return 0; }
}
function writeMarkQueue(rows: QueuedMark[]): void {
  try { window.localStorage.setItem(MARK_QUEUE_KEY, JSON.stringify(rows)); } catch { /* private mode: the press is simply not kept */ }
}
type PressAnswer = { success: boolean; retryable?: boolean; error?: string };

/** The same success, retry and refusal rule serves a fresh press and offline replay. */
export const MARK_PRESS = {
  /** THE PRESS MADE NOW, one answer in, one ending out (a throw is `null`). `queueable` is the caller's own fact: only a
   *  plain whole-change mark carries nothing this device's queue cannot re-send, so only that one may be kept. */
  fresh(answer: PressAnswer | null, opts: { queueable: boolean }): { ending: "recorded" | "queued" | "unrecorded"; said: string | null } {
    if (answer?.success) return { ending: "recorded", said: null };
    const moment = answer == null || answer.retryable === true;
    if (moment && opts.queueable) return { ending: "queued", said: "Saved on this device. It records itself when the connection returns." };
    return { ending: "unrecorded", said: answer?.error ?? (moment ? "It did not save. Check you are signed in, then press it again." : "Something went wrong.") };
  },
  /** WHAT BECAME OF EVERY PRESS THIS DEVICE WAS HOLDING, over the answers the server gave, in the order they were sent.
   *  `keep` is the positions still owed, so the caller re-queues exactly those rows. */
  flush(answers: readonly (PressAnswer | null)[]): { keep: number[]; said: string } {
    const keep: number[] = [], refused: string[] = [];
    let recorded = 0;
    answers.forEach((a, i) => {
      if (a?.success) recorded += 1;
      else if (a == null || a.retryable) keep.push(i);
      else refused.push(a.error ?? "That one can no longer be recorded.");
    });
    const many = (n: number, a: string, b: string) => (n === 1 ? a : b), held = keep.length;
    return { keep, said: [
      recorded > 0 ? `${recorded} press${many(recorded, "", "es")} held on this device ${many(recorded, "was", "were")} recorded.` : null,
      refused.length > 0 ? `${refused.length} press${many(refused.length, "", "es")} could not be recorded: ${refused.join(" ")}` : null,
      held > 0 ? `${held} press${many(held, "", "es")} held on this device could not be recorded yet and ${many(held, "is", "are")} still waiting. Reload this page to send ${many(held, "it", "them")} again.` : null,
    ].filter(Boolean).join(" ") };
  },
  /** THE PRESS KEPT ON THIS DEVICE until the next load sends it again. */
  keep(proposalId: string, expectedVersion: string): void {
    writeMarkQueue([...readMarkQueue().filter((r) => r.proposalId !== proposalId || r.expectedVersion !== expectedVersion), { proposalId, expectedVersion, at: Date.now() }]);
  },
};

/** ONE flush per page load, whichever card mounts first. What the flush did is said on the card rather than settled
 *  behind the operator's back. */
let markQueueFlushed = false;
function useMarkQueueFlush(): string | null {
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (markQueueFlushed) return;
    markQueueFlushed = true;
    const old = unboundMarks();
    const pending = readMarkQueue();
    writeMarkQueue(pending);
    const oldNotice = old ? `${old} earlier offline press${old === 1 ? "" : "es"} could not be replayed because this device did not save the copy version. Open the change and record exactly what you applied.` : "";
    if (pending.length === 0) { if (oldNotice) setSaid(oldNotice); return; }
    void (async () => {
      const answers: (PressAnswer | null)[] = [];
      for (const row of pending) {
        try { answers.push(await markProposalImplementedAction({ proposalId: row.proposalId, expectedVersion: row.expectedVersion })); } catch { answers.push(null); }
      }
      const { keep, said: says } = MARK_PRESS.flush(answers);
      writeMarkQueue(keep.map((i) => pending[i]!));
      setSaid([says, oldNotice].filter(Boolean).join(" "));
    })();
  }, []);
  return said;
}

/** One copy control serves Today and Changes; `onToast` is the list's optional echo. */
/** THE WORDS OF A LINK CHANGE: the address the underlined words point at. The card says "make the underlined words a link",
 *  so the words are underlined on screen and carried as a real anchor on the clipboard. */
type CopyLink = { href: string; anchor: string; /** The page the copy lands on: the clipboard's anchor is written absolute off its host, so a pasted link resolves anywhere. */ pageUrl?: string | null } | null;
/** The anchor words, marked inside one line of copy: `mark` wraps them, and a line that does not carry them is returned whole. */
const withAnchor = <T,>(line: string, link: CopyLink, plain: (s: string) => T, mark: (s: string) => T): T[] => {
  const at = link?.anchor ? line.indexOf(link.anchor) : -1;
  return at < 0 || !link ? [plain(line)] : [plain(line.slice(0, at)), mark(link.anchor), plain(line.slice(at + link.anchor.length))];
};
export function PublicationCopy({ text, units, link = null }: { text: string; units?: BundleComponent["units"]; link?: CopyLink }) {
  const line = (s: string) => withAnchor<ReactNode>(s, link, (t) => t, (t) => <span key="a" className="underline decoration-accent-primary underline-offset-2">{t}</span>);
  return <div className="space-y-2 whitespace-pre-wrap break-words">{units ? units.map((u, i) =>
    u.kind === "paragraph" ? <p key={i}>{line(u.text)}</p> : u.kind === "heading" ? createElement(`h${u.level}`, { key: i, className: "font-semibold" }, u.text)
      : u.kind === "table" ? <div key={i} className="overflow-x-auto"><table className="w-full border-collapse text-left text-[12px]"><thead><tr>{u.columns.map((column, j) => <th key={j} className="border border-border bg-surface-inset px-2 py-1.5 font-semibold">{line(column)}</th>)}</tr></thead><tbody>{u.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k} className="border border-border px-2 py-1.5 align-top">{line(cell)}</td>)}</tr>)}</tbody></table></div>
        : createElement(u.kind === "ordered_list" ? "ol" : "ul", { key: i, className: `pl-6 ${u.kind === "ordered_list" ? "list-decimal" : "list-disc"}` }, u.items.map((item, j) => <li key={j}>{line(item)}</li>))) : <p>{line(text)}</p>}</div>;
}

/** ONE PAYLOAD FOR EVERY COPY PRESS, on Today and on Changes alike (audit 3.9, 2026-09-14): the rich half is real HTML
 *  (h2 to h6, p, ol, ul, li, and an anchor for a link change), and the plain half is plain words: a heading on its own
 *  line, list items numbered or bulleted, never a # or - marker, because the plain half is what lands in an editor
 *  that takes no HTML, and a page had "## Heading" pasted into it as visible text. */
export function clipboardPayload(text: string, units?: BundleComponent["units"], link: CopyLink = null): { html: string; plain: string } {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const href = link ? operatorUiPolicy.livePageHref(link.href, link.pageUrl) : null;
  const rich = (s: string) => withAnchor(s, href ? link : null, escape, (t) => `<a href="${escape(href!)}">${escape(t)}</a>`).join("");
  const all: NonNullable<BundleComponent["units"]> = units ?? text.split(/\n+/).filter((s) => s.trim()).map((s) => ({ kind: "paragraph" as const, text: s }));
  const html = all.map((u) => u.kind === "paragraph" ? `<p>${rich(u.text)}</p>` : u.kind === "heading" ? `<h${u.level}>${escape(u.text)}</h${u.level}>`
    : u.kind === "table" ? `<table><thead><tr>${u.columns.map((cell) => `<th>${rich(cell)}</th>`).join("")}</tr></thead><tbody>${u.rows.map((row) => `<tr>${row.map((cell) => `<td>${rich(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<${u.kind === "ordered_list" ? "ol" : "ul"}>${u.items.map((item) => `<li>${rich(item)}</li>`).join("")}</${u.kind === "ordered_list" ? "ol" : "ul"}>`).join("");
  const plain = all.map((u) => u.kind === "paragraph" || u.kind === "heading" ? u.text
    : u.kind === "table" ? [u.columns, ...u.rows].map((row) => row.join("\t")).join("\n")
      : u.items.map((item, i) => `${u.kind === "ordered_list" ? `${i + 1}.` : "•"} ${item}`).join("\n")).join("\n\n");
  return { html, plain };
}

export function CopyButton({ text, units, link = null, label, onToast }: { text: string; units?: BundleComponent["units"]; link?: CopyLink; label: string; onToast?: (t: string) => void }) {
  const [said, setSaid] = useState<string | null>(null);
  const say = (s: string, ms: number) => { setSaid(s); setTimeout(() => setSaid(null), ms); };
  const copy = async () => {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    const { html, plain } = clipboardPayload(text, units, link);
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard.write) { await navigator.clipboard.writeText(plain); return "Copied"; }
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    return units?.some((u) => u.kind !== "paragraph") ? "Copied with its structure" : "Copied";
  };
  return (
    <button type="button" data-copy-after="true" aria-live="polite"
      onClick={() => { copy().then(
        (message) => { say(message, 4000); onToast?.(message); },
        () => { say("Copy it by hand", 4000); onToast?.("Your clipboard could not be reached, so please copy it by hand."); }); }}
      className="min-h-11 shrink-0 rounded-md border border-border px-3 py-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2">
      {said ?? label}
    </button>
  );
}

/** "Skip" is the operator's own dismissal, with the consequence stated before they press it. The
 *  store then refuses to re-draft the same change until the evidence itself moves. The LIST owns the
 *  optimistic version of this control; this two-step one is what the detail page asks. */
export function SetAsideChange({ proposalId, finishable = false, prepare = false }: { proposalId: string; finishable?: boolean; prepare?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; asked: boolean; finished: string | null; error: string | null }>({ done: false, asked: false, finished: null, error: null });

  if (state.finished) return <p className="text-[13px] font-semibold text-foreground" data-finish-one-done="true">{state.finished}</p>;
  if (state.done) {
    return (
      <p className="text-[12px] text-muted-foreground" data-set-aside-done="true">
        Skipped. It will not come back unless its evidence changes.
      </p>
    );
  }
  if (!state.asked) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {finishable ? <button type="button" disabled={pending} data-finish-one="true"
          onClick={() => { const authorizationId = prepare ? crypto.randomUUID() : undefined;
            startTransition(async () => { const res = await finishOneProposalAction({ proposalId, ...(prepare ? { prepare: true, authorizationId } : {}) }).catch(() => null);
            setState((s) => ({ ...s, finished: res?.success ? res.note ?? "Finished. This change is ready to copy." : null,
              error: res?.success ? null : res?.error ?? "This change could not be finished just now." })); }); }}
          className="min-h-11 rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">
          {pending ? "Preparing the change…" : prepare ? "Prepare best edit on this page" : "Finish this one"}
        </button> : null}
        {finishable ? <span className="text-[12px] text-muted-foreground">{prepare ? "Each attempt reuses saved evidence; up to $2 OpenAI and $0.40 DataForSEO. Unfinished work and previous receipts stay saved. Research stays paused." : "Free page and evidence checks run first. Only if they pass: one OpenAI review, capped at $0.05. DataForSEO $0. Research stays paused."}</span> : null}
        <button type="button" data-set-aside="true" onClick={() => setState((s) => ({ ...s, asked: true, error: null }))}
          className="inline-flex min-h-11 items-center text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">Skip</button>
        {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
      </div>
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
          if (res.success) setState({ done: true, asked: true, finished: null, error: null });
          else setState({ done: false, asked: true, finished: null, error: res.error ?? "Something went wrong." });
        })}
        className="min-h-11 rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground disabled:opacity-60">
        {pending ? "Saving…" : "Yes, skip it"}
      </button>
      <button type="button" onClick={() => setState({ done: false, asked: false, finished: null, error: null })}
        className="inline-flex min-h-11 items-center text-[12px] text-muted-foreground underline underline-offset-2">
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
      <button type="button" disabled={!state.ticked || pending} data-confirm-dangerous="true" className="min-h-11 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground disabled:opacity-60"
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
          className="min-h-11 rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {pending ? "Saving…" : "Approve as ready"}
        </button>
      ) : null}
      <button type="button" data-improve-draft="true" disabled={pending} onClick={() => answer("improve")}
        className="min-h-11 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground disabled:opacity-60">
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

/** Record only selected pieces of the displayed version; new pages and risky moves require their additional facts. */
export function MarkImplemented({ proposalId, expectedVersion, label: idle = "Mark done", components, newPage = false, inPlaceLink = false, onRecorded }: {
  proposalId: string;
  expectedVersion: string;
  label?: string;
  /** Fired once the server accepted the record, so the card that hosts this can flip itself in place. */
  onRecorded?: (note: string | null) => void;
  /** The bundle's pieces (several = a picker), each with the STABLE id it carries inside the stored bundle so
   *  two pieces of one kind are ticked apart. `moves` marks one that changes where the page lives;
   *  `recorded` marks one already on file. */
  components?: { id: string; kind: string; label: string; dependsOn?: readonly string[]; moves?: boolean; recorded?: boolean }[];
  /** A page that did not exist has no address until they publish it, so the address has to be given here. */
  newPage?: boolean;
  inPlaceLink?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; error: string | null; note: string | null; queued?: boolean }>({ done: false, error: null, note: null });
  const flushed = useMarkQueueFlush();
  const pickable = components && components.length > 1 ? components : null;
  // Recording measurement is a deliberate claim. A multi-piece change starts empty; the operator ticks only
  // what actually reached the site, and already-recorded pieces cannot be selected again.
  const [applied, setApplied] = useState<Set<string>>(() => new Set(pickable ? [] : (components ?? []).filter((c) => !c.recorded).map((c) => c.id)));
  // THE EXACT WORDING THEY APPLIED, where it is not the prepared wording. Named as that and as nothing else: free text under a vague label reads as replacement copy and was recorded as a comment, so a page written the operator's own way was read back against words nobody put there.
  const [ownWording, setOwnWording] = useState(""), [liveUrl, setLiveUrl] = useState(""), [confirmed, setConfirmed] = useState(false);
  const label = useMemo(() => (state.done ? "Marked done" : idle), [state.done, idle]);
  const nothingPicked = pickable != null && applied.size === 0, addressOwed = newPage && liveUrl.trim().length === 0;
  // THE DELIBERATE YES, asked only about the pieces they say they applied. The server asks again and refuses
  // without it, so this box is the operator's act and never the gate.
  const movesPage = (components ?? []).some((c) => c.moves && applied.has(c.id));
  const hasLinkedComponents = (components ?? []).some((c) => (c.dependsOn?.length ?? 0) > 0);

  // A PLAIN WHOLE-CHANGE MARK is the only shape this device can re-send faithfully: nothing here narrows what
  // was recorded, and nothing here is the operator's own words.
  const queueable = !newPage && !movesPage && !(pickable && applied.size < pickable.length) && ownWording.trim().length === 0;

  function onClick() {
    startTransition(async () => {
      // A THROWN action is a FAILED action: a signed-out session made this reject silently and the press
      // looked like it landed while the row never changed. Every ending now reaches the operator's eyes, and it
      // is read by the SAME rule the flush reads, so a bad moment the server typed is kept here too instead of
      // being printed once and lost.
      const res = await markProposalImplementedAction({
        proposalId, expectedVersion,
        ...(newPage ? { liveUrl: liveUrl.trim() } : {}),
        ...(pickable && applied.size < pickable.length ? { componentIds: [...applied] } : {}),
        ...(ownWording.trim() ? { appliedText: ownWording.trim() } : {}),
        ...(movesPage ? { destructiveConfirmed: confirmed } : {}),
      }).catch(() => null);
      const end = MARK_PRESS.fresh(res, { queueable });
      if (end.ending === "recorded") { const note = res?.note ?? null; setState({ done: true, error: null, note }); onRecorded?.(note); return; }
      if (end.ending === "queued") MARK_PRESS.keep(proposalId, expectedVersion);
      setState({ done: false, error: end.said, note: null, queued: end.ending === "queued" });
    });
  }

  return (
    <div className="space-y-3">
      {pickable ? (
        <div className="space-y-1.5" data-component-picker="true">
          <p className="text-[12px] font-semibold text-foreground">Which pieces did you apply?</p>
          {/* KEYED BY THE PIECE'S OWN ID: two sections sharing one key ticked and unticked as one. */}
          {pickable.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-2 text-[12px] text-muted-foreground">
              <input type="checkbox" checked={applied.has(c.id)} disabled={c.recorded} className="h-5 w-5 shrink-0"
                data-linked-component={operatorUiPolicy.linkedComponentIds(pickable, c.id).size > 1 ? "true" : undefined}
                onChange={(e) => setApplied((prev) => {
                  const next = new Set(prev);
                  for (const id of operatorUiPolicy.linkedComponentIds(pickable, c.id)) {
                    if (e.target.checked) next.add(id); else next.delete(id);
                  }
                  return next;
                })} />
              {c.label}{c.recorded ? " (already recorded)" : ""}
            </label>
          ))}
          <p className="text-[12px] text-muted-foreground">
            Only the pieces you tick get measured, so leave the ones you skipped unticked.
          </p>
          {hasLinkedComponents ? <p className="text-[12px] text-muted-foreground" data-linked-components="true">
            Visible FAQ copy and its matching structured data stay linked: ticking either selects or clears both.
          </p> : null}
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
      {!inPlaceLink ? <div className="space-y-1.5" data-operator-note="true">
        <label className="block text-[12px] text-muted-foreground" htmlFor={`note-${proposalId}`}>
          Applied different wording? Paste the exact words that are on the page. Both are kept, and the page is read for yours.
        </label>
        <textarea id={`note-${proposalId}`} rows={3} value={ownWording} onChange={(e) => setOwnWording(e.target.value)}
          placeholder="Optional: the exact wording now on the page"
          className="w-full resize-y rounded-md border border-border bg-surface-inset px-3 py-2 text-[12px] text-foreground" />
      </div> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onClick} disabled={pending || state.done || nothingPicked || addressOwed || (movesPage && !confirmed)}
          className="min-h-11 rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60">
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
      {/* WHAT IS STILL THEIRS TO DO after a partial apply, and what became of a press this device was holding. */}
      {flushed ? <p className="text-[12px] leading-relaxed text-muted-foreground" data-mark-flush="true">{flushed}</p> : null}
      {state.note ? <p className="text-[12px] leading-relaxed text-muted-foreground">{state.note}</p> : null}
    </div>
  );
}
