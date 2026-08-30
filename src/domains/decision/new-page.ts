import "server-only";
import { dayLabel } from "@/lib/presenter";

/**
 * decision/new-page: the ONE builder of a researched new page, and the only thing on the far side of an EARNED
 * create_new verdict. It writes nothing off a keyword, a tracked question, a competitor's page, an engine's
 * fan-out or a search volume: the ONLY door in is `earnedNewPage(decision)`, which the coverage ladder opens once it has proved this account reaches this subject on no page of its own.
 *
 * ONE bundle through the EXISTING pipeline: a ChangeProposal carrying a ChangeBundle, the same record, validator, ranker, persistence and Changes surfaces an existing-page repair uses.
 *
 * ONE strict brief call, AFTER the verdict. No field in its schema carries a verdict, a shape or an intent, so
 * it can neither decide the page should exist nor change what wins. Every claim is checked back against what
 * was supplied, and the WHOLE draft is refused when the model invents a number, an address, a publisher or a
 * question, turns one tracked question into the page, writes an outline that would fit any topic, skips why the account's own pages lost, or promises to put anything live.
 *
 * THEN THE PAGE ITSELF. A plan is not a page, so the opening and every planned section are written through the
 * ONE canonical editor an existing page's section goes through: same firewall, budget, cache, deterministic
 * contract and per-claim ruling, so each piece arrives having named the evidence id behind every assertion it
 * makes. A proposal reaches the operator only when the title, the description, the opening and EVERY section
 * landed; one section short is no proposal this pass, and the next resumes free off what was already bought.
 */

import { log } from "@/lib/logger";
import { CURRENT_CLAIM } from "@/lib/constants";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { answerIntelFacts } from "@/domains/evidence/answer-intel";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { PageCoverageReading } from "@/domains/evidence/page-intersection";
import { AUTOPUBLISH_RE, CODE_SUFFIX, HOST_RE, SPELLED_PROPORTION_RE } from "./copy-sanitize";
import { earnedNewPage, type CoverageDecision } from "./coverage-adjudication";
import type { DecidedTopic } from "./coverage-pass";
import type { OwnedCandidate } from "./owned-coverage";
import { callStructuredLLM } from "./llm/structured-drafter";
import { draftFieldForPage } from "./drafted-copy";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { copyKey, evidenceShortfall, REVIEW_CONTRACT } from "./proof";
import type { NewPageBrief } from "./llm/schemas";
import type { BundleComponent, BundleEvidenceItem, ChangeBundle, ChangeProposal } from "./contracts";
import { componentIdOf, effortForFamily } from "./contracts";
import { validateProposal } from "./validate-proposal";
import type { ProposeOptions } from "./propose";

/** Internal on purpose: `buildNewPageProposal` is the whole public surface of this file. */
type NewPageOutcome = { status: "built"; proposal: ChangeProposal } | { status: "none"; reason: string };

const num = (n: number): string => n.toLocaleString("en-US");
const day = (iso: string | null): string => dayLabel(iso) ?? "a day nobody recorded";
const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
/** What the pages that win here ARE, in words an operator reads. */
const SHAPE: Record<string, string> = { informational_guide: "a guide that explains the subject", list: "a list", definition: "a short definition",
  comparison: "a comparison", product: "a product page", category: "a category page", tool: "a tool people use", forum: "a discussion thread" };
/** NO SCHEMA IS DERIVED: recommending Article or FAQPage off the draft's own shape is a guess wearing a
 *  standard's name. Structured data returns when the evidence speaks to eligibility. */
/** Any written figure: a count, a money amount, a percentage, a year. */
const FIGURE_RE = /\d[\d,.]*%?/g;
/** The verdict's receipt ids that came from the winning-page pattern, and only those: the rest of its
 *  evidence is already rebuilt above from the investigation itself and would land here twice. */
const PATTERN_KEY = /^(pattern|opening|common\d+|gap\d+|split\d+)$/;

