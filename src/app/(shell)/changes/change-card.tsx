"use client";

/** change-card - ONE ranked change, said in full before anybody opens it: the page it is on, THE EXACT WORDS
 *  THERE NOW, THE EXACT WORDS TO PUT THERE, what it is worth in the operator's own numbers, and one control per
 *  decision. Everything that has to be read rather than done (the whole reason, the steps, the checks) opens in
 *  place, so the list stays a list. "See the change" is still the deep link to the whole investigation, and a
 *  dangerous change carries its hold here as it does everywhere. Publishing stays MANUAL. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Pill, type PillIntent } from "@/components/ui/pill";
// A client bundle cannot import the server-only kernel facade, so the ONE pure rule for what is dangerous and
// the ONE stable name for a piece come from the contract module itself rather than a copy of them living here.
import { componentIdOf, dangerousComponents } from "@/domains/decision/contracts";
import { copyKey, proofOf } from "@/domains/decision/proof";
import { citedPublishers, confirmedVersion, openHold } from "@/domains/decision/completeness";
import type { ChangeBundle, ChangeProposal } from "@/domains/decision";
import { cardCaveats, pageLabel } from "./types";
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
const fieldWord = (f: string): string => (f === "meta" ? "meta description" : f.replace(/_/g, " ")); // THE OFFICIAL TERM, EVERYWHERE (operator ruling, 2026-08-29): every SEO description is called "meta description"; bare "description" is reserved for visible content

/** Effort in the operator's own units: sixty minutes is an hour, and "about 60 min" read like a rounding error. */
const effortLabel = (m: number): string => m < 60 ? `${m} min` : ((h) => `${h} ${h === 1 ? "hour" : "hours"}`)(Math.round((m / 60) * 10) / 10);
/** WHAT THE READ AHEAD CAN AND CANNOT SETTLE, said at the press rather than a month later. The page's own floor is a Search
 *  Console figure this card never carries, so the half that is true of every page is stated here and Results prints the number. */
const MEASURING_PLAN = "Clicks are read after 28 days. A change too small for this page's own traffic to show is read across the batch.";

/** A CONSOLIDATION IS NOT A PASTEABLE LINE: it merges or retires live pages, so it carries ordered steps and a
 *  confirmation instead of a copy box. A search naming a year dies every January, so it is worth redoing then. */
const isConsolidation = (p: ChangeProposal): boolean => String(p.kind) === "consolidation" || p.changeFamily === "consolidation";
const YEAR_QUERY = /\b20\d{2}\s*$/;
const YEAR_NOTE = "Year searches reset every January; this edit is worth redoing each year.";

/** THE ONLY CHIPS THAT ARE NOT VERB PLUS OBJECT: the shapes that are not edits at all. Every single edit is
 *  named by what the operator DOES to what ("Replace title", "Add section"); a family word like "AI answer
 *  gap" told them the diagnosis and hid the action (operator, 2026-08-27). */
const CATEGORY: [RegExp, string][] = [
  [/::consolidation$/, "Page merge"], [/::ownership$/, "Ownership decision"], [/::researching$/, "Research"],
];
const INLINE_PIECES = 4; /** How many steps a card shows in full before the list becomes the detail page's job: a two or three step treatment is read here, a forty-item correction bundle is not. */
/** THE OBJECT THIS CHANGE TOUCHES, in the customer's own words, read off the canonical field and never off
 *  prose. "One edit" told the operator nothing, and "Copy new section" appeared on things that were not
 *  sections; at ten to thirty applied changes a day, guessing the object is the product's real cost. */
const TARGET_WORD: Record<string, string> = { title: "title", meta: "meta description", h1: "heading", section: "section", answer_block: "answer", internal_link: "link" };
function targetWordOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return "page";
  if (c.kind === "existing_edit" && c.linkTo) return "link"; /* THE CHIP NAMES WHAT THE EDIT IS (operator, 2026-09-10): a one-sentence carrier for an internal link wore "Add section" because its field is section, and the operator had to guess; the link is the change, the sentence is its vehicle */
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

