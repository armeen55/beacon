import "server-only";

/**
 * decision/drafted-copy: THE WORDS, ON THE CARD. The $0 producers prove a page has no description and prove a
 * page is a stub, and both hand the operator an instruction instead of work: "write a description of about 150
 * characters". That is the job, restated. This runs AFTER them and never inside one, so a budget block, a
 * refusal or a cold cache changes nothing about which cards exist or which families were swept. Two halves:
 *   1. A MISSING OR TEMPLATED DESCRIPTION gets a paste-ready line and a page AI answers never credit gets a
 *      paste-ready ANSWER, both through the EXISTING structured drafter, grounded on that page's OWN STORED
 *      BODY under named ids (one bounded read for the pass), budgeted and cached by the one gateway, and read
 *      back by the editor contract below, at most MAX_DRAFTS a pass. Anything short leaves the producer's card.
 *   2. A THIN PAGE gets an OUTLINE, deterministically, out of headings at least two read winners share, named
 *      as theirs. No model, no invention; no winners on file leaves the card as the producer wrote it. */

import { log } from "@/lib/logger";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { callStructuredLLM, draftAtomicEditStructured, type CompleteFn } from "./llm/structured-drafter";
import type { AtomicEditDraft } from "./llm/schemas";
import { validateProposal } from "./validate-proposal";
import type { ChangeProposal } from "./contracts";

/** How many drafted blocks one pass buys, descriptions and answers together; past it, the honest note. */
const MAX_DRAFTS = 5;
const META_MIN = 110, META_MAX = 165; // what Google shows of a description before it cuts, and the floor under a line worth pasting
const ANSWER_MIN = 40, ANSWER_MAX = 90; // the drafter's own brief in words; a block outside it ignored the brief and is refused, never trimmed
/** Headings this many read winners share before they are worth naming, and how many are named. */
const AGREEING_WINNERS = 2, MAX_HEADINGS = 5;
const MAX_HEADING_WORDS = 8; // a heading past this is a wrapped paragraph, and site furniture is not a subject
const FURNITURE = /^(home|menu|search|contact|about|share|follow|newsletter|comments?|related|categories|tags|advertisement|subscribe|navigation|footer|privacy|terms)\b/i;
const UNSAFE = /[–—]|\[|\]|\{|\}/; // nothing an operator can paste: a dash Beacon never writes, a bracket somebody forgot to fill in

/** The marker the ranking reads to hold a card behind finished work; "is still owed, and this card is what is owed" is the stable phrase and may not change wording. */
const owedNote = (what: string): string => `The exact ${what} lands on the next pass; it is still owed, and this card is what is owed. No action needed from you until it does.`;

const pathOf = (url: string): string => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return url; } };
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** `judge` is the semantic reader of a finished edit. ABSENT MEANS NOTHING IS ACCEPTED, so a pass with no
 *  judge wired writes no copy and buys nothing, and wiring one is a deliberate act rather than a default. */
type DraftedCopyOptions = { tenantId: string; snapshot: EvidenceSnapshot; now: Date; complete?: CompleteFn; bypassCache?: boolean; judge?: JudgeFn;
  /** The account's banned vocabulary, read once per pass by the caller so this file does no I/O of its own. */
  bannedTerms?: readonly string[] };

const slugOf = (p: ChangeProposal): string => p.id.split("::").at(-1) ?? ""; // the producer's own slug, off the id it minted

/** The page this card lands on, by either key. */
function pageFor(snapshot: EvidenceSnapshot, card: ChangeProposal): OwnedPageEvidence | null {
  const url = (card.pageUrl ?? "").trim();
  const path = (card.pagePath ?? "").trim().toLowerCase();
  return snapshot.ownedPages.find((p) => (url && canonicalUrlKey(p.url) === canonicalUrlKey(url)) || pathOf(p.url).toLowerCase() === path) ?? null;
}

