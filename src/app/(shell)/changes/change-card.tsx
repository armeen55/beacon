"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pill, type PillIntent } from "@/components/ui/pill";
import { componentIdOf, dangerousComponents } from "@/domains/decision/contracts";
import { proofOf, reviewFits } from "@/domains/decision/proof";
import { citedPublishers, confirmedVersion, openHold } from "@/domains/decision/completeness";
import type { ChangeBundle, ChangeProposal } from "@/domains/decision";
import operatorUiPolicy, { cardCaveats, pageLabel } from "./types";
import { CopyButton, PublicationCopy, MarkImplemented, ReviewAnswer } from "./change-controls";

const TITLE_FOOTNOTE = "This line says the search in the words people actually run it in.";
const CAVEAT_MARK = "different slice of Google";

const RISK: Record<ChangeProposal["riskLevel"], { intent: PillIntent; label: string }> = {
  low: { intent: "neutral", label: "Low risk" }, medium: { intent: "waiting", label: "Medium risk" },
  high: { intent: "attention", label: "High risk" },
};

const fieldWord = (f: string): string => (f === "meta" ? "meta description" : f.replace(/_/g, " ")); // THE OFFICIAL TERM, EVERYWHERE (operator ruling, 2026-08-29): every SEO description is called "meta description"; bare "description" is reserved for visible content

const effortLabel = (m: number): string => m < 60 ? `${m} min` : ((h) => `${h} ${h === 1 ? "hour" : "hours"}`)(Math.round((m / 60) * 10) / 10);

const isConsolidation = (p: ChangeProposal): boolean => String(p.kind) === "consolidation" || p.changeFamily === "consolidation";
const YEAR_QUERY = /\b20\d{2}\s*$/;
const YEAR_NOTE = "Year searches reset every January; this edit is worth redoing each year.";

const CATEGORY: [RegExp, string][] = [
  [/::consolidation$/, "Page merge"], [/::ownership$/, "Ownership decision"], [/::researching$/, "Research"],
];
const INLINE_PIECES = 4;
const TARGET_WORD: Record<string, string> = { title: "title", meta: "meta description", h1: "heading", section: "section", answer_block: "answer", internal_link: "link" };
function targetWordOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return "page";
  if (c.kind === "existing_edit" && c.linkTo) return "link"; /* THE CHIP NAMES WHAT THE EDIT IS (operator, 2026-09-10): a one-sentence carrier for an internal link wore "Add section" because its field is section, and the operator had to guess; the link is the change, the sentence is its vehicle */
  return TARGET_WORD[c.field] ?? fieldWord(c.field);
}
const DELETE_KIND: Record<string, string> = { section_remove: "Delete section", internal_link_remove: "Delete link", redirect: "Delete address, forward it", noindex: "Delete from search" };
function actionWordOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return "Create";
  return c.before ? "Replace" : "Add";
}
function categoryOf(p: ChangeProposal, isNew: boolean, parts: number): string {
  if (isNew) return "Create page";
  // Multi-piece bundles lead with their size; a family label describes only one piece.
  if (parts > 1) return `${parts} edits together`;
  const named = CATEGORY.find(([re]) => re.test(p.id))?.[1] ?? DELETE_KIND[p.bundle?.components[0]?.kind ?? ""];
  if (named) return named;
  return `${actionWordOf(p)} ${targetWordOf(p)}`;
}

