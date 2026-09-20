/**
 * decision/producers/extended: the causes that could name a problem and never write the fix. A page that
 * strands its readers, an engine that read it and cited somebody else, an engine that never found it, two of the account's own pages splitting one search. Each producer below turns ONE of them into the exact
 * components an operator can act on, or into one honest refusal naming what is missing.
 *
 * THE RULES validate-proposal ENFORCES: every component here is outside the seven legacy kinds, so it carries
 * where, objective, mechanism and measurementPlan; a component changing factual content carries a source pack
 * built only from evidence already supplied; a change that moves or hides a page is dangerous; and every
 * component cites the finding's own receipt keys. PURE apart from the drafting calls handed in on the context.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import { authorizedCorrections, readFactChecks } from "@/domains/evidence/pages/fact-checks";
import { classifyResult } from "@/domains/evidence/serp-shape"; import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import type { ChangeProposal } from "../contracts"; import { COPY_RULES } from "../copy-sanitize"; import { createHash } from "node:crypto"; import { canonicalUrlKey } from "@/domains/evidence/relevance-gate";
import type { CauseFinding } from "../diagnosis"; import { RECEIPT } from "../diagnose";
import { effortMinutesFor } from "./contract"; import type { Produced, Producer, ProducerCtx } from "./contract";
import { produceDifferentiation } from "./differentiate";
/** Two links is the whole budget, and a rebuild is earned by causes agreeing, never by one loud one. */
const MAX_REQUIREMENTS = 4, MIN_STRUCTURAL_CAUSES = 2;
/** A merge that lists more than MAX_MOVED is a rebuild of the page that survives. */
const MAX_MOVED = 6;
/** Pages under one prefix past which they are a SET, and a set's member is never folded into its hub. */
const MIN_SIBLINGS = 5;

