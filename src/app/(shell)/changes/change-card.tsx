"use client";

/** change-card - ONE ranked change, said in full before anybody opens it: the page it is on, THE EXACT WORDS
 *  THERE NOW, THE EXACT WORDS TO PUT THERE, what it is worth in the operator's own numbers, and one control per
 *  decision. Everything that has to be read rather than done (the whole reason, the steps, the checks) opens in
 *  place, so the list stays a list. "See the change" is still the deep link to the whole investigation, and a
 *  dangerous change carries its hold here as it does everywhere. Publishing stays MANUAL. */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Pill, type PillIntent } from "@/components/ui/pill";
// A client bundle cannot import the server-only kernel facade, so the ONE pure rule for what is dangerous and
// the ONE stable name for a piece come from the contract module itself rather than a copy of them living here.
import { componentIdOf, dangerousComponents } from "@/domains/decision/contracts";
import { receiptComposition } from "@/domains/decision/contracts";
import type { ChangeBundle, ChangeProposal } from "@/domains/decision";
import { dismissProposalAction, markProposalImplementedAction } from "./actions";

/** The producer's own boilerplate. It said the same sentence on all 37 title cards, so it is a footnote under
 *  the list, never a line on a card. */
export const TITLE_FOOTNOTE = "This line says the search in the words people actually run it in.";
/** The one caveat that has to stand on its own line: it says my reading may not be your visitors' reading. */
const CAVEAT_MARK = "different slice of Google";

const RISK: Record<ChangeProposal["riskLevel"], { intent: PillIntent; label: string }> = {
  low: { intent: "neutral", label: "Low risk" }, medium: { intent: "waiting", label: "Medium risk" },
  high: { intent: "attention", label: "High risk" },
};
/** HOW PROVEN THIS EDIT IS, in three words, on every card. `proven` means the exact copy cleared every evidence and safety check;
 *  short of that, a change whose receipt cites a live results page or a page that beats you is early evidence, and one with neither
 *  is my best guess. The operator can act on all three, and this says which risk he is taking. */
function provenChip(p: ChangeProposal, proven: boolean): { intent: PillIntent; label: string } {
  if (proven) return { intent: "live", label: "Proven" };
  const looked = (p.bundle?.receipt.items ?? []).some((i) => i.kind === "serp" || i.kind === "winning_page");
  return looked ? { intent: "measuring", label: "Early evidence" } : { intent: "waiting", label: "My best guess" };
}

const fieldWord = (f: string): string => (f === "meta" ? "description" : f.replace(/_/g, " "));