function primaryAction(p: ChangeProposal): string {
  if (p.bundle) return p.bundle.objective;
  if (p.opportunityType.includes(" ") && p.opportunityType.length > 20 && !/(^|\s)\//.test(p.opportunityType)) return p.opportunityType;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  return `Update the ${fieldWord(c.field)} to sharpen it for "${p.primaryQuery}"`; // the page is already the line above this one, so naming it again reads as a stutter
}

/** WHAT DOES NOT CHANGE, said out loud where omission could cause a mistake. Derived from the canonical
 *  field's own scope, never invented: a title edit touches the title tag by definition, an added section
 *  deletes nothing by definition. Where nothing mechanical can be said, nothing is said. */
function untouchedOf(p: ChangeProposal): string | null {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit") return null;
  switch (c.field) {
    case "title": return "Only the title tag changes. The heading and page text stay as they are.";
    case "meta": return "Only the meta description changes. Nothing on the page itself changes.";
    case "h1": return "Only this heading changes. The text under it stays as it is.";
    case "schema": return "Only this page's structured data changes. Its visible text and unrelated markup stay as they are.";
    case "section": case "answer_block":
      return c.before ? "Only this passage changes. Everything around it stays." : "This adds new copy. Nothing on the page is deleted.";
    default: return null;
  }
}

/** WHAT TO PHYSICALLY DO, in one to two plain lines, computed from the canonical fields alone (operator, 2026-09-10: "what is deleting, what is editing, what is pasting, what is changing"; the Farahnaz replacement was applied blind because the old words sat in small text). */
function doLineOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return "Do this: create a new page and paste its pieces from this change's own page. Nothing existing is touched.";
  if (c.kind !== "existing_edit") return "Do this: open the change for its exact steps.";
  if (c.linkTo) return `Do this: paste the sentence below onto the page, and make the underlined words a link to ${c.linkTo}. Nothing is deleted.`;
  if (c.field === "meta") return c.before ? "Do this: open the page's SEO settings and replace the current meta description with the line below." : "Do this: open the page's SEO settings and set the meta description to the line below.";
  if (c.field === "title") return "Do this: replace the page title in your page editor with the line below. The visible heading is untouched.";
  if (c.field === "h1") return "Do this: replace the page's main heading with the line below. The text under it stays.";
  if (c.field === "schema") return c.before ? "Do this: find the exact existing JSON-LD block shown under Now in this page's custom code and replace it with the complete block below. Do not paste it into visible page text or delete unrelated markup." : "Do this: add the complete JSON-LD block below to this page's custom code at the location named under Where it goes. Do not paste it into visible page text or replace unrelated markup.";
  if (c.before) return "Do this: find the exact text shown under Now, delete it, and paste the new copy in its place. Nothing else changes.";
  return `Do this: paste the copy below onto the page as a new ${c.field === "section" ? "section under its own heading" : "answer paragraph"}, at the spot named under Where it goes. Nothing is deleted.`;
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
/** DOES THE RECEIPT ALREADY SAY THIS SENTENCE: four fifths of its content words are already in the receipt, in any order. */
const saysAgain = (sentence: string, said: string): boolean => { const words = sentence.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? [], has = new Set(said.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? []); return words.length >= 6 && words.filter((w) => has.has(w)).length * 5 >= words.length * 4; };
function splitReason(text: string): { body: string; caveat: string | null } {
  const parts = text.split(/\.\s+/).map((s) => (s.trim().endsWith(".") ? s.trim() : `${s.trim()}.`))
    .filter((s) => s.length > 1 && s !== TITLE_FOOTNOTE);
  const caveat = parts.find((s) => s.includes(CAVEAT_MARK)) ?? null;
  // TWO SENTENCES, because the card is read before anything is pasted and the whole argument lives on the change's own page.
  return { body: parts.filter((s) => s !== caveat).slice(0, 2).join(" "), caveat };
}

/** The pieces of a bundle, named the way the server names them, so a tick here is the tick it asks for again. */
const piecesOf = (b: ChangeBundle | undefined) => (b?.components ?? []).map((c, i) => ({
  id: componentIdOf(c, i), kind: c.kind, label: c.label,
  ...(c.derivation ? { dependsOn: c.derivation.dependsOn.map((dependency) => dependency.componentId) } : {}),
  ...(dangerousComponents([c]).length > 0 ? { moves: true } : {}),
}));

export function ChangeCard({ proposal, rank, ready = false, review = false, caseLine = null, onAside, onDone, onToast, picked, onPick, recorded = false, recordedNote, problem = null, returnTo = "/changes" }: {
  proposal: ChangeProposal; rank: number; ready?: boolean;
  recorded?: boolean; recordedNote?: string; problem?: string | null;
  picked?: boolean; onPick?: (id: string) => void;
  returnTo?: string;
  review?: boolean;
  caseLine?: string | null;
  onAside: (id: string) => void; onDone: (id: string) => void; onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const bundle = proposal.bundle;
  const isNew = proposal.kind === "new_page";
  const parts = bundle?.components.length ?? 1;
  const held = dangerousComponents(bundle?.components ?? []).map((c) => c.label);
  const { body, caveat } = useMemo(() => splitReason(proposal.whyItMatters), [proposal.whyItMatters]);
  const proof = useMemo(() => proofOf(proposal), [proposal]);
  const { field, before, after } = beforeAfter(proposal);
  const steps = (proposal.operatorSteps ?? []).map((s) => (s ?? "").replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  const path = proposal.pagePath ?? proposal.pageLabel;
  const pageTitle = proposal.pagePath ? pageLabel(proposal.pagePath) : (proposal.pageLabel || "This page");
  const secondary = path === pageTitle ? null : path;
  const merge = isConsolidation(proposal);
  const recordDone = (note: string | null) => { setDoneNote(note); setDone(true); onDone(proposal.id); };
  const verdict = openHold(proposal);
  const hold = review && verdict.safetyHold && !verdict.faulted ? verdict : null;
  const caveats = cardCaveats(proposal, [...verdict.caveats, ...proof.limits.filter((l) => !proposal.limitations.includes(l)),
    ...(caveat ? [caveat] : []), ...(YEAR_QUERY.test(proposal.primaryQuery) ? [YEAR_NOTE] : [])], verdict.settledPriorReceipt);
  const worth = [proof.ranksHere, ...(body ? body.split(/(?<=[.!?])\s+/).filter((sentence) => !saysAgain(sentence, proof.ranksHere ?? "")) : [])].filter(Boolean).join(" "); /* a sentence the receipt already says in other words is not said twice (operator walk, 2026-09-16: "Only 1 page of this site links to ... today" printed back to back) */
  const waiting = ((w: string) => (w ? `${w[0]!.toUpperCase()}${w.slice(1)}.` : null))((proposal.rankingReceipt?.factors ?? []).find((f) => f.name === "readiness")?.input?.trim() ?? "");
  const placement = proposal.recommendedChange.kind === "existing_edit" ? proposal.recommendedChange.where ?? null : null;
  const units = proposal.recommendedChange.kind === "existing_edit" ? proposal.recommendedChange.units : undefined;
  const link = proposal.recommendedChange.kind === "existing_edit" && proposal.recommendedChange.linkTo ? { href: proposal.recommendedChange.linkTo, anchor: proposal.recommendedChange.anchorText ?? "", pageUrl: proposal.pageUrl } : null;
  const livePageHref = operatorUiPolicy.livePageHref(proposal.pageUrl);
  const reading = ready && !merge && reviewFits(proposal, proposal.semanticReview?.of); // a row accepted on a legacy-keyed reading still says what stands behind it (audit, 2026-09-14)
  const sources = reading ? citedPublishers(proposal).size : 0;

  if (done || recorded) return (
    <li className="rounded-2xl border border-accent-primary/50 bg-surface-raised p-4" data-change-card="done">
      <p className="text-[14px] font-semibold text-foreground">{pageTitle}</p>
      <p className="mt-1 text-[13px] text-muted-foreground" data-card-done="true">{doneNote ?? recordedNote ?? "Recorded. Open Results for its current verification and measurement state."}</p>
    </li>
  );

  return (
    <li className={`group overflow-hidden rounded-2xl border bg-surface-raised shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${ready ? "border-accent-primary/50" : "border-border"}`}
      data-change-card="true">
      {problem ? <p className="px-4 pt-3 text-[12px] leading-relaxed text-red-500" data-bulk-problem="true">Not recorded: {problem} Press Mark done on this one to try it again.</p> : null}
      {/* THE WHOLE COLLAPSED HEAD IS THE CONTROL, so it is reachable by tab and opens on Enter or Space. */}
      <div className="flex w-full items-start">
      {onPick ? <label className="ml-1 mt-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center"><input type="checkbox" data-pick-done="true" checked={picked ?? false} onChange={() => onPick(proposal.id)} aria-label={`Select ${pageTitle} for the batch`} className="h-5 w-5 accent-accent-primary" /></label> : null}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-primary/10 text-[12px] font-bold text-accent-primary ring-1 ring-accent-primary/20" title={proposal.whyRankedAboveNext ? `Full ranked backlog: ${proposal.whyRankedAboveNext}` : undefined}><span className="tabular-nums" data-change-rank={rank}>{rank}</span></span>
        <span className="flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${isNew || parts > 1 ? "bg-accent-primary/15 text-accent-primary" : "bg-surface-inset text-muted-foreground"}`}>
              {categoryOf(proposal, isNew, parts)}
            </span>
            <span className="text-[14px] font-semibold text-foreground">{pageTitle}</span>
          </span>
          {secondary ? <span className="block truncate text-[12px] text-muted-foreground">{secondary}</span> : null}
          <span className="block text-[14px] font-semibold leading-relaxed text-foreground">{primaryAction(proposal)}</span>
        </span>
        <span aria-hidden className="mt-1 rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition group-hover:border-accent-primary/40 group-hover:text-foreground">{open ? "Hide details" : "How and why"}</span>
      </button>
      </div>

      <div className="space-y-3 px-4 pb-4">
        {livePageHref ? (
          <a href={livePageHref} target="_blank" rel="noreferrer" data-open-live-page="true"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent-primary underline underline-offset-2">
            Open live page <span aria-hidden>↗</span>
          </a>
        ) : null}
        {/* THE FIX ITSELF, on the card. The line to put there is the loud one; the line that is there now is
            the quiet one, because nobody is being asked to write the old one again. A merge has no line to
            paste at all, so it shows its ordered steps instead and never offers a copy button. */}
        {merge ? (
          steps.length > 0 ? (
            <div className="space-y-1" data-merge-steps="true">
              <p className="text-[12px] font-semibold text-foreground">The moves, in order:</p>
              <ol className="list-none space-y-0.5 text-[13px] leading-relaxed text-muted-foreground">
                {steps.map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
              </ol>
            </div>
          ) : null
        ) : parts > 1 && parts <= INLINE_PIECES ? (
          /* A CARD MAY ASK FOR SEVERAL STEPS AND MAY NEVER HIDE ONE. A two-step treatment summarised as "2 exact
             pieces inside, open the change" put half the work behind a click, the same defect as burying a heading
             change in placement prose: an operator who does not open it does the wrong amount of work. A short
             treatment shows every step here, each with its own wording and its own location. */
          <ol className="space-y-2" data-bundle-steps="true">
            {(bundle?.components ?? []).map((c, i) => {
              const copyable = operatorUiPolicy.isPasteableComponent(c), componentLink = copyable && c.redirectTo && c.anchorAfter
                ? { href: c.redirectTo, anchor: c.anchorAfter, pageUrl: proposal.pageUrl } : null;
              return (
              <li key={i} data-component-mode={copyable ? "copy" : "instruction"} className={`rounded-lg border px-3 py-2 ${copyable ? "border-accent-primary/40 bg-accent-primary/5" : "border-border bg-surface-inset/50"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-foreground"><span className="tabular-nums">{i + 1}. </span>{c.label}</p>
                  {copyable ? <CopyButton text={c.after} units={c.units} link={componentLink} onToast={onToast} label={`Copy ${(c.label ?? c.kind).toLowerCase()}`} /> : null}
                </div>
                {c.before ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Now: <span className="line-through">{c.before}</span></p> : null}
                {!copyable ? <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Instruction, do not paste</p> : null}
                <PublicationCopy text={c.after} units={c.units} link={componentLink} />
                {c.page && c.page !== proposal.pageUrl && c.page !== proposal.pagePath ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Page: {c.page}</p> : null}
                {c.where ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Where it goes: {c.where}</p> : null}
                {c.derivation ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Apply this schema with the visible FAQ copy in this same change; the block matches those exact answers.</p> : null}
              </li>
              );
            })}
          </ol>
        ) : parts > 1 ? (
          /* A BUNDLE'S DELIVERABLE IS ITS PIECES, so the collapsed card never offers the umbrella sentence as
             the thing to copy: forty sourced corrections copied as "Replace the statements listed below" is not
             the work (Codex, 2026-08-21). Each piece carries its own exact wording on the change's own page. */
          <p className="rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground" data-bundle-pieces="true">
            {parts.toLocaleString("en-US")} exact pieces inside, each with its own wording to copy. Open the change to work through them.
          </p>
        ) : (
          <div className="space-y-1" data-before-after="true">
            <p className="text-[13px] font-medium leading-relaxed text-foreground" data-do-line="true">{doLineOf(proposal)}</p>
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
              {/* LINE BREAKS ARE PART OF THE DELIVERABLE: a list-shaped answer renders one item per line. */}
              <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-foreground">
                <p className="text-muted-foreground">{isNew ? `Page ${field}:` : before == null ? "Add:" : "Change to:"}</p><PublicationCopy text={after} units={units} link={link} />{/* an addition adds; "Change to:" over copy that replaces nothing read as a replacement (walk of 2026-09-16) */}
              </div>
              {/* THE BUTTON NAMES THE REAL OBJECT: "Copy new section" on a title, and "Copy draft" anywhere,
                  both made the operator re-read the card to learn what they were holding. */}
              <CopyButton text={after} units={units} link={link} onToast={onToast}
                label={`Copy ${targetWordOf(proposal)} · ${effortLabel(proposal.estimatedEffortMinutes)}`} />
            </div>
            {before ? (
              /* THE OLD WORDS ARE A SEARCH TARGET, NOT A FOOTNOTE (operator, 2026-09-10): "for the name change
                 I didn't even know what I was doing". The operator finds this exact line on the live page first,
                 so the card hands it over in its own box, struck through, after the copy the order pin puts first. */
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] leading-relaxed text-foreground" data-find-line="true">
                <span className="font-semibold">Find this on the page: </span><span className="line-through decoration-foreground/40">{before}</span>
              </p>
            ) : null /* NOTHING IS CLAIMED ABOUT A FIELD NOBODY HANDED OVER. A null `before` means the row did
                 not carry the old words, never that the page has none. The adds-new-copy fact now lives on the
                 one untouched-scope line below, so the card says it once. */}
            {/* WHERE IT GOES BELONGS TO THE FINISHED CARD MOST OF ALL. This line was rendered inside the held-draft
                box, so the one card an operator is meant to act on was the one card that never said where its copy
                lands: paste-ready work, no place to paste it. A section names its heading and the line it follows,
                a field edit replaces its own line and names none, and the card prints whichever it has. */}
            {placement ? <p className="text-[12px] leading-relaxed text-muted-foreground" data-placement="true">Where it goes: {placement}</p> : null}
            {untouchedOf(proposal) ? <p className="text-[12px] leading-relaxed text-muted-foreground" data-untouched="true">{untouchedOf(proposal)}</p> : null}
          </div>
        )}

        {/* WHY IT IS WORTH TRYING, in the row's own figures and the row's own sentence: what was measured, then
            up to two sentences of the reason the producer wrote. The whole argument stays on the change's page. */}
        {worth ? (
          <p className="text-[13px] leading-relaxed text-foreground" data-ranks-here="true">
            <span className="font-semibold">Why this ranks here:</span> {worth}
          </p>
        ) : null}
        {proposal.whyRankedAboveNext ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">
            <span className="font-semibold text-foreground">Why this ranks above the next opportunity in the full backlog:</span> {proposal.whyRankedAboveNext}
          </p>
        ) : null}

        {/* THE CAVEAT, ON THE CARD THAT OFFERS THE WORK. It sat behind the expander as "Evidence and limits",
            which is where a caveat goes to be missed by the person pasting the words. */}
        {caveats.length > 0 ? (
          <div className="space-y-1" data-change-caveat="true">
            <p className="text-[12px] font-semibold text-foreground">Keep in mind</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-guess-caution="true">
              {caveats.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        ) : null}

        {waiting && !ready ? <p className="text-[13px] leading-relaxed text-muted-foreground" data-waiting-on="true">{waiting}</p> : null}
        {hold ? (
          <div className="space-y-1 rounded-md border border-border bg-surface-inset px-3 py-2" data-held-reason="true">
            {/* THE CONSEQUENCE IN PLAIN WORDS, never a gate sentence: what this changes for the page and what to do next, with the pieces counted. THE CAVEATS ARE NOT REPEATED HERE (2026-09-06): they are the one filtered list above. */}
            <p className="text-[12px] font-semibold text-foreground">What you are deciding:</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{hold.why.join(" ")} Every other check passed on {parts === 1 ? "this change" : `all ${parts} pieces`}. Open it, confirm the move, then make the change.</p>
          </div>
        ) : null}
        {reading ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground" data-ready-backing="true">
            {sources > 0 ? `Backed by ${sources} checked ${sources === 1 ? "source" : "sources"}` : "Written from words already on your own pages"} and read for sense before it was offered. Copy it, then press Mark done.
          </p>
        ) : null}

        {/* THE FACTS, AS CHIPS. Everything they stand for opens in the ONE expander below, so a card is what to
            change, where, the final work, and why it ranks; the argument, the checks and the risks live in one
            place instead of three toggles reprinting the same paragraph. */}
        <p className="flex flex-wrap items-center gap-1.5" data-change-facts="true">
          <Pill>about {effortLabel(proposal.estimatedEffortMinutes)}</Pill>
          <Pill intent={proposal.confidence === "high" ? "live" : proposal.confidence === "medium" ? "neutral" : "waiting"}>{proposal.confidence[0]!.toUpperCase() + proposal.confidence.slice(1)} confidence</Pill>
          <Pill>{proof.opportunity.length + proof.wording.length} evidence {proof.opportunity.length + proof.wording.length === 1 ? "line" : "lines"}</Pill>
          <Pill intent={RISK[proposal.riskLevel].intent}>{RISK[proposal.riskLevel].label}</Pill>
        </p>

        {held.length > 0 ? (
          <p data-dangerous-hold="true" className="rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
            {held.join(" and ")}: this changes where the page lives or whether people can find it, so it is
            held for you to read once and confirm before you make the change.
          </p>
        ) : null}

        {open ? (
          <div className="space-y-3 border-t border-border pt-3">
            {!merge && steps.length > 0 ? (
              <div className="space-y-1" data-operator-steps="true">
                <p className="text-[12px] font-semibold text-foreground">How to make this change</p>
                <ol className="list-none space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {steps.map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
                </ol>
              </div>
            ) : null}
            {/* WHY THIS OPPORTUNITY: what was actually measured, each line already a sentence its producer wrote
                with its own numbers, dated where the evidence carried a date. */}
            {proof.opportunity.length > 0 ? (
              <div className="space-y-1" data-proof-opportunity="true">
                <p className="text-[12px] font-semibold text-foreground">Why this opportunity</p>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-checks-list="true">
                  {proof.opportunity.map((o, i) => (
                    <li key={i}>{o.fact}{o.seen ? <span className="text-muted-foreground/70"> (seen {o.seen})</span> : null}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {/* WHAT THE REPLACED WORDS CARRY THAT THE NEW WORDS DO NOT, read off the canonical spans: a
                replacement states its material losses or their absence, never silence (operator, 2026-08-27). */}
            {(proposal.recommendedChange.kind === "existing_edit" && proposal.recommendedChange.before?.trim()) ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-material-loss="true">
                {proof.losses.length > 0
                  ? `This replacement also removes: ${proof.losses.join("; ")}. Check that each is meant to go.`
                  : "No link, figure or named item in the replaced words is lost."}
              </p>
            ) : null}
            {/* WHY THIS TYPE OF ACTION, only when something actually chose it: a bundle's objective or the
                treatment the diagnosis named. Attention evidence chooses nothing, so most cards honestly show
                nothing here, and what else was weighed rides with it in the record's own sentence. */}
            {proof.whyAction || proof.alternative ? (
              <div className="space-y-1" data-proof-action="true">
                <p className="text-[12px] font-semibold text-foreground">Why this action</p>
                {proof.whyAction ? <p className="text-[12px] leading-relaxed text-muted-foreground">{proof.whyAction}</p> : null}
                {proof.alternative ? <p className="text-[12px] leading-relaxed text-muted-foreground">{proof.alternative}</p> : null}
              </div>
            ) : null}
            {/* WHY THESE EXACT WORDS. A different question from the one above, and answered with different
                evidence: what the copy asserts, and the words carrying THAT assertion. A claim shows only the
                evidence it names, because a source standing beside a sentence it never touched is how a receipt
                starts lying. Demand is not listed here: a search proves a page is wanted, never that a sentence
                is the right sentence. */}
            {proof.wording.length > 0 || proof.queryEcho || proof.shape || proof.wordingBasis ? (
              <div className="space-y-1" data-proof-wording="true">
                <p className="text-[12px] font-semibold text-foreground">Why these words</p>
                {proof.queryEcho ? <p className="text-[12px] leading-relaxed text-muted-foreground">{proof.queryEcho}</p> : null}
                {proof.shape ? <p className="text-[12px] leading-relaxed text-muted-foreground">{proof.shape}</p> : null}
                {proof.wordingBasis ? <p className="text-[12px] leading-relaxed text-muted-foreground" data-wording-basis="true">{proof.wordingBasis}</p> : null}
                <ul className="list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted-foreground">
                  {proof.wording.map((w, i) => (
                    <li key={i}>{w.claim}
                      <ul className="list-none space-y-0.5 pt-0.5 pl-0 text-muted-foreground/80">
                        {w.because.map((b, j) => <li key={j}>Rests on: {b}</li>)}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {/* THE SEARCH THIS CHANGE ANSWERS, AND WHAT WAS DECIDED ABOUT IT, read off the ONE case file
                Visibility reads. Two screens deriving that verdict separately is how one of them offered work
                on a case the other had already refused. */}
            {caseLine ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-ai-case="true">{caseLine}</p>
            ) : null}
            {/* A CARD STILL WAITING ON A LOOK ANSWERS THAT LOOK HERE. What can be RECORDED lives on the card
                itself, because a control is not supporting evidence and nobody should open an argument to press it. */}
            {hold ? (
              <ReviewAnswer proposalId={proposal.id} version={confirmedVersion(proposal)} approvable={hold.defects.length === 0} />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href={`/changes/${encodeURIComponent(proposal.id)}?returnTo=${encodeURIComponent(returnTo)}`}
            className="inline-flex min-h-11 items-center rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2">
            See the change
          </Link>
          {/* THE RECORD AND THE OPERATOR'S OWN WORDING, on the card itself (operator, 2026-09-06: Copy, edit as
              applied, Mark done and Skip are the four controls a finished card offers without being opened). A new
              page owes its live address and a piece that moves a page owes a confirmation, and this control asks
              for each where it applies rather than refusing the press afterwards. EVERY BUNDLE OF TWO OR MORE PIECES GETS
              THE PICKER (audit 3.9): a bundle past the inline limit got a bare Mark done, so one press recorded every piece
              as applied when the operator had pasted one. */}
          {review ? null : parts > INLINE_PIECES ? <span className="text-[12px] text-muted-foreground">Open the change to record only the pieces you actually applied.</span> : <MarkImplemented proposalId={proposal.id} expectedVersion={confirmedVersion(proposal)} newPage={isNew} onRecorded={recordDone}
            components={parts > 1 || held.length > 0 ? piecesOf(bundle) : undefined} />}
          <button type="button" data-set-aside="true" onClick={() => onAside(proposal.id)}
            className="inline-flex min-h-11 items-center text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Skip
          </button>
        </div>
      </div>
    </li>
  );
}
