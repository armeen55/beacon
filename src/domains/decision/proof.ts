/** decision/proof - THE TWO ANSWERS A CUSTOMER NEEDS BEFORE PASTING ANYTHING, selected from typed fields and  nothing else. The card argued "Backed by 3 checks", which is a count wearing an evidence label: on the live  account five of seven finished cards said exactly that, and the one carrying real assistant evidence (three  answers, eight rival sites cited, this page read and passed over) said "Page-only" and "Backed by 6 checks".  A count cannot be read, argued with, or trusted, and it is the same sentence whether the evidence is a  90-day search record or one look at the page.  THE TWO ANSWERS ARE DISTINCT AND MAY NEVER BE TRADED FOR EACH OTHER. "Why this opportunity" is about the  SIZE AND CAUSE of a problem; "why these words" is about the WORDING. Search demand never proves a sentence  is the right sentence, and a source proving a fact never proves the change will earn traffic. Every clause  here is composed from a typed field, so a producer rewording its prose can never change what this says, and  an absent field prints NOTHING rather than a zero, a placeholder or a guess. */

import { componentIdOf } from "./contracts";
import type { BundleComponentKind, ChangeProposal } from "./contracts";
import type { CauseFinding } from "./diagnosis";

/** What the card may say about a change, already selected and ordered. Every part is optional because honest
 *  absence is the normal case: a page-only repair has no demand figure and must not pretend to one. */
type ProofReceipt = {
  /** The collapsed card's one line: why this opportunity is ranked here. Null when no typed field supports one. */
  ranksHere: string | null;
  /** What was measured, each already a sentence its producer wrote with its own numbers, dated where the  evidence carried a date. `seen` is formatted from the stored instant alone, never from the reader's clock:  a relative age rendered on the server and rehydrated in the browser disagrees with itself. */
  opportunity: { fact: string; seen: string | null }[];
  /** WHY THIS TYPE OF ACTION treats the diagnosed cause: a bundle's own objective, or the treatment the  diagnosis itself named. Null when nothing diagnosed an action, which is honest and common: attention  evidence never explains why a title change beats a section, so nothing here may guess one. */
  whyAction: string | null;
  /** What else was weighed and why it lost, in the record's own sentence. The competing cause's internal slug
   *  is never printed; only its written reason is. Null when no meaningful alternative was recorded. */
  alternative: string | null;
  /** What the copy asserts, and the exact evidence carrying THAT assertion and never another claim's. */
  wording: { claim: string; because: string[] }[];
  /** THE HONEST BASIS OF THE WORDING for families where wordings compete (title, description, heading): when no  results-page pattern, winning-page reading or modeled shape backs these exact words, the receipt says so  and claims no superiority. Null when wording-class evidence exists or the family does not compete. */
  wordingBasis: string | null;
  /** The search this page already appears for, when the finished words actually use it. */
  queryEcho: string | null;
  /** Where the SHAPE of the copy came from, when it was modeled on something rather than guessed. */
  shape: string | null;
  /** WHAT THE REPLACED WORDS CARRY THAT THE NEW WORDS DO NOT: links, figures and capitalized items, read off
   *  the canonical before and after. Empty on an addition and when nothing is lost. */
  losses: string[];
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

/** WHAT THE ASSISTANTS ACTUALLY SHOWED, said at the exact strength the stage carries and no stronger. The  stages are not interchangeable: being read and passed over, never being reached, and being named without a  link are three different problems. `citations_unreported` is the one that must never become a citation gap,  because those engines do not say who they cited, so nobody measured whether this page was. */
const AI_STAGE: Record<NonNullable<NonNullable<ChangeProposal["aiImpact"]>["stage"]>, (rivals: number) => string> = {
  owned_retrieved_not_cited: () => "assistants read this page and quoted somebody else",
  rivals_cited_own_not_retrieved: (r) => `assistants never reached this page and quoted ${num(r)} other ${r === 1 ? "site" : "sites"}`,
  own_not_in_reported_sources: () => "this page was not among the sources those answers reported",
  owned_mentioned_not_cited: () => "assistants named this site without linking to it",
  citations_unreported: () => "those engines do not report which sources they used, so whether this page was cited is not known",
};

/** NOT EVERY `primaryQuery` IS A SEARCH. A factual-correction card is filed under a synthetic label built from  its own address ("/persian-rugs/kerman-rug factual accuracy", producers/factual-defects.ts), and views are  back-filled onto any row missing them, so quoting that label beside a real impression count would invent a  search nobody ran. A real search never contains the address of the page it lands on, and both sides of that  test are canonical fields, so no prose is read to decide it. */
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
  if (hasShown && hasShort) return sentence(`This page had ${num(shown!)} impressions${forSearch(p)} over 90 days and is short about ${num(short!)} clicks in the last 28`);
  if (hasShown) return sentence(`This page had ${num(shown!)} impressions${forSearch(p)} over 90 days`);
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
    losses: materialLosses(p),
    limits: [...(p.bundle?.receipt.missing ?? []), ...(p.limitations ?? []), ...certifiedScope(p)].map((l) => l.trim()).filter(Boolean) };
}

