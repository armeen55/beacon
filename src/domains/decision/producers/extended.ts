/**
 * decision/producers/extended (V1 Closure, launch blocker 9): the causes that could name a problem and never
 * write the fix. A page that strands its readers, an engine that read it and cited somebody else, an engine
 * that never found it, two of the account's own pages splitting one search: every one of those reached the
 * operator as a sentence and a shrug. Each producer below turns ONE of them into the exact components an
 * operator can act on, or into one honest refusal that says what is missing and what to do about it.
 *
 * THE RULES THIS FILE OBEYS, because validate-proposal enforces them: every component here is outside the
 * seven legacy kinds, so it carries where, objective, mechanism and measurementPlan or the proposal is
 * refused; a component changing factual content carries a source pack assembled ONLY from evidence already
 * supplied; a change that moves or hides a page is marked dangerous; and a component always cites the
 * finding's own receipt keys. THE COPY OBEYS THEM TOO: no sentence opens on a capitalized word the factual
 * firewall cannot place, and every after-text names the page's own search.
 *
 * PURE apart from the drafting calls handed in on the context. No store, no clock, no model of its own.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { BundleComponent } from "../contracts";
import type { CauseFinding } from "../diagnosis";
import type { Produced, Producer, ProducerCtx } from "./contract";

/** Two links is the whole budget: a stranded reader needs a way through, not a directory. And a rebuild is
 *  the biggest swing there is, so it is earned by causes agreeing, never by one loud one. */
const MAX_LINKS = 2;
const MAX_REQUIREMENTS = 4;
const MAX_HEADINGS = 6;
const MIN_STRUCTURAL_CAUSES = 2;