const count = (n: number): string => Math.round(n).toLocaleString("en-US");
/** The last net: no em or en dash ever reaches an operator, and the double gap one leaves is collapsed. */
const nodash = (s: string): string => s.replace(/[–—]/g, " ").replace(/[^\S\r\n]{2,}/g, " ");
const plain = (s: string): string => nodash(s).replace(/\s+/g, " ").trim();
const sentence = (s: string): string => (/[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const refuse = (refusal: string): Produced => ({ components: [], refusal });

const NO_EVIDENCE = "Nothing on file stands behind this, so no change is written for it. Research this page again and the finding comes back here.";
/** A SPLIT IS SETTLED BY EVIDENCE OR IT IS NOT SETTLED: neither of these ever hands the decision back. */
const UNSETTLED = "Which of your own pages come up for that search is not settled, so nothing here says combine anything. Checking which pages Google serves for it comes first.";
const UNPROVEN = "Two of your own pages come up for that search, which is a reason to look and not proof that either takes the other's clicks. Which of them earns that search is not readable yet, so nothing here says combine anything: what each earns gets read first.";

function evidenceKeysOf(ctx: ProducerCtx): string[] | null {
  const keys = ctx.finding.evidenceKeys.filter((k) => k.trim().length > 0);
  return keys.length > 0 ? keys : null;
}
// The ladder attaches a small structured payload so a producer never parses an operator sentence back into
// numbers. Read by SHAPE, not by field name: a finding stored before that payload existed carries none of it, and the honest answer is a refusal naming what is missing.

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

const textAt = (b: Bag, k: string): string | null => {
  const v = b[k];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
};


function enginePrompt(f: CauseFinding): { engine: string; promptText: string } | null {
  for (const b of bagsOf(f)) {
    const engine = textAt(b, "engine");
    const promptText = textAt(b, "promptText");
    if (engine && promptText) return { engine, promptText };
  }
  return null;
}
/** THE SPLIT AS THE LADDER READ IT: the pages, what each earns for that exact search, and the survivor its
 *  own comparison PROVED, which is null far more often than not. Read by SHAPE, like every payload here. */
type Split = { paths: string[]; survivor: string | null; comparison: Array<{ url: string; clicks: number | null; position: number | null }> };
function competingPages(f: CauseFinding): Split | null {
  for (const b of bagsOf(f)) {
    if (!Array.isArray(b.competingPaths)) continue;
    const paths = [...new Set((b.competingPaths as unknown[])
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim()))];
    const rows = Array.isArray(b.comparison) ? (b.comparison as Array<Record<string, unknown>>) : [];
    const comparison = rows.map((r) => ({ url: typeof r.url === "string" ? r.url : "",
      clicks: typeof r.clicks === "number" ? r.clicks : null, position: typeof r.position === "number" ? r.position : null }))
      .filter((r) => r.url.length > 0);
    if (paths.length >= 2) return { paths, survivor: textAt(b, "survivor"), comparison };
  }
  return null;
}
// ── 1. internal links: somewhere for the reader to go next ───────────────────

/** A link's destination as a path of this account, or null for anything off the site. */
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
 * A SOURCE RECOMMENDATION EXISTS ONLY WITH ALL FIVE PIECES on file: a claim that belongs ON the page, the kind
 * of source that would back it, the exact line to add, where it belongs and why it improves the page. Any one
 * missing is a refusal naming which. THE CLAIM IS NEVER A MEASUREMENT: "this page received 6,000 views" is a fact ABOUT the page, never a sentence to put ON it.
 */
export const produceSourceExpansion: Producer = async (ctx) => {
  const cause = ctx.finding.cause;
  if (cause !== "ai_citation_gap" && cause !== "retrieved_not_cited") return refuse("AI answers are not what this page loses on, so no sources are written for it. The cause that was found is on the receipt.");
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const seen = enginePrompt(ctx.finding);
  if (!seen) return refuse("Which engine answered that search, and what it was asked, is not on file, so what this page has to add is unknown. The AI answers for that search need reading again.");
  const mine = ownVocabulary(ctx);
  const missing = (ctx.pattern?.commonEntities ?? [])
    .map((e) => e.entity.trim()).filter((e) => e.length > 0)
    .filter((e) => { const t = topicTokens(e); return t.length > 0 && !t.some((x) => mine.has(x)); })
    .slice(0, MAX_REQUIREMENTS);
  // Credibility first: an engine that READ this page and named somebody else judged whether it can be checked, so that one sources what the page already claims; a gap it never reached is a coverage question.
  const expansion = cause === "ai_citation_gap" && missing.length > 0;
  // 1. THE CLAIM, and it has to belong on the page.
  const claims = (expansion ? missing : pageClaims(ctx)).slice(0, MAX_REQUIREMENTS);
  if (claims.length === 0) return refuse("Nothing on file is a claim this page could make that a source would back: no subject the cited pages all name that this one leaves out, and none of this page's own sentences. This page and those need reading again.");
  // 2. WHAT KIND OF SOURCE, read off the pages actually being cited for this search rather than invented.
  const publishers = [...new Set((ctx.pattern?.publishers ?? []).map((p) => p.trim()).filter((p) => p.length > 0))].slice(0, 3);
  if (publishers.length === 0 || !ctx.pattern) return refuse("The pages being cited for this search have not been read, so what kind of source would stand up here is unknown. They need reading first.");
  // Resolve the claim-level sources before buying copy. A source recommendation with an unnamed source is
  // evidence work, not operator work, and must not consume a drafting call or reach Ready as homework.
  const pagePath = (() => { try { return new URL(ctx.page.url.startsWith("http") ? ctx.page.url : `https://${ctx.page.url}`).pathname.replace(/\/+$/, "") || "/"; } catch { return ctx.page.url; } })();
  const verified = authorizedCorrections(await readFactChecks(ctx.tenantId, pagePath).catch(() => []), undefined, ctx.tenantId).filter((f) => f.sources.length > 0);
  const backing = (c: string): string | null => { const tokens = new Set(topicTokens(c)), fact = verified.find((f) => c.toLowerCase().includes(f.subject.toLowerCase()) || topicTokens(f.subject).filter((t) => tokens.has(t)).length >= 2) ?? null, source = fact?.sources[0]; return source ? `${c} stands on a verified source already on file: ${source.url} says "${source.says}". Cite that page.` : null; };
  const sourceRequirements = claims.map(backing);
  if (sourceRequirements.some((line) => line == null)) return refuse(`The page-level claim still owes a verified source before copy is written. The fact pass must resolve ${claims.filter((_, i) => sourceRequirements[i] == null).map(sentence).join("; ")}.`);
  // 4. WHERE IT BELONGS.
  const place = ctx.page.outline[0] ? `the section headed "${ctx.page.outline[0]}"` : "the part of this page that answers the search";
  // 3. THE EXACT LINE, bought through the same firewall, budget and cache as every other draft, and grounded in what belongs on a page: the winners' reading and this page's own words. Never my own figures.
  const drafted = await ctx.draft.section({
    query: ctx.primary,
    pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url,
    heading: expansion ? claims[0]! : null,
    brief: expansion
      ? `${seen.engine} answered "${seen.promptText}" naming other sites and never this page, and every page it named covers ${claims.join(", ")} while this one does not. Cover that here in one short section, in this page's own terms, and name where each statement comes from.`
      : `${seen.engine} read this page while answering "${seen.promptText}" and cited other sites. Restate what this page already says, in one short section, so every statement in it names the source a reader can check: ${claims.join(" ")}`,
    outline: ctx.page.outline,
    evidenceHints: [...claims, ...(ctx.pattern.commonHeadings ?? []).map((h) => h.heading), ...(ctx.pattern.brief?.deltas ?? []).filter((delta) => delta.dimension === "questions" && delta.sources.length > 0).map((delta) => delta.need)],
  });
  if (!drafted) return refuse("No sourced line for this page passed its own checks, so nothing is handed over rather than filler.");
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
      // ONLY PAGE CLAIMS, never a figure of mine. Each requirement either names the verified source on file,
      // by url and what it says, or names the acquisition the fact pass owes. Held for review either way.
      sourcePack: { sourceRequirements: sourceRequirements as string[], factRequirements: claims.map(sentence), resolved: true },
      measurementPlan: `How often "${seen.promptText}" names this page, and clicks for "${ctx.primary}", read at 7, 14 and 28 days after you publish it.`,
    }],
    refusal: null,
  };
};
// ── 3. consolidation: two of your own pages on one search ────────────────────