const SYSTEM = [
  "You write ONE page brief for a page that does not exist yet. The decision that this page should exist is already made and is not yours to revisit.",
  "Write in plain business English a page's own reader would understand. First person only where the brief speaks to the site owner.",
  "Rules you may not break.",
  "1. Use ONLY the facts below. Never add a number, a percentage, a date, a web address, a publisher, a search phrase or a claim that is not written there. ONE exception: when the page ranks or lists things, the title and opening may say how many things it covers, and that number must equal the number of sections you write. No other figure, ever.",
  "2. headKeys and every evidenceKeys entry must be one of the short ids listed under EVIDENCE IDS, copied exactly. They look like demand, shape, win1. Never put a heading, a sentence or a page name there. Every address in internalLinks must be copied exactly from OWN PAGES. Every question in faqQuestions must be copied exactly from OBSERVED QUESTIONS.",
  "3. Leave internalLinks or faqQuestions empty when the supplied lists do not honestly support them. An empty list is a correct answer. Every sourceRequirement and every factRequirement is a full sentence, never a short label.",
  "4. Every section heading must be specific to this topic. A heading that would fit any subject is a failure.",
  "5. whyExistingPagesLose must name at least one of the OWN PAGES addresses and say plainly why strengthening it is not the answer.",
  "6. Never promise to put anything live, publish anything, or do anything to the site yourself. The site owner writes and publishes this page.",
  "7. No em dash and no en dash. Never use the words experiment, control, baseline, treatment or SERP.",
  "8. The sections are the PAGE'S OWN sections, written for the person who will read the page. Never write a section about search demand, competing sites, rankings, what was researched, or why this page should exist. The title is what a reader would search, about the TOPIC itself: 'The hardest languages to learn, ranked' is right; '6 things a hardest-language list must show' or any title about the page, its list, its sections or its structure is wrong.",
].join("\n");

/** The evidence this brief may cite, each id with the fact behind it, plus what I do not hold. All observed. */
function receiptOf(inv: TopicInvestigation, owned: readonly OwnedCandidate[], d: CoverageDecision, r: PageCoverageReading | null):
{ items: BundleEvidenceItem[]; missing: string[] } {
  const items: BundleEvidenceItem[] = [];
  const missing: string[] = [];
  // WHICH STORED ANSWERS: one line off one answer keeps the singular id; a line several stand behind carries all.
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null, from?: Pick<BundleEvidenceItem, "observationId" | "observationIds">): void => {
    items.push({ key, kind, fact, observedAt, ...(from?.observationId ? { observationId: from.observationId } : {}), ...(from?.observationIds?.length ? { observationIds: from.observationIds } : {}) }); };

  const dem = inv.demand;
  const demand = [dem.monthlySearchVolume != null ? `about ${num(dem.monthlySearchVolume)} searches a month` : null,
    dem.gscImpressions != null ? `${num(dem.gscImpressions)} views in Google over 90 days` : null,
    dem.difficulty != null ? `the hardest of these searches scores ${num(dem.difficulty)} out of 100 to compete for` : null,
  ].filter((s): s is string => !!s);
  if (demand.length > 0) add("demand", "keyword", `People look for "${inv.label}": ${demand.join(", ")}.`, null);
  if (dem.monthlySearchVolume == null) missing.push(`No monthly search count is on file for "${inv.label}", so the size of this in searches is unknown.`);
  if (dem.difficulty == null) missing.push("No difficulty score is on file for these searches, so how hard they are to compete for is unknown.");

  // ONE CHECK PER SOURCE, NEVER PER ROW. Every results page read on this subject is ONE read of Google, so the
  // reads are counted once and named once: twenty rows of the same look read as twenty separate checks.
  const serps = [...inv.exactSerps].sort((a, b) => (b.observedAt ?? "").localeCompare(a.observedAt ?? ""));
  if (serps.length > 0) add("look", "serp", `Google's results were read for ${num(serps.length)} ${serps.length === 1 ? "search" : "searches"} on this subject, the newest "${serps[0]!.query}" on ${day(serps[0]!.observedAt)}: ${serps[0]!.organicResults} results from ${serps[0]!.distinctDomains} sites.`, serps[0]!.observedAt);
  add("shape", "serp", `What wins for "${inv.label}" is ${SHAPE[inv.pageType] ?? "one settled shape"}, and ${inv.distinctResultDomains} sites come up for it.`, null);
  inv.winners.filter((w) => w.extractState === "current").slice(0, 4).forEach((w, i) => add(`win${i + 1}`, "winning_page",
    `${w.domain} wins here, and its page was read on ${day(w.fetchedAt)}${w.wordCount != null ? `, ${num(w.wordCount)} words` : ""}, ${w.headings} sections.`, w.fetchedAt));
  if (r) {
    const top = r.shared.slice(0, 6).map((s) => `"${s.keyword}"`).join(", ");
    add("shared", "keyword", `The pages that win here were put side by side search by search: ${num(r.shared.length)} searches come up on pages from at least two of ${r.winnerPublishers.length} sites, including ${top}.`, null);
    if (r.largestSearchVolume != null) add("size", "keyword", `The biggest single search in that set gets about ${num(r.largestSearchVolume)} searches a month, and ${r.keywordsWithVolume} of them carry a count at all.`, null);
    else missing.push("None of the searches those winning pages share carries a monthly count.");
  } else missing.push(`The winning pages for "${inv.label}" have not been put side by side search by search, so this rests on what those pages cover rather than on a counted list of the searches they share.`);
  owned.slice(0, 4).forEach((c, i) => {
    add(`owned${i + 1}`, "page_extract", `Your page ${c.url}${c.title ? ` ("${c.title}")` : ""} was checked${c.wordCount != null ? `, ${num(c.wordCount)} words across ${c.outlineLength} sections` : ""}, and it is not the answer to this.`, c.fetchedAt);
    if (!c.bodyHeld) missing.push(`The words of your page ${c.url} are not on file, so it was judged on its address and its title only.`);
  });
  if (owned.length === 0) missing.push("You own no page the evidence connects to this at all, so there was nothing of yours to strengthen instead.");
  add("verdict", "diagnosis", d.explanation, null);
  d.alternativesRuledOut.slice(0, 4).forEach((a, i) => add(`ruledout${i + 1}`, "diagnosis", `${a.alternative}: ${a.reason}`, null));
  // WHAT THE WINNING PAGES SHARE, IN THE VERDICT'S OWN WORDS, copied verbatim rather than rebuilt. It is ONE
  // reading of those pages side by side, so it is ONE check however many sentences that reading produced.
  const shared = (d.evidence ?? []).filter((e) => PATTERN_KEY.test(e.id)).map((e) => e.fact.trim()).filter(Boolean);
  if (shared.length > 0) add("pattern", "winning_page", shared.join(" "), null);
  // WHOSE SEARCH IS WHOSE. A search an ENGINE ran and a question I put to it are two different observations.
  const fans = inv.fanOuts.filter((f) => !!f.query.trim());
  const asked = inv.trackedPrompts.map((p) => p.promptText.trim()).filter(Boolean);
  // THE EXACT ANSWER THIS QUOTES: one line quotes ONE engine's own search and names the stored answer it came
  // out of, with that answer's own date. The fallback below comes from a QUESTION I track, so it carries no
  // observation id rather than borrowing somebody else's. A present-tense example yields to one that is dated.
  const quote = fans.find((f) => !CURRENT_CLAIM.test(f.query)) ?? fans[0];
  if (quote != null) add("asked", "ai_observation", `To answer this, an AI engine went and searched ${num(fans.length)} ${fans.length === 1 ? "thing" : "things"} of its own, like "${quote.query.trim()}".`, quote.observedAt, { observationId: quote.observationId });
  else if (asked.length > 0) add("asked", "ai_observation", `No AI engine has shown a search of its own here. What is on file is a question people ask, like "${asked[0]}".`, null);
  // WHAT THOSE ANSWERS SAID, case scoped and attributed. Claims and caveats stay out: an engine's assertion is grounding for the brief, never a source of mine.
  const said = answerIntelFacts(inv.answerIntel);
  for (const f of said.facts) add(f.key, "ai_observation", f.fact, f.observedAt, f);
  if (inv.trackedPrompts.length === 0) missing.push("No tracked AI engine has been asked about this, so how assistants answer it today is unknown.");
  // A DROPPED SIGNAL IS STILL EVIDENCE I HAD, so the count is owned here and the unsafe wording never appears.
  if (said.withheld) missing.push(said.withheld);
  return { items, missing };
}

