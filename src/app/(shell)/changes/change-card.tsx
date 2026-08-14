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
import { markProposalImplementedAction } from "./actions";
import { pageLabel } from "./types";
import { CopyButton, MarkImplemented } from "./change-controls";

/** The producer's own boilerplate. It said the same sentence on all 37 title cards, so it is dropped outright
 *  rather than reprinted anywhere: a sentence true of every row is a fact about the producer, not a reason. */
const TITLE_FOOTNOTE = "This line says the search in the words people actually run it in.";
/** The one caveat that has to stand on its own line: this reading may not be your visitors' reading. */
const CAVEAT_MARK = "different slice of Google";

const RISK: Record<ChangeProposal["riskLevel"], { intent: PillIntent; label: string }> = {
  low: { intent: "neutral", label: "Low risk" }, medium: { intent: "waiting", label: "Medium risk" },
  high: { intent: "attention", label: "High risk" },
};
/** HOW PROVEN THIS EDIT IS, as one ordered tier: 0 cleared every evidence and safety check, 1 has a receipt
 *  citing a live results page or a page that beats you, 2 has neither. The list sorts and filters on the SAME
 *  number the chip renders, so a filter and a chip can never disagree. */
export const evidenceTier = (p: ChangeProposal, proven: boolean): 0 | 1 | 2 =>
  proven ? 0 : (p.bundle?.receipt.items ?? []).some((i) => i.kind === "serp" || i.kind === "winning_page") ? 1 : 2;
const TIER_CHIP: { intent: PillIntent; label: string }[] = [{ intent: "live", label: "Proven" },
  { intent: "measuring", label: "Early evidence" }, { intent: "waiting", label: "Best guess" }];

/** Today, in the operator's words, for the sentence a just-finished card prints. */
const DAY_NOW = (): string => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" });
const fieldWord = (f: string): string => (f === "meta" ? "description" : f.replace(/_/g, " "));

/** Effort in the operator's own units: sixty minutes is an hour, and "about 60 min" read like a rounding error. */
const effortLabel = (m: number): string =>
  m < 60 ? `${m} min` : ((h) => `${h} ${h === 1 ? "hour" : "hours"}`)(Math.round((m / 60) * 10) / 10);

/** A CONSOLIDATION IS NOT A PASTEABLE LINE: it merges or retires live pages, so it carries ordered steps and a
 *  confirmation instead of a copy box. A search naming a year dies every January, so it is worth redoing then. */
