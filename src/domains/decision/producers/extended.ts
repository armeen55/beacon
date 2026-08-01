/**
 * decision/producers/extended (V1 Closure, launch blocker 9): the causes that could name a problem and
 * never write the fix.
 *
 * Beacon's ladder can conclude that a page strands its readers, that an engine read it and cited somebody
 * else, that an engine never found it at all, or that two of the account's own pages are splitting one
 * search. Until this file existed every one of those reached the operator as a sentence and a shrug. Each
 * producer below turns ONE of them into the exact components an operator can act on, or into one honest
 * refusal that says what is missing and what to do about it.
 *
 * THE RULES THIS FILE OBEYS, because validate-proposal enforces them and a rejected proposal helps nobody:
 *   - every component here is outside the seven legacy kinds, so it carries where, objective, mechanism and
 *     measurementPlan or the whole proposal is refused;
 *   - a component that changes factual content carries a source pack, assembled ONLY from evidence already
 *     supplied: never a fact, a figure or a source this file made up;
 *   - a change that moves a page or hides it is marked dangerous, which routes the proposal to the
 *     operator-confirmation hold on purpose;
 *   - a component always cites the finding's own receipt keys, and a finding with none of them produces
 *     nothing at all.
 *
 * PURE apart from the drafting calls handed in on the context. No store, no clock, no model of its own.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { BundleComponent } from "../contracts";
import type { CauseFinding } from "../diagnosis";
import type { Produced, Producer, ProducerCtx } from "./contract";

/** Two links is the whole budget: a page that strands its reader needs a way through, not a directory. */
const MAX_LINKS = 2;
const MAX_REQUIREMENTS = 4;
const MAX_HEADINGS = 6;
/** A rebuild is the biggest swing there is, so it is earned by causes agreeing, never by one loud one. */
const MIN_STRUCTURAL_CAUSES = 2;

