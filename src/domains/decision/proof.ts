/** decision/proof - THE TWO ANSWERS A CUSTOMER NEEDS BEFORE PASTING ANYTHING, selected from typed fields and
 *  nothing else. The card argued "Backed by 3 checks", which is a count wearing an evidence label: on the live
 *  account five of seven finished cards said exactly that, and the one carrying real assistant evidence (three
 *  answers, eight rival sites cited, this page read and passed over) said "Page-only" and "Backed by 6 checks".
 *  A count cannot be read, argued with, or trusted, and it is the same sentence whether the evidence is a
 *  90-day search record or one look at the page.
 *
 *  THE TWO ANSWERS ARE DISTINCT AND MAY NEVER BE TRADED FOR EACH OTHER. "Why this opportunity" is about the
 *  SIZE AND CAUSE of a problem; "why these words" is about the WORDING. Search demand never proves a sentence
 *  is the right sentence, and a source proving a fact never proves the change will earn traffic. Every clause
 *  here is composed from a typed field, so a producer rewording its prose can never change what this says, and
 *  an absent field prints NOTHING rather than a zero, a placeholder or a guess. */

import type { ChangeProposal } from "./contracts";

/** What the card may say about a change, already selected and ordered. Every part is optional because honest
 *  absence is the normal case: a page-only repair has no demand figure and must not pretend to one. */
export type ProofReceipt = {
  /** The collapsed card's one line: why this opportunity is ranked here. Null when no typed field supports one. */
  ranksHere: string | null;
  /** What was measured, each already a sentence its producer wrote with its own numbers, dated where the
   *  evidence carried a date. `seen` is formatted from the stored instant alone, never from the reader's clock:
   *  a relative age rendered on the server and rehydrated in the browser disagrees with itself. */
  opportunity: { fact: string; seen: string | null }[];
  /** WHY THIS TYPE OF ACTION treats the diagnosed cause: a bundle's own objective, or the treatment the
   *  diagnosis itself named. Null when nothing diagnosed an action, which is honest and common: attention
   *  evidence never explains why a title change beats a section, so nothing here may guess one. */
  whyAction: string | null;
  /** What else was weighed and why it lost, in the record's own sentence. The competing cause's internal slug
   *  is never printed; only its written reason is. Null when no meaningful alternative was recorded. */
  alternative: string | null;
  /** What the copy asserts, and the exact evidence carrying THAT assertion and never another claim's. */
  wording: { claim: string; because: string[] }[];
  /** THE HONEST BASIS OF THE WORDING for families where wordings compete (title, description, heading): when no
   *  results-page pattern, winning-page reading or modeled shape backs these exact words, the receipt says so
   *  and claims no superiority. Null when wording-class evidence exists or the family does not compete. */
  wordingBasis: string | null;
  /** The search this page already appears for, when the finished words actually use it. */
  queryEcho: string | null;
  /** Where the SHAPE of the copy came from, when it was modeled on something rather than guessed. */
  shape: string | null;
  /** What Beacon looked for and does not have, plus the caveat the ranking itself already carries. */
  limits: string[];
};

const num = (v: number): string => Math.round(v).toLocaleString("en-US");
const quoted = (s: string): string => `"${s.trim()}"`;
/** One sentence, ended once. Producer explanations arrive with and without their full stop. */
const sentence = (s: string): string => { const t = s.trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };
/** The day an observation was taken, in UTC so the string is the same everywhere it renders. */
const seenOn = (iso: string | null): string | null => { const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null; };

/** WHAT THE ASSISTANTS ACTUALLY SHOWED, said at the exact strength the stage carries and no stronger. The
 *  stages are not interchangeable: being read and passed over, never being reached, and being named without a
 *  link are three different problems. `citations_unreported` is the one that must never become a citation gap,
 *  because those engines do not say who they cited, so nobody measured whether this page was. */