const count = (n: number): string => Math.round(n).toLocaleString("en-US");
/** The last net: no em or en dash ever reaches an operator, and the double gap one leaves is collapsed. */
const nodash = (s: string): string => s.replace(/[–—]/g, " ").replace(/[^\S\r\n]{2,}/g, " ");
const plain = (s: string): string => nodash(s).replace(/\s+/g, " ").trim();
const sentence = (s: string): string => (/[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const refuse = (refusal: string): Produced => ({ components: [], refusal });

/** Nothing on file behind the cause means nothing may be claimed from it: every producer shares this one. */
const NO_EVIDENCE = "I cannot show you anything behind this, so I am not writing a change for it. Let me research this page again and I will come back with what I found.";

function evidenceKeysOf(ctx: ProducerCtx): string[] | null {
  const keys = ctx.finding.evidenceKeys.filter((k) => k.trim().length > 0);
  return keys.length > 0 ? keys : null;
}

// ── the structured payload, read by SHAPE ────────────────────────────────────
// The ladder attaches a small structured payload so a producer never parses an operator sentence back into
// numbers. Read by SHAPE, not by field name: a finding stored before that payload existed carries none of
// it, and the honest answer to that is a refusal saying what is missing, never a guess.

type Bag = Record<string, unknown>;
const MAX_SCAN = 60;

function collect(v: unknown, depth: number, out: Bag[]): void {
  if (!v || typeof v !== "object" || Array.isArray(v) || depth < 0 || out.length >= MAX_SCAN) return;
  out.push(v as Bag);
  for (const inner of Object.values(v as Bag)) collect(inner, depth - 1, out);
}

function bagsOf(finding: CauseFinding): Bag[] {
  const out: Bag[] = [];
  collect(finding, 3, out);
  return out;
}

const numberAt = (b: Bag, k: string): number | null =>
  (typeof b[k] === "number" && Number.isFinite(b[k]) ? (b[k] as number) : null);
const textAt = (b: Bag, k: string): string | null => {
  const v = b[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
};

function linkGap(f: CauseFinding): { medianWinnerLinks: number; ownedLinks: number } | null {
  for (const b of bagsOf(f)) {
    const median = numberAt(b, "medianWinnerLinks");
    const owned = numberAt(b, "ownedLinks");
    if (median !== null && owned !== null) return { medianWinnerLinks: median, ownedLinks: owned };
  }
  return null;
}

function enginePrompt(f: CauseFinding): { engine: string; promptText: string } | null {
  for (const b of bagsOf(f)) {
    const engine = textAt(b, "engine");
    const promptText = textAt(b, "promptText");
    if (engine && promptText) return { engine, promptText };
  }
  return null;
}

function competingPages(f: CauseFinding): { paths: string[]; stronger: string | null } | null {
  for (const b of bagsOf(f)) {
    if (!Array.isArray(b.competingPaths)) continue;
    const paths = [...new Set((b.competingPaths as unknown[])
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim()))];
    if (paths.length >= 2) return { paths, stronger: textAt(b, "strongerPath") };
  }
  return null;
}

// ── 1. internal links: somewhere for the reader to go next ───────────────────

const WEAK_ANCHOR = /^(read more|learn more|click here|here|more|this page|link|details|see more|continue)$/i;

type Target = { path: string; topic: string; score: number };

/** Same site, same account, never the page itself. Anything I cannot resolve is not a page I will name. */
function ownPath(href: string, pageUrl: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) return null;
  let base: URL | null = null;
  try { base = new URL(pageUrl); } catch { base = null; }
  try {
    const u = new URL(raw, base ?? "https://site.invalid");
    if (base && u.host !== base.host) return null;
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch { return null; }
}

const wantedTokens = (ctx: ProducerCtx): Set<string> =>
  new Set([...topicTokens(ctx.primary), ...(ctx.body?.entityNames ?? []).flatMap((e) => topicTokens(e))]);

/** WHERE THIS PAGE ALREADY SENDS PEOPLE, by canonical path: a second link to a destination it already
 *  points at is not somewhere new to go. */
const alreadyLinked = (ctx: ProducerCtx): Set<string> =>
  new Set((ctx.body?.internalLinks ?? []).map((l) => ownPath(l.href, ctx.page.url)).filter((p): p is string => !!p));

/** DETERMINISTIC FIRST: the target comes from THE ACCOUNT'S OWN PAGE INVENTORY, never from the links this
 *  page already carries. Scored on the words the search and the page's subjects share with the destination's
 *  address and name, so the same context in is the same two targets out. No body, no link: it is a coin flip. */
function candidateTargets(ctx: ProducerCtx): Target[] {
  if (!ctx.body) return [];
  const self = ownPath(ctx.page.url, ctx.page.url);
  const want = wantedTokens(ctx);
  const linked = alreadyLinked(ctx);
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const owned of ctx.ownedPages) {
    const path = ownPath(owned.url, ctx.page.url);
    if (!path || path === self || linked.has(path) || seen.has(path)) continue;
    seen.add(path);
    const name = (owned.title ?? owned.h1 ?? "").trim();
    const tokens = new Set([...topicTokens(path), ...topicTokens(name)]);
    const shared = [...tokens].filter((t) => want.has(t));
    if (shared.length === 0) continue;
    out.push({ path, topic: name || ctx.primary, score: shared.length });
  }
  return out.sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic) || a.path.localeCompare(b.path));
}

/** THE ONE THING AN EXISTING LINK IS STILL GOOD FOR: words that tell a reader nothing. Provable only when the
 *  destination is a page of this account whose own name is on this page's subject, so the replacement words
 *  are read off something held rather than written. Anything less clean and no anchor is touched this pass. */
function weakAnchorSwap(ctx: ProducerCtx): { anchor: string; path: string; name: string } | null {
  const want = wantedTokens(ctx);
  const named = new Map<string, string>();
  for (const owned of ctx.ownedPages) {
    const path = ownPath(owned.url, ctx.page.url); const name = (owned.title ?? owned.h1 ?? "").trim();
    if (path && name && !named.has(path)) named.set(path, name);
  }
  for (const link of ctx.body?.internalLinks ?? []) {
    const anchor = link.anchorText.trim(); const path = ownPath(link.href, ctx.page.url);
    const name = path ? named.get(path) : undefined;
    if (!WEAK_ANCHOR.test(anchor) || !path || !name || !topicTokens(name).some((t) => want.has(t))) continue;
    return { anchor, path, name };
  }
  return null;
}