// ── THE EDITOR CONTRACT ───────────────────────────────────────────────────────
/** WHETHER COPY IS FINISHED IS NOT A QUESTION ABOUT ITS SPELLING. Two word lists used to answer it: a verb list
 *  called a sentence an instruction, and a vocabulary list called a word invented because the page had not
 *  already printed it. The second refused the one thing an editor is for, a faithful paraphrase. So the editor
 *  hands back its HOMEWORK and two gates read it. The deterministic half checks only what code can know: fields
 *  present, no placeholder, every id resolves, the text it replaces and the place it lands are really on the
 *  stored page, the heading is not the tracked question said back, the copy is the length its field takes.
 *  Sense is the JUDGE's, and NO JUDGE MEANS NO DELIVERABLE. Dashes, ungrounded figures and destructive
 *  replacements stay where they live (validate-proposal, llm/numeric-fidelity): house rules for any copy. */
type EditorDeliverable = {
  actionType: "title" | "h1" | "meta" | "answer_block" | "section" | "internal_link"; targetUrl: string; placementAnchor: string; beforeText: string | null;
  finalCopy: string; naturalHeading: string | null; claims: readonly { text: string; supportedBy: readonly string[] }[];
  evidenceIdsUsed: readonly string[]; uncertaintyOrOmitted: readonly string[]; implementationMinutes: number; measurementTarget: string;
  /** A LINK IS A SENTENCE, NEVER AN ERRAND. `finalCopy` is the whole sentence carrying it, `linkTo` the owned page it lands on and `anchorText` the words on it, all three so the live check reads the link rather than a paraphrase of the instruction. */
  linkTo?: string | null; anchorText?: string | null };
/** The stored facts the deliverable is checked against; `evidence` maps an id to the exact words behind it, so "the evidence supports this" is a lookup. */
type SourcePacket = { targetUrl: string; title: string | null; h1: string | null; metaDescription: string | null; bodyText: string;
  headings: readonly string[]; evidence: Readonly<Record<string, string>>; trackedQuestion: string | null;
  /** Every path this account owns, so a link's destination is checked against the real site instead of being believed. */
  ownedPaths: readonly string[];
  /** The account's own banned vocabulary (BusinessProfile constraints), never a hardcoded list. */
  bannedTerms: readonly string[] };
/** Every ruling the judge owes on a finished edit. All seven must hold; `notes` is for the log line and nothing else. */
type JudgeVerdict = { pageFit: boolean; claimsEntailed: boolean; usefulAndNatural: boolean; placementCorrect: boolean;
  implementableNow: boolean; improvesPage: boolean; wouldHandToCustomer: boolean; notes: string };
/** The semantic reader: a model in production, a fixture in a proving pass. Null is a refusal, never an approval. */
export type JudgeFn = (d: EditorDeliverable, p: SourcePacket) => Promise<JudgeVerdict | null>;

/** WHAT ONE ACTION TYPE MAY WEIGH: characters for a line that replaces a field, words for a block of copy. */
const BAND: Record<EditorDeliverable["actionType"], [number, number, "c" | "w"]> = { title: [20, 70, "c"], h1: [10, 90, "c"],
  meta: [META_MIN, META_MAX, "c"], answer_block: [ANSWER_MIN, ANSWER_MAX, "w"], section: [40, 400, "w"], internal_link: [8, 90, "w"] };
/** COPY THAT POINTS AT THE PAGE INSTEAD OF ANSWERING. Deleted in the editor pass on the theory a judge would
 *  read for this; the judge then passed "This page lists hello, goodbye, thank you" for a page listing no such
 *  phrase, and "See the headings below for each example" as an answer. It is cheap, it is exact, and it is back.
 *  An ANSWER is the words a reader needs, never a description of where those words live. */
const SELF_POINTER = /\b(?:covered|described|explained|shown|listed)\s+(?:in|on|here)\b|\bthis (?:guide|page|article)\b|\bsee the\b|\bsections?\s+(?:below|above)\b|\bheadings?\s+below\b/i;
/** WHAT A PAGE IS SAID TO CONTAIN IS CHECKABLE. Catches the class where a named item is genuinely absent; it does
 *  NOT catch an item the page merely mentions in passing, which is why the self-pointer rule above carries the weight. */