const AI_STAGE: Record<NonNullable<NonNullable<ChangeProposal["aiImpact"]>["stage"]>, (rivals: number) => string> = {
  owned_retrieved_not_cited: () => "assistants read this page and quoted somebody else",
  rivals_cited_own_not_retrieved: (r) => `assistants never reached this page and quoted ${num(r)} other ${r === 1 ? "site" : "sites"}`,
  own_not_in_reported_sources: () => "this page was not among the sources those answers reported",
  owned_mentioned_not_cited: () => "assistants named this site without linking to it",
  citations_unreported: () => "those engines do not report which sources they used, so whether this page was cited is not known",
};

/** NOT EVERY `primaryQuery` IS A SEARCH. A factual-correction card is filed under a synthetic label built from
 *  its own address ("/persian-rugs/kerman-rug factual accuracy", producers/factual-defects.ts), and views are
 *  back-filled onto any row missing them, so quoting that label beside a real impression count would invent a
 *  search nobody ran. A real search never contains the address of the page it lands on, and both sides of that
 *  test are canonical fields, so no prose is read to decide it. */
const searchable = (p: ChangeProposal): boolean =>
  p.primaryQuery.trim().length > 0 && !(p.pagePath && p.primaryQuery.includes(p.pagePath));
const forSearch = (p: ChangeProposal): string => (searchable(p) ? ` for ${quoted(p.primaryQuery)}` : "");

/** THE SIZE OF THE PROBLEM, in the unit it was actually measured in. Views are a 90-day audience and the click
 *  shortfall is the last 28 days: they are two windows and are never merged into one figure. */
function demandClause(p: ChangeProposal): string | null {
  const ai = p.aiImpact;
  if (ai && ai.answers > 0 && searchable(p)) {
    const stage = ai.stage ? AI_STAGE[ai.stage](ai.citedRivals) : null;
    const runs = ai.days && ai.days > 0 ? ` on ${num(ai.days)} separate ${ai.days === 1 ? "day" : "days"}` : "";
    const head = `Assistants answered ${quoted(p.primaryQuery)} ${num(ai.answers)} ${ai.answers === 1 ? "time" : "times"}${runs}`;
    return stage ? sentence(`${head}, and ${stage}`) : sentence(head);
  }
  const shown = p.demandImpressions90d, short = p.impactScore;
  const hasShown = shown != null && shown > 0, hasShort = short != null && short > 0;
  if (hasShown && hasShort) return sentence(`This page was shown ${num(shown!)} times${forSearch(p)} over 90 days and is short about ${num(short!)} clicks in the last 28`);
  if (hasShown) return sentence(`This page was shown ${num(shown!)} times${forSearch(p)} over 90 days`);
  if (hasShort) return sentence(`About ${num(short!)} clicks over 28 days are missing${searchable(p) ? ` on ${quoted(p.primaryQuery)}` : " here"}`);
  return null;
}

/** THE TWO ANSWERS, selected. Nothing here reads a regex over prose: a clause exists because a typed field
 *  exists, and disappears with it. */
