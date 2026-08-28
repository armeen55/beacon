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

import type { BundleComponentKind, ChangeProposal } from "./contracts";
import type { CauseFinding } from "./diagnosis";
import { topicTokens } from "@/domains/evidence/relevance-gate";

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

/** WHAT THE REPLACED WORDS CARRY THAT THE NEW WORDS DO NOT, read structurally off the canonical before and
 *  after and never off prose: links and paths (function a reader loses outright), figures (facts with numbers
 *  in them), and multi-word capitalized phrases (names, and the "Try Lesson 1 Free" class of button copy the
 *  crawler fuses into a paragraph). Empty on an addition, because adding deletes nothing; empty when nothing
 *  is lost, and the CARD then says so instead of staying silent. Disclosure at this layer; the link case alone
 *  also refuses Ready in the banked re-read, because a lost link is unambiguous while a dropped phrase can be
 *  the very correction being made. */

/** WHICH LEVERS ADDRESS WHICH CAUSE, the truth table the ranking discounts on and the boundary refuses on.
 *  It lives HERE, in the client-safe half of the decision kernel, because the one servability verdict
 *  (completeness's openHold) now asks the proportional-evidence question below and a client bundle reaches it;
 *  authorization re-exports it so its callers stand unchanged. Keyed on the cause ladder's own union, TOTAL,
 *  type-only on the ladder so no server module rides into the browser. */