/** The exact primary action in one line: a bundle's objective, or the field an atomic edit rewrites. */
function primaryAction(p: ChangeProposal): string {
  if (p.bundle) return p.bundle.objective;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  return `Update the ${fieldWord(c.field)} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** THE WORDS THERE NOW AND THE WORDS TO PUT THERE, off the same field the detail page renders. */
function beforeAfter(p: ChangeProposal): { field: string; before: string | null; after: string } {
  const c = p.recommendedChange;
  return c.kind === "new_page"
    ? { field: "title", before: null, after: c.proposedTitle }
    : { field: fieldWord(c.field), before: c.before, after: c.after };
}

/** The paragraph, split so the boilerplate is gone and the caveat stands alone. Sentence-level, so a reason
 *  that carries neither comes back exactly as it was written. */
function splitReason(text: string): { body: string; caveat: string | null } {
  const parts = text.split(/\.\s+/).map((s) => (s.trim().endsWith(".") ? s.trim() : `${s.trim()}.`))
    .filter((s) => s.length > 1 && s !== TITLE_FOOTNOTE);
  const caveat = parts.find((s) => s.includes(CAVEAT_MARK)) ?? null;
  return { body: parts.filter((s) => s !== caveat).join(" "), caveat };
}

/** THE NUMBERS THIS CHANGE IS ABOUT, read back out of the evidence the row already carries and never invented:
 *  a figure I cannot find prints nothing at all. */
function statsOf(p: ChangeProposal): { value: string; label: string }[] {
  const text = `${p.whyItMatters} ${(p.evidence?.hints ?? []).join(" ")}`;
  const grab = (re: RegExp): string | null => re.exec(text)?.[1] ?? null;
  const short = p.upsidePerMonth != null && p.upsidePerMonth > 0
    ? Math.round(p.upsidePerMonth).toLocaleString("en-US")
    : grab(/about ([\d,]+) fewer clicks/);
  return [
    [grab(/showed up in Google ([\d,]+) times/), "times it showed up"],
    [grab(/got ([\d,]+) clicks?/), "clicks it earned"],
    [short, "clicks a month short"],
  ].filter((r): r is [string, string] => r[0] != null).map(([value, label]) => ({ value, label }));
}

/** WHO IS ABOVE HIM TODAY, in the receipt's own words. The winning-page, competitor and results-page facts already
 *  open with the site's own domain, and the ones that read a page carry what it runs; this lifts the first fact that
 *  actually names a site and says it once, loudly, instead of leaving it folded inside the checks list. Nothing is
 *  invented: a receipt with no domain in it gets no line at all. */
function beatenBy(b: ChangeBundle | undefined): string | null {
  const named = (b?.receipt.items ?? [])
    .filter((i) => i.kind === "winning_page" || i.kind === "competitor" || i.kind === "serp")
    .map((i) => i.fact.trim())
    .filter((f) => /\b[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+\b/i.test(f));
  // The fact that says who is ON TOP beats the fact that says who merely appears; either way it is the receipt's own sentence.
  return named.find((f) => /led by|holds|wins|#1/i.test(f)) ?? named[0] ?? null;
}

/** The pieces of a bundle, named the way the server names them, so a tick here is the tick it asks for again. */
const piecesOf = (b: ChangeBundle | undefined) => (b?.components ?? []).map((c, i) => ({
  id: componentIdOf(c, i), kind: c.kind, label: c.label,
  ...(dangerousComponents([c]).length > 0 ? { moves: true } : {}),
}));

export function ChangeCard({ proposal, rank, proven, onAside, onToast }: {
  proposal: ChangeProposal; rank: number; proven: boolean;
  onAside: (id: string) => void; onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const bundle = proposal.bundle;
  const isNew = proposal.kind === "new_page";
  const parts = bundle?.components.length ?? 1;
  const held = dangerousComponents(bundle?.components ?? []).map((c) => c.label);
  const { body, caveat } = useMemo(() => splitReason(proposal.whyItMatters), [proposal.whyItMatters]);
  const stats = useMemo(() => statsOf(proposal), [proposal]);
  const { field, before, after } = beforeAfter(proposal);
  // THE SAME SENTENCE THREE TIMES IS NOT THREE REASONS: the strongest reason is printed only when it says
  // something the headline and the paragraph above it did not already say.
  const reason = (bundle?.confidenceReasons[0] ?? bundle?.receipt.items[0]?.fact ?? "").trim();
  const strongest = reason && reason !== body.trim() && reason !== primaryAction(proposal).trim() ? reason : null;
  const checks = bundle?.receipt.items.map((it) => it.fact) ?? (proposal.evidence?.hints ?? []);
  const steps = (proposal as ChangeProposal & { operatorSteps?: string[] }).operatorSteps ?? [];
  const pageTitle = proposal.pagePath ?? proposal.pageLabel;
  const secondary = proposal.pageLabel !== pageTitle ? proposal.pageLabel : null;

  return (
    <li className={`rounded-2xl border bg-surface-raised ${proven ? "border-accent-primary/50" : "border-border"}`}
      data-change-card="true">
      {/* THE WHOLE COLLAPSED HEAD IS THE CONTROL, so it is reachable by tab and opens on Enter or Space. */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left">
        <span className="mt-0.5 text-[12px] tabular-nums text-muted-foreground" title={proposal.whyRankedAboveNext ?? undefined}>{rank}</span>
        <span className="flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${isNew || parts > 1 ? "bg-accent-primary/15 text-accent-primary" : "bg-surface-inset text-muted-foreground"}`}>
              {isNew ? "New page" : parts > 1 ? `${parts} edits together` : "One edit"}
            </span>
            <span className="text-[14px] font-semibold text-foreground">{pageTitle}</span>
          </span>
          {secondary ? <span className="block truncate text-[12px] text-muted-foreground">{secondary}</span> : null}
          <span className="block text-[14px] font-semibold leading-relaxed text-foreground">{primaryAction(proposal)}</span>
        </span>
        <span aria-hidden className="mt-1 text-[12px] text-muted-foreground">{open ? "Close" : "Open"}</span>
      </button>

      <div className="space-y-3 px-4 pb-4">
        {stats.length > 0 ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" data-change-stats="true">
            {stats.map((s) => (
              <span key={s.label}>
                <span className="text-[14px] font-semibold tabular-nums text-foreground">{s.value}</span> {s.label}
              </span>
            ))}
          </p>
        ) : null}

        {/* THE FIX ITSELF, on the card. The line to put there is the loud one; the line that is there now is
            the quiet one, because nobody is being asked to write the old one again. */}
        <div className="space-y-1" data-before-after="true">
          {before ? (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Now: <span className="line-through">{before}</span>
            </p>
          ) : (
            <p className="text-[12px] italic text-muted-foreground">There is no {field} on the page today.</p>
          )}
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
            <p className="min-w-0 flex-1 text-[14px] font-semibold leading-relaxed text-foreground">
              <span className="font-normal text-muted-foreground">Change to: </span>{after}
            </p>
            <CopyButton text={after} label={`Copy new ${field}`} onToast={onToast} />
          </div>
        </div>

        <p className="flex flex-wrap items-center gap-1.5" data-change-facts="true">
          <Pill>about {proposal.estimatedEffortMinutes} min</Pill>
          <Pill intent={RISK[proposal.riskLevel].intent}>{RISK[proposal.riskLevel].label}</Pill>
          <Pill intent={provenChip(proposal, proven).intent}>{provenChip(proposal, proven).label}</Pill>
          {checks.length > 0 ? (
            <button type="button" onClick={() => setChecksOpen((v) => !v)} aria-expanded={checksOpen}>
              <Pill intent="measuring">{bundle ? `backed by ${receiptComposition(bundle.receipt.items)}` : `backed by ${checks.length} check${checks.length === 1 ? "" : "s"}`}</Pill>
            </button>
          ) : null}
        </p>
        {checksOpen && checks.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-checks-list="true">
            {checks.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        ) : null}

        {held.length > 0 ? (
          <p data-dangerous-hold="true" className="rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
            {held.join(" and ")}: this changes where the page lives or whether people can find it, so I am
            holding it for you to read once and confirm before you make the change.
          </p>
        ) : null}

        {open ? (
          <div className="space-y-3 border-t border-border pt-3">
            {/* THE ONE LINE THAT ARGUES THIS CHANGE: the site sitting above him and what it runs, in the receipt's
                own words. Self hiding, because a receipt that names nobody may not imply one. */}
            {beatenBy(bundle) ? (
              <p className="rounded-md border border-border bg-surface-inset px-3 py-2 text-[13px] leading-relaxed text-foreground" data-who-beats-you="true">
                Who beats you today: {beatenBy(bundle)}
              </p>
            ) : null}
            {body ? <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p> : null}
            {caveat ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-change-caveat="true">&#9432; {caveat}</p>
            ) : null}
            {strongest ? <p className="text-[13px] leading-relaxed text-muted-foreground">Strongest reason: {strongest}</p> : null}
            {steps.length > 0 ? (
              <div className="space-y-1" data-operator-steps="true">
                <p className="text-[12px] font-semibold text-foreground">How to make this change</p>
                <ol className="list-none space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {steps.slice(0, 3).map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
                </ol>
              </div>
            ) : null}
            {proposal.limitations.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">What to keep in mind</p>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
                  {proposal.limitations.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            ) : null}
            {proposal.whyRankedAboveNext ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">{proposal.whyRankedAboveNext}</p>
            ) : null}
            {/* EVERY CARD IS AN EDIT HE CAN MAKE, so every card can record that he made it. Hiding this control on the
                unproven half promised measurement on work I then refused to measure. */}
            <MarkImplemented proposalId={proposal.id} label="I made this change" newPage={isNew} components={piecesOf(bundle)} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href={`/changes/${encodeURIComponent(proposal.id)}`}
            className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white">
            See the change
          </Link>
          <button type="button" data-set-aside="true" onClick={() => onAside(proposal.id)}
            className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Put this aside
          </button>
        </div>
      </div>
    </li>
  );
}