const isConsolidation = (p: ChangeProposal): boolean => String(p.kind) === "consolidation" || p.changeFamily === "consolidation";
/** One shape for comparing two written lines: spacing and case never made two sentences different. */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
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
function categoryOf(p: ChangeProposal, isNew: boolean, parts: number): string {
  if (isNew) return "New page";
  const named = CATEGORY.find(([re]) => re.test(p.id))?.[1];
  if (named) return named;
  return parts > 1 ? `${parts} edits together` : "One edit";
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
    : grab(/about ([\d,]+) clicks are being left/) ?? grab(/about ([\d,]+) fewer clicks/);
  const one = (v: string | null, plural: string, singular: string): [string | null, string] =>
    [v, v === "1" ? singular : plural];
  return [
    one(grab(/: ([\d,]+) views/) ?? grab(/showed up in Google ([\d,]+) times/), "views in Google", "view in Google"),
    one(grab(/([\d,]+) clicks?, position/) ?? grab(/got ([\d,]+) clicks?/), "clicks it earned", "click it earned"),
    one(short, "clicks a month short", "click a month short"),
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

export function ChangeCard({ proposal, rank, proven, onAside, onDone, onToast }: {
  proposal: ChangeProposal; rank: number; proven: boolean;
  onAside: (id: string) => void; onDone: (id: string) => void; onToast: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  // MARKED DONE FLIPS THE CARD WHERE IT SITS: the row stays put, says what happens next, and comes off the open
  // count on the spot. It leaves the list on the next load, which is the release's job, never this render's.
  const [done, setDone] = useState(false);
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
  // ONE NUMBER PER STEP, AND NO BLANK ROWS. Producers write steps both ways ("1. Open the editor" and "Open the
  // editor"), so a step carrying its own number printed "1. 1. Open the editor" beside the span below, and a
  // step that came through empty printed a bare "1." with nothing after it.
  const steps = (proposal.operatorSteps ?? []).map((s) => (s ?? "").replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
  // THE PAGE, SAID THE WAY A PERSON SAYS IT. The headline was the raw slug ("/famous-iranian-comedians"), which
  // is a file name; the address itself stays underneath, where an address belongs.
  const path = proposal.pagePath ?? proposal.pageLabel;
  // Only a real address goes through the slug reader: a new-page proposal carries a TITLE in pageLabel,
  // and de-slugging a title truncates it at its first slash and eats its punctuation.
  const pageTitle = proposal.pagePath ? pageLabel(proposal.pagePath) : (proposal.pageLabel || "This page");
  const secondary = path === pageTitle ? null : path;
  const tier = evidenceTier(proposal, proven);
  const chip = TIER_CHIP[tier]!;
  // A MERGE IS READ, NEVER PASTED: no copy box, no copy button, and the ordered steps become the whole fix. The
  // caution a best-guess card carries, when the row wrote one, is what the line there now already earns.
  // An instruction is read the same way: a Copy button on "Write a description that..." would paste the
  // instruction onto the site, so an after that starts with a do-this verb renders as steps, never as copy.
  // "Position held..." is the GA4 divergence diagnosis: a finding to read, never a line to paste.
  const instruction = !isConsolidation(proposal) && steps.length > 0
    && /^(Add|Write|Rewrite|Open|Move|Redirect|Paste|Link|Position held)\b/.test(after ?? "");
  // AND RESEARCH IS READ TOO. A card the pass still owes its own work on opens with a count rather than a verb,
  // so the regex above waves it through onto a Copy button. It carries its own marker instead.
  const research = (proposal.limitations ?? []).some((l) => l.includes("this card is research, not an edit"));
  const merge = isConsolidation(proposal) || instruction || research;
  // THE SAME INSTRUCTION TWICE IS NOT TWO STEPS: when the first written step already opens with the line the
  // change carries, the line is that step and prepending it printed it back to back with itself.
  const echoed = steps.length > 0 && after != null
    && norm(steps[0]!).slice(0, 25) === norm(after).slice(0, 25);
  const shownSteps = instruction && after && !echoed ? [after, ...steps] : steps;
  // A MERGE WITH NO STEPS ON FILE STILL HAS TO SAY WHAT TO DO. "Read this twice, then:" over an empty list was
  // the whole instruction, so the plan the change carries is read as a paragraph instead. It is never copyable:
  // pasting a plan onto the site is exactly the mistake this card exists to prevent.
  const mergePlan = merge && shownSteps.length === 0
    ? (after?.trim() || (bundle?.components ?? []).map((c) => c.after?.trim()).find(Boolean) || null)
    : null;
  const caution = tier === 2 ? proposal.limitations[0] ?? null : null;
  const recordDone = () => { setDone(true); onDone(proposal.id); };

  if (done) return (
    <li className="rounded-2xl border border-accent-primary/50 bg-surface-raised p-4" data-change-card="done">
      <p className="text-[14px] font-semibold text-foreground">{pageTitle}</p>
      <p className="mt-1 text-[13px] text-muted-foreground" data-card-done="true">Done. Measuring from {DAY_NOW()}.</p>
    </li>
  );

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
            the quiet one, because nobody is being asked to write the old one again. A merge has no line to
            paste at all, so it shows its ordered steps instead and never offers a copy button. */}
        {merge ? (
          shownSteps.length > 0 ? (
            <div className="space-y-1" data-merge-steps="true">
              <p className="text-[12px] font-semibold text-foreground">Read this twice, then:</p>
              <ol className="list-none space-y-0.5 text-[13px] leading-relaxed text-muted-foreground">
                {shownSteps.map((s, i) => <li key={i}><span className="tabular-nums font-semibold">{i + 1}. </span>{s}</li>)}
              </ol>
            </div>
          ) : mergePlan ? (
            <div className="space-y-1" data-merge-plan="true">
              <p className="text-[12px] font-semibold text-foreground">Read this twice before you touch anything:</p>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">{mergePlan}</p>
            </div>
          ) : null
        ) : (
          <div className="space-y-1" data-before-after="true">
            {before ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Now: <span className="line-through">{before}</span>
              </p>
            ) : isNew ? null : (
              <p className="text-[12px] italic text-muted-foreground">There is no {field} on the page today.</p>
            )}
            <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
              <p className="min-w-0 flex-1 text-[14px] font-semibold leading-relaxed text-foreground">
                <span className="font-normal text-muted-foreground">{isNew ? `Page ${field}: ` : "Change to: "}</span>{after}
              </p>
              <CopyButton text={after} onToast={onToast}
                label={`Copy ${isNew ? "" : "new "}${field} · ${effortLabel(proposal.estimatedEffortMinutes)}`} />
            </div>
          </div>
        )}

        <p className="flex flex-wrap items-center gap-1.5" data-change-facts="true">
          {/* NO TIME IS ASKED FOR ON A RESEARCH CARD, so "about 0 min" is a pill claiming a duration for work nobody has been given. */}
          {merge && proposal.estimatedEffortMinutes > 0 ? <Pill>about {effortLabel(proposal.estimatedEffortMinutes)}</Pill> : null}
          <Pill intent={RISK[proposal.riskLevel].intent}>{RISK[proposal.riskLevel].label}</Pill>
          <Pill intent={chip.intent}>{chip.label}</Pill>
          {checks.length > 0 ? (
            <button type="button" onClick={() => setChecksOpen((v) => !v)} aria-expanded={checksOpen}>
              <Pill intent="measuring">{bundle ? `Backed by ${receiptComposition(bundle.receipt.items)}` : `Backed by ${checks.length} check${checks.length === 1 ? "" : "s"}`}</Pill>
            </button>
          ) : null}
        </p>
        {caution ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground" data-guess-caution="true">{caution}</p>
        ) : null}
        {checksOpen && checks.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground" data-checks-list="true">
            {checks.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        ) : null}

        {held.length > 0 ? (
          <p data-dangerous-hold="true" className="rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-[12px] leading-relaxed text-foreground">
            {held.join(" and ")}: this changes where the page lives or whether people can find it, so it is
            held for you to read once and confirm before you make the change.
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
            {proposal.limitations.length > (caution ? 1 : 0) ? (
              <div className="space-y-1">
                <p className="text-[12px] font-semibold text-foreground">What to keep in mind</p>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
                  {proposal.limitations.slice(caution ? 1 : 0).map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            ) : null}
            {proposal.whyRankedAboveNext ? (
              <p className="text-[12px] leading-relaxed text-muted-foreground" data-why-ranked="true">{proposal.whyRankedAboveNext}</p>
            ) : null}
            {/* EVERY CARD THAT IS AN EDIT CAN RECORD THAT HE MADE IT, and hiding this control on the unproven half
                promised measurement on work that was then refused. RESEARCH IS NOT AN EDIT: nothing has been
                written for this page yet, so "Mark done" would start a 28 day reading of a change nobody made. */}
            {research ? null : (
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
          {!isNew && !research && held.length === 0 ? <MarkDoneNow proposalId={proposal.id} onRecorded={recordDone} onToast={onToast} /> : null}
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