function placeFor(ctx: ProducerCtx, target: Target): string {
  const tokens = new Set([...topicTokens(target.topic), ...topicTokens(target.path)]);
  const heading = ctx.page.outline.find((h) => topicTokens(h).some((t) => tokens.has(t)));
  return heading ? `the section headed "${heading}"` : `the part of this page that talks about ${target.topic}`;
}

/** A drafted line's first word wears a capital because of where it sat, not because it names anything, and
 *  quoted inside one of my sentences the firewall reads it as an invented name. So the opener keeps its
 *  capital only when it is a word this page itself uses, and otherwise reads as the clause it now is. */
function openLower(line: string, own: Set<string>): string {
  const token = topicTokens(line.split(/\s+/)[0] ?? "")[0];
  return token && own.has(token) ? line : line.charAt(0).toLowerCase() + line.slice(1);
}

export const produceInternalLinks: Producer = async (ctx) => {
  if (ctx.finding.cause !== "internal_link_weakness") return refuse("I did not find this page's links to be what loses it the click, so I am not writing links for it. Ask me what I did find and I will show you.");
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const gap = linkGap(ctx.finding);
  if (!gap) return refuse("I have not counted this page's links against the pages that win its subject, so I am not going to invent somewhere to send a reader. Research this page again and I will count both sides.");
  const targets = candidateTargets(ctx);
  if (targets.length === 0) return refuse("I know this page leaves a reader with nowhere to go, and I do not hold another page of yours on this subject to send them to, so I am not inventing one. Tell me the page it should lead to and I will write the sentence.");
  // NEVER MY OWN FIGURES. This drafted sentence becomes copy on the operator's page, and a receipt fact is a
  // number ABOUT the page (clicks, views), so handing them over let a click count land in a line somebody
  // publishes. The hints are this page's own words and what the pages winning the subject say.
  const evidenceHints = [ctx.page.title, ctx.page.h1, ...ctx.page.outline,
    ...(ctx.body?.entityNames ?? []), ...(ctx.pattern?.commonHeadings ?? []).map((h) => h.heading)]
    .filter((h): h is string => typeof h === "string" && h.trim().length > 0).slice(0, MAX_REQUIREMENTS);
  const own = ownVocabulary(ctx);
  const components: BundleComponent[] = [];
  for (const target of targets.slice(0, MAX_LINKS)) {
    const drafted = await ctx.draft.internalLink({
      query: ctx.primary, sourcePage: ctx.page.url, targetPage: target.path, topic: target.topic, evidenceHints,
    });
    if (!drafted) continue;
    const anchor = plain(drafted.anchorText);
    const line = plain(drafted.linkSentence);
    if (!anchor || !line) continue;
    const place = placeFor(ctx, target);
    // EVERY SENTENCE OPENS ON A WORD THE FIREWALL CAN PLACE, and the copy says the page's own subject out
    // loud: an instruction opening "Point the words" was read as a named thing this file invented, and a
    // link sentence that never repeated what the page is about was refused as off-topic. Both were true copy
    // refused for how it was worded, so the wording is what changed.
    components.push({
      kind: "internal_link_add",
      label: `Link to ${target.path}`,
      before: null,
      after: `I would add this line to ${place}: ${sentence(openLower(line, own))} The words "${anchor}" then point at ${target.path}, so a reader who came for "${ctx.primary}" has somewhere to go next.`,
      evidenceKeys: keys,
      risk: "safe",
      where: place,
      objective: `Send the reader who lands here on to ${target.path} instead of leaving them at the bottom of this page.`,
      mechanism: `The pages that win this subject point readers on to about ${count(gap.medianWinnerLinks)} of their own pages and this one points to ${count(gap.ownedLinks)}, so somebody who lands here has nowhere to go next.`,
      measurementPlan: `I will read clicks and average position for "${ctx.primary}" on this page and on ${target.path} at 7, 14 and 28 days after you add it.`,
    });
  }
  // AN EXISTING LINK IS NEVER A NEW DESTINATION, and the only change worth making to one is the words on it.
  const swap = weakAnchorSwap(ctx);
  if (swap) components.push({
    kind: "anchor_text",
    label: `Rename the link to ${swap.path}`,
    before: swap.anchor,
    // The exact new wording travels structured, so the live check reads the LINK'S OWN WORDS rather than
    // re-parsing my sentence about them.
    anchorAfter: swap.name,
    after: `I would change the words "${swap.anchor}" that already point at ${swap.path} so they read "${swap.name}", because a reader who came for "${ctx.primary}" cannot tell where that link goes until they have spent the click.`,
    evidenceKeys: keys,
    risk: "safe",
    where: `the words "${swap.anchor}" where they already sit on this page`,
    objective: `Say out loud where that link goes, so a reader who came for "${ctx.primary}" knows before they click it.`,
    mechanism: `The words on that link describe nothing, so the one route this page already offers reads as noise and the reader stops here.`,
    measurementPlan: `I will read clicks and average position for "${ctx.primary}" on this page and on ${swap.path} at 7, 14 and 28 days after you change it.`,
  });
  if (components.length === 0) return refuse("I could not write a link sentence for this page that I would stand behind, so I am handing you nothing rather than filler. Ask me again and I will try the next page down.");
  return { components, refusal: null };
};