/** WHAT THE REPLACED WORDS CARRY THAT THE NEW WORDS DO NOT, read structurally off the canonical before and  after and never off prose: links and paths (function a reader loses outright), figures (facts with numbers  in them), and multi-word capitalized phrases (names, and the "Try Lesson 1 Free" class of button copy the  crawler fuses into a paragraph). Empty on an addition, because adding deletes nothing; empty when nothing  is lost, and the CARD then says so instead of staying silent. Disclosure at this layer; the link case alone  also refuses Ready in the banked re-read, because a lost link is unambiguous while a dropped phrase can be  the very correction being made. */

/** WHICH LEVERS ADDRESS WHICH CAUSE, the truth table the ranking discounts on and the boundary refuses on.  It lives HERE, in the client-safe half of the decision kernel, because the one servability verdict  (completeness's openHold) now asks the proportional-evidence question below and a client bundle reaches it;  authorization re-exports it so its callers stand unchanged. Keyed on the cause ladder's own union, TOTAL,  type-only on the ladder so no server module rides into the browser. */
export const CAUSE_LEVERS: Record<CauseFinding["cause"], ReadonlySet<BundleComponentKind>> = {
  cannibalization: new Set(["consolidation", "canonical", "redirect", "noindex", "internal_link_remove", "internal_links"]),
  ctr_snippet: new Set(["title", "meta", "h1", "anchor_text"]),
  competitor_content_gap: new Set(["section_add", "entity_expansion", "full_rewrite", "table_or_list_add", "new_page", "section", "opening_answer"]),
  incomplete_coverage: new Set(["section_add", "entity_expansion", "table_or_list_add", "full_rewrite", "new_page", "section", "opening_answer"]),
  weak_opening: new Set(["opening_answer", "h1", "paragraph_correction", "restructure"]),
  serp_shape_shift: new Set(["restructure", "table_or_list_add", "schema", "section_rewrite", "opening_answer", "section"]),
  intent_shift: new Set(["full_rewrite", "restructure", "section_rewrite", "title", "new_page", "section", "opening_answer"]),
  // `section` belongs in these three for the same reason the older seven kinds do: a section is what a producer
  // here actually mints, and leaving it out refused the very cards that answer an engine citing everybody else.
  // AND `opening_answer` BELONGS TO INCOMPLETE COVERAGE for that same reason (operator, 2026-09-02): the answer
  // block a page owes for a search it already earns and never answers is a section that leads with the answer. AND `opening_answer` BELONGS TO EVERY SET `section` IS IN (operator, 2026-09-02): a body answer that lands inside the page's own copy is filed under its real field, `answer_block`, which `leversOf` reads as `opening_answer`, and renaming what a mutation IS must never change what it is authorized to treat, so the lever is added exactly where `section` already stood. Incomplete coverage keeps its own narrower guard, in authorization.
  // and without it the boundary withheld every one of them as a lever that does not treat the coverage it closes.
  internal_link_weakness: new Set(["internal_link_add", "anchor_text", "navigation", "internal_link_remove", "internal_links", "section", "opening_answer"]),
  ai_citation_gap: new Set(["source_update", "factual_correction", "entity_expansion", "schema", "opening_answer", "source_pack", "section"]),
  retrieved_not_cited: new Set(["opening_answer", "table_or_list_add", "schema", "source_update", "entity_expansion", "source_pack", "section"]),
  // Only the levers that REPLACE the untrue words. A new section beside a wrong sentence leaves the wrong
  // sentence on the page, so section kinds are deliberately absent here.
  factual_error: new Set(["factual_correction", "paragraph_correction", "source_update"]),
  technical_indexability: new Set(["noindex", "canonical", "redirect", "navigation"]),
  // FEWER PEOPLE RUNNING THE SEARCH IS NOT A PAGE DEFECT. Nothing you can write on the page brings the searches
  // back, so this one stays deliberately empty: it matches nothing, discounts nothing, and those cards rank on
  // their other factors. Filling it in to make decline cards score would be scoring them for a fix that is not one.
  demand_decline: new Set([]),
  // LOSING GROUND ON A SEARCH PEOPLE STILL RUN IS A CONTENT PROBLEM, and it was the last empty set that made a
  // real decline card score zero for cause fit while a description errand scored its full 25. These are the
  // levers that move a page back up a search it is still shown for.
  // No title here on purpose: a sharper line does not win back a position something better took.
  ranking_loss: new Set(["section_add", "full_rewrite", "opening_answer", "internal_links", "section", "restructure"]),
  measuring_change: new Set([]),
  no_problem: new Set([]),
};
const MINTABLE: ReadonlySet<BundleComponentKind> = new Set<BundleComponentKind>(["title", "meta", "h1", "opening_answer", "section", "new_page"]);
/** A CAUSE NO PRODUCER HERE CAN TREAT MAY NOT EMPTY THE QUEUE. Refusing every card on such a page leaves the  operator holding a diagnosis and nothing to do about it, which is worse than an imperfect card: how a page  is SERVED is the live example, and its fix is plumbing no card in this product writes. THE SPLIT IS THE  EXCEPTION, and the exception is a card: the ownership family below is exactly what treats it. */
export const treatable = (cause: CauseFinding["cause"]): boolean => cause === "cannibalization" || [...CAUSE_LEVERS[cause]].some((k) => MINTABLE.has(k));
/** The field's word on a card, for the sentences below. */
const FIELD_WORD: Record<string, string> = { title: "title", meta: "description", h1: "heading" };
const bareText = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/** WHAT THIS CHANGE PROMISES THAT ITS OWN EVIDENCE DOES NOT CARRY, or null when the burden is met. THE PROOF BURDEN  MATCHES THE PROMISE (operator, 2026-08-28): a rendering repair, a factual correction, a title hypothesis and an  AEO answer make different promises and may not owe the same evidence. Refused here: replacing a title,  description or heading that exists on demand figures alone (the live Onager title rode 8,112 impressions and one  page claim into Ready with nothing naming a defect in the line it replaced); filling an empty field with  statements no banked claim carries; body copy with no re-readable gain receipt; and a replacement that loses a  unit of the passage it replaces without a checkable disposition for it. Read at the ONE servability verdict  (completeness's openHold), so the queue, Today, the detail page, Mark done, the promotion door and the producer  sweep refuse together. PURE, canonical fields only. */
/** WHAT A RECEIPT IS AUTHORIZED FOR, written out EXACTLY and compared exactly. A receipt is about a draft, never a job: `copyIdentity` excludes the copy and `workKey` names the work, so preservation kept copy A while an incoming draft's receipts rode along. The first repair bound it with `componentIdOf`, a 32-bit fingerprint meant for naming a bundle piece in a browser, and two real drafts collided on it and transferred a receipt through the very merge this was written to stop (Codex, 2026-08-28). A HASH NAMES A BUCKET; THIS NAMES THE THING: tenant and page, so the same sentence elsewhere is another decision; field and locator, so the same sentence in another slot is another decision; the replaced and proposed words; every bundle piece in order; and the CONTENT of every banked fact, so a passage rewritten under its old id goes stale. */
/** A QUOTE THE OPERATOR READS, CUT HONESTLY. `slice(0, 60)` ended mid word behind a closing quote, so a
 *  shortened passage read as if that were all the page said. */