/** Build ONE researched new page from an EARNED verdict, or hand back the honest reason nothing was built. `none` is a real answer and costs nothing. */
export async function buildNewPageProposal(decided: DecidedTopic, tenantId: string, opts: ProposeOptions = {}): Promise<NewPageOutcome> {
  const { investigation: inv, candidates: owned, decision, reading } = decided;
  // THE ONLY DOOR. A verdict short of this is an investigation, and an investigation is never a page: no receipt is built, no prompt is assembled and no call is made.
  // A COMPARISON IS EVIDENCE, NOT THE DOOR: the ladder buys it only where a page of this account's own could already be the answer, so requiring the reading here quietly re-closed the door the ladder opened.
  if (!earnedNewPage(decision) || decision.topicKey !== inv.key) {
    return { status: "none", reason: "Nothing here proves you are missing a page, so nothing is being built." };
  }
  // The read-winner floor lives in the coverage ladder, one gate above the only door into this file.
  const now = opts.now ?? new Date();
  const { items, missing } = receiptOf(inv, owned, decision, reading);
  const keys = new Set(items.map((i) => i.key));
  const facts = items.map((i) => i.fact);
  // The exact lists the brief may echo, and nothing else.
  const ownedByKey = new Map(owned.map((c) => [canonicalUrlKey(c.url), c]));
  // A QUESTION AND A SEARCH PHRASE ARE NOT THE SAME THING. Both sets back the matching below (host allowlist, FAQ check, grounding text), but only real questions are shown as questions it may turn into an FAQ.
  const askedQuestions = new Map<string, string>();
  for (const q of [...inv.fanOuts.map((f) => f.query), ...inv.trackedPrompts.map((p) => p.promptText)]) if (q.trim()) askedQuestions.set(norm(q), q.trim());
  const questions = new Map(askedQuestions);
  for (const q of [...(reading?.shared ?? []).map((s) => s.keyword), ...inv.queries]) if (q.trim()) questions.set(norm(q), q.trim());
  // EVERY HOST I ACTUALLY SHOWED IT, the observed questions included: rule 2 orders it to copy them exactly.
  const hosts = new Set([...inv.winners.map((w) => w.domain), ...inv.resultDomains, ...owned.map((c) => publisherHost(c.url)),
    ...[...questions.values(), ...inv.queries].flatMap((q) => q.match(HOST_RE) ?? [])].map(norm).filter(Boolean));
  // WHAT THIS TOPIC IS ABOUT, in the words its own searches AND its own evidence use: the label alone is three
  // tokens, and a heading is generic when it borrows nothing from the case, not merely nothing from its name.
  const subject = new Set([...topicTokens(inv.label), ...inv.queries.flatMap((q) => topicTokens(q)),
    ...facts.flatMap((f) => topicTokens(f)), ...(reading?.shared ?? []).flatMap((s) => topicTokens(s.keyword))]);

  const user = [
    `TOPIC: ${inv.label}`,
    `WHAT PEOPLE SEARCH: ${inv.queries.slice(0, 8).map((q) => `"${q}"`).join(", ")}`,
    `WHAT A SEARCHER WANTS: ${inv.demand.intent ?? "not established"}`,
    `WHAT WINS HERE, AND WHAT THIS PAGE MUST BE: ${SHAPE[inv.pageType] ?? inv.pageType}`,
    `EVIDENCE IDS (headKeys and every evidenceKeys entry must be exactly one of these, and nothing else): ${items.map((i) => i.key).join(", ")}`,
    ...items.map((i) => `  ${i.key}: ${i.fact}`),
    "OWN PAGES (the only addresses you may name)",
    ...(owned.length > 0 ? owned.map((c) => `  ${c.url}`) : ["  none"]),
    "OBSERVED QUESTIONS (the only questions you may turn into an FAQ)",
    ...(askedQuestions.size > 0 ? [...askedQuestions.values()].slice(0, 12).map((q) => `  ${q}`) : ["  none"]),
    "Write the brief for this one page.",
  ].join("\n");

  // ONE PASS, ONE CEILING: a brief and its sections are charged calls like any other, and this whole path used
  // to sit outside the count entirely.
  const spent = (): boolean => !!opts.attempts && (opts.attempts.left -= 1) < 0;
  if (spent()) {
    log.info("[new-page] the pass has spent its whole attempt budget, so no brief was bought", { tenantId, topicKey: inv.key });
    return { status: "none", reason: "This pass has spent its whole attempt budget, so this page was not written for yet." };
  }
  const call = await callStructuredLLM({
    kind: "new_page_brief", tenantId, system: SYSTEM, user, grounded: facts.join(" "),
    projectedCostUsd: 0.03, maxTokens: 2600, complete: opts.complete, now, bypassCache: opts.bypassCache,
  });
  opts.attempts?.record?.(call); // real requests and real dollars, onto this page's own allowance
  if (call.status !== "drafted") {
    log.warn("[new-page] no usable brief", { tenantId, topicKey: inv.key, status: call.status });
    return { status: "none", reason: "This page did not reach a standard worth handing over, so nothing is handed over rather than filler." };
  }
  const v = call.value as NewPageBrief;

  // EVERY FIGURE BACK TO THE EVIDENCE: the final validator never sees whyExistingPagesLose, the section briefs or the requirements, so they would otherwise be ungoverned.
  const fig = (t: string): string[] => (t.match(FIGURE_RE) ?? []).map((f) => f.replace(/[.,]+$/, ""));
  const figures = new Set(fig(facts.join(" ")));
  // THE ONE COUNT A TITLE MAY CARRY IS THE PAGE'S OWN SECTION COUNT. A drafted "the 5 hardest" over 7 sections is repaired to 7 rather than refused; an ungrounded leading count can only ever BE that
  // invented list length, so its echoes in the description and opening are the same claim and move with it.
  const own = String(v.sections.length);
  // Numbered headings ("1. Mandarin") are the list's own order, not figures: the order is the outline's.
  for (const s of v.sections) s.heading = s.heading.replace(/^\s*\d{1,2}[.)]\s*/, "");
  const lead = v.proposedTitle.match(/^(?:the\s+)?(\d{1,2})\b/i) ?? v.proposedTitle.match(/\bthe\s+(\d{1,2})\s/i);
  if (lead && lead[1] !== own && !figures.has(lead[1])) {
    const echo = new RegExp(`\\b${lead[1]}\\b`, "g");
    v.proposedTitle = v.proposedTitle.replace(echo, own);
    v.metaDescription = v.metaDescription.replace(echo, own);
    v.openingAnswer = v.openingAnswer.replace(echo, own);
  }

  // ── every claim back against what was supplied; one failure throws the whole draft ──
  const prose = [v.proposedTitle, v.metaDescription, v.openingAnswer, v.whyExistingPagesLose,
    ...v.sections.flatMap((s) => [s.heading, s.covers]), ...v.sourceRequirements, ...v.factRequirements,
    ...v.internalLinks.map((l) => l.anchor), ...v.faqQuestions].join(" ");
  const strayHost = (prose.match(HOST_RE) ?? []).map(norm).filter((h) => !CODE_SUFFIX.test(h)).find((h) => !hosts.has(h) && !hosts.has(publisherHost(h)));
  // Body prose never carries a bare count; the title, description and opening may carry ONLY the page's own section count, and the final validator holds exactly that line, so they are dropped from this sweep.
  const proseBody = [v.whyExistingPagesLose, ...v.sections.flatMap((s) => [s.heading, s.covers]),
    ...v.sourceRequirements, ...v.factRequirements, ...v.internalLinks.map((l) => l.anchor), ...v.faqQuestions].join(" ");
  const structural = fig([v.proposedTitle, v.metaDescription, v.openingAnswer].join(" ")).find((f) => !figures.has(f) && f !== own);
  const strayFigure = fig(proseBody).find((f) => !figures.has(f)) ?? structural;
  const headings = v.sections.map((s) => norm(s.heading));
  // A ranked list's sections ARE its items ("Mandarin", "Arabic"), which share no token with the label; the
  // outline is generic only when MOST of the page borrows nothing from the case, not when one item is itself.
  const offTopic = v.sections.filter((s) => !topicTokens(`${s.heading} ${s.covers}`).some((t) => subject.has(t))).length * 2 > v.sections.length;
  const badLink = v.internalLinks.find((l) => !ownedByKey.has(canonicalUrlKey(l.url)));
  const badQuestion = v.faqQuestions.find((q) => !questions.has(norm(q)));
  const promptAsPage = questions.has(norm(v.proposedTitle));
  // A LABEL WHERE AN ID BELONGS IS A FORMATTING SLIP, NOT A FABRICATED CLAIM: the ids that ARE mine still stand
  // behind the copy, so a stray one is dropped and the page is refused only where the head or a section would
  // be left citing nothing at all. Binning a researched page over one bad string is how a subject sat unbuilt.
  const cite = (ks: readonly string[]): string[] => ks.filter((k) => keys.has(k));
  // A title about the page itself ("6 things a ... list must show") is meta however clean its figures are.
  const metaTitle = /\b(lists?|pages?|sections?|outlines?|guides?)\b[^,]*\b(must|should|needs?)\b|\bthings? (?:a|an|every|the)\b[^,]*\b(lists?|pages?)\b/i.test(v.proposedTitle);
  const refusal =
    metaTitle ? "wrote a title about the page itself rather than the topic"
      : cite(v.headKeys).length === 0 || v.sections.some((s) => cite(s.evidenceKeys).length === 0) ? "wrote a section it could not point at one piece of the evidence for"
      : strayHost ? "named a website it was never shown"
        : strayFigure ? `quoted ${strayFigure}, which is a figure it was never given`
        : badLink ? "linked to a page of yours it was never given"
          : badQuestion ? "answered a question nobody has actually asked"
            : promptAsPage ? "turned one tracked question into the whole page"
              : offTopic ? "wrote an outline that would fit any subject"
                : new Set(headings).size !== headings.length ? "repeated the same section twice"
                  : owned.length > 0 && !owned.some((c) => v.whyExistingPagesLose.toLowerCase().includes(c.url.toLowerCase()) || (c.path.length > 1 && v.whyExistingPagesLose.toLowerCase().includes(c.path.toLowerCase())))
                    ? "did not say why the pages you already have cannot carry this"
                    : SPELLED_PROPORTION_RE.test(prose) ? "wrote out a proportion nothing measured"
                      : AUTOPUBLISH_RE.test(prose) ? "wrote as though something here goes live by itself"
                      : null;
  if (refusal) {
    log.warn("[new-page] brief disagrees with the evidence", { tenantId, topicKey: inv.key, refusal });
    return { status: "none", reason: `The page drafted for "${inv.label}" ${refusal}, so it was thrown away rather than handed over.` };
  }

  // A LIST OF HEADINGS IS NOT A PAGE, AND A PAGE NOBODY CAN SOURCE IS NOT A PAGE EITHER (2026-08-30). Every planned
  // section is written in the planned order through the ONE canonical editor every other change goes through, so it
  // comes back having declared what it asserts, named the evidence id behind each assertion and been ruled on claim
  // by claim. Coverage adjudication authorized the NEED and the results pages authorize the FORMAT; a competitor's
  // page and an engine's answer are briefing here and may never carry a sentence, so the only ids that can support
  // one are a checked fact and another page this account owns, read below and handed over under those exact ids.
  const qualified = Object.fromEntries(owned.filter((c) => (c.openingSample ?? "").trim().length > 0).slice(0, 4).map((c, i) => [`owned-page-${i + 1}`, `${c.path}: ${c.openingSample}`]));
  const outline = v.sections.map((s) => s.heading);
  const written: string[] = []; const pieces: NonNullable<Awaited<ReturnType<typeof draftFieldForPage>>>[] = [];
  // THE PAGE AS IT STANDS SO FAR IS WHAT THE NEXT PIECE IS JUDGED AGAINST: a page that does not exist yet still has words once its title, its opening and its earlier sections are written, and asking "does this already say it" against them is the same question an existing page's editor answers.
  const soFar = (): OwnedPageBody => ({ url: owned[0]?.url ?? `https://${inv.key}`, title: v.proposedTitle, h1: v.proposedTitle, metaDescription: v.metaDescription,
    headings: [v.proposedTitle, ...outline], passages: [v.openingAnswer, ...written], openingSample: v.openingAnswer, vocabulary: "", cardTexts: [], faqs: [],
    entityNames: [], internalLinks: [], fetchedAt: now.toISOString(), completeness: "complete", contentHash: null, heldNote: "This page does not exist yet; these are the words drafted for it so far." });
  const write = (heading: string, covers: string): Promise<NonNullable<Awaited<ReturnType<typeof draftFieldForPage>>> | null> =>
    draftFieldForPage({ field: "answer_block", body: soFar(), query: inv.label, ownedPaths: owned.map((c) => c.path), minutes: 15, evidenceHints: facts, facts: qualified,
      brief: `Write the section headed "${heading}". ${covers} Write no figure that is not in the evidence you were given, including a list length such as 5 or 10: name the items without counting them.` },
    { tenantId, now, complete: opts.complete, bypassCache: opts.bypassCache, ...(opts.attempts ? { attempts: opts.attempts } : {}) });
  // THE OPENING IS A PIECE OF THIS PAGE LIKE ANY OTHER, and the first thing a reader and an assistant lift: a brief's own sentence is nobody's ruled claim, so it is written and read here rather than shipped on the strength of the plan that asked for it. No opening, no page.
  const first = await write(v.proposedTitle, `Answer "${inv.label}" outright in the first lines a reader sees. The team already drafted this opening: "${v.openingAnswer}". Verify it against the evidence and refine it to fit.`);
  if (first) { v.openingAnswer = first.after; pieces.push(first); }
  for (const s of v.sections) {
    if (!first) break; // ONE BUDGET LINE, NOT TWO: the canonical editor decrements the pass's own allowance before every charged call and refuses on it, so the extra bookkeeping decrement this loop used to make for the second drafter now just burns a call nobody spends. An exhausted budget leaves a partial draft, which the shortfall check below refuses whole.
    const done = await write(s.heading, s.covers);
    if (!done) break;
    written.push(`${(done.heading ?? s.heading).trim()}\n\n${done.after}`.replace(/[–—]/g, " ")); pieces.push(done);
  }
  if (written.length < outline.length) {
    const owed = outline.slice(written.length);
    log.warn("[new-page] partial draft, nothing proposed", { tenantId, topicKey: inv.key, owed: owed.length });
    return { status: "none", reason: `${num(written.length)} of the ${num(outline.length)} sections this page needs are written and ${num(owed.length)} ${owed.length === 1 ? "is" : "are"} still owed: ${owed.join(", ")}. Part of a page is not worth handing over. Ask again and it picks up where it stopped: what is already written costs nothing a second time.` };
  }

  // ── one bundle: the pieces to paste, and everything they rest on ──
  const schemaTypes: string[] = []; // NO SCHEMA IS DERIVED (see above): none, not a guess.
  // THE MODEL'S OWN CITATIONS for the three pieces a reader sees first, validated against the supplied ids like every other key. A generic set assigned afterwards proved nothing.
  const core = cite(v.headKeys);
  const sectionKeys = [...new Set(v.sections.flatMap((s) => cite(s.evidenceKeys)))];
  // A SOURCE I HOLD IS NAMED WHOLE: the page, its publisher, the claim, the day I read it. Holding NONE leaves
  // "this kind of source is needed", so the copy says the operator picks it and the page is held for review.
  const cited = inv.winners.filter((w) => w.extractState === "current" && w.fetchedAt).slice(0, 3)
    .map((w) => `${w.url}, published by ${w.domain}, read on ${day(w.fetchedAt)}: it is one of the pages that win "${inv.label}", and it is a source for what a page on this subject has to cover.`);
  // A CITED WINNER IS A REAL SOURCE for the section it evidences. The model's OWN requirement sentences never are: they carry the caveat either way, and a pack leaning on one holds the page for review.
  const caveat = (s: string): string => `${s} You pick the exact source for this one: what is on file is the kind of source it needs and not the source itself.`;
  const sourcing = [...cited, ...v.sourceRequirements.map(caveat)];
  const unbacked = cited.length === 0 || v.sourceRequirements.length > 0;
  const components: BundleComponent[] = [
    { kind: "title", label: "Page title", before: null, after: v.proposedTitle, evidenceKeys: core, risk: "safe" },
    { kind: "meta", label: "Meta description", before: null, after: v.metaDescription, evidenceKeys: core, risk: "safe" },
    { kind: "opening_answer", label: "Opening answer", before: null, after: v.openingAnswer, evidenceKeys: core, risk: "review" },
    { kind: "section", label: "The page, section by section", before: null, after: written.join("\n\n"), evidenceKeys: sectionKeys, risk: "review" },
  ];
  if (sourcing.length > 0 || v.factRequirements.length > 0) {
    components.push({ kind: "source_pack", label: "What to source and check before this goes out", before: null,
      after: [...sourcing, ...v.factRequirements].map((s) => `- ${s}`).join("\n"), evidenceKeys: core, risk: "review" });
  }
  if (v.internalLinks.length > 0) {
    components.push({ kind: "internal_links", label: "Link to these pages of your own", before: null,
      after: v.internalLinks.map((l) => `${l.anchor} -> ${ownedByKey.get(canonicalUrlKey(l.url))!.path}`).join("\n"),
      evidenceKeys: [...core, ...[...keys].filter((k) => k.startsWith("owned"))], risk: "safe" });
  }
  // WHAT THE PAGE ITSELF ASSERTS AND WHAT CARRIES IT, in the one authorization vocabulary. Every section's claims answer for the ONE piece that carries them, named by `componentIdOf` off that piece's exact words, so a reading taken over this page can never authorize different copy and the serving door asks a new page exactly what it asks a section: is each claim carried by the sources it names, and is any of it checked at all.
  const at = (k: string): number => components.findIndex((c) => c.kind === k);
  const claims: NonNullable<ChangeProposal["claims"]>[number][] = []; const ruled: { i: number; by: string[]; entailed: boolean }[] = []; const banked = new Map<string, string>();
  pieces.forEach((a, n) => { const i = n === 0 ? at("opening_answer") : at("section"); // the opening answers for the opening piece and every section for the section piece, so no piece is authorized by another's reading
    for (const f of a.supportFacts) banked.set(f.id, f.fact);
    a.claims.forEach((x, k) => { const r = a.review.find((z) => z.i === k); if (r) ruled.push({ i: claims.length, by: [...r.by], entailed: r.entailed });
      claims.push({ text: x.text, supportedBy: [...x.supportedBy], of: componentIdOf(components[i]!, i) }); }); });
  const gains = pieces.map((a) => a.gain).filter((g): g is NonNullable<typeof g> => !!g);
  const gain = gains.length === 0 ? null : { adds: gains.map((g) => g.adds).join(" "), by: [...new Set(gains.flatMap((g) => [...g.by]))], pageWhole: gains.every((g) => g.pageWhole) };
  const shared = reading?.shared.length ?? 0;
  const dates = items.map((i) => i.observedAt).filter((d): d is string => !!d).sort();
  const bundle: ChangeBundle = {
    // THREE BRANCHES EARN THIS PAGE. One is "your pages reach some of this, but too little to build on": claiming "none of your own pages comes up for" there put a statement and its flat contradiction on
    // one screen. The third bought no comparison at all, because no page of yours touches the subject.
    objective: !reading
      ? `Give yourself a page for "${inv.label}": you own no page that comes up for it, and the ${num(inv.currentReadableWinners)} winning pages read agree on what one has to cover.`
      : reading.ownedCoveredKeywords === 0
        ? `Give yourself a page for "${inv.label}", which ${num(shared)} searches the winning pages share and none of your own pages comes up for.`
        : `Give yourself a page for "${inv.label}": the winning pages share ${num(shared)} searches, and pages of yours reach only ${num(reading.ownedCoveredKeywords)} of them.`,
    metric: `Clicks from search for "${inv.label}" over the next 28 days.`,
    scope: { queries: inv.queries.slice(0, 8), prompts: inv.trackedPrompts.map((p) => p.promptText) },
    components,
    receipt: { items, missing, freshestObservedAt: dates.at(-1) ?? null },
    alternatives: decision.alternativesRuledOut.map((a) => ({ option: a.alternative, reason: a.reason })),
    risks: [
      "A page that does not exist yet has no history, so give it the full 28 days before you judge it.",
      "Read every line once and add your own sources before it goes out. You write and publish this page; Beacon only drafts it.",
      ...missing.slice(0, 2),
    ],
    confidenceReasons: [decision.explanation, v.whyExistingPagesLose,
      dates.at(-1) ? `The newest evidence behind this was observed on ${day(dates.at(-1)!)}.` : "None of the evidence behind this carries a single observation date."],
    measurementPlan: "Once the page is live, record it on Results with its address, and clicks, views and average position for these searches get read at 7, 14 and 28 days, compared against pages you did not touch.",
  };

  const proposal: ChangeProposal = {
    id: `${tenantId}::${inv.key}::new_page::bundle`,
    tenantId, kind: "new_page", changeFamily: "new_page", publish: "manual",
    pagePath: null, pageUrl: null, pageLabel: v.proposedTitle, primaryQuery: inv.label,
    opportunityType: "Cover a subject you have no page for",
    status: "needs_review",
    recommendedChange: { kind: "new_page", proposedTitle: v.proposedTitle, metaDescription: v.metaDescription,
      openingAnswer: v.openingAnswer, outline, faqQuestions: v.faqQuestions, schemaTypes },
    whyItMatters: `${decision.explanation} You write and publish it yourself; measurement starts once you say it is live.`,
    estimatedEffortMinutes: effortForFamily("new_page"),
    // WHERE THIS HAPPENS AND IN WHAT ORDER: a brief with no first move is a document, and these four are the job.
    operatorSteps: ["Create a new page in your site editor and give it the title above",
      "Paste the opening answer, then each section in the order it is written, under its own heading",
      "Add your own sources to anything the source pack flags before you publish",
      "Publish it, then come back here with its address and mark it done, and measurement starts"],
    riskLevel: "low",
    // A page nobody has read yet is never high confidence, however well the comparison settled it: the writing is still ahead of us.
    confidence: "medium",
    limitations: [...new Set(missing)],
    // THE QUESTIONS TRAVEL WITH THE DRAFT: the last gate grounds every address in the copy against this text.
    evidence: { query: inv.label, hints: [...facts.slice(0, 5), ...[...questions.values()].slice(0, 8)], evidenceRefCount: items.length },
    impactScore: null, upsidePerMonth: null, bundle, createdAt: now.toISOString(),
    ...(claims.length > 0 ? { claims, supportFacts: [...banked].map(([id, fact]) => ({ id, fact })) } : {}), ...(gain ? { informationGain: gain } : {}),
  };
  // THE QUESTIONS ARE EVIDENCE TOO: the facts alone never carried the list the prompt ordered it to copy.
  const verdict = validateProposal(proposal, { evidenceText: [...facts, ...questions.values()].join(" "), now });
  if (verdict.verdict === "rejected") {
    log.warn("[new-page] brief failed the one validator", { tenantId, topicKey: inv.key, reasons: verdict.reasons.slice(0, 3),
      title: v.proposedTitle, sections: v.sections.length,
      where: [proposal.whyItMatters, ...bundle.components.map((c) => `${c.kind}: ${c.after}`), ...bundle.risks]
        .filter((t) => /\b5\b/.test(t)).map((t) => t.slice(0, 220)).slice(0, 3) });
    return { status: "none", reason: `The page drafted for "${inv.label}" did not pass its own safety checks, so nothing is handed over rather than risk it.` };
  }
  // A PAGE RESTING ON "SOME SOURCE OF THIS KIND" IS NEVER READY: the honest place for it is review. AND THE ONE SERVING VERDICT DECIDES THE REST, so a page whose claims nothing checked carries stays internal here carrying the door's own sentence rather than being minted ready for the door to refuse a moment later.
  const row: ChangeProposal = { ...proposal, ...(ruled.length > 0 ? { semanticReview: { of: copyKey(proposal), version: REVIEW_CONTRACT, claims: ruled } } : {}),
    limitations: [...new Set([...proposal.limitations, ...verdict.reasons, ...(!unbacked ? [] : [cited.length > 0
      ? "Some of what this page claims still rests on the kind of source it needs rather than a source on file, so you pick those before it goes out."
      : "No source of Beacon's own stands behind the claims on this page, so you pick every one of them before it goes out."])])] };
  const short = evidenceShortfall(row);
  return { status: "built", proposal: { ...row, status: unbacked || !!short || verdict.verdict !== "ready" ? "needs_review" : "ready",
    ...(short ? { limitations: [...new Set([...row.limitations, short])] } : {}) } };
}