// ── 2. source expansion: what an engine reads before it decides who to name ───

function ownVocabulary(ctx: ProducerCtx): Set<string> {
  const body = ctx.body;
  const text = [ctx.page.title, ctx.page.h1, ...ctx.page.outline,
    body?.openingSample ?? null, body?.metaDescription ?? null, ...(body?.cardTexts ?? []), ...(body?.entityNames ?? [])]
    .filter((t): t is string => !!t).join(" ");
  return new Set(topicTokens(text));
}

function pageClaims(ctx: ProducerCtx): string[] {
  const body = ctx.body;
  if (!body) return [];
  const said = [...(body.openingSample ?? "").split(/(?<=[.?!])\s+/), ...body.cardTexts]
    .map((s) => plain(s)).filter((s) => s.split(/\s+/).filter(Boolean).length >= 5);
  return [...new Set(said)];
}

/**
 * A SOURCE RECOMMENDATION EXISTS ONLY WHEN I HOLD ALL FIVE PIECES: a claim that belongs ON the page, the kind
 * of source that would back it, the exact line to add, where it belongs and why it improves the page. Any one
 * missing is a refusal that says which. THE CLAIM IS NEVER ONE OF MY OWN MEASUREMENTS: "this page received
 * 6,000 views" is a fact ABOUT the page, never a sentence to put ON it. A claim here is a subject the cited
 * pages all name, or something this page already says in its own words.
 */