/** The exact words, on the clipboard, in one press. Nothing is written to the operator's site here. */
function CopyButton({ text, label, onToast }: { text: string; label: string; onToast: (t: string) => void }) {
  return (
    <button type="button" data-copy-after="true"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => onToast("Copied"), () => onToast("I could not reach your clipboard, so please copy it by hand.")); }}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
      {label}
    </button>
  );
}

/** "Put this aside" is the operator's own dismissal, with the consequence stated before they press it. The
 *  store then refuses to re-draft the same change until the evidence itself moves. The LIST owns the
 *  optimistic version of this control; this two-step one is what the detail page asks. */
export function SetAsideChange({ proposalId }: { proposalId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; asked: boolean; error: string | null }>({ done: false, asked: false, error: null });

  if (state.done) {
    return (
      <p className="text-[12px] text-muted-foreground" data-set-aside-done="true">
        Put aside. I will not suggest this again unless the evidence changes.
      </p>
    );
  }
  if (!state.asked) {
    return (
      <button type="button" data-set-aside="true" onClick={() => setState((s) => ({ ...s, asked: true }))}
        className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
        Put this aside
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[12px] text-muted-foreground">
        I will not suggest this again unless the evidence changes. Put it aside?
      </span>
      <button type="button" disabled={pending}
        onClick={() => startTransition(async () => {
          const res = await dismissProposalAction({ proposalId });
          if (res.success) setState({ done: true, asked: true, error: null });
          else setState({ done: false, asked: true, error: res.error ?? "Something went wrong." });
        })}
        className="rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground disabled:opacity-60">
        {pending ? "Saving…" : "Yes, put it aside"}
      </button>
      <button type="button" onClick={() => setState({ done: false, asked: false, error: null })}
        className="text-[12px] text-muted-foreground underline underline-offset-2">
        Keep it
      </button>
      {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
    </div>
  );
}

/** "Mark implemented" records that the OPERATOR applied the change. THE PARTIAL-BUNDLE PICKER: three of five
 *  pieces applied must not record five, and the two they skipped stay theirs to do. THE NOTE carries their own
 *  words beside my reading. THE ADDRESS, for a new page only. THE CONFIRMATION, for a piece that moves or hides
 *  a page, which the server asks for again and refuses without. */
export function MarkImplemented({ proposalId, label: idle = "Mark implemented", components, newPage = false }: {
  proposalId: string;
  label?: string;
  /** The bundle's pieces (several = a picker), each with the STABLE id it carries inside the stored bundle so
   *  two pieces of one kind are ticked apart. `moves` marks one that changes where the page lives;
   *  `recorded` marks one already on file. */
  components?: { id: string; kind: string; label: string; moves?: boolean; recorded?: boolean }[];
  /** A page that did not exist has no address until they publish it, so I have to be told where it is. */
  newPage?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ done: boolean; error: string | null; note: string | null }>({ done: false, error: null, note: null });
  const pickable = components && components.length > 1 ? components : null;
  // OPEN ON WHAT IS GENUINELY STILL THEIRS TO DO: pre-ticking a piece already on file offered to record a
  // component I am already measuring, and the server refuses to write it twice anyway.
  const [applied, setApplied] = useState<Set<string>>(() => {
    const all = pickable ?? components ?? [], open = all.filter((c) => !c.recorded);
    return new Set((open.length > 0 ? open : all).map((c) => c.id));
  });
  const [note, setNote] = useState(""), [liveUrl, setLiveUrl] = useState(""), [confirmed, setConfirmed] = useState(false);
  const label = useMemo(() => (state.done ? "Marked implemented" : idle), [state.done, idle]);
  const nothingPicked = pickable != null && applied.size === 0, addressOwed = newPage && liveUrl.trim().length === 0;
  // THE DELIBERATE YES, asked only about the pieces they say they applied. The server asks again and refuses
  // without it, so this box is the operator's act and never the gate.
  const movesPage = (components ?? []).some((c) => c.moves && applied.has(c.id));

  function onClick() {
    startTransition(async () => {
      const res = await markProposalImplementedAction({
        proposalId,
        ...(newPage ? { liveUrl: liveUrl.trim() } : {}),
        ...(pickable && applied.size < pickable.length ? { componentIds: [...applied] } : {}),
        ...(note.trim() ? { operatorNote: note.trim() } : {}),
        ...(movesPage ? { destructiveConfirmed: confirmed } : {}),
      });
      if (res.success) setState({ done: true, error: null, note: res.note ?? null });
      else setState({ done: false, error: res.error ?? "Something went wrong.", note: null });
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
            I only measure the pieces you tick, so leave the ones you skipped unticked.
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
          <p className="text-[12px] text-muted-foreground">I go and read that page myself, so I need the exact address on your own site.</p>
        </div>
      ) : null}

      {movesPage ? (
        <label data-destructive-confirm="true" className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I understand this moves or hides a page, and I have read what it does to my site above.
        </label>) : null}
      <div className="space-y-1.5" data-operator-note="true">
        <label className="block text-[12px] text-muted-foreground" htmlFor={`note-${proposalId}`}>
          Wrote it your own way? Tell me what you put there and I will keep your words beside my reading.
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
          {addressOwed ? "Give me the address it is live at and I will go and read it."
            : nothingPicked ? "Tick at least one piece and I will start measuring it."
              : movesPage && !confirmed ? "Confirm you meant to move or hide the page and I will record it."
                : "You apply the change on your site; I read the page myself and tell you what I found."}
        </span>
        {state.error ? <span className="text-[12px] text-red-500">{state.error}</span> : null}
      </div>
      {/* WHAT IS STILL THEIRS TO DO after a partial apply: the change stays open carrying the rest. */}
      {state.note ? <p className="text-[12px] leading-relaxed text-muted-foreground">{state.note}</p> : null}
    </div>
  );
}