const cut = (t: string, n = 60): string => (t.trim().length > n ? `${t.trim().slice(0, n)}...` : t.trim());

export const copyKey = (p: ChangeProposal): string => { const c = p.recommendedChange;
  return JSON.stringify([p.tenantId, p.pagePath ?? "", p.changeFamily, c.kind === "existing_edit" ? [c.field, c.where ?? "", c.before ?? "", c.after, c.linkTo ?? "", c.anchorText ?? ""] : ["new_page", c.proposedTitle, c.metaDescription, c.openingAnswer, c.outline],
    (p.bundle?.components ?? []).map((x) => [x.kind, x.page ?? "", x.where ?? "", x.before ?? "", x.after]),
    // AND WHICH PIECE EACH CLAIM ANSWERS FOR, folded ONLY where the row carries it: `of` is new, every banked reading was taken over a key that never had it, and appending a null to every claim would retire the paid review on every stored row at once.
    (p.claims ?? []).map((x) => (x.of ? [x.text, [...x.supportedBy].sort(), x.of] : [x.text, [...x.supportedBy].sort()])), [...(p.supportFacts ?? [])].map((f) => [f.id, f.fact]).sort()]); },
  /** THE ONE EDITORIAL STANDARD THIS WORK ANSWERS TO, from typed fields alone (operator, 2026-09-05). Five doors used to decide for themselves what kind of edit they were looking at, and one of them decided it from whether a `fact-` or `owned-page` id happened to be in the packet, so the same words were a summary at the writer, a missing answer at the evaluator and a synthesis at the re-read. The PERSISTED assignment wins wherever a row carries one; a row banked before the field existed falls back to what the change itself is, which is structural and cannot be wrong. It reads no evidence id, no prose and no count. PURE, and client-safe, so the card, the producer and the queue give one answer. */
  editorialStandard = (a: { field?: string | null; link?: boolean; assignment?: ChangeProposal["assignment"]; changeFamily?: string | null }): "summary" | "missing_answer" | "restructuring" | "correction" | "internal_link" | "structured_data" =>
    a.assignment?.standard ?? (a.field === "schema" ? "structured_data" : a.link === true || a.field === "internal_link" ? "internal_link"
      : a.field === "title" || a.field === "h1" || a.field === "meta" ? "summary" : a.assignment?.treatment === "restructure" ? "restructuring"
      : a.assignment?.gapKind === "stale_fact" || a.changeFamily === "factual_correction" ? "correction" : "missing_answer");