export const produceSourceExpansion: Producer = async (ctx) => {
  const cause = ctx.finding.cause;
  if (cause !== "ai_citation_gap" && cause !== "retrieved_not_cited") return refuse("I did not find AI answers to be what this page loses on, so I am not writing sources for it. Ask me what I did find and I will show you.");
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const seen = enginePrompt(ctx.finding);
  if (!seen) return refuse("I do not hold which engine answered that search or what it was asked, so I cannot tell you what this page has to add. Let me read the AI answers for that search again.");
  const mine = ownVocabulary(ctx);
  const missing = (ctx.pattern?.commonEntities ?? [])
    .map((e) => e.entity.trim()).filter((e) => e.length > 0)
    .filter((e) => { const t = topicTokens(e); return t.length > 0 && !t.some((x) => mine.has(x)); })
    .slice(0, MAX_REQUIREMENTS);
  // Credibility first: an engine that READ this page and named somebody else did not miss it, it judged it,
  // and what it judged is whether the page can be checked, so that one sources what the page already claims.
  // A gap the engine never reached is a coverage question, answered by covering what every cited page covers.
  const expansion = cause === "ai_citation_gap" && missing.length > 0;
  // 1. THE CLAIM, and it has to belong on the page.
  const claims = (expansion ? missing : pageClaims(ctx)).slice(0, MAX_REQUIREMENTS);
  if (claims.length === 0) return refuse("I hold nothing this page could say that a source would back: no subject the pages being cited all name that this one leaves out, and none of this page's own sentences on file. Let me read this page and those again and I will come back with the line.");
  // 2. WHAT KIND OF SOURCE, read off the pages actually being cited for this search rather than invented.
  const publishers = [...new Set((ctx.pattern?.publishers ?? []).map((p) => p.trim()).filter((p) => p.length > 0))].slice(0, 3);
  if (publishers.length === 0 || !ctx.pattern) return refuse("I have not read the pages being cited for this search, so I cannot tell you what kind of source would stand up on this one. Let me read them first and I will come back with what to cite.");
  // 4. WHERE IT BELONGS.
  const place = ctx.page.outline[0] ? `the section headed "${ctx.page.outline[0]}"` : "the part of this page that answers the search";
  // 3. THE EXACT LINE, bought through the same firewall, budget and cache as every other draft, and grounded
  // in what belongs on a page: the winners' reading and this page's own words. Never my own figures.
  const drafted = await ctx.draft.section({
    query: ctx.primary,
    pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
    heading: expansion ? claims[0]! : null,
    brief: expansion
      ? `${seen.engine} answered "${seen.promptText}" naming other sites and never this page, and every page it named covers ${claims.join(", ")} while this one does not. Cover that here in one short section, in this page's own terms, and name where each statement comes from.`
      : `${seen.engine} read this page while answering "${seen.promptText}" and cited other sites. Restate what this page already says, in one short section, so every statement in it names the source a reader can check: ${claims.join(" ")}`,
    outline: ctx.page.outline,
    evidenceHints: [...claims, ...(ctx.pattern.commonHeadings ?? []).map((h) => h.heading), ...(ctx.pattern.questionsAnswered ?? [])],
  });
  if (!drafted) return refuse("I could not write the sourced line for this page that passes my own checks, so I am handing you nothing rather than filler.");
  return {
    components: [{
      kind: expansion ? "entity_expansion" : "source_update",
      label: expansion ? "Cover what the cited pages cover" : "Show where this page's claims come from",
      before: null,
      after: `${plain(drafted.heading)}\n\n${nodash(drafted.body).trim()}`,
      evidenceKeys: keys,
      risk: "review",
      where: place,
      // 5. WHY IT IMPROVES THE PAGE.
      objective: expansion
        ? `Cover on this page what the pages ${seen.engine} named are covering, so there is a reason to name this one.`
        : `Put a source a reader can check behind what this page already claims, so ${seen.engine} has something to stand on when it names one.`,
      mechanism: cause === "retrieved_not_cited"
        ? `${seen.engine} read this page while answering "${seen.promptText}" and named other sites instead, so the page was seen and passed over: what it is missing is something a reader can check, not a sharper line.`
        : `${seen.engine} answered "${seen.promptText}" naming other sites and never this page, so the fix is to carry what those answers are built on rather than to reword what is already here.`,
      // ONLY PAGE CLAIMS, never a figure of mine. WHAT I HOLD HERE IS THE KIND OF SOURCE, not the source: I
      // read who is being cited for this search and never a page that backs this exact claim. That is a
      // research requirement, so it says out loud that the operator picks the source, and this component is
      // held for review rather than handed over as ready to paste.
      sourcePack: {
        sourceRequirements: claims.map((c) => `${c} needs a source a reader can check, of the kind the pages being cited for "${ctx.primary}" point at: ${publishers.join(", ")}. You pick the exact page: I hold the kind of source this needs and not the source itself.`),
        factRequirements: claims.map(sentence),
      },
      measurementPlan: `I will read how often "${seen.promptText}" names this page, and clicks for "${ctx.primary}", at 7, 14 and 28 days after you publish it.`,
    }],
    refusal: null,
  };
};

// ── 3. consolidation: two of your own pages on one search ────────────────────