export const CAUSE_LEVERS: Record<CauseFinding["cause"], ReadonlySet<BundleComponentKind>> = {
  cannibalization: new Set(["consolidation", "canonical", "redirect", "noindex", "internal_link_remove", "internal_links"]),
  ctr_snippet: new Set(["title", "meta", "h1", "anchor_text"]),
  competitor_content_gap: new Set(["section_add", "entity_expansion", "full_rewrite", "table_or_list_add", "new_page", "section"]),
  incomplete_coverage: new Set(["section_add", "entity_expansion", "table_or_list_add", "full_rewrite", "new_page", "section"]),
  weak_opening: new Set(["opening_answer", "h1", "paragraph_correction", "restructure"]),
  serp_shape_shift: new Set(["restructure", "table_or_list_add", "schema", "section_rewrite", "opening_answer", "section"]),
  intent_shift: new Set(["full_rewrite", "restructure", "section_rewrite", "title", "new_page", "section"]),
  // `section` belongs in these three for the same reason the older seven kinds do: a section is what a producer
  // here actually mints, and leaving it out refused the very cards that answer an engine citing everybody else.
  internal_link_weakness: new Set(["internal_link_add", "anchor_text", "navigation", "internal_link_remove", "internal_links", "section"]),
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
/** A CAUSE NO PRODUCER HERE CAN TREAT MAY NOT EMPTY THE QUEUE. Refusing every card on such a page leaves the
 *  operator holding a diagnosis and nothing to do about it, which is worse than an imperfect card: how a page
 *  is SERVED is the live example, and its fix is plumbing no card in this product writes. THE SPLIT IS THE
 *  EXCEPTION, and the exception is a card: the ownership family below is exactly what treats it. */
export const treatable = (cause: CauseFinding["cause"]): boolean => cause === "cannibalization" || [...CAUSE_LEVERS[cause]].some((k) => MINTABLE.has(k));
/** The field's word on a card, for the sentences below. */
const FIELD_WORD: Record<string, string> = { title: "title", meta: "description", h1: "heading" };
const bareText = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * WHAT THIS CHANGE PROMISES THAT ITS OWN EVIDENCE DOES NOT CARRY, or null when the burden is met. THE PROOF
 * BURDEN MATCHES THE PROMISE (operator, 2026-08-28): a typo repair, a factual correction, a title hypothesis
 * and an AEO answer do not make the same promise and may not owe the same evidence. So a mark-only repair is
 * its own evidence and owes no results page; a factual correction answers to the quote-bound authority chain
 * and nothing extra here; a bundle answers on the receipt and plan its mint already gated. What is refused:
 * replacing a title, description or heading that exists on demand figures alone (the live Onager title rode
 * 8,112 impressions and one page claim into Ready with nothing naming a defect in the title it replaces),
 * filling an empty field with statements no banked claim carries, offering assistant-recurrence copy that adds
 * nothing beyond the page's own words (the sweep's own comment calls the empty-claims exemption a real hole),
 * and a body replacement that silently drops a link, a figure or a named phrase no typed removal accounts for.
 * Read at the ONE servability verdict (completeness's openHold), so the queue, Today, the detail page, Mark
 * done, the promotion door and the producer sweep all refuse together. PURE, canonical fields only.
 */
export function evidenceShortfall(p: ChangeProposal): string | null { // ONE AUTHORIZATION VOCABULARY: a bundle's `plan.removes` and a component's `preserves.losses` are the customer-facing SUMMARY of a change and were pooled in as though they were the same verified record, so they are display only now; a ledger entry answers for ONE unit, because one entry quoting the whole passage claimed every unit had been considered while naming none (Codex, 2026-08-28)
  const c = p.recommendedChange;
  if (p.researchOnly === true || c.kind !== "existing_edit") return null;
  const before = c.before?.trim() ?? "";
  if (before && mechanicalRepair(before, c.after)) return null;
  // A CORRECTION PROVES ITS WORDS THROUGH THE QUOTE-BOUND CHAIN so it owes no gain receipt, and it is NOT a licence to discard the page around the mistake: it left the boundary entirely, so one could replace "Meaning: Bright, radiant, or glowing. Start your free lesson today." with "Meaning: Light." and delete the call to action in silence (Codex, 2026-08-28). It answers for preservation like every other replacement.
  const correction = p.changeFamily === "factual_correction";
  if (c.field === "title" || c.field === "meta" || c.field === "h1") {
    // A BUNDLE'S DEMAND RECEIPT PROVES THE PAGE MATTERS, NEVER THAT ITS EXACT WORDS ARE BETTER, and every bundle exited here unconditionally. The one a split genuinely authorizes is the differentiation itself, which writes on every competing page and is the diagnosis's own prescription; a single-page bundle answers the same wording question as any other card.
    if (p.bundle && new Set((p.bundle.components ?? []).map((x) => x.page).filter(Boolean)).size > 1) return null;
    if (before) {
      const cause = p.causeFinding?.cause ?? p.diagnosisCause; // a diagnosis the field does not treat is already refused by unsettledCause with the sharper sentence, so this speaks only where nothing else does: no cause at all, or one whose lever set is empty
      if (!(cause && CAUSE_LEVERS[cause]?.has(c.field)) && !(cause && treatable(cause)) && !p.modeledOn)
        return `it replaces the ${FIELD_WORD[c.field]} this page already has on demand evidence alone: demand proves the page matters, never that these words beat the current ones, so it is held until a diagnosis names what is wrong with the current ${FIELD_WORD[c.field]} or a stored results page backs this shape`;
    } else if ((p.claims ?? []).length === 0) {
      return `it fills the empty ${FIELD_WORD[c.field]} with statements no banked claim carries, so what the copy asserts about this page cannot be re-checked`;
    }
    return null;
  }
  // BODY COPY OWES A RE-READABLE GAIN RECEIPT. A link carries its gain in the link and a correction in its quote, so neither is asked; every other body edit is AEO work and answers here.
  const linkWork = (p.bundle?.components ?? []).some((x) => x.kind === "internal_link_add" || x.kind === "anchor_text" || x.kind === "internal_links");
  if ((c.field === "section" || c.field === "answer_block") && !linkWork && !correction) {
    const g = p.informationGain;
    if (!g) return "nothing on file says what a reader gains from it that the page does not already say, so it is held until an evaluator reads it against the page and names the gain";
    if (!g.pageWhole) return "what it adds was judged against only part of this page, so whether the page already says it is not actually known, and it is held until the whole page is read against it";
    const cited = new Set((p.claims ?? []).flatMap((x) => [...x.supportedBy]));
    if (g.by.length > 0 && !g.by.every((id) => cited.has(id))) return "the evidence named for what it adds is not the evidence its claims stand on, so the gain on file belongs to a different reading";
    if (g.by.length === 0 && (p.claims ?? []).some((x) => x.supportedBy.some((id) => id.startsWith("rival-")))) return "what it adds stands on a competing page's briefing, which says what rivals cover and never what is true, so it is held until a source carries the claim";
    // AN EMPTY EVIDENCE LIST IS THE STRUCTURAL CASE AND ONLY THAT: a replacement may earn its gain in FORM by assembling what the page scatters, while an ADDITION naming nothing that carries what it adds is "improves clarity" wearing a receipt.
    if (g.by.length === 0 && !before) return "it says it adds something while naming no evidence that carries it, and an addition earns its place on what it brings, not on how it reads";
  }
  if (before) {
    const units = unitsOf(before), ledger = (p.preservation ?? []).filter((u) => bareText(u.text).length > 0 && bareText(before).includes(bareText(u.text)));
    const entryFor = (t: string): (typeof ledger)[number] | undefined => ledger.find((u) => units.filter((x) => bareText(u.text).includes(bareText(x))).length <= 1 && (bareText(u.text).includes(bareText(t)) || bareText(t).includes(bareText(u.text))));
    // A DISPOSITION IS A CHECKED CLAIM, NOT A LABEL: `why` and `to` were optional and nothing read the disposition at all, so "removed" with no reason, "moved" with no destination and "kept" over text the copy does not carry all passed on an overlapping string.
    const unverified = (u: { text: string; disposition: string; why?: string; to?: string }): string | null =>
      u.disposition === "kept" ? (carriesUnit(u.text, c.after) ? null : "says it keeps material the new copy no longer carries")
        : u.disposition === "corrected" ? ((p.claims ?? []).some((x) => x.supportedBy.some((id) => id.startsWith("fact-"))) ? null : "corrects material without naming a checked source for the correction")
          : u.disposition === "moved" ? (u.to?.trim() ? null : "moves material without naming where it goes") : (u.why?.trim() ? null : "removes material without saying why it may go");
    const unaccounted = (t: string): string | null => { const e = entryFor(t), bad = e ? unverified(e) : null; return e == null ? "neither says it nor accounts for it: every unit of a replaced passage is kept, corrected, moved with its destination, or removed with its reason before the change is offered" : bad ? `${bad}: "${e.text.slice(0, 60)}"` : null; };
    if (c.field === "section" || c.field === "answer_block") {
      const lost = units.filter((u) => !carriesUnit(u, c.after)).map((u) => ({ u, why: unaccounted(u) })).find((x) => x.why != null);
      if (lost) return `it replaces a passage saying "${lost.u.slice(0, 60)}" and ${lost.why}`;
      if ((c.where ?? "").includes("absorbs the duplicated entries") && ledger.length === 0)
        return "it says it absorbs the entries below it without naming one of them, so what the operator is being asked to delete is not stated";
    }
    const loss = materialLosses(p).map((l) => ({ l, why: unaccounted(l.replace(/^the (?:link|figure) /, "")) })).find((x) => x.why != null);
    if (loss) return `it replaces a passage that carries ${loss.l} and ${loss.why}`;
  }
  return null;
}

const unitsOf = (t: string): string[] => t.split(/(?<=[.!?:])\s+|\s*[\n\u2022|]\s*|\s+[-\u2013\u2014]\s+/u).map((u) => u.trim()).filter((u) => u.length >= 10);
/** Content words AND every number whole (a dropped "42" is how a figure stops being material); shared with the drafter, whose own preservation read uses the same two definitions, and beside it the polarity test, because "X is safe" and "X is not safe" share every content token. */
export const materialTokens = (t: string): string[] => [...new Set([...topicTokens(t), ...(t.toLowerCase().match(/\d[\d.,%°:-]*/gu) ?? [])])];
export const negated = (t: string): boolean => /\b(?:not|never|no|none|cannot|isn't|aren't|won't|don't|doesn't|without)\b/iu.test(t);
/** DOES THE NEW COPY STILL SAY THIS UNIT? EVERY material token, and the same yes or no. A 60 percent bag of words called "safe" preserved by "unsafe", "causes" by "prevents" and "increases" by "decreases", because one token IS the claim and four neighbours outvoted it (Codex, 2026-08-28). A faithful paraphrase carries every material token in some form and passes; dropping one changes what the passage says and owes a typed disposition. */
const carriesUnit = (unit: string, after: string): boolean => {
  const stem = (w: string): string => w.replace(/(?:ies|es|ed|ing|ly|s)$/u, "");
  const said = new Set(materialTokens(after).map(stem)), mine = materialTokens(unit);
  return mine.length === 0 || (mine.every((w) => said.has(stem(w))) && negated(unit) === negated(after)); };

/** ONLY RENDERING A READER CANNOT SEE MAY PROVE ITSELF: collapsed repeat whitespace, a stray space before an unchanged mark, trimmed ends, equivalent quote and dash glyphs, case. Stripping every space and mark before comparing was "meaning is a function of letters alone", which is false in both directions: "nowhere" to "now here", "resign" to "re-sign", "well" to "we'll" and "therapist" to "the rapist" all self-authorized (Codex, 2026-08-28). WORD BOUNDARIES AND MARKS ARE MEANING, so an inserted or removed apostrophe, hyphen or comma, a moved boundary and any letter change owe whatever their treatment owes. */
export function mechanicalRepair(before: string, after: string): boolean {
  const render = (t: string): string => t.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"').replace(/[\u2010-\u2015]/gu, "-").replace(/\s+/gu, " ").replace(/ +([,.;:!?])/gu, "$1").trim();
  return render(before).length > 0 && render(before) === render(after);
}

/** WHAT THIS CHANGE CERTIFIES AND WHAT IT ONLY CARRIES, derived off the canonical before and after so every
 *  stored row says it without being redrafted. A mark repair certifies the marks, never the sentence around
 *  them; a factual correction that got SHORTER says why: only the source-carried meaning survives, and shorter
 *  was never the point (operator, 2026-08-28: accuracy and usefulness are separate gates, and a narrowed line
 *  must say it narrowed rather than pose as discovered traffic copy). */
function certifiedScope(p: ChangeProposal): string[] {
  const c = p.recommendedChange;
  if (c.kind !== "existing_edit" || !c.before?.trim()) return [];
  if (mechanicalRepair(c.before, c.after)) return ["This repairs the marks named here and nothing else. The rest of the wording is carried over as it was, not certified as the best copy for this page."];
  const material = (t: string): number => t.toLowerCase().normalize("NFKD").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).length;
  if (p.changeFamily === "factual_correction" && material(c.after) < material(c.before))
    return ["The corrected line is shorter than the one it replaces: only the meaning the cited source carries survives, the unsupported wording was narrowed, and nothing here claims the shorter line earns more traffic."];
  return [];
}

export function materialLosses(p: ChangeProposal): string[] {
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