export const produceConsolidation: Producer = async (ctx) => {
  if (ctx.finding.cause !== "cannibalization") return refuse("Two of your own pages are not competing for that search, so there is nothing here to settle. The cause that was found is on the receipt.");
  const keys = evidenceKeysOf(ctx); if (!keys) return refuse(NO_EVIDENCE);
  const group = competingPages(ctx.finding); if (!group) return refuse(UNSETTLED);
  // The ladder carries the competing pages as whole addresses; an operator reads them as paths on their own site, and anything I cannot resolve is named exactly as it was given rather than reshaped.
  const abs = (u: string): string => (u.startsWith("http") || u.startsWith("/") ? u : `https://${u}`);
  const short = (p: string): string => ownPath(abs(p), abs(ctx.page.url)) ?? p;
  const named = [...new Set(group.paths.map(short))].slice(0, 4);
  if (named.length < 2) return refuse(UNSETTLED);
  // NO SURVIVOR, NO CHANGE. Two pages coming up for one search says they both come up for it, never that the
  // clicks are divided and never which page should live: the comparison decides that, or this stays research.
  const keep = group.survivor ? short(group.survivor) : null;
  const earns = new Map(group.comparison.map((r) => [short(r.url), r]));
  // THE PAGE I AM KEEPING MUST HAVE FIGURES OF ITS OWN; one I hold none for is named as one I cannot measure.
  if (!keep || !named.includes(keep) || (earns.get(keep)?.clicks ?? null) == null) return refuse(UNPROVEN);
  const losers = named.filter((p) => p !== keep);
  // THE WORDS EACH PAGE CARRIES TODAY, read once because BOTH answers need them: a merge may name only what it can read, and telling the pages apart may only rewrite pages whose own copy is whole and on file.
  const bodies = ctx.heldBodies ?? new Map(), bodyFor = (p: string): OwnedPageBody | null => [...bodies.values()].find((b) => short(b.url) === p) ?? null;
  // A MEMBER OF A SET IS NOT A DUPLICATE OF THE SET. Where the page being folded away is one of many built to
  // one shape under one prefix, the two addresses answer two different searches, and the merge would retire
  // one of a series while every sibling stands. Structural, so it reads the same on any site: the count of
  // pages under the same prefix. Those pages get told apart instead, and no address moves.
  // NOTE: a root-level path scores 0 here (no prefix above it), so the merge gate below is what guards those.
  const under = (p: string): number => { const at = p.lastIndexOf("/");
    return at > 0 ? ctx.ownedPages.filter((o) => short(o.url).startsWith(p.slice(0, at + 1))).length : 0; };
  const crowded = losers.find((p) => under(p) >= MIN_SIBLINGS);
  // STRUCTURAL, SO IT IS TYPED: this rules the merge out here for good, not until more evidence lands, and the card that decided on a merge reads that off the field rather than off these words.
  if (crowded) { const why = `${crowded} is one of ${count(under(crowded))} pages of yours built to the same shape under ${crowded.slice(0, crowded.lastIndexOf("/") + 1)}, so folding it into ${keep} would retire one of a set and leave every other one standing.`;
    return await produceDifferentiation(ctx, named, keep, bodyFor, why, short(ctx.page.url)) ?? refuse(`${why} Give ${crowded} and ${keep} titles and opening lines that say which search each one answers, and nothing here moves an address.`); }
  // A merge may name only what it can read: one that cannot say what it preserves is research, not a change.
  const held = named.map((p) => ({ path: p, body: bodyFor(p) })); if (held.some((h) => !h.body)) return refuse(`${held.filter((h) => !h.body).map((h) => h.path).join(" and ")} has not been read closely enough to say what would be lost by folding ${losers.length === 1 ? "it" : "them"} into ${keep}, so nothing here says combine anything yet. ${losers.length === 1 ? "That page needs" : "Those pages need"} reading, and then exactly what moves can be named.`);
  // A SAMPLE PROVES PRESENCE, NEVER ABSENCE. The gate below reads "the survivor already carries every section this page carries" off the headings on file, so a partly captured page whose few captured headings happen to be covered would authorize a permanent redirect on what was never read. Only a whole capture can say nothing is missing.
  const short_read = held.filter((h) => h.body!.completeness !== "complete").map((h) => h.path); if (short_read.length > 0) return refuse(`${short_read.join(" and ")} ${short_read.length === 1 ? "is" : "are"} only partly on file, so what ${short_read.length === 1 ? "it carries" : "they carry"} that ${keep} does not cannot be told from what was never read, and a redirect is permanent. ${short_read.length === 1 ? "That page needs" : "Those pages need"} reading in full first.`);
  // ONE JOB, OR THEY ARE NOT DUPLICATES: two pages built for different jobs are not a merge, and folding them
  // loses the job one of them does. A PROVEN disagreement refuses; a kind I cannot read is not a disagreement,
  // and what stands there is that Google serves both for the one search, which is why this is still a question.
  const kinds = new Set(held.map((h) => classifyResult(h.body!.title ?? h.body!.h1, abs(h.body!.url || h.path))).filter((k) => !!k)); if (kinds.size > 1) return refuse(`Your pages at ${named.join(" and ")} come up for the same search and they are not the same kind of page, so folding one into the other would lose the job it does. They need reading side by side against that search first.`);
  // WHAT MOVES AND WHAT STAYS, named off the words I hold on both sides, so this is work rather than a decision.
  const survivorHas = new Set((bodyFor(keep)?.headings ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean));
  // FURNITURE IS NOT CONTENT. The stored headings are the page's h1 then its h2s, so a merge told an operator to move "Explore More" and the site's own brand line off a page:
  // chrome this site prints everywhere, plus the loser's own title, which is not a section at all. The survivor's headings catch neither, because it does not carry them.
  const furniture = (p: string, h: string): boolean => ctx.templateHeadings?.has(h.toLowerCase().replace(/\s+/g, " ")) === true || h.toLowerCase() === (bodyFor(p)?.h1 ?? "").trim().toLowerCase();
  const moves = [...new Set(losers.flatMap((p) => (bodyFor(p)?.headings ?? []).map((h) => h.trim()).filter((h) => h.length > 0 && !survivorHas.has(h.toLowerCase()) && !furniture(p, h))))].slice(0, MAX_MOVED);
  // A WINNER OF ONE SEARCH IS NOT A HOME FOR A WHOLE PAGE, so A MERGE MAY MOVE NOTHING. Everything above settles
  // who owns one search; a redirect retires every OTHER search the losing page answers, and one query cannot
  // speak for those. Structural test, off both pages' own words: a section the survivor does not already carry
  // is a job it does not do, so absorbing it makes it a different page and dropping it loses whoever came for
  // it. What survives this is a true duplicate, where the redirect costs no subject. 2026-08-14: /persian-names
  // carried boy names and last names, and this card told an operator to fold it into a girl-names page. Typed,
  // so the card that decided on a merge reads the refusal off the field and never off these words.
  if (moves.length > 0) { const why = `${losers.join(" and ")} ${losers.length === 1 ? "carries a section" : "carry sections"} ${keep} does not: ${moves.map((m) => `"${m}"`).join(", ")}. ${keep} wins "${ctx.primary}", and that settles one search, not every search ${losers.join(" and ")} ${losers.length === 1 ? "answers" : "answer"}: folding ${losers.length === 1 ? "it" : "them"} in would either turn ${keep} into a different page or drop those sections and whoever comes looking for them.`;
    return await produceDifferentiation(ctx, named, keep, bodyFor, why, short(ctx.page.url)) ?? refuse(`${why} Give ${named.join(" and ")} titles and opening lines that say which search each one answers, and no address moves.`); }
  const win = earns.get(keep)!;
  const rest = losers.map((p) => { const c = earns.get(p)?.clicks ?? null; return c == null ? `nothing measurable on ${p}` : `${count(c)} on ${p}`; }).join(" and ");
  // A MERGE IS A JOB, NOT A PASTE. The component carries the DECISION and its numbers, which is all an operator
  // would ever copy; every instruction lives in the steps below, so "Copy new section" can never copy an order.
  const after = plain(`${count(named.length)} of your own pages come up for "${ctx.primary}": ${named.join(", ")}. ${keep} earns ${count(win.clicks!)} clicks from that search against ${rest}${win.position == null ? "" : `, at about position ${count(win.position)}`}, so ${keep} is the page to keep. ${keep} already carries every section ${losers.join(" and ")} ${losers.length === 1 ? "carries" : "carry"}, so no subject is dropped by forwarding ${losers.length === 1 ? "it" : "them"}; what is lost is ${losers.join(" and ")} as ${losers.length === 1 ? "an address" : "addresses"}, and every search ${losers.length === 1 ? "it answers" : "they answer"} is answered on ${keep}. The risk is high, because a web address changes.`);
  const steps = [
    `Check ${keep} already says everything ${losers.join(" and ")} ${losers.length === 1 ? "says" : "say"}: nothing on file there is missing from it`,
    `Redirect ${losers.join(" and ")} to ${keep} for good`,
    `Come back here and mark it done, about ${effortMinutesFor("consolidation")} minutes of work in all, and clicks and average position for "${ctx.primary}" get read across all ${count(named.length)} addresses`];
  return {
    operatorSteps: steps,
    components: [{
      kind: "consolidation",
      label: "Settle which page owns this search",
      before: null,
      after,
      evidenceKeys: keys,
      // MANDATORY: this kind moves where a page lives, so it always reaches you as a question, never a paste.
      risk: "dangerous",
      where: `across ${named.join(" and ")}, starting with ${keep}`,
      redirectTo: keep,
      objective: `Put ${keep} in front of "${ctx.primary}" on its own instead of ${count(named.length)} pages of yours, and keep everything the others say.`,
      mechanism: `Google is choosing between ${count(named.length)} pages of yours for that search every time somebody runs it, and ${keep} is the one already earning the clicks, which is the one thing no wording change on either page can settle.`,
      measurementPlan: `Clicks and average position for "${ctx.primary}" across all ${count(named.length)} addresses, read at 7, 14, 28 and 56 days after you make the change.`,
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
/** A rebuild is earned by causes together. Its source-bound pieces and preservation debt live on ONE private proposal until
 * its opening and every planned section are present and the whole replacement qualifies. Interruption stops
 * at the first failure; only missing slots are drafted after restoring the unchanged assignment's bank.
 */
export async function produceFullRewriteRecommendation(ctx: ProducerCtx, causes: readonly Cause[]): Promise<Produced> {
  const keys = evidenceKeysOf(ctx);
  if (!keys) return refuse(NO_EVIDENCE);
  const structural = [...new Set(causes)].filter((c) => STRUCTURAL.has(c));
  if (structural.length < MIN_STRUCTURAL_CAUSES) return refuse("Only one thing about this page is wrong at the level a rebuild fixes, so rebuilding it is a bigger swing than the evidence pays for. Make that one change first and the page gets read again.");
  if (!ctx.body || ctx.body.completeness !== "complete" || ctx.body.version !== "current" || !ctx.body.passages.join(" ").trim()) return { ...refuse("A whole-body replacement needs the complete current original page before any drafting; banked work stays intact."), requirement: { kind: "page_source", query: ctx.primary, url: ctx.page.url, reasonCode: "page_source_owed" } };
  if (!ctx.draft.compose) return refuse("The drafting path cannot retain the exact publication structure and source receipts of a complete replacement, so no rewrite is bought.");
  const pattern = ctx.pattern;
  const headings = [...new Set((pattern?.commonHeadings ?? []).map((h) => h.heading.trim()).filter((h) => h.length > 0))];
  const questions = [...new Set((pattern?.brief?.deltas ?? []).filter((delta) => delta.dimension === "questions" && delta.sources.length > 0).map((delta) => delta.need.trim()).filter((q) => q.length > 0))];
  if (!pattern || (headings.length === 0 && questions.length === 0)) return refuse("The pages that win this subject have not been read side by side, so what this page has to become is unknown. They need reading first, and then the brief gets written.");
  const shape = ARCHETYPE[pattern.archetype] ?? "a page that answers this search directly, in a shape the pages winning it have not settled so it is yours to pick";
  const covers = headings.length > 0 ? headings : questions;
  const wrongs = structural.map((c) => STRUCTURAL.get(c)!);
  const hints = [...(pattern.commonEntities ?? []).map((e) => e.entity), ...questions,
    ...(ctx.body?.openingSample ? [`The page opens: ${ctx.body.openingSample}`] : []), ...(ctx.body?.cardTexts ?? []).slice(0, 4)];
  const planned = covers, before = ctx.body.passages.join("\n\n"), slots = [0, ...planned.map((_, i) => i + 1)];
  const identity = createHash("sha256").update(JSON.stringify([ctx.tenantId, canonicalUrlKey(ctx.page.url), ctx.primary, before, ctx.page, ctx.body.headings, ctx.body.entityNames, ctx.body.internalLinks, ...(ctx.body.sourceCapture ? [["original_main_content", ctx.body.sourceCapture.version, ctx.body.sourceCapture.complete, ctx.body.sourceCapture.mainHtml]] : []), pattern.fingerprint, planned, [...structural].sort(), ctx.draftContext ?? null])).digest("hex");
  const taskFor = (slot: number): NonNullable<ChangeProposal["assignment"]> => {
    const subject = slot === 0 ? ctx.primary : planned[slot - 1]!;
    const deliveryMode = slot === 0 ? "inline" as const : "headed" as const; return { page: ctx.body!.url, basis: identity, standard: "restructuring", gapKind: "full_rewrite_piece", propositions: [subject], intent: [ctx.primary], informationNeed: { question: subject, requiredAtomKeys: [`${identity}::${slot}`], polarity: "supports", voice: "publisher", deliveryMode }, deliveryMode,
      diagnosedGap: `This page is being rebuilt as ${shape}. Complete ${slot === 0 ? "the opening" : `the section about ${subject}`}; ${wrongs.join("; ")}.`,
      treatment: slot === 0 ? "answer_block" : "section", shape: slot === 0 ? "direct_answer" : "section", anchor: ctx.body!.h1 ?? ctx.body!.title,
      mustLeadWith: `the supported answer or distinction about ${subject}, with enough subject and scope to stand on its own`, opening: "Teach the subject directly in the owning publisher's voice.",
      format: slot === 0 ? "An opening answer followed by the explanation and qualifications it needs; no outer heading." : "A natural descriptive or reader-question heading and its complete supporting section copy.",
      pageContext: [], forbidden: [], rivals: [], briefing: [], mayReuse: "Supported original-page material is the substance being reorganized; cite its exact page-* evidence. New claims require their own supplied claim-support evidence.",
      mustPreserve: "Retain supported original material across the completed replacement. Account for corrections, moves and removals against copy and sources; this piece does not authorize deletion of another section.",
      mustNotRepeat: `Do not duplicate another planned section's treatment or narrate the page's arrangement. The complete plan is: opening; ${planned.join("; ")}.`, placement: "additive",
      completionTest: `A reader can understand and use the supported answer about ${subject} from this piece. Its factual claims, qualifications and preservation records remain source-bound; whole-page acceptance is still owed.` };
  };
  const stored = ctx.draftBank, ready = new Map<number, { slot: number; heading: string | null; body: string; assignment: ChangeProposal["assignment"] }>();
  if (stored && (stored.brief.kind !== "full_rewrite" || stored.brief.identity !== identity || JSON.stringify(stored.brief.headings) !== JSON.stringify(planned))) return refuse("The banked rewrite belongs to different page, evidence or assignment inputs; preserve it and reconcile that change before buying more copy.");
  for (const piece of stored?.pieces ?? []) { const slot = piece.slot; if (slot == null || !slots.includes(slot) || ready.has(slot) || COPY_RULES.recordKey(piece.assignment) !== COPY_RULES.recordKey(taskFor(slot)) || slot === 0 && piece.heading != null || slot > 0 && !piece.heading) return refuse("The banked rewrite has an ambiguous or unqualified piece record; reconstruct it without discarding or rebuying the preserved copy."); const restored = await ctx.draft.restore?.(piece); if (!restored) return refuse("The banked rewrite piece cannot be qualified on these inputs; preserve its copy without rebuying it."); ready.set(slot, { slot, heading: restored.heading, body: restored.after, assignment: restored.assignment }); }
  for (const [i, heading] of planned.entries()) {
    const slot = i + 1; if (ready.has(slot)) continue;
    const assignment = taskFor(slot), section = await ctx.draft.section({ query: ctx.primary, pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url, heading,
      brief: assignment.diagnosedGap, assignment, outline: ctx.page.outline, evidenceHints: hints });
    if (!section) break; ready.set(slot, { slot, heading: section.heading, body: section.body, assignment });
  }
  if (ready.size === planned.length && !ready.has(0)) { const assignment = taskFor(0), opening = await ctx.draft.openingAnswer?.({ query: ctx.primary, pageLabel: ctx.page.h1 ?? ctx.page.title ?? ctx.page.url, currentValue: ctx.body.openingSample ?? null, outline: ctx.page.outline, evidenceHints: hints, assignment }); if (opening) ready.set(0, { slot: 0, heading: null, body: opening, assignment }); }
  const ordered = slots.flatMap((slot) => ready.has(slot) ? [ready.get(slot)!] : []), composed = ordered.length ? ctx.draft.compose(ordered) : null, owed = slots.filter((slot) => !ready.has(slot));
  if (!ordered.length) return refuse("No rewrite piece could be completed; drafting stopped at that failure and no publication copy is handed over."); if (!composed?.units || composed.pieces.length !== ordered.length) return refuse("The pieces could not be banked with their exact structure and source receipts; preserve the prior rewrite before buying anything else.");
  const draftBank = { brief: { kind: "full_rewrite", identity, headings: planned, owed }, pieces: composed?.pieces ?? [] };
  const after = composed?.after ?? "", target = { mode: "whole_body" as const, anchorKind: null, anchor: null };
  const written = plain(after).toLowerCase();
  const holds = [...new Set([...ctx.body.passages, ...ctx.body.headings, ...ctx.body.internalLinks.map((link) => `${link.anchorText}: ${link.href}`)]
    .map((h) => h.trim()).filter((h) => h.length > 0 && h !== ctx.body!.h1))];
  const ledger = composed.pieces.flatMap((piece) => piece.preservation ?? []), survives = (h: string): boolean => written.includes(plain(h).toLowerCase()) || ledger.some((record) => record.text === h && record.disposition === "kept");
  const preserves = { keeps: holds.filter(survives),
    losses: holds.filter((h) => !survives(h)).map((what) => ({ what,
      why: ledger.find((record) => record.text === what)?.why ?? "This original material is not yet accounted for in the proposed replacement; no deletion is authorized until its preservation is resolved by the whole-page review." })) };
  return { draftBank, components: [{ kind: "full_rewrite", label: "Rebuild this page", before,
      after, ...(composed?.units ? { units: composed.units } : {}), target, preserves,
      evidenceKeys: [...keys, ...planned.map((heading) => RECEIPT.cover(heading))], risk: "review", where: COPY_RULES.where(target),
      objective: `Make this ${shape} for "${ctx.primary}", instead of fixing ${count(structural.length)} separate things on a page built for something else.`,
      mechanism: `${count(structural.length)} things are wrong at once and every one of them is about what this page is rather than how it is worded: ${wrongs.join("; ")}. Changing them one at a time leaves the rest of them standing.`,
      measurementPlan: `Clicks, views and average position for "${ctx.primary}", read at 7, 14, 28 and 56 days after you publish it, against what this page does today.`,
    }], refusal: null };
}