/** The exact primary action in one line: a bundle's objective, the producer's own headline when it wrote a real one
 *  (a sentence, no slug in it), or the field an atomic edit rewrites. A HEADLINE THAT CARRIES AN ADDRESS IS THE
 *  WRITER'S BRIEF, NOT THE CUSTOMER'S SENTENCE (rendered app, 2026-09-05): two ready cards led with "Write a real
 *  description on /california-persian-cities/berkeley: 20 pages share one templated line", a file name printed at
 *  the operator, repeating word for word the reason already printed under it. */
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
  if (c.before) return "Do this: find the exact text shown under Now, delete it, and paste the new copy in its place. Nothing else changes.";
  const anchor = /placed after (?:the heading )?[\u201c"]([^\u201d"]+)/.exec(c.where ?? "")?.[1] ?? null;
  const restates = anchor ? c.after.replace(/\s+/g, " ").trim().toLowerCase().startsWith(anchor.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40)) : false;
  if (restates) return "Do this: the new copy opens by rewriting the line named under Where it goes. Delete that old line and paste this in its place, so the sentence appears once.";
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
  ...(dangerousComponents([c]).length > 0 ? { moves: true } : {}),
}));

export function ChangeCard({ proposal, rank, ready = false, review = false, caseLine = null, onAside, onDone, onToast, picked, onPick, recorded = false, problem = null }: {
  proposal: ChangeProposal; rank: number; ready?: boolean;
  /** RECORDED BY THE BATCH BELOW THE LIST, so a card the operator never pressed still says what happened to it: the open count dropped on the batch's answer while every card it recorded kept offering Copy and Mark done, which reads as work still owed. `problem` is this row's OWN reason when the batch could not record it, printed on the row rather than as one first error under twenty cards that leaves the operator guessing which card it belongs to. */
  recorded?: boolean; problem?: string | null;
  /** BULK SELECTION, offered only where the list offers it (the Ready lane): ticking claims nothing by itself, and the one batch press below the list is what records. Absent means no checkbox renders at all. */
  picked?: boolean; onPick?: (id: string) => void;
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
  const verdict = openHold(proposal);
  const hold = review ? verdict : null;
  // THE CAVEATS, THROUGH THE ONE FILTER THE DETAIL READS. The card used to print the row's RAW limitations under
  // "Evidence and limits" while the detail printed the hold's filtered ones, so one row said two different things
  // on two screens and a caveat written for a draft whose words are gone rode the finished card.
  const caveats = cardCaveats(proposal, [...verdict.caveats, ...proof.limits.filter((l) => !proposal.limitations.includes(l)),
    ...(caveat ? [caveat] : []), ...(YEAR_QUERY.test(proposal.primaryQuery) ? [YEAR_NOTE] : [])]);
  // WHY IT IS WORTH TRYING: what was measured, and the row's own reason where it says something the measurement did not.
  const worth = [proof.ranksHere, body && !(proof.ranksHere ?? "").includes(body) ? body : null].filter(Boolean).join(" ");
  // WHAT THIS ONE IS WAITING ON BEFORE ANYBODY CAN DO IT, off the row's own typed next step: a card ranked above a smaller one that is ready reads as an order somebody could work straight through, so the dependency is printed where the card is and not folded into the ranking receipt behind an expander. A plain sentence, never a label: "Waiting on: this one waits on your confirmation" says the same thing twice.
  const waiting = ((w: string) => (w ? `${w[0]!.toUpperCase()}${w.slice(1)}.` : null))((proposal.rankingReceipt?.factors ?? []).find((f) => f.name === "readiness")?.input?.trim() ?? "");
  const placement = proposal.recommendedChange.kind === "existing_edit" ? proposal.recommendedChange.where ?? null : null;
  // WHAT STANDS BEHIND FINISHED WORK, SAID ON THE CARD THAT OFFERS IT (measured, 2026-09-05: all six Ready rows carry a paid reading bound to their exact copy, not one of them said so, and the only sentence the hold had for them was "nothing has read them for sense yet", which their own record disproves). Read off the row itself: the reading is claimed only while `semanticReview` names THESE exact words, and sources are counted by PUBLISHER and never by fact id, which is the same count the proportional evidence bar uses. A row with no outside publisher stands on words this account already publishes, its own page's or the page a link points at, and says that instead of a bare zero.
  const reading = ready && !merge && proposal.semanticReview?.of === copyKey(proposal);
  const sources = reading ? citedPublishers(proposal).size : 0;

  if (done || recorded) return (
    <li className="rounded-2xl border border-accent-primary/50 bg-surface-raised p-4" data-change-card="done">
      <p className="text-[14px] font-semibold text-foreground">{pageTitle}</p>
      <p className="mt-1 text-[13px] text-muted-foreground" data-card-done="true">Done. Measuring from {DAY_NOW()}. {MEASURING_PLAN}</p>
    </li>
  );

  return (
    <li className={`rounded-2xl border bg-surface-raised ${ready ? "border-accent-primary/50" : "border-border"}`}
      data-change-card="true">
      {problem ? <p className="px-4 pt-3 text-[12px] leading-relaxed text-red-500" data-bulk-problem="true">Not recorded: {problem} Press Mark done on this one to try it again.</p> : null}
      {/* THE WHOLE COLLAPSED HEAD IS THE CONTROL, so it is reachable by tab and opens on Enter or Space. */}
      <div className="flex w-full items-start">
      {onPick ? <input type="checkbox" data-pick-done="true" checked={picked ?? false} onChange={() => onPick(proposal.id)} aria-label={`Select ${pageTitle} for the batch`} className="ml-4 mt-5 h-4 w-4 shrink-0 accent-accent-primary" /> : null}
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
      </div>

      <div className="space-y-3 px-4 pb-4">
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
            <p className="text-[13px] font-medium leading-relaxed text-foreground" data-do-line="true">{doLineOf(proposal)}</p>
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
            {/* THE ONE LANE THAT RENDERS A CARD IN REVIEW IS THE SAFETY LANE, so this heading frames the operator's own call and never Beacon's internal QA ("A draft, not finished work" is banned customer language under the 2026-08-27 contract: unfinished work never wears a card at all). WHAT THE BLOCK SAID WAS WRONG ABOUT ITS OWN LANE (measured, 2026-09-05): the lane admits a row only while it carries NO fault and every hard reason it holds is the safety confirmation, so "copying it takes an imperfect starting point, not proven work" was printed over copy that had passed every check, on the one card whose only open question is whether to move a page. It now says what passed and what to do next, with the pieces counted. THE CAVEATS ARE NOT REPEATED HERE (2026-09-06): they are the one filtered list above, so a card carries one set of caveats and not two. */}
            <p className="text-[12px] font-semibold text-foreground">What you are deciding:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
              {hold.why.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{hold.faulted
              ? "Copying it takes an unfinished starting point, not proven work."
              : `Every other check passed on ${parts === 1 ? "this change" : `all ${parts} pieces`}. Open it, confirm the move, then make the change.`}</p>
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
            {proposal.whyRankedAboveNext ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">{proposal.whyRankedAboveNext}</p>
            ) : null}
            {/* A CARD STILL WAITING ON A LOOK ANSWERS THAT LOOK HERE. What can be RECORDED lives on the card
                itself, because a control is not supporting evidence and nobody should open an argument to press it. */}
            {hold ? (
              <ReviewAnswer proposalId={proposal.id} version={confirmedVersion(proposal)} approvable={hold.defects.length === 0} />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href={`/changes/${encodeURIComponent(proposal.id)}`}
            className="inline-flex rounded-md bg-accent-primary px-3 py-1.5 text-[13px] font-semibold text-white">
            See the change
          </Link>
          {/* THE RECORD AND THE OPERATOR'S OWN WORDING, on the card itself (operator, 2026-09-06: Copy, edit as
              applied, Mark done and Skip are the four controls a finished card offers without being opened). A new
              page owes its live address and a piece that moves a page owes a confirmation, and this control asks
              for each where it applies rather than refusing the press afterwards. A bundle past the inline limit
              lists its pieces on the change's own page, so the picker stays there and this records the whole change. */}
          {review ? null : <MarkImplemented proposalId={proposal.id} newPage={isNew} onRecorded={recordDone}
            components={parts <= INLINE_PIECES || held.length > 0 ? piecesOf(bundle) : undefined} />}
          <button type="button" data-set-aside="true" onClick={() => onAside(proposal.id)}
            className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Skip
          </button>
        </div>
      </div>
    </li>
  );
}