export const produceConsolidation: Producer = async (ctx) => {
  if (ctx.finding.cause !== "cannibalization") return refuse("I did not find two of your own pages competing for that search, so there is nothing here to settle. Ask me what I did find and I will show you.");
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const group = competingPages(ctx.finding);
  if (!group) return refuse("I have not settled which of your own pages come up for that search, so I am not telling you to combine anything. Let me check which of your pages Google is serving for it first.");
  // The ladder carries the competing pages as whole addresses; an operator reads them as paths on their
  // own site, and anything I cannot resolve is named exactly as it was given rather than reshaped.
  const short = (p: string): string => ownPath(p, ctx.page.url) ?? p;
  const named = [...new Set(group.paths.map(short))].slice(0, 4);
  if (named.length < 2) return refuse("I have not settled which of your own pages come up for that search, so I am not telling you to combine anything. Let me check which of your pages Google is serving for it first.");
  // NO DRAFT SPEND: this is a recommendation with evidence behind it, not copy. Writing paragraphs for a
  // change that starts with a decision the operator has to make is money spent before the decision exists.
  const keep = group.stronger && named.includes(short(group.stronger)) ? short(group.stronger) : null;
  const others = named.filter((p) => p !== keep);
  // EVERY SENTENCE OPENS IN BEACON'S OWN VOICE, and that is not only style: the factual firewall reads a
  // capitalized word it cannot find in the evidence as a named thing this copy invented, so an instruction
  // opening "Pick the one you want" was refused as a fabricated claim and this change never reached anyone.
  const after = keep
    ? `${named.length} of your own pages come up for "${ctx.primary}": ${named.join(", ")}. ${keep} holds the stronger position of the two, so keep that one as the single page for this search, move anything worth keeping from ${others.join(" and ")} into it, and send those addresses on to ${keep}.`
    : `${named.length} of your own pages come up for "${ctx.primary}": ${named.join(", ")}. I cannot see which of them holds the stronger position, so I am not choosing for you. You pick the one you want to own this search, then move anything worth keeping from the other into it and send the old address on to the one you kept.`;
  return {
    components: [{
      kind: "consolidation",
      label: "Settle which page owns this search",
      before: null,
      after,
      evidenceKeys: keys,
      // MANDATORY: this kind moves where a page lives, and a lever like that always reaches you as a
      // question rather than as a paste.
      risk: "dangerous",
      where: "across both pages, starting with the one you keep",
      objective: `Put one page of yours in front of "${ctx.primary}" instead of ${count(named.length)}, so the clicks stop splitting.`,
      mechanism: `Google is picking between ${count(named.length)} pages of yours for that search and the clicks divide between them, which is the one thing no wording change on either page can fix.`,
      measurementPlan: `I will read clicks and average position for "${ctx.primary}" across all ${count(named.length)} addresses at 7, 14, 28 and 56 days after you make the change.`,
    }],
    refusal: null,
  };
};

// ── 4. the full rebuild: only when the causes agree ──────────────────────────

type Cause = CauseFinding["cause"];

const STRUCTURAL: ReadonlyMap<Cause, string> = new Map<Cause, string>([
  ["competitor_content_gap", "the pages that beat it carry something it does not"],
  ["incomplete_coverage", "it leaves out sections every winning page covers"],
  ["weak_opening", "its first words never say what the search is about"],
  ["serp_shape_shift", "it is a different kind of page from the ones that win"],
  ["intent_shift", "it is written for a different job from the one people came to do"],
  ["internal_link_weakness", "it leaves the reader with nowhere to go next"],
]);

const ARCHETYPE: Readonly<Record<string, string>> = {
  informational_guide: "a guide that answers the question from end to end",
  list: "a list page that runs through the options",
  definition: "a page that says plainly what the thing is",
  comparison: "a page that puts the options side by side",
  product: "a page about the thing you sell",
  category: "a page that gathers the options in one place",
  tool: "a page built around something a reader can use",
  forum: "a page of real answers from people who have done it",
};

/**
 * NOT registered to one cause: a rebuild is what the causes conclude TOGETHER. Handed the same context plus
 * the causes that fired on this page, it either writes the page or says why one edit is the better buy.
 *
 * IT WRITES THE WHOLE PAGE OR IT WRITES NOTHING. Every heading the winners agree on is drafted through the
 * section drafter, with the page's own new opening in front of them, as plain text to paste. The cost is real,
 * one call per planned heading, so it is bounded at MAX_HEADINGS and rides the same budget as every other
 * draft. When the budget stops it part way, or a section fails its own checks, there is no component: the
 * refusal names what is owed, and the next pass resumes free because the same section is served from cache.
 */