export function proofOf(p: ChangeProposal): ProofReceipt {
  const demand = demandClause(p);
  // The diagnosed defect, in the diagnosis's own typed words. Skipped when the demand clause is the AI one,
  // which already said the cause: "assistants read this page and quoted somebody else" IS retrieved_not_cited,
  // and saying it twice reads as two findings.
  const explained = !p.aiImpact?.stage && p.causeFinding?.explanation ? sentence(p.causeFinding.explanation) : null;
  // A RANKING IS AN ORDER, NEVER A FORECAST. `directional` is the ranker's own flag for "measured shortfall,
  // no cause named yet", and it is the one clause that must survive when nothing else is known. It is silent
  // once a cause HAS been named, in either of the two ways one can be: an AI stage is a finding, so a card
  // saying assistants read this page and quoted somebody else may not also say nothing explains it.
  const named = explained ?? p.aiImpact?.stage ?? null;
  const order = p.rankingReceipt?.directional && !named
    ? "No cause is named for it yet, so this is the order to work in, not a promise about size." : null;
  const ranksHere = [demand, explained ?? order].filter(Boolean).join(" ") || null;

  // WHY THIS ACTION, said only by something that actually chose it: a bundle states its own objective, and a
  // diagnosis that named a treatment names it here. Attention evidence chooses nothing, so a card with neither
  // says nothing, which is the whole point: impressions justify looking, never a particular kind of edit.
  const ACTION_PHRASE: Record<string, string> = { title: "a title change", meta: "a description change", opening_answer: "an opening answer",
    section: "a section change", full_page: "a full page rewrite", new_page: "a new page", consolidate: "consolidating the competing pages", watch: "watching before acting" };
  const diagnosedAction = p.causeFinding?.action ? ACTION_PHRASE[p.causeFinding.action] ?? null : null;
  const whyAction = p.bundle?.objective
    ?? (diagnosedAction ? sentence(`The diagnosis that named this cause also named the treatment: ${diagnosedAction}`) : null);

  // WHAT ELSE WAS WEIGHED, in the record's own written reason. The competing cause's internal slug never
  // prints; a bundle's recorded alternative names its option outright.
  const alt = p.bundle?.alternatives?.[0] ?? null;
  const competing = p.causeFinding?.competingExplanations?.[0] ?? null;
  const alternative = alt ? sentence(`Considered instead: ${alt.option}. It lost because ${alt.reason}`)
    : competing ? sentence(`Also weighed and set aside: ${competing.reason}`) : null;

  // Every support id a claim names, resolved to the words it actually carries. A claim shows ITS OWN evidence
  // and never the bundle's other sources: an unrelated source standing beside a sentence it never touched is
  // the exact way a receipt starts lying.
  const facts = new Map((p.supportFacts ?? []).map((f) => [f.id, f.fact]));
  const items = p.bundle?.receipt.items ?? [];
  // A BUNDLE'S WORDING PROVENANCE IS PER COMPONENT AND NEVER POOLED: each piece shows only the receipt items
  // its own evidenceKeys name, so a fact banked for one piece can never dress up its neighbour.
  const byKey = new Map(items.map((i) => [i.key, i.fact]));
  const wording = p.bundle
    ? p.bundle.components.map((c) => ({ claim: c.objective?.trim() || c.label,
        because: (c.evidenceKeys ?? []).map((k) => byKey.get(k)).filter((f): f is string => !!f) }))
      .filter((w) => w.because.length > 0)
    : (p.claims ?? [])
      .map((c) => ({ claim: c.text, because: c.supportedBy.map((id) => facts.get(id)).filter((f): f is string => !!f) }))
      .filter((w) => w.because.length > 0);

  // The measured record: the receipt's typed items where a bundle wrote one, the producer's own evidence
  // sentences otherwise, because most finished rows on the live account carry no bundle at all.
  const opportunity = items.length > 0
    ? items.map((i) => ({ fact: i.fact, seen: seenOn(i.observedAt) }))
    : (p.evidence?.hints ?? []).map((h) => ({ fact: h, seen: null }));

  // WORDS TAKEN FROM THE SEARCH ITSELF, claimed only when the finished copy really contains it. Both sides are
  // canonical strings, so this is a comparison and not a reading of prose.
  const after = p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.after : "";
  const q = p.primaryQuery.trim();
  const queryEcho = searchable(p) && after.toLowerCase().includes(q.toLowerCase())
    ? `${quoted(q)} is the search already bringing people to this page, and the new wording uses it.` : null;

  // "BEST" IS A CLAIM THAT NEEDS WORDING-CLASS EVIDENCE, and where none exists the receipt says so instead of
  // implying it. Only the families where wordings genuinely compete are asked; a factual correction's words
  // stand on their quotes and a section's on its claims.
  const field = p.recommendedChange.kind === "existing_edit" ? p.recommendedChange.field : null;
  const wordingEvidence = !!p.modeledOn || items.some((i) => i.kind === "serp" || i.kind === "winning_page");
  const wordingBasis = (field === "title" || field === "meta" || field === "h1") && !wordingEvidence && p.changeFamily !== "factual_correction"
    ? "The wording is composed from this page and its search. No results page or winning page was checked against these exact words, so they are offered as a supported improvement, not as proven better than alternatives."
    : null;

  return { ranksHere, whyAction, alternative, opportunity, wording, wordingBasis, queryEcho, shape: p.modeledOn ?? null,
    limits: [...(p.bundle?.receipt.missing ?? []), ...(p.limitations ?? [])].map((l) => l.trim()).filter(Boolean) };
}