const PAGE_CONTAINS = /\bthis page (?:lists|contains|shows|includes|gives)\b([^.!?]{0,200})/i;
/** CRAWLER MARKERS ARE NOT PAGE COPY. The capture brackets every body with these, and an anchor cut from them
 *  ("top of pagePopular Persian...") names a string no operator can find on the rendered page. */
const CHROME = /\b(?:top|bottom) of page/gi;
/** The same marker, NON-global: a /g regex carries `lastIndex` between calls, so testing with the one used for replacing alternates true and false. */
const CHROME_AT = /\b(?:top|bottom) of page/i;
const ANCHOR_MAX = 160; // a place on the page, not a paragraph: a 300 character blob is not an anchor
const PLACEHOLDER = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;
const flat = (s: string): string => s.toLowerCase().replace(/[\s\u00a0]+/g, " ").replace(/[\u201c\u201d]/g, '"').replace(/[\u2019]/g, "'").trim();
const blankish = (s: string | null | undefined): boolean => !s || s.trim().length === 0 || PLACEHOLDER.test(s);
const urlKey = (u: string): string => flat(u).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

/** THE LIVE JUDGE, through the ONE gateway: registered prompt, content-hash cache ($0 on a repeat), fail-closed
 *  budget, strict schema, single retry, then refusal. gpt-5-mini spends reasoning tokens before it answers, so
 *  the timeout is the memory's floor and not the drafter's default. Any transport or schema failure is null,
 *  which is a refusal: nothing about a judge that could not read the copy says the copy is good. */
const JUDGE_SYSTEM = 'You are a senior SEO and AEO editor reviewing ONE finished edit before it is handed to a paying customer. You are given the edit and the exact stored evidence it names. Return ONLY a JSON object with seven booleans and "notes" (one sentence naming what decided it): '
  + '"pageFit" (does this belong on THIS page), "claimsEntailed" (check EVERY material claim against the quoted evidence one at a time: the evidence must carry it, with no fact added that the evidence does not show. ANY claim about what the page itself contains, lists or shows must be verifiable in the stored page excerpt below; a page that merely mentions a subject does not list it. When in doubt on any claim, answer false), "usefulAndNatural" (does it read as a person wrote it and tell a reader something), "placementCorrect" (does it belong exactly where it says it lands), '
  + '"implementableNow" (could an operator paste this today with no further decisions), "improvesPage" (does it improve the page rather than repeat the search back, and does an answer answer rather than point at its own page), "wouldHandToCustomer" (would you personally hand this to a customer). Judge only what you are given. When in doubt on any field, answer false.';
const liveJudge = (tenantId: string, now: Date): JudgeFn => async (d, p) => {
  const user = [`Page: ${p.targetUrl}`, `Its title: ${p.title ?? "(none)"}`, `Its heading: ${p.h1 ?? "(none)"}`, `The search or question behind this: ${p.trackedQuestion ?? "(none)"}`,
    `Edit type: ${d.actionType}`, `It lands at: ${d.placementAnchor}`, d.naturalHeading ? `Under the heading: ${d.naturalHeading}` : "", d.beforeText ? `It replaces: ${d.beforeText}` : "It replaces nothing.",
    `THE COPY: ${d.finalCopy}`, "Its claims and the evidence each one names:", ...d.claims.map((c) => `- "${c.text}" <- ${c.supportedBy.join(", ")}`),
    "The stored evidence, by id:", ...Object.entries(p.evidence).map(([id, t]) => `${id}: ${t.slice(0, 700)}`), "", "Return the JSON now."].filter(Boolean).join("\n");
  const r = await callStructuredLLM({ kind: "editor_judgement", tenantId, system: JUDGE_SYSTEM, user, grounded: user, projectedCostUsd: 0.01, maxTokens: 2000, timeoutMs: 95_000, now }).catch(() => null);
  return r?.status === "drafted" ? (r.value as JudgeVerdict) : null;
};