export async function produceFullRewriteRecommendation(ctx: ProducerCtx, causes: readonly Cause[]): Promise<Produced> {
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const structural = [...new Set(causes)].filter((c) => STRUCTURAL.has(c));
  if (structural.length < MIN_STRUCTURAL_CAUSES) return refuse("Only one thing about this page is wrong at the level a rebuild fixes, so rebuilding it is a bigger swing than my evidence pays for. Make that one change first and I will read the page again.");
  const pattern = ctx.pattern;
  const headings = (pattern?.commonHeadings ?? []).map((h) => h.heading.trim()).filter((h) => h.length > 0).slice(0, MAX_HEADINGS);
  const questions = (pattern?.questionsAnswered ?? []).map((q) => q.trim()).filter((q) => q.length > 0).slice(0, MAX_HEADINGS);
  if (!pattern || (headings.length === 0 && questions.length === 0)) return refuse("I have not read the pages that win this subject side by side, so I cannot tell you what this page has to become. Let me read them first and I will write the brief.");
  const shape = ARCHETYPE[pattern.archetype] ?? "a page that answers this search directly, in a shape the pages winning it have not settled so it is yours to pick";
  const covers = headings.length > 0 ? headings : questions;
  const wrongs = structural.map((c) => STRUCTURAL.get(c)!);
  // THE COPY ITSELF, one drafted section per planned heading, grounded in the reading of the pages that win
  // and in what this page already carries. My own figures are not page copy, so they are not handed over here.
  const hints = [...(pattern.commonEntities ?? []).map((e) => e.entity), ...questions,
    ...(ctx.body?.openingSample ? [`The page opens: ${ctx.body.openingSample}`] : []), ...(ctx.body?.cardTexts ?? []).slice(0, 4)];
  const planned = covers.slice(0, MAX_HEADINGS);
  const drafted: string[] = [];
  for (const heading of planned) {
    const section = await ctx.draft.section({
      query: ctx.primary, pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url, heading,
      brief: `This page is being rebuilt as ${shape} for "${ctx.primary}", and every page that wins that search covers ${heading}. Write that section, in this page's own terms, keeping anything it already says that earns its place.`,
      outline: ctx.page.outline, evidenceHints: hints,
    });
    if (section) drafted.push(`${plain(section.heading)}\n\n${nodash(section.body).trim()}`);
  }
  // The page's own new first lines, and only once every section landed: nothing is bought to sit in front
  // of a body with a hole in it.
  const owed = planned.length - drafted.length;
  // READY MEANS WHOLE. Half a page pasted over a working one is a loss, so a rebuild that stopped part way
  // is not shipped dressed as a change. Nothing already written is re-paid: asking for the same section
  // again is served from what I already bought, so picking this up next pass costs the operator nothing.
  if (owed > 0) return refuse(`I could write ${count(drafted.length)} of the ${count(planned.length)} sections this rebuild needs and ${count(owed)} ${owed === 1 ? "is" : "are"} still owed, so I am not handing you half a page. Ask me again and I will pick up where I stopped: the sections I already wrote cost nothing to ask for a second time.`);
  const opening = ctx.draft.openingAnswer
    ? await ctx.draft.openingAnswer({ query: ctx.primary, pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
      currentValue: ctx.body?.openingSample ?? null, outline: ctx.page.outline, evidenceHints: hints })
    : null;
  if (!opening) return refuse(`I wrote all ${count(planned.length)} sections this rebuild needs and could not write the page's own opening lines, so I am not handing you a page with no way in. Ask me again and the opening is the only thing left: the sections I already wrote cost nothing to ask for a second time.`);
  const after = [nodash(opening).trim(), ...drafted].join("\n\n");
  return {
    components: [{
      kind: "full_rewrite",
      label: "Rebuild this page",
      before: null,
      after,
      evidenceKeys: keys,
      risk: "review",
      where: "the whole page, from the first line down",
      objective: `Make this ${shape} for "${ctx.primary}", instead of fixing ${count(structural.length)} separate things on a page built for something else.`,
      mechanism: `${count(structural.length)} things are wrong at once and every one of them is about what this page is rather than how it is worded: ${wrongs.join("; ")}. Changing them one at a time leaves the rest of them standing.`,
      measurementPlan: `I will read clicks, views and average position for "${ctx.primary}" at 7, 14, 28 and 56 days after you publish it, against what this page does today.`,
    }],
    refusal: null,
  };
}