/** WHY BEACON'S OWN PAID REVIEWER HAS NOT AUTHORIZED THIS, or null. It already reads the claims and the evidence, and was answering ONE publish boolean whose claim-level reasoning was then discarded, so nothing ever recorded whether the cited facts SUPPORT the claim and "Noor means light" could stand on a passage reading "Tehran is the capital of Iran" (Codex, 2026-08-28). Asked only where a material claim is made: a mechanical repair, and copy citing only the page's own words, are not sent to a model to be told what they already prove. Fails closed on a missing, stale, short or mismatched ruling, because silence is never a pass. `REVIEW_CONTRACT` mirrors llm/prompt-registry's `draft.factual_review`, so a verdict from an older contract is re-read rather than trusted. */
export const REVIEW_CONTRACT = 7; // BUMPED 2026-09-05: the paid reading now sees the real page and the persisted assignment, so the three readings taken against the support facts standing in for the page are re-asked once (about four cents). // THE PERSISTED AUTHORIZATION CONTRACT, one number for every family that banks a reading. It read `draft.factual_review`, which is a prompt CACHE version and would have governed editor receipts by accident; bumped to 4 as the substantive editor joins it, so every earlier receipt is re-read. BUMPED AGAIN 2026-09-03 (operator spend approved): the meaning bars did not exist when these readings were taken. A reading banked before them was never asked whether the copy beats the line it replaces, whether any claim is contested, superseded or a modern reconstruction, or whether the line names anything only this page can say, and no judge ever runs on a row already wearing Ready, so a stale receipt would serve those rows for ever. Every banked reading is re-asked once, about 0.30 dollars for the 26 rows on file. It skips 5 because `draft.factual_review` reads 5 and the two may never be the same number, which the suite pins.
/** A WORDING-ONLY SUSPICION, NEVER A PROOF (operator, 2026-08-30): equal content tokens lose order, multiplicity and grammar, and "fear of God" versus "God's fear" reduces to the same bag. Suspicion routes the card to the ONE existing reviewer, whose banked `materialChange` ruling settles it; nothing is auto-retired on a bag of words. Same words in the same order (a punctuation repair) are not suspicious at all. */
export function wordingOnlySuspicion(p: Pick<ChangeProposal, "recommendedChange">): boolean {
  const c = p.recommendedChange as { before?: string | null; after?: string | null };
  const before = (c.before ?? "").trim(), after = (c.after ?? "").trim();
  if (!before || !after) return false;
  const bare = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  if (bare(before) === bare(after)) return false;
  const toks = (t: string): string => [...new Set(t.toLowerCase().replace(/'s\b/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").split(/\s+/).filter((w) => w.length > 0 && !["of", "the", "a", "an", "meaning"].includes(w)))].sort().join(" ");
  return toks(before) === toks(after);
}
export function unreviewed(p: ChangeProposal): string | null {
  const claims = p.claims ?? [], r = p.semanticReview, key = (xs: readonly string[]): string => [...xs].sort().join("|");
  // STRUCTURED DATA IS REVIEWED BY ITS OWN GATE, NOT BY THE EDITOR'S CHECKLIST (falsifier, 2026-09-02): /farsi-numbers owed a semantic review it could never pass, because every paid reading judged JSON-LD as prose and refused it with "the code adds no visible text". A schema block's claims are STRUCTURAL and its truth is the canon's visible-content proof, which validate-proposal owns.
  if (p.recommendedChange.kind === "existing_edit" && p.recommendedChange.field === "schema") return null;
  if (!(p.changeFamily === "factual_correction" || p.informationGain || claims.some((c) => c.supportedBy.some((id) => id.startsWith("fact-"))))) return null;
  if (!r || r.of !== copyKey(p)) return "nothing on file says the sources it cites actually support what it claims, so it is held until Beacon's own reviewer has read them together";
  if (r.version !== REVIEW_CONTRACT) return "the reading on file was made under an older review contract, so it is read again before these words are offered";
  // THE SUSPECTED NO-OP IS RULED, NEVER ASSUMED: a suspected card without an explicit materiality ruling is held for the reviewer, and one the reviewer ruled immaterial is never offered. Provider unavailable means it WAITS, not that it publishes or dies.
  if (wordingOnlySuspicion(p) && r.materialChange !== true) return r.materialChange === false
    ? "Beacon's reviewer ruled this rewording keeps the page's meaning, so it is not offered"
    : "this looks like a wording-only change, so Beacon's reviewer must confirm the meaning genuinely moves before it is offered";
  if (r.claims.length !== claims.length) return "the reading did not rule on every claim this change makes, and silence about one of them is not a pass";
  return claims.every((c, i) => { const v = r.claims.find((x) => x.i === i), own = new Set(c.supportedBy); return !!v && v.entailed && v.by.length > 0 && v.by.every((id) => own.has(id)); }) ? null : "a claim here was not shown to follow from the exact sources it names"; // the reading is EVIDENTIAL, never clerical (operator, 2026-08-31): a ruling entailed by a nonempty subset of the claim's OWN ids confirms the claim; only vouching through evidence the claim never named is refused
}

/** WHAT A CLAIM MAY NEVER STAND ON ALONE, and what counts as real authority for one. A rival's page, a winner read side by side and a results-page line say what OTHER sites cover and how the winning answer is shaped: that is why a piece of work is worth doing and it is never proof that a sentence is true. `fact-*` is a checked statement with a source that was actually read, and `owned-page-*` is another page of this account, which is the one comparison a page cannot make about itself. Ids, never prose, so no rewording of a briefing line can promote it to a source. */
const BRIEFING = /^(?:rival|competitor)[-\d]|^win(?:\d|pattern)|^serp\d/;
const QUALIFIED = /^fact-|^owned-page/;
/** THE PIECES OF A BUNDLE THAT PUT WORDS ON THE PAGE, and therefore owe a claim-to-source authorization of their own. A link, a canonical, a redirect and a technical repair assert nothing about the world, so they are deliberately absent: the bypass in completeness stays for exactly them. */
const SUBSTANTIVE: ReadonlySet<BundleComponentKind> = new Set<BundleComponentKind>(["section", "section_add", "section_rewrite", "opening_answer", "full_rewrite", "restructure", "entity_expansion", "table_or_list_add", "paragraph_correction", "factual_correction", "new_page"]);

/** WHY THIS BUNDLE'S SUBSTANTIVE COPY IS NOT AUTHORIZED, or null. A LOCAL RECEIPT IS NOT AUTHORIZATION (Codex, 2026-08-30): a bundle's `evidenceKeys`, its plan summary and its component label say why the work was chosen and have never said that the words are carried by anything, so a deep body bundle could put paragraphs on a customer's page having answered no claim-to-source question at all. Every piece that writes words answers on ITS OWN claims now, named through `componentIdOf` so one authorized section can never lend its ruling to the next piece, and the bundle is servable only when every one of them stands. */
function unauthorizedComponent(p: ChangeProposal): string | null {
  const owed = (p.bundle?.components ?? []).map((c, i) => ({ c, id: componentIdOf(c, i) })).filter((x) => SUBSTANTIVE.has(x.c.kind));
  if (owed.length === 0) return null;
  const claims = p.claims ?? [], r = p.semanticReview, key = (xs: readonly string[]): string => [...xs].sort().join("|");
  if (!r || r.of !== copyKey(p)) return "the words this change would put on the page have not been read against the sources they name, so it is held until Beacon's own reviewer has read them together";
  if (r.version !== REVIEW_CONTRACT) return "the reading on file was made under an older review contract, so it is read again before these words are offered";
  for (const { c, id } of owed) {
    const own = claims.map((x, i) => ({ x, i })).filter((y) => y.x.of === id);
    if (own.length === 0) return `one piece of this change ("${c.label}") states things on the page and names nothing that carries them, so it is held until it is read against its own sources`;
    const bad = own.find(({ x, i }) => { const v = r.claims.find((z) => z.i === i); return !v || !v.entailed || key(v.by) !== key(x.supportedBy); });
    if (bad) return `a claim in "${c.label}" was not shown to follow from the exact sources it names, and a piece of a change is authorized on its own evidence or not at all`;
  }
  return null;
}

export function evidenceShortfall(p: ChangeProposal): string | null { // ONE AUTHORIZATION VOCABULARY: a bundle's `plan.removes` and a component's `preserves.losses` are the customer-facing SUMMARY of a change and were pooled in as though they were the same verified record, so they are display only now; a ledger entry answers for ONE unit, because one entry quoting the whole passage claimed every unit had been considered while naming none (Codex, 2026-08-28)
  const c = p.recommendedChange;
  if (p.researchOnly === true) return null;
  // A COMPETING PAGE EXPLAINS WHY THE WORK IS WORTH DOING AND NEVER WHETHER A SENTENCE IS TRUE. Asked of every row, before anything else, because rival and winner text reaches the writer as briefing on the deep-bundle and new-page paths and the only thing standing between it and a customer's page was a prompt asking the model not to use it (Codex, 2026-08-30).
  const briefed = (p.claims ?? []).find((x) => x.supportedBy.length > 0 && x.supportedBy.every((id) => BRIEFING.test(id)));
  if (briefed) return `it says "${cut(briefed.text)}" on the strength of a page that competes with this one, which says what rivals cover and never what is true, so it is held until a checked source carries it`;
  const unread = unreviewed(p); if (unread) return unread;
  const unauthorized = unauthorizedComponent(p); if (unauthorized) return unauthorized;
  // A NEW PAGE IS THE LARGEST THING BEACON PROPOSES AND IT LEFT BY THE FIRST LINE, facing no evidence question at all (Codex, 2026-08-28), and then faced only "is there a gain receipt" (2026-08-30), which a competitor teardown satisfies. Coverage adjudication authorizes the NEED and the results pages authorize the FORMAT; neither authorizes a sentence, so every material claim the finished page makes rests on a checked source or another page this account owns, or the page stays internal and its own evidence requirement is minted.
  if (c.kind !== "existing_edit") {
    const claims = p.claims ?? [];
    if (!p.informationGain || claims.length === 0) return "a whole new page is proposed and nothing on file says what any of it stands on, so it is held until its claims, sources and plan are authorized like every other change";
    const unsupported = claims.find((x) => !x.supportedBy.some((id) => QUALIFIED.test(id)));
    return unsupported ? `a whole new page is proposed and "${cut(unsupported.text)}" rests on nothing checked, so it is held until a source on file or another page of yours carries it` : null;
  }
  const before = c.before?.trim() ?? "";
  if (before && mechanicalRepair(before, c.after)) return null;
  // A CORRECTION PROVES ITS WORDS THROUGH THE QUOTE-BOUND CHAIN so it owes no gain receipt, and it is NOT a licence to discard the page around the mistake: it left the boundary entirely, so one could replace "Meaning: Bright, radiant, or glowing. Start your free lesson today." with "Meaning: Light." and delete the call to action in silence (Codex, 2026-08-28). It answers for preservation like every other replacement.
  const correction = p.changeFamily === "factual_correction";
  if (c.field === "title" || c.field === "meta" || c.field === "h1") {
    if (before) {
      const cause = p.causeFinding?.cause ?? p.diagnosisCause; // NO BUNDLE BYPASS: a differentiation writing on every competing page proves the TREATMENT its split authorizes and never the exact words of any one component, so a bundle answers the same wording question as any other card. A diagnosis the field does not treat is already refused by unsettledCause with the sharper sentence, so this speaks only where nothing else does: no cause at all, or one whose lever set is empty
      if (!(cause && CAUSE_LEVERS[cause]?.has(c.field)) && !p.modeledOn) // AND A DIAGNOSIS THE FIELD DOES NOT TREAT IS NOT WORDING EVIDENCE EITHER: "the cause is treatable by something" let a split authorize an exact title, which is the bypass wearing a wider condition (Codex, 2026-08-28)
        return `it replaces the ${FIELD_WORD[c.field]} this page already has on demand evidence alone: demand proves the page matters, never that these words beat the current ones, so it is held until a diagnosis names what is wrong with the current ${FIELD_WORD[c.field]} or a stored results page backs this shape`;
    } else if ((p.claims ?? []).length === 0) {
      return `it fills the empty ${FIELD_WORD[c.field]} with statements none of its own sources carry, so nothing on file can confirm what it says about this page`;
    }
    return null;
  }
  // BODY COPY OWES A RE-READABLE GAIN RECEIPT. A link carries its gain in the link and a correction in its quote, so neither is asked; every other body edit is AEO work and answers here.
  // AND A LINK THAT CAME ALONE IS STILL LINK WORK (live, 2026-08-31): this recognised links only as BUNDLE COMPONENTS, so a standalone internal-link card, which is minted with no bundle exactly as a correction is, was asked for the information-gain receipt a link can never earn. Its value is the route, not a new fact. The typed destination is what says so.
  const linkWork = (p.bundle?.components ?? []).some((x) => x.kind === "internal_link_add" || x.kind === "anchor_text" || x.kind === "internal_links") || (c.kind === "existing_edit" && !!c.linkTo);
  if ((c.field === "section" || c.field === "answer_block") && !linkWork && !correction) {
    const g = p.informationGain;
    if (!g) return "nothing on file says what a reader gains from it that the page does not already say, so it is held until an evaluator reads it against the page and names the gain";
    if (p.semanticReview?.of !== copyKey(p)) return "the reading on file was written for different words, a different page or different evidence than the ones it is attached to, so nothing here was actually judged";
    if (!g.pageWhole) return "what it adds was judged against only part of this page, so whether the page already says it is not actually known, and it is held until the whole page is read against it";
    const cited = new Set((p.claims ?? []).flatMap((x) => [...x.supportedBy]));
    if (g.by.length > 0 && !g.by.every((id) => cited.has(id))) return "the evidence named for what it adds is not the evidence its claims stand on, so the gain on file belongs to a different reading";
    if (g.by.length === 0 && (p.claims ?? []).some((x) => x.supportedBy.some((id) => id.startsWith("rival-")))) return "what it adds stands on a competing page's briefing, which says what rivals cover and never what is true, so it is held until a source carries the claim";
    if (g.by.length === 0) return "it says it adds something while naming no evidence and no reorganized material that carries it, so what a reader gains cannot be checked"; // NO SHAPE EARNS AN EXEMPTION: "a replacement may earn its gain in form" let {adds: "improves clarity", by: []} authorize any replacement, so until structural work can NAME the units it reorganizes, an empty evidence list authorizes nothing anywhere
  }
  if (before) {
    const units = unitsOf(before), ledger = (p.preservation ?? []).filter((u) => bareText(u.text).length > 0 && bareText(before).includes(bareText(u.text)));
    const entryFor = (t: string): (typeof ledger)[number] | undefined => ledger.find((u) => units.filter((x) => bareText(u.text).includes(bareText(x))).length <= 1 && (bareText(u.text).includes(bareText(t)) || bareText(t).includes(bareText(u.text))));
    // A DISPOSITION IS A CHECKED CLAIM, NOT A LABEL: `why` and `to` were optional and nothing read the disposition at all, so "removed" with no reason, "moved" with no destination and "kept" over text the copy does not carry all passed on an overlapping string.
    // A DISPOSITION IS PROVED, NOT EXPLAINED: each passed on a non-empty sentence, so "because reasons" removed a call to action, "the moon" was a destination, and any fact- id anywhere on the row supported any correction (Codex, 2026-08-28). A removal names a TYPED basis, a move names somewhere this change actually writes, and a correction names the banked facts carrying THAT unit.
    const banked = new Set((p.supportFacts ?? []).map((f) => f.id)); const places = [bareText(c.after), ...(p.bundle?.components ?? []).map((x) => bareText(`${x.after} ${x.where ?? ""} ${x.page ?? ""}`))]; // ONE PLACE, NOT THE WHOLE CHANGE FLATTENED: joining every component into one string let a move name a destination carried by one piece while the material sat in a different piece (Codex, 2026-08-28)
    const cites = (u: { by?: readonly string[] }): boolean => (u.by ?? []).length > 0 && (u.by ?? []).every((id) => banked.has(id)); // A DESTINATION IS A PLACE THAT CARRIES THE MATERIAL, not a word that happens to appear: "moon" passed because the copy said moon somewhere
    const lands = (u: { text: string; to?: string }): boolean => !!u.to?.trim() && places.some((w) => w.includes(bareText(u.to!)) && w.includes(bareText(u.text)));
    const BASIS_PROVED: Record<string, ((u: { text: string; to?: string; by?: readonly string[] }) => boolean) | undefined> = { duplicate_of: lands, replaced_by: lands, moved: lands, obsolete: cites, unsupported: cites, owner_confirmed: () => !!p.confirmedVersion };
    const unverified = (u: { text: string; disposition: string; why?: string; to?: string; of?: string; basis?: string; by?: readonly string[] }): string | null =>
      p.semanticReview?.of !== copyKey(p) ? "carries a reading written for different words, a different page or different evidence than the ones it is attached to"
        : u.disposition === "kept" ? (carriesUnit(u.text, c.after) ? null : "says it keeps material the new copy no longer carries")
          : u.disposition === "corrected" ? (cites(u) ? null : "corrects material without naming the banked facts that carry that correction")
            : u.disposition === "moved" ? (lands(u) ? null : "moves material to a destination that does not carry it: a word appearing somewhere in the new copy is not a place")
              // AN ENUM IS NOT EVIDENCE: `basis` alone passed, so "obsolete, because reasons" deleted a call to action and `duplicate_of` named no survivor. A basis that points somewhere must resolve there and carry the material; one that rests on a finding must name the banked fact behind it.
              : BASIS_PROVED[u.basis ?? ""]?.(u) ? null : "removes material without a basis this door can check, and a sentence is an explanation rather than a proof";
    const unaccounted = (t: string): string | null => { const e = entryFor(t), bad = e ? unverified(e) : null; return e == null ? "neither says it nor accounts for it: every unit of a replaced passage is kept, corrected, moved with its destination, or removed with its reason before the change is offered" : bad ? `${bad}: "${cut(e.text)}"` : null; };
    const strayed = ledger.map((u) => ({ u, why: unverified(u) })).find((x) => x.why != null); // AN ENTRY NOBODY NEEDED IS STILL A CLAIM: entries were checked only when an unaccounted unit reached one, so a ledger written for other words rode along untouched whenever every unit happened to survive
    if (strayed) return `it ${strayed.why}: "${cut(strayed.u.text)}"`;
    if (c.field === "section" || c.field === "answer_block") {
      const lost = units.filter((u) => !carriesUnit(u, c.after)).map((u) => ({ u, why: unaccounted(u) })).find((x) => x.why != null);
      if (lost) return `it replaces a passage saying "${cut(lost.u)}" and ${lost.why}`;
      if ((c.where ?? "").includes("absorbs the duplicated entries") && ledger.length === 0)
        return "it says it absorbs the entries below it without naming one of them, so what the operator is being asked to delete is not stated";
    }
    const loss = materialLosses(p).map((l) => ({ l, why: unaccounted(l.replace(/^the (?:link|figure) /, "")) })).find((x) => x.why != null);
    if (loss) return `it replaces a passage that carries ${loss.l} and ${loss.why}`;
  }
  return null;
}

const unitsOf = (t: string): string[] => t.split(/(?<=[.!?])\s+|\s*[\n\u2022|]\s*|\s+[-\u2013\u2014]\s+/u).map((u) => u.trim()).filter((u) => u.length >= 10);
/** LEXICAL LOGIC MAY REFUSE; IT MAY NEVER AUTHORIZE. Material tokens as a SET with one negation flag cannot tell who did what to whom ("Alice defeated Bob" and "Bob defeated Alice" share every token), all from some, or which clause a "not" modifies, and all three passed (Codex, 2026-08-28). A unit is carried automatically ONLY when the new copy still contains it; anything else, a faithful paraphrase included, owes a typed disposition until a banked semantic verdict bound to these exact words exists. */
const carriesUnit = (unit: string, after: string): boolean => bareText(unit).length > 0 && bareText(after).includes(bareText(unit));

/** ONLY RENDERING A READER CANNOT SEE MAY PROVE ITSELF: collapsed repeat whitespace, a stray space before an unchanged mark, trimmed ends, equivalent quote glyphs. NEITHER CASE NOR A DASH CLASS IS AMONG THEM: an em dash is not a hyphen ("the man-eating shark" is not "the man - eating shark"), and: "Polish" to "polish", "US" to "us" and "March" to "march" change what a word denotes. Stripping every space and mark before comparing was "meaning is a function of letters alone", which is false in both directions: "nowhere" to "now here", "resign" to "re-sign", "well" to "we'll" and "therapist" to "the rapist" all self-authorized (Codex, 2026-08-28). WORD BOUNDARIES AND MARKS ARE MEANING, so an inserted or removed apostrophe, hyphen or comma, a moved boundary and any letter change owe whatever their treatment owes. */
export function mechanicalRepair(before: string, after: string): boolean {
  const render = (t: string): string => t.normalize("NFKC").replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"').replace(/\s+/gu, " ").replace(/ +([,.;:!?])/gu, "$1").trim();
  return render(before).length > 0 && render(before) === render(after);
}

/** WHAT THIS CHANGE CERTIFIES AND WHAT IT ONLY CARRIES, derived off the canonical before and after so every  stored row says it without being redrafted. A mark repair certifies the marks, never the sentence around  them; a factual correction that got SHORTER says why: only the source-carried meaning survives, and shorter  was never the point (operator, 2026-08-28: accuracy and usefulness are separate gates, and a narrowed line  must say it narrowed rather than pose as discovered traffic copy). */
function certifiedScope(p: ChangeProposal): string[] {
  const c = p.recommendedChange; if (c.kind !== "existing_edit" || !c.before?.trim()) return [];
  if (mechanicalRepair(c.before, c.after)) return ["This repairs the marks named here and nothing else. The rest of the wording is carried over as it was, not certified as the best copy for this page."]; const material = (t: string): number => t.toLowerCase().normalize("NFKD").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).length;
  if (p.changeFamily === "factual_correction" && material(c.after) < material(c.before)) return ["The corrected line is shorter than the one it replaces: only the meaning the cited source carries survives, the unsupported wording was narrowed, and nothing here claims the shorter line earns more traffic."];
  return [];
}

function materialLosses(p: ChangeProposal): string[] {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit" || !c.before?.trim()) return [];
  const before = c.before, after = c.after;
  const bare = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  const a = bare(after);
  const out: string[] = [];
  for (const u of before.match(/https?:\/\/\S+|\bwww\.\S+|(?<=\s|^)\/[a-z0-9-]{2,}(?:\/[a-z0-9-]+)+/g) ?? [])
    if (!after.includes(u.replace(/[).,]+$/, ""))) out.push(`the link ${u.replace(/[).,]+$/, "")}`);
  for (const n of before.match(/\d[\d,.]*(?:\s?(?:%|percent|BCE|CE|AD|BC))?/g) ?? [])
    if (n.replace(/[^\d]/g, "").length >= 2 && !a.includes(bare(n))) out.push(`the figure ${n.trim()}`);
  for (const ph of before.match(/(?:[\p{Lu}\p{N}][\p{L}\p{N}'’-]* ){1,5}\p{Lu}[\p{L}\p{N}'’-]+/gu) ?? [])
    if (!a.includes(bare(ph))) out.push(`"${ph.trim()}"`);
  return [...new Set(out)];
}