/** WHY THIS DELIVERABLE IS NOT FINISHED, or empty. PURE, and no line here is an opinion about whether the copy is any good. */
export function deliverableFailures(d: EditorDeliverable, p: SourcePacket): string[] {
  const out: string[] = [];
  const stored = flat([p.bodyText, p.headings.join(" "), p.title ?? "", p.h1 ?? ""].join(" "));
  for (const [what, text] of [["copy", d.finalCopy], ["placement", d.placementAnchor], ["measurement target", d.measurementTarget]] as const) {
    if (blankish(text)) out.push(`its ${what} is blank or still carries a placeholder`); }
  if (blankish(d.targetUrl) || urlKey(d.targetUrl) !== urlKey(p.targetUrl)) out.push("it names a page this evidence is not about");
  const known = new Set(Object.keys(p.evidence));
  const unknown = [...new Set([...d.evidenceIdsUsed, ...d.claims.flatMap((c) => [...c.supportedBy])])].filter((id) => !known.has(id));
  if (unknown.length > 0) out.push(`it names evidence that is not on file: ${unknown.slice(0, 3).join(", ")}`);
  if (d.claims.length === 0) out.push("it makes no claim anybody could check");
  if (d.claims.some((c) => c.supportedBy.length === 0 || blankish(c.text))) out.push("one of its claims names no evidence at all");
  // WHAT IS BEING REPLACED HAS TO EXIST, or the operator is told to swap words the page does not have, and the swap deletes whatever is truly there.
  // A FIELD IS ITS OWN PLACE. A title, a heading and a description are lines the page already HAS, so what they
  // replace is the stored FIELD and where they land IS that field, never a string inside the body copy. Checked
  // against the body they were refused every single time: a description is not printed in a page's own words, so
  // no real description edit could ever finish. Copy that lands in the body still owes a real anchor in it.
  const FIELD: Partial<Record<EditorDeliverable["actionType"], string | null>> = { title: p.title, h1: p.h1, meta: p.metaDescription };
  if (d.actionType in FIELD) {
    if (d.beforeText != null && flat(d.beforeText) !== flat(FIELD[d.actionType] ?? "\u0000")) out.push("the line it says it replaces is not the one this page carries");
  } else {
    if (d.beforeText != null && !stored.includes(flat(d.beforeText))) out.push("the words it says it replaces are not on the stored page");
    if (!blankish(d.placementAnchor) && !stored.includes(flat(d.placementAnchor))) out.push("the place it says it lands is not on the stored page"); }
  if (d.actionType === "answer_block") {
    if (blankish(d.naturalHeading)) out.push("it lands somewhere new and names no heading");
    // A TRACKED PROMPT PASTED ABOVE A BLOCK IS A SEARCH STRING ON A CUSTOMER'S PAGE, the one thing a reader can see was written by a machine.
    else if (flat(d.naturalHeading!) === flat(p.trackedQuestion ?? "\u0000")) out.push("its heading is the tracked question said back word for word"); }
  const [lo, hi, unit] = BAND[d.actionType];
  const n = unit === "c" ? d.finalCopy.trim().length : words(d.finalCopy);
  if (n < lo || n > hi || UNSAFE.test(d.finalCopy)) out.push(`its copy is ${n} long, outside the ${lo} to ${hi} this field takes, or carries something nobody can paste`);
  // A LINK IS CHECKED AS A LINK: the destination has to be a page this account actually owns, and the words on it have to be in the sentence being pasted.
  // AN ANSWER MAY NOT BE ABOUT THE PAGE. Only for copy that lands in the body; a description IS about the page.
  if ((d.actionType === "answer_block" || d.actionType === "section") && SELF_POINTER.test(d.finalCopy)) {
    out.push("it points at the page instead of answering"); }
  const contains = PAGE_CONTAINS.exec(d.finalCopy);
  if (contains) {
    // ONLY THE LIST ITSELF. ", and <verb>" starts a new predicate ("and recommends lessons"), and reading its
    // words as things the page was said to contain invented failures nobody could act on.
    const missing = (contains[1] ?? "").split(/,\s+and\s+/)[0]!.split(/,| and /).map((t) => t.trim())
      .filter((t) => t.length > 3 && t.length <= 40 && !stored.includes(flat(t)));
    if (missing.length > 0) out.push(`it says the page contains things it does not: ${missing.slice(0, 3).join(", ")}`); }
  const banned = p.bannedTerms.filter((t) => t.trim() && new RegExp(`\\b${t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${d.finalCopy} ${d.naturalHeading ?? ""}`));
  if (banned.length > 0) out.push(`it uses words this account does not publish: ${banned.slice(0, 3).join(", ")}`);
  if (d.placementAnchor.trim().length > ANCHOR_MAX) out.push("where it goes is a paragraph rather than a place on the page");
  if (CHROME_AT.test(d.placementAnchor)) out.push("where it goes is taken from the crawl's own markers, not from the page");
  if (d.actionType === "internal_link") {
    if (!d.linkTo || !p.ownedPaths.some((x) => x.toLowerCase() === d.linkTo!.toLowerCase())) out.push("the page it links to is not one this account owns");
    if (blankish(d.anchorText) || !flat(d.finalCopy).includes(flat(d.anchorText!))) out.push("the words it puts on the link are not in the sentence it hands over"); }
  if (!(d.implementationMinutes > 0)) out.push("it does not say how long it takes");
  return [...new Set(out)];
}

