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
import { proofOf } from "@/domains/decision/proof";
import { confirmedVersion, openHold } from "@/domains/decision/completeness";
import type { ChangeBundle, ChangeProposal } from "@/domains/decision";
import { markProposalImplementedAction } from "./actions";
import { pageLabel } from "./types";
import { CopyButton, MarkImplemented, ReviewAnswer } from "./change-controls";

/** The producer's own boilerplate. It said the same sentence on all 37 title cards, so it is dropped outright
 *  rather than reprinted anywhere: a sentence true of every row is a fact about the producer, not a reason. */
const TITLE_FOOTNOTE = "This line says the search in the words people actually run it in.";
/** The one caveat that has to stand on its own line: this reading may not be your visitors' reading. */
const CAVEAT_MARK = "different slice of Google";

const RISK: Record<ChangeProposal["riskLevel"], { intent: PillIntent; label: string }> = {
  low: { intent: "neutral", label: "Low risk" }, medium: { intent: "waiting", label: "Medium risk" },
  high: { intent: "attention", label: "High risk" },
};

/** Today, in the operator's words, for the sentence a just-finished card prints. */
const DAY_NOW = (): string => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
const fieldWord = (f: string): string => (f === "meta" ? "description" : f.replace(/_/g, " "));

/** Effort in the operator's own units: sixty minutes is an hour, and "about 60 min" read like a rounding error. */
const effortLabel = (m: number): string =>
  m < 60 ? `${m} min` : ((h) => `${h} ${h === 1 ? "hour" : "hours"}`)(Math.round((m / 60) * 10) / 10);

/** A CONSOLIDATION IS NOT A PASTEABLE LINE: it merges or retires live pages, so it carries ordered steps and a
 *  confirmation instead of a copy box. A search naming a year dies every January, so it is worth redoing then. */
const isConsolidation = (p: ChangeProposal): boolean => String(p.kind) === "consolidation" || p.changeFamily === "consolidation";
const YEAR_QUERY = /\b20\d{2}\s*$/;
const YEAR_NOTE = "Year searches reset every January; this edit is worth redoing each year.";

/** THE ISSUE CLASS AS A LABEL, off the id's own family slug: "Missing description" tells the operator what
 *  kind of problem this is before a sentence is read, the way every serious tool names its issue classes. */
const CATEGORY: [RegExp, string][] = [
  [/::missing_description$/, "Missing description"], [/::duplicate_heading$/, "Duplicate heading"],
  [/::internal_link$/, "Internal link"], [/::ai_answer_gap$/, "AI answer gap"],
  [/::engine_followup$/, "Follow-up search"], [/::thin_page$/, "Thin page"], [/::divergence$/, "Diagnosis"],
  [/::answer_block$/, "Answer block"], [/::consolidation$/, "Page merge"], [/::h1$/, "Heading"],
  [/::title(-family)?$/, "Title"], [/::ownership$/, "Ownership decision"], [/::researching$/, "Research"],
];
const INLINE_PIECES = 4; /** How many steps a card shows in full before the list becomes the detail page's job: a two or three step treatment is read here, a forty-item correction bundle is not. */
/** THE OBJECT THIS CHANGE TOUCHES, in the customer's own words, read off the canonical field and never off
 *  prose. "One edit" told the operator nothing, and "Copy new section" appeared on things that were not
 *  sections; at ten to thirty applied changes a day, guessing the object is the product's real cost. */
const TARGET_WORD: Record<string, string> = { title: "title", meta: "description", h1: "heading", section: "section", answer_block: "answer", internal_link: "link" };
function targetWordOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return "page";
  return TARGET_WORD[c.field] ?? fieldWord(c.field);
}
/** Add, Replace or Create: what the operator DOES, decided by whether canonical `before` carries the old words. */
function actionWordOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return "Create";
  return c.before ? "Replace" : c.field === "section" || c.field === "answer_block" ? "Add" : "Set";
}
function categoryOf(p: ChangeProposal, isNew: boolean, parts: number): string {
  if (isNew) return "Create page";
  // A multi-piece bundle is named by its SIZE first: the live queue held a three-edit bundle across two
  // pages wearing the chip "Title" because its id ended ::title-family. The family regex names one edit only.
  if (parts > 1) return `${parts} edits together`;
  const named = CATEGORY.find(([re]) => re.test(p.id))?.[1];
  if (named) return named;
  return `${actionWordOf(p)} ${targetWordOf(p)}`;
}