const count = (n: number): string => Math.round(n).toLocaleString("en-US");
/** Model copy comes back sanitized, and this is the last net: no em or en dash ever reaches an operator. */
const plain = (s: string): string => s.replace(/[–—]/g, " ").replace(/\s+/g, " ").trim();
const sentence = (s: string): string => (/[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const refuse = (refusal: string): Produced => ({ components: [], refusal });

/** Nothing on file behind the cause means nothing may be claimed from it: the one refusal every producer shares. */
const NO_EVIDENCE =
  "I cannot show you anything behind this, so I am not writing a change for it. Let me research this page again and I will come back with what I found.";

function evidenceKeysOf(ctx: ProducerCtx): string[] | null {
  const keys = ctx.finding.evidenceKeys.filter((k) => k.trim().length > 0);
  return keys.length > 0 ? keys : null;
}

// ── the structured payload, read by SHAPE ────────────────────────────────────
// The ladder attaches a small structured payload to the causes below so a producer never has to parse an
// operator sentence back into numbers. It is read here by SHAPE rather than by a field name on purpose: a
// finding stored before that payload existed genuinely carries none of it, and the honest answer to that is
// a refusal that says what is missing, never a guess dressed up as a recommendation.

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

/** Anchors that tell a reader nothing, so relinking one on real words is itself the improvement. */
const WEAK_ANCHOR = /^(read more|learn more|click here|here|more|this page|link|details|see more|continue)$/i;

type Target = { path: string; topic: string; score: number; weak: boolean };

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

/** DETERMINISTIC FIRST: the target is chosen from pages this account demonstrably has, scored on the words
 *  the search and the page's own subjects share with them. Same context in, same two targets out. */
function candidateTargets(ctx: ProducerCtx): Target[] {
  const body = ctx.body;
  if (!body) return [];
  const self = ownPath(ctx.page.url, ctx.page.url);
  const want = new Set([...topicTokens(ctx.primary), ...body.entityNames.flatMap((e) => topicTokens(e))]);
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const link of body.internalLinks) {
    const path = ownPath(link.href, ctx.page.url);
    if (!path || path === self || seen.has(path)) continue;
    seen.add(path);
    const tokens = new Set([...topicTokens(path), ...topicTokens(link.anchorText)]);
    const shared = [...tokens].filter((t) => want.has(t));
    if (shared.length === 0) continue;
    const entity = body.entityNames.find((e) => topicTokens(e).some((t) => tokens.has(t))) ?? null;
    out.push({ path, topic: entity ?? ctx.primary, score: shared.length, weak: WEAK_ANCHOR.test(link.anchorText.trim()) });
  }
  return out.sort((a, b) => b.score - a.score || Number(b.weak) - Number(a.weak) || a.path.localeCompare(b.path));
}

function placeFor(ctx: ProducerCtx, target: Target): string {
  const tokens = new Set([...topicTokens(target.topic), ...topicTokens(target.path)]);
  const heading = ctx.page.outline.find((h) => topicTokens(h).some((t) => tokens.has(t)));
  return heading ? `the section headed "${heading}"` : `the part of this page that talks about ${target.topic}`;
}

export const produceInternalLinks: Producer = async (ctx) => {
  if (ctx.finding.cause !== "internal_link_weakness") {
    return refuse("I did not find this page's links to be what loses it the click, so I am not writing links for it. Ask me what I did find and I will show you.");
  }
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const gap = linkGap(ctx.finding);
  if (!gap) {
    return refuse("I have not counted this page's links against the pages that win its subject, so I am not going to invent somewhere to send a reader. Research this page again and I will count both sides.");
  }
  const targets = candidateTargets(ctx);
  if (targets.length === 0) {
    return refuse("I know this page leaves a reader with nowhere to go, and I do not hold another page of yours on this subject to send them to, so I am not inventing one. Tell me the page it should lead to and I will write the sentence.");
  }
  const evidenceHints = ctx.receiptFacts.slice(0, MAX_REQUIREMENTS);
  const components: BundleComponent[] = [];
  for (const target of targets.slice(0, MAX_LINKS)) {
    const drafted = await ctx.draft.internalLink({
      query: ctx.primary, sourcePage: ctx.page.url, targetPage: target.path, topic: target.topic, evidenceHints,
    });
    if (!drafted) continue;
    const anchor = plain(drafted.anchorText);
    const line = plain(drafted.linkSentence);
    if (!anchor || !line) continue;
    components.push({
      kind: "internal_link_add",
      label: `Link to ${target.path}`,
      before: null,
      after: `${sentence(line)} Point the words "${anchor}" at ${target.path}.`,
      evidenceKeys: keys,
      risk: "safe",
      where: placeFor(ctx, target),
      objective: `Send the reader who lands here on to ${target.path} instead of leaving them at the bottom of this page.`,
      mechanism: `The pages that win this subject point readers on to about ${count(gap.medianWinnerLinks)} of their own pages and this one points to ${count(gap.ownedLinks)}, so somebody who lands here has nowhere to go next.`,
      measurementPlan: `I will read clicks and average position for "${ctx.primary}" on this page and on ${target.path} at 7, 14 and 28 days after you add it.`,
    });
  }
  if (components.length === 0) {
    return refuse("I could not write a link sentence for this page that I would stand behind, so I am handing you nothing rather than filler. Ask me again and I will try the next page down.");
  }
  return { components, refusal: null };
};

// ── 2. source expansion: what an engine reads before it decides who to name ───

/** The page's own words, rolled up once, so a subject it already carries is never called missing. */
function ownVocabulary(ctx: ProducerCtx): Set<string> {
  const body = ctx.body;
  const text = [ctx.page.title, ctx.page.h1, ...ctx.page.outline,
    body?.openingSample ?? null, body?.metaDescription ?? null, ...(body?.cardTexts ?? []), ...(body?.entityNames ?? [])]
    .filter((t): t is string => !!t).join(" ");
  return new Set(topicTokens(text));
}

export const produceSourceExpansion: Producer = async (ctx) => {
  const cause = ctx.finding.cause;
  if (cause !== "ai_citation_gap" && cause !== "retrieved_not_cited") {
    return refuse("I did not find AI answers to be what this page loses on, so I am not writing sources for it. Ask me what I did find and I will show you.");
  }
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const seen = enginePrompt(ctx.finding);
  if (!seen) {
    return refuse("I do not hold which engine answered that search or what it was asked, so I cannot tell you what this page has to add. Let me read the AI answers for that search again.");
  }
  const mine = ownVocabulary(ctx);
  const missing = (ctx.pattern?.commonEntities ?? [])
    .map((e) => e.entity.trim()).filter((e) => e.length > 0)
    .filter((e) => { const t = topicTokens(e); return t.length > 0 && !t.some((x) => mine.has(x)); })
    .slice(0, MAX_REQUIREMENTS);
  const facts = ctx.receiptFacts.map((f) => f.trim()).filter((f) => f.length > 0).slice(0, MAX_REQUIREMENTS);
  // Credibility first: an engine that READ this page and named somebody else did not miss it, it judged it,
  // and what it judged is whether the page can be checked. A gap the engine never reached is a coverage
  // question, so that one is answered by naming the subjects every cited page names and this one does not.
  const kind = cause === "retrieved_not_cited" || missing.length === 0 ? "source_update" : "entity_expansion";
  // ONLY what was supplied: the facts I hold and the reading of the pages that win. Nothing else may appear.
  const sourceRequirements = (missing.length > 0 ? missing : (ctx.pattern?.questionsAnswered ?? []).slice(0, MAX_REQUIREMENTS))
    .map((x) => `A source a reader can check for ${sentence(x)}`);
  const factRequirements = facts.slice();
  if (sourceRequirements.length === 0) sourceRequirements.push(...facts.map((f) => `A source a reader can check for ${sentence(f)}`));
  if (sourceRequirements.length === 0 || factRequirements.length === 0) {
    return refuse("I hold nothing checkable to add to this page: no figures of my own and no reading of what the pages being cited all name. Let me read those pages first and I will come back with what to add.");
  }
  const place = ctx.page.outline[0] ? `the section headed "${ctx.page.outline[0]}"` : "the part of this page that answers the search";
  const after = kind === "entity_expansion"
    ? `Cover ${missing.join(", ")} on this page, each one where it belongs, and say where each one comes from.`
    : `Add a line in ${place} that says where each of these comes from, with a link a reader can follow: ${facts.map(sentence).join(" ")}`;
  return {
    components: [{
      kind,
      label: kind === "entity_expansion" ? "Cover what the cited pages cover" : "Show where the facts come from",
      before: null,
      after,
      evidenceKeys: keys,
      risk: "review",
      where: place,
      objective: kind === "entity_expansion"
        ? `Cover on this page what the pages ${seen.engine} named are covering, so there is a reason to name this one.`
        : `Make every figure on this page checkable, so ${seen.engine} has something to stand on when it names a source.`,
      mechanism: cause === "retrieved_not_cited"
        ? `${seen.engine} read this page while answering "${seen.promptText}" and named other sites instead, so the page was seen and passed over: what it is missing is something a reader can check, not a sharper line.`
        : `${seen.engine} answered "${seen.promptText}" naming other sites and never this page, so the fix is to carry what those answers are built on rather than to reword what is already here.`,
      sourcePack: { sourceRequirements, factRequirements },
      measurementPlan: `I will read how often "${seen.promptText}" names this page, and clicks for "${ctx.primary}", at 7, 14 and 28 days after you publish it.`,
    }],
    refusal: null,
  };
};

// ── 3. consolidation: two of your own pages on one search ────────────────────

export const produceConsolidation: Producer = async (ctx) => {
  if (ctx.finding.cause !== "cannibalization") {
    return refuse("I did not find two of your own pages competing for that search, so there is nothing here to settle. Ask me what I did find and I will show you.");
  }
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const group = competingPages(ctx.finding);
  if (!group) {
    return refuse("I have not settled which of your own pages come up for that search, so I am not telling you to combine anything. Let me check which of your pages Google is serving for it first.");
  }
  // The ladder carries the competing pages as whole addresses; an operator reads them as paths on their
  // own site, and anything I cannot resolve is named exactly as it was given rather than reshaped.
  const short = (p: string): string => ownPath(p, ctx.page.url) ?? p;
  const named = [...new Set(group.paths.map(short))].slice(0, 4);
  if (named.length < 2) {
    return refuse("I have not settled which of your own pages come up for that search, so I am not telling you to combine anything. Let me check which of your pages Google is serving for it first.");
  }
  // NO DRAFT SPEND: this is a recommendation with evidence behind it, not copy. Writing paragraphs for a
  // change that starts with a decision the operator has to make is money spent before the decision exists.
  const keep = group.stronger && named.includes(short(group.stronger)) ? short(group.stronger) : null;
  const others = named.filter((p) => p !== keep);
  const after = keep
    ? `${named.length} of your own pages come up for "${ctx.primary}": ${named.join(", ")}. ${keep} holds the stronger position of the two, so keep that one as the single page for this search, move anything worth keeping from ${others.join(" and ")} into it, and send those addresses on to ${keep}.`
    : `${named.length} of your own pages come up for "${ctx.primary}": ${named.join(", ")}. My evidence does not say which of them holds the stronger position, so I am not choosing for you. Pick the one you want to own this search, move anything worth keeping from the other into it, and send the old address on to the one you kept.`;
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

/** The causes that are about what the page IS, not how it is worded. Only these can add up to a rebuild. */
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
 * the causes that fired on this page, it either writes the brief or says why one edit is the better buy.
 */
export async function produceFullRewriteRecommendation(ctx: ProducerCtx, causes: readonly Cause[]): Promise<Produced> {
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const structural = [...new Set(causes)].filter((c) => STRUCTURAL.has(c));
  if (structural.length < MIN_STRUCTURAL_CAUSES) {
    return refuse("Only one thing about this page is wrong at the level a rebuild fixes, so rebuilding it is a bigger swing than my evidence pays for. Make that one change first and I will read the page again.");
  }
  const pattern = ctx.pattern;
  const headings = (pattern?.commonHeadings ?? []).map((h) => h.heading.trim()).filter((h) => h.length > 0).slice(0, MAX_HEADINGS);
  const questions = (pattern?.questionsAnswered ?? []).map((q) => q.trim()).filter((q) => q.length > 0).slice(0, MAX_HEADINGS);
  if (!pattern || (headings.length === 0 && questions.length === 0)) {
    return refuse("I have not read the pages that win this subject side by side, so I cannot tell you what this page has to become. Let me read them first and I will write the brief.");
  }
  const shape = ARCHETYPE[pattern.archetype] ?? "a page that answers this search directly";
  const agreed = pattern.archetype in ARCHETYPE
    ? ""
    : " The pages that win it have not settled on one kind of page, so the shape is yours to pick.";
  const covers = headings.length > 0 ? headings : questions;
  const wrongs = structural.map((c) => STRUCTURAL.get(c)!);
  const after = [
    `This page has to become ${shape} for "${ctx.primary}".${agreed}`,
    `${count(structural.length)} separate things are wrong with it at once: ${wrongs.join("; ")}.`,
    `Build it to cover ${covers.map((c) => `"${c}"`).join(", ")}, in that order, answering the search in the first lines.`,
    "Keep everything already on the page that earns its place, and publish it at the same address.",
  ].join(" ");
  return {
    components: [{
      kind: "full_rewrite",
      label: "Rebuild this page",
      before: null,
      after,
      evidenceKeys: keys,
      risk: "review",
      where: "the whole page, from the first line down",
      objective: `Make this the page that answers "${ctx.primary}" completely, instead of fixing ${count(structural.length)} separate things on a page built for something else.`,
      mechanism: `${count(structural.length)} things are wrong at once and every one of them is about what this page is rather than how it is worded, so changing them one at a time leaves the rest of them standing.`,
      measurementPlan: `I will read clicks, views and average position for "${ctx.primary}" at 7, 14, 28 and 56 days after you publish it, against what this page does today.`,
    }],
    refusal: null,
  };
}