/** THE ONE ANSWER: a finished deliverable, or every reason it is not one. Deterministic first, so a judge is never paid to read copy the packet already refutes. */
async function acceptDeliverable(d: EditorDeliverable, p: SourcePacket, judge: JudgeFn | undefined): Promise<string[]> {
  const hard = deliverableFailures(d, p);
  if (hard.length > 0) return hard;
  if (!judge) return ["nothing read it for sense, so it is not finished"];
  const v = await judge(d, p).catch(() => null);
  if (!v) return ["no reading of it came back, so nothing is accepted"];
  return ([["pageFit", "it does not belong on this page"], ["claimsEntailed", "the evidence it names does not carry every claim it makes"],
    ["usefulAndNatural", "it is not useful or does not read naturally"], ["placementCorrect", "it lands in the wrong place"],
    ["implementableNow", "an operator could not act on it as written"], ["improvesPage", "it repeats the search instead of improving the page"],
    ["wouldHandToCustomer", "no serious editor would hand this to a customer"]] as const).filter(([k]) => v[k] !== true).map(([, why]) => why);
}

/** THE STORED FACTS THIS PAGE'S EDIT IS CHECKED AGAINST, each under an id the drafter is handed and the
 *  deliverable must name back. Nothing here is fetched: it is the snapshot's own capture and this card's own
 *  evidence, so "the evidence supports this" is a lookup rather than a belief. */
function packetFor(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null, owned: readonly OwnedPageEvidence[], bannedTerms: readonly string[]): SourcePacket {
  const evidence: Record<string, string> = {};
  card.evidence.hints.forEach((h, i) => { evidence[`card-${i + 1}`] = h; });
  if (page.content?.title) evidence["page-title"] = page.content.title;
  if (page.content?.h1) evidence["page-h1"] = page.content.h1;
  (page.content?.outline ?? []).slice(0, 8).forEach((h, i) => { evidence[`page-heading-${i + 1}`] = h; });
  (body?.passages ?? []).slice(0, 6).forEach((t, i) => { evidence[`page-copy-${i + 1}`] = t; });
  return { targetUrl: page.url, title: page.content?.title ?? null, h1: page.content?.h1 ?? null, metaDescription: body?.metaDescription ?? page.content?.metaDescription ?? null,
    bodyText: [...(body?.passages ?? []), body?.vocabulary ?? ""].join(" ").replace(CHROME, " "),
    headings: [...(page.content?.outline ?? []), ...(body?.headings ?? [])], evidence, trackedQuestion: card.primaryQuery,
    ownedPaths: owned.map((o) => pathOf(o.url)), bannedTerms };
}

/** ONE FINISHED EDIT for one page, or nothing: the description under its title, or the answer a page owes.
 *  The drafter is handed the page's own stored words under named ids and must hand back the whole homework;
 *  the deterministic half of the editor contract reads it against the packet, the judge reads it for sense,
 *  and the one canon validator reads the copy last. Anything short of all three leaves the producer's card. */