/** The exact primary action in one line: a bundle's objective, the producer's own headline when it wrote a
 *  real one (a sentence, not a slug), or the field an atomic edit rewrites. */
function primaryAction(p: ChangeProposal): string {
  if (p.bundle) return p.bundle.objective;
  if (p.opportunityType.includes(" ") && p.opportunityType.length > 20) return p.opportunityType;
  const c = p.recommendedChange;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  return `Update the ${fieldWord(c.field)} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** WHAT DOES NOT CHANGE, said out loud where omission could cause a mistake. Derived from the canonical
 *  field's own scope, never invented: a title edit touches the title tag by definition, an added section
 *  deletes nothing by definition. Where nothing mechanical can be said, nothing is said. */
function untouchedOf(p: ChangeProposal): string | null {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit") return null;
  switch (c.field) {
    case "title": return "Only the title tag changes. The heading and page text stay as they are.";
    case "meta": return "Only the description changes. Nothing on the page itself changes.";
    case "h1": return "Only this heading changes. The text under it stays as it is.";
    case "section": case "answer_block":
      return c.before ? "Only this passage changes. Everything around it stays." : "This adds new copy. Nothing on the page is deleted.";
    default: return null;
  }
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

/** The pieces of a bundle, named the way the server names them, so a tick here is the tick it asks for again. */
const piecesOf = (b: ChangeBundle | undefined) => (b?.components ?? []).map((c, i) => ({
  id: componentIdOf(c, i), kind: c.kind, label: c.label,
  ...(dangerousComponents([c]).length > 0 ? { moves: true } : {}),
}));

export function ChangeCard({ proposal, rank, ready = false, review = false, caseLine = null, onAside, onDone, onToast }: {
  proposal: ChangeProposal; rank: number; ready?: boolean;
  /** WAITING ON A HUMAN LOOK. The card renders the whole argument and the words it has, and NOTHING that would record the work as made: no copy box, no Mark done, either on the collapsed row or inside the expander. A control is a claim that the work is finished, and this stage is the stage where it is not. */
  review?: boolean;
  /** What Decision concluded about the search this change answers, in its own words, read off the ONE case file Visibility reads. Null when the change answers no tracked search, or when that file could not be read: neither of those is a verdict, and neither is printed as one. */
  caseLine?: string | null;
  onAside: (id: string) => void; onDone: (id: string) => void; onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // MARKED DONE FLIPS THE CARD WHERE IT SITS: the row stays put, says what happens next, and comes off the open
  // count on the spot. It leaves the list on the next load, which is the release's job, never this render's.
  const [done, setDone] = useState(false);
  const bundle = proposal.bundle;
  const isNew = proposal.kind === "new_page";
  const parts = bundle?.components.length ?? 1;
  const held = dangerousComponents(bundle?.components ?? []).map((c) => c.label);
  const { body, caveat } = useMemo(() => splitReason(proposal.whyItMatters), [proposal.whyItMatters]);
  const proof = useMemo(() => proofOf(proposal), [proposal]);
  const { field, before, after } = beforeAfter(proposal);
  // ONE NUMBER PER STEP, AND NO BLANK ROWS. Producers write steps both ways ("1. Open the editor" and "Open the editor"), so a step carrying its own number printed "1. 1. Open the editor" beside the span below, and a step that came through empty printed a bare "1." with nothing after it.
  const steps = (proposal.operatorSteps ?? []).map((s) => (s ?? "").replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  // THE PAGE, SAID THE WAY A PERSON SAYS IT. The headline was the raw slug ("/famous-iranian-comedians"), which
  // is a file name; the address itself stays underneath, where an address belongs.
  const path = proposal.pagePath ?? proposal.pageLabel;
  // Only a real address goes through the slug reader: a new-page proposal carries a TITLE in pageLabel,
  // and de-slugging a title truncates it at its first slash and eats its punctuation.
  const pageTitle = proposal.pagePath ? pageLabel(proposal.pagePath) : (proposal.pageLabel || "This page");
  const secondary = path === pageTitle ? null : path;
  // A MERGE IS READ, NEVER PASTED: it moves several pages at once, so it carries ordered steps instead of a copy box. EVERYTHING ELSE IS A PASTE, because nothing instruction-shaped reaches this list any more: the completeness boundary keeps a card that tells the operator to go and write the work out of the queue entirely, so the "Read this twice, then:" framing and the research branch it carried are gone with it.
  const merge = isConsolidation(proposal);
  const recordDone = () => { setDone(true); onDone(proposal.id); };
  // A DRAFT IS SHOWN WITH THE REASON IT IS HELD, IN THE WORDS ALREADY STORED ON IT, and the reason decides what
  // may be pressed: editorial judgement is the operator's to answer, a fact about the work is nobody's.
  const hold = review ? openHold(proposal) : null;
  const placement = proposal.recommendedChange.kind === "existing_edit" ? proposal.recommendedChange.where ?? null : null;

  if (done) return (
    <li className="rounded-2xl border border-accent-primary/50 bg-surface-raised p-4" data-change-card="done">
      <p className="text-[14px] font-semibold text-foreground">{pageTitle}</p>
      <p className="mt-1 text-[13px] text-muted-foreground" data-card-done="true">Done. Measuring from {DAY_NOW()}.</p>
    </li>
  );

  return (
    <li className={`rounded-2xl border bg-surface-raised ${ready ? "border-accent-primary/50" : "border-border"}`}
      data-change-card="true">
      {/* THE WHOLE COLLAPSED HEAD IS THE CONTROL, so it is reachable by tab and opens on Enter or Space. */}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left">
        <span className="mt-0.5 text-[12px] tabular-nums text-muted-foreground" title={proposal.whyRankedAboveNext ?? undefined}>{rank}</span>
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
        <span aria-hidden className="mt-1 text-[12px] text-muted-foreground">{open ? "Hide" : "Details"}</span>
      </button>

      <div className="space-y-3 px-4 pb-4">
        {/* WHY THIS SITS HERE, in one sentence carrying its own figures. Two bare numbers used to stand here
            under vague labels ("30,423 times shown in Google") with no search named and no window on the first
            of them; the sentence says the same measured figures, says which search earned them and over how
            long, and prints nothing at all where nothing was measured. */}
        {proof.ranksHere ? (
          <p className="text-[13px] leading-relaxed text-foreground" data-ranks-here="true">
            <span className="font-semibold">Why this ranks here:</span> {proof.ranksHere}
          </p>
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
            {(bundle?.components ?? []).map((c, i) => (
              <li key={i} className="rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
                <p className="text-[12px] font-semibold text-foreground"><span className="tabular-nums">{i + 1}. </span>{c.label}</p>
                {c.before ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Now: <span className="line-through">{c.before}</span></p> : null}
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{c.after}</p>
                {c.where ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Where it goes: {c.where}</p> : null}
              </li>
            ))}
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
            {before ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Now: <span className="line-through">{before}</span>
              </p>
            ) : null /* NOTHING IS CLAIMED ABOUT A FIELD NOBODY HANDED OVER. A null `before` means the row did
                 not carry the old words, never that the page has none. The adds-new-copy fact now lives on the
                 one untouched-scope line below, so the card says it once. */}
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
              {/* LINE BREAKS ARE PART OF THE DELIVERABLE: a list-shaped answer renders one item per line. */}
              <p className="min-w-0 flex-1 whitespace-pre-line text-[14px] font-semibold leading-relaxed text-foreground">
                <span className="font-normal text-muted-foreground">{isNew ? `Page ${field}: ` : "Change to: "}</span>{after}
              </p>
              {/* THE BUTTON NAMES THE REAL OBJECT: "Copy new section" on a title, and "Copy draft" anywhere,
                  both made the operator re-read the card to learn what they were holding. */}
              <CopyButton text={after} onToast={onToast}
                label={`Copy ${targetWordOf(proposal)} · ${effortLabel(proposal.estimatedEffortMinutes)}`} />
            </div>
            {/* WHERE IT GOES BELONGS TO THE FINISHED CARD MOST OF ALL. This line was rendered inside the held-draft
                box, so the one card an operator is meant to act on was the one card that never said where its copy
                lands: paste-ready work, no place to paste it. A section names its heading and the line it follows,
                a field edit replaces its own line and names none, and the card prints whichever it has. */}
            {placement ? <p className="text-[12px] leading-relaxed text-muted-foreground" data-placement="true">Where it goes: {placement}</p> : null}
            {untouchedOf(proposal) ? <p className="text-[12px] leading-relaxed text-muted-foreground" data-untouched="true">{untouchedOf(proposal)}</p> : null}
          </div>
        )}

        {hold ? (
          <div className="space-y-1 rounded-md border border-border bg-surface-inset px-3 py-2" data-held-reason="true">
            {/* Only the DECISION lane renders cards in review now, so this heading frames the operator's own
                call rather than Beacon's internal QA ("A draft, not finished work" is banned customer language
                under the 2026-08-27 contract: unfinished work never wears a card at all). */}
            <p className="text-[12px] font-semibold text-foreground">What you are deciding:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
              {hold.why.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <p className="text-[12px] leading-relaxed text-muted-foreground">Copying it takes an imperfect starting point, not proven work.</p>
          </div>
        ) : null}

        {/* THE FACTS, AS CHIPS. Everything they stand for opens in the ONE expander below, so a card is what to
            change, where, the final work, and why it ranks; the argument, the checks and the risks live in one
            place instead of three toggles reprinting the same paragraph. */}
        <p className="flex flex-wrap items-center gap-1.5" data-change-facts="true">
          {merge && proposal.estimatedEffortMinutes > 0 ? <Pill>about {effortLabel(proposal.estimatedEffortMinutes)}</Pill> : null}
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
            {body ? <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p> : null}
            {caveat ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-change-caveat="true">&#9432; {caveat}</p>
            ) : null}
            {YEAR_QUERY.test(proposal.primaryQuery) ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-year-note="true">{YEAR_NOTE}</p>
            ) : null}
            {!merge && steps.length > 0 ? (
              <div className="space-y-1" data-operator-steps="true">
                <p className="text-[12px] font-semibold text-foreground">How to make this change</p>
                <ol className="list-none space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {steps.slice(0, 3).map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
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
            {/* WHY THESE EXACT WORDS. A different question from the one above, and answered with different
                evidence: what the copy asserts, and the words carrying THAT assertion. A claim shows only the
                evidence it names, because a source standing beside a sentence it never touched is how a receipt
                starts lying. Demand is not listed here: a search proves a page is wanted, never that a sentence
                is the right sentence. */}
            {proof.wording.length > 0 || proof.queryEcho || proof.shape ? (
              <div className="space-y-1" data-proof-wording="true">
                <p className="text-[12px] font-semibold text-foreground">Why these words</p>
                {proof.queryEcho ? <p className="text-[12px] leading-relaxed text-muted-foreground">{proof.queryEcho}</p> : null}
                {proof.shape ? <p className="text-[12px] leading-relaxed text-muted-foreground">{proof.shape}</p> : null}
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
            {/* EVIDENCE AND LIMITS: what Beacon looked for and does not have, said in the same place as what it
                does. Where sources disagree the disagreement is stated here and nothing above upgrades it into
                confidence about the wording. */}
            {proof.limits.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">Evidence and limits</p>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-guess-caution="true">
                  {proof.limits.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            ) : null}
            {proposal.whyRankedAboveNext ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">{proposal.whyRankedAboveNext}</p>
            ) : null}
            {/* A CARD THAT CLEARED EVERY CHECK CAN RECORD THAT IT WAS MADE. One that is still waiting on a look
                says what it is waiting for instead, because offering to record it done is offering to measure
                work whose exact words nobody has validated. */}
            {hold ? (
              <ReviewAnswer proposalId={proposal.id} version={confirmedVersion(proposal)} approvable={hold.blocking == null} />
            ) : (
              <MarkImplemented proposalId={proposal.id} label="Mark done" newPage={isNew}
                components={piecesOf(bundle)} onRecorded={recordDone} />
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href={`/changes/${encodeURIComponent(proposal.id)}`}
            className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white">
            See the change
          </Link>
          {/* THE ONE-PRESS RECORD, on the collapsed card. A new page owes its live address and a merge owes a
              confirmation, so those two keep the full form above rather than being refused after the press. */}
          {!review && !isNew && held.length === 0 ? <MarkDoneNow proposalId={proposal.id} onRecorded={recordDone} onToast={onToast} /> : null}
          <button type="button" data-set-aside="true" onClick={() => onAside(proposal.id)}
            className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Skip
          </button>
        </div>
      </div>
    </li>
  );
}

/** ONE PRESS, ON THE COLLAPSED CARD: the edit is applied, so the record lands without opening anything. The
 *  server owns every refusal, and a refusal is said out loud here rather than swallowed. */
function MarkDoneNow({ proposalId, onRecorded, onToast }: { proposalId: string; onRecorded: () => void; onToast: (t: string) => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" data-mark-done-now="true" disabled={pending}
      onClick={() => startTransition(async () => {
        const res = await markProposalImplementedAction({ proposalId });
        if (res.success) onRecorded(); else onToast(res.error ?? "That could not be recorded just now.");
      })}
      className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground disabled:opacity-60">
      {pending ? "Saving…" : "Mark done"}
    </button>
  );
}