async function draftBlock(card: ChangeProposal, page: OwnedPageEvidence, body: OwnedPageBody | null,
  opts: DraftedCopyOptions, kind: "description" | "answer"): Promise<EditorDeliverable | null> {
  const packet = packetFor(card, page, body, opts.snapshot.ownedPages, opts.bannedTerms ?? []);
  const outline = (page.content?.outline ?? []).slice(0, 8);
  const refuse = (why: string, extra: Record<string, unknown> = {}): null => {
    log.info(`[drafted-copy] the ${kind} is not finished`, { tenantId: opts.tenantId, path: card.pagePath, why, ...extra });
    return null; };
  // THE BRIEF'S OWN TARGET COPY IS THE STARTING POINT, NOT A PROMPT TO OUTDO. A producer that already carries an
  // agreed spec (the exact title or opening the evidence lane settled) hands it over to be VERIFIED against the
  // stored page and refined to fit, so the model checks work rather than replacing it with an idea of its own.
  const spec = card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.after.trim() : "";
  const hints = [...Object.entries(packet.evidence).map(([id, text]) => `${id}: ${text.slice(0, 400)}`),
    ...(spec ? [`The target the team already agreed for this edit: "${spec.slice(0, 600)}". Verify it against the stored copy above and refine it to fit that copy exactly; do not replace it with a different idea.`] : []),
    "Every claim you make must name the ids above that carry it. Write only what those words already show about this page."];
  const field = kind === "description" ? "meta" : "answer_block";
  // THE LINE THE MODEL IS SHOWN IS THE LINE THE GATE CHECKS. The drafter used to be handed the CARD's stored
  // `before` while the gate compared against the freshly loaded page, so any crawl newer than the card (a
  // re-punctuated dash was enough) made the model echo one string and the gate demand another, and every field
  // edit was refused for disagreeing with itself.
  const held = kind === "description" ? packet.metaDescription : null;
  const drafted = await draftAtomicEditStructured({
    query: card.primaryQuery, pageLabel: card.pageLabel, field, currentValue: held,
    outline, evidenceHints: hints, tenantId: opts.tenantId,
  }, { complete: opts.complete, now: opts.now, bypassCache: opts.bypassCache }).catch(() => null);
  // WHY THE DRAFTER SAID NO, NOT JUST THAT IT DID. The status alone ("validation_failed") named nothing that
  // could be acted on, so diagnosing one refusal meant buying another call to see what the last one objected to.
  if (!drafted || drafted.status !== "drafted") return refuse("no draft came back", { status: drafted?.status ?? "threw",
    errors: (drafted as { errors?: string[] } | null)?.errors?.slice(0, 4) ?? null, failure: (drafted as { failure?: string } | null)?.failure ?? null });
  const v = drafted.value as AtomicEditDraft;
  const claims = v.claims.map((c) => ({ text: c.text, supportedBy: c.supportedBy }));
  const deliverable: { -readonly [K in keyof EditorDeliverable]: EditorDeliverable[K] } = {
    actionType: kind === "description" ? "meta" : "answer_block", targetUrl: page.url,
    placementAnchor: v.placementAnchor, beforeText: v.before, finalCopy: v.after.replace(/\s+/g, " ").trim(),
    naturalHeading: v.naturalHeading, claims, evidenceIdsUsed: [...new Set(claims.flatMap((c) => [...c.supportedBy]))],
    uncertaintyOrOmitted: v.risks, implementationMinutes: v.implementationMinutes || (card.estimatedEffortMinutes ?? 0),
    measurementTarget: v.proofPlan.metrics[0] ?? "",
  };
  // THE MODEL PROPOSES, CODE VERIFIES. A field edit replaces the page's OWN stored line, and a model that
  // paraphrases or re-spaces it by a character was refused outright. A near miss is RESOLVED to the exact stored
  // form here, so what persists is still character-exact to the page; only a `before` naming something else fails.
  // A NEAR MISS IS PUNCTUATION, NOT DISAGREEMENT. The house rule forbids en dashes, so a model asked to echo a
  // stored line containing one rewrites it ("550-330" for "550\u2013330") and the two strings stop matching. They are
  // compared with dashes and their spacing normalized, and the STORED form is what gets written back.
  const norm = (t: string): string => flat(t).replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, "-");
  const near = (a: string, b: string): boolean => norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
  // AN ANCHOR IS A SENTENCE A HUMAN CAN FIND. The model may hand back a whole paragraph or a run that starts in
  // the crawl's own markers; the SHORTEST stored sentence carrying it is what an operator can actually look for,
  // so the anchor is resolved to that and only an anchor nothing on the page carries is refused below.
  const anchor = deliverable.placementAnchor.trim();
  if (anchor) {
    // AMBIGUITY IS A REFUSAL, NEVER A GUESS: two distinct stored sentences sharing the matched prefix means the
    // operator could land the copy in the wrong place, so nothing is rewritten and the card keeps its owed note.
    const cands = [...new Set(packet.bodyText.replace(CHROME, " ").split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= ANCHOR_MAX && flat(t).includes(flat(anchor.slice(0, 60)))))];
    if (cands.length > 1) return refuse("where it goes matches more than one place on the page", { reasons: ["where it goes matches more than one place on the page"] });
    if (cands[0]) deliverable.placementAnchor = cands[0];
  }
  if (held && deliverable.beforeText != null && near(held, deliverable.beforeText)) deliverable.beforeText = held;
  const refused = await acceptDeliverable(deliverable, packet, opts.judge ?? liveJudge(opts.tenantId, opts.now));
  // A REFUSAL NAMES THE TWO STRINGS IT COMPARED. "not the line this page carries" was unactionable without them.
  if (refused.length > 0) return refuse(refused[0]!, { reasons: refused.slice(0, 3), held: (held ?? "").slice(0, 120), proposed: (deliverable.beforeText ?? "").slice(0, 120) });
  // THE ONE CANON VALIDATOR, last and unchanged: dashes, ungrounded figures and destructive replacements are
  // house rules about any copy Beacon ships, not opinions about this deliverable, so they stay their own gate.
  const verdict = validateProposal({ ...card, recommendedChange: { kind: "existing_edit", field: kind === "description" ? "meta" : "section",
    before: deliverable.beforeText, after: deliverable.finalCopy } },
  // THE PAGE'S OWN WORDS GO IN. The canon validator's entailment half was handed the card's hints and the
  // outline and never the stored body, so it judged copy about a page against everything except that page.
  { pageBodyText: packet.bodyText, evidenceText: [...outline, ...hints, packet.title ?? ""].filter(Boolean).join(" "), now: opts.now });
  return verdict.verdict === "rejected" ? refuse(verdict.reasons[0] ?? "canon refused it") : deliverable;
}

/** WHAT THE PAGES THAT WIN THIS PAGE'S OWN HEAD SEARCH COVER, off headings at least two READ winners share.
 *  Deterministic and quotes nobody: a heading is named only when several of them agree on it. */
function winnersCover(snapshot: EvidenceSnapshot, page: OwnedPageEvidence): string[] {
  const head = [...(page.search?.topQueries ?? [])].sort((a, b) => b.impressions - a.impressions)[0]?.query;
  const row = head ? (snapshot.research?.serpEvidence ?? []).find((s) => canonicalQueryKey(s.query) === canonicalQueryKey(head)) : null;
  if (!row) return [];
  const ranked = new Set(row.organic.map((o) => canonicalUrlKey(o.url)));
  const mine = canonicalUrlKey(page.url);
  const seen = new Map<string, { label: string; on: Set<string> }>();
  for (const w of snapshot.research?.winningPages ?? []) {
    const key = canonicalUrlKey(w.url);
    if (key === mine || !ranked.has(key) || !w.extract) continue;
    for (const h of w.extract.headings) {
      const label = h.replace(/\s+/g, " ").trim();
      if (!label || label.length > 60 || words(label) > MAX_HEADING_WORDS || FURNITURE.test(label) || UNSAFE.test(label)) continue;
      const at = label.toLowerCase();
      const cur = seen.get(at) ?? { label, on: new Set<string>() };
      cur.on.add(w.domain);
      seen.set(at, cur);
    }
  }
  return [...seen.values()].filter((h) => h.on.size >= AGREEING_WINNERS)
    .sort((a, b) => b.on.size - a.on.size || a.label.localeCompare(b.label)).slice(0, MAX_HEADINGS).map((h) => h.label);
}

/** The same cards, with words wherever this pass could honestly put them. Never adds, drops or reorders a
 *  card. Fail-soft: anything that does not land leaves the producer's own card intact. */
export async function applyDraftedCopy(cards: readonly ChangeProposal[], opts: DraftedCopyOptions): Promise<ChangeProposal[]> {
  const out: ChangeProposal[] = [];
  let bought = 0;
  // ONE bounded body read for the pass: the stored copy of exactly the pages about to be drafted, never the site.
  const drafting = cards.filter((c) => ["missing_description", "ai_answer_gap"].includes(slugOf(c)))
    .map((c) => pageFor(opts.snapshot, c)?.url).filter((u): u is string => !!u).slice(0, MAX_DRAFTS);
  const bodies = drafting.length > 0 ? await loadOwnedPageBodies(opts.tenantId, drafting).catch(() => new Map<string, OwnedPageBody>()) : new Map<string, OwnedPageBody>();
  for (const card of cards) {
    const slug = slugOf(card);
    const wants = slug === "missing_description" ? "description" : slug === "ai_answer_gap" ? "answer" : null;
    const page = wants || slug === "thin_page" ? pageFor(opts.snapshot, card) : null;
    if (!page) { out.push(card); continue; }
    if (wants) {
      const meta = wants === "description";
      const drafted = bought < MAX_DRAFTS ? await draftBlock(card, page, bodies.get(canonicalUrlKey(page.url)) ?? null, opts, meta ? "description" : "answer") : null;
      if (drafted) bought += 1;
      out.push(drafted
        ? { ...card, researchOnly: false,
            recommendedChange: { kind: "existing_edit", field: meta ? "meta" : "section",
              before: drafted.beforeText, after: drafted.finalCopy,
              // WHERE IT GOES, IN THE PAGE'S OWN WORDS. The placement used to be built out of the tracked
              // question ("a new section headed \"What are basic Persian phrases for beginners?\""), which put a
              // search string on the customer's page. It is now the anchor the editor found in the stored copy
              // and a heading a reader would search for, both checked against that copy before they got here.
              where: meta ? null : `A new section headed "${drafted.naturalHeading ?? ""}", placed after "${drafted.placementAnchor}"` },
            operatorSteps: meta
              ? [`Open the site editor on ${card.pagePath}`, "Paste the description above, exactly as written",
                "Mark it done here and the click rate gets read again"]
              : [`Open the site editor on ${card.pagePath}`, `Find "${drafted.placementAnchor}" on the page`,
                `Start a new section straight after it, with the heading "${drafted.naturalHeading ?? ""}"`,
                "Paste the answer above as that section's opening, exactly as written", "Mark it done here and the next answers get checked against it"],
            limitations: [...card.limitations, ...drafted.uncertaintyOrOmitted, meta
              ? "This line is written off the page's own title, headings and stored copy as last read, so check it still describes the page before you publish it."
              : "This answer is written off the page's own title, headings and stored copy as last read and the stored answers this card cites, so check every word of it is true of the page before you publish it."] }
        : { ...card, limitations: [...card.limitations, owedNote(wants)] });
      continue;
    }
    const covers = winnersCover(opts.snapshot, page);
    out.push(covers.length === 0 ? card : { ...card,
      recommendedChange: { kind: "existing_edit", field: "section",
        before: card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.before : null,
        after: `${card.recommendedChange.kind === "existing_edit" ? card.recommendedChange.after : ""} The pages that win this cover: ${covers.join(", ")}.` },
      operatorSteps: [...(card.operatorSteps ?? []).slice(0, -1), `Give each of these its own section: ${covers.join(", ")}`,
        ...(card.operatorSteps ?? []).slice(-1)],
      limitations: [...card.limitations, `Those subjects are the headings ${AGREEING_WINNERS} or more of the pages Google ranks for this search share, read off the copies on file, and they are what those pages cover rather than a plan written for this one.`] });
  }
  if (bought > 0) log.info("[drafted-copy] blocks written this pass", { tenantId: opts.tenantId, bought });
  return out;
}
