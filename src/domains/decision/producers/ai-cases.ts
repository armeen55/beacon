import "server-only";
/** decision/producers/ai-cases - THE ONE AEO DECISION PATH. Two sources of case (a tracked question the
 *  operator approved; a search the assistants ran themselves), one ladder, one family. Both stage the AI
 *  position BEFORE a page is chosen, because the stage IS the work: read-and-passed-over needs a liftable
 *  answer, named-never-credited needs a citable passage, never-retrieved needs reachability first, and
 *  unreported sourcing is a reporting gap no edit closes. CLASSIFICATION IS NEVER BOUNDED, only paid drafting
 *  is: every material search terminates somewhere a person can see, and same-page clusters collapse into ONE
 *  card carrying all of them, aggregation with a receipt and never a drop (operator, 2026-08-19). */
import { log } from "@/lib/logger";
import type { ChangeProposal } from "../contracts";
import { dayLabel, engineLabel, engineList } from "@/lib/presenter";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { buildFanoutEvidence, FANOUT_LINKAGE_CAVEAT, instrumentFacts, type FanoutRow } from "@/domains/evidence/ai-visibility/fanout-evidence";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { CanonicalPairObservation } from "@/domains/evidence/funnel/research-evidence";
import type { CanonicalDemandUnit } from "@/domains/evidence/demand-units";
import { readFactChecks } from "@/domains/evidence/pages/fact-checks";
import { VERIFICATION_RULES_VERSION } from "@/domains/evidence/pages/fact-checks";
import { journeyLabel, readAnswerJourneys, standingOf } from "@/domains/evidence/ai-visibility/answer-journeys";
import { sectionFit } from "./page-job";
import { recordAiCaseDispositions, type AiCaseDisposition, type AiCaseState } from "../ai-case-store";
import { asWritten, askable, bestPageFor, count, labelOf, MAX_PER_PRODUCER, noteNeedsOwnPage, pageWords, pathOf, plain,
  STOREFRONT, subjectWords, type Draft, type Fit, type Understanding } from "./page-fit";

/** WHERE A SEARCH ENDS UP AS FAR AS THE EVIDENCE ALONE CAN SAY. The vocabulary is the store's (ai-case-store)
 *  and is not spelled a second time here: two names for one set of states is the same defect this closure
 *  exists to remove. `held` and the landing states below need facts only a producer pass holds. */
type FanoutStage = "owned_retrieved_not_cited" | "rivals_cited_own_not_retrieved" | "own_not_in_reported_sources";

// ── THE ONE CASE STANDING, AND THE ONE WRITER OVER IT ─────────────────────────
/** Every customer-facing word on an AEO card derives from ONE standing object, so a claim can only say what
 *  the standing holds: a reading claim needs a reported retrieval, credit is named in the endpoint's own
 *  vocabulary, and the drafting brief takes its structure from the ANSWER INTENT and the page, never from a
 *  topic strategy written for some other page (Codex, 2026-08-21: phrase-page instructions shipped on
 *  wildlife and rug cards, so no producer carries a content strategy of its own any more). A raw fan-out
 *  query is EVIDENCE: quoted as the search the assistants ran, never pasted as a heading or a question. */
type Intent = "examples" | "definition" | "comparison" | "process" | "history" | "category" | "question";
const INTENT_OF: [Intent, RegExp][] = [
  ["comparison", /\b(vs|versus|difference|better than|compared)\b/i],
  ["process", /\bhow (to|do|does|can)\b|\bsteps?\b|\brecipe\b/i],
  ["history", /\b(history|origins?|ancient|timeline|dynasty|empire|revolution)\b/i],
  ["examples", /\b(examples?|lists?|names?|ideas?|phrases?|words?|sayings?|idioms?|quotes?)\b/i],
  ["definition", /\b(what (is|are)|meanings?|means|definitions?|known for|famous for)\b/i],
  ["category", /\b(buy|shops?|stores?|prices?|costs?|delivery|products?)\b/i],
];
const intentOf = (t: string): Intent => INTENT_OF.find(([, re]) => re.test(t))?.[0] ?? "question";
/** What each intent's finished section is SHAPED like. Structure only: every fact still has to come from the
 *  page's own evidence, and the editor contract refuses anything these words could not license. */
const SHAPE: Record<Intent, string> = {
  examples: "a one-sentence direct answer first, then the strongest items each on its own line with the one fact a reader needs about it",
  definition: "the definition in the first sentence, then the two or three facts on this page that support it",
  comparison: "what each option is and the one difference that decides between them",
  process: "the steps in order, one per line, each something a reader can do",
  history: "the turns in order, earliest first, with their dates",
  category: "what this category offers and how a buyer narrows it, using only what this page carries",
  question: "the direct answer in the first two sentences, then the specifics only this page has",
};
/** A search rendered as a subject a reader would say, for copy that must not paste the machine's phrasing:
 *  the intent-marker words come off and what is left is a noun phrase about the subject itself. */
const MARKERS = /\b(examples?|lists?|ideas?|websites?|sites?|best|top|guides?)\b/gi;
const readableSubject = (q: string): string => plain(q).replace(MARKERS, " ").replace(/\s+/g, " ").trim() || plain(q);
/** The case as one object, and the four card texts as pure derivations of it. */
type Standing = { voice: string; quoted: string; path: string; intent: Intent; stage: FanoutStage | "owned_mentioned_not_cited";
  retrievedNotCited: number; domain: string | null; covers: string; factLine: string | null };
function caseCopy(s: Standing): { headline: string; after: string; steps: string[]; next?: string } {
  const q = s.quoted, credit = s.domain ? `credit ${s.domain} instead` : "credit other sites";
  const open = `Open the site editor on ${s.path}`, close = "Mark it done here and the next answers get checked against it";
  const section = `Add a section on ${s.path} that answers ${q}: ${SHAPE[s.intent]}, under a heading a reader would look for, built only from facts the page and its evidence already establish.`;
  if (s.stage === "owned_retrieved_not_cited") return {
    headline: `Assistants read ${s.path} for ${q} and ${credit}`,
    after: `${section} The assistants already open this page while answering and credit somebody else, so a restatement of what it lists changes nothing: the section has to be a block an assistant can lift whole.`,
    steps: [open, `Add the section answering ${q}`, "Put the answer in the first two sentences, before any background", close],
    next: `The next pass reads what the credited pages answer for ${q} that ${s.path} does not, and the section brief lands only after that comparison is on file. Nothing here invents the missing facts.` };
  if (s.stage === "owned_mentioned_not_cited") return {
    headline: `Assistants name this brand for ${q} and ${credit}; ${s.path} needs a passage worth citing`,
    after: `Write the passage an assistant can credit on ${s.path}: the direct answer to ${q} in the first two sentences, every factual claim backed by a source the page names. ${s.factLine ?? "No verified source fact is on file for this page yet, so the fact is acquired first; a passage never invents its backing."} Assistants already say the name in prose and hand the credit elsewhere, so the missing thing is a passage that earns the citation, not awareness.`,
    steps: [open, `Write the direct answer to ${q} with its source named in the passage`, s.factLine ? "Build on the verified fact already on file" : "Hold publishing until a verified source for the claim is on file", close],
    next: s.factLine ? undefined : `No verified source fact is on file for ${s.path}. The fact pass acquires one for the claim this passage will make, and the wording lands only after the fact is confirmed; a passage with invented backing never ships.` };
  if (s.stage === "rivals_cited_own_not_retrieved") return {
    headline: `AI answers cite ${s.domain ?? "other sites"} for ${q} and none reports reading ${s.path}; make it reachable first`,
    after: `Make ${s.path} the page an assistant reaches for ${q}: align the title and H1 with the subject's own words, link it from the strongest related pages, confirm it is indexed, then put the answer in the first two sentences. No stored answer reports reading this page, so reachability comes before wording.`,
    steps: [open, "Align the title and H1 with the subject's own words", `Link to ${s.path} from the strongest related pages`, close],
    next: "Reachability is checked first: the next pass confirms the page is indexed and linked before any wording is written, because a section on a page no assistant reads changes nothing." };
  return {
    headline: `AI answers rely on other sites for ${q}; ${s.path} is not among the sources they report`,
    after: `${section} These instruments report the sources they relied on and not what they read, so whether this page was read is unknown; what is known is that the credit goes elsewhere, and the work is a passage worth relying on.`,
    steps: [open, `Add the section answering ${q}`, "Put the answer in the first two sentences, before any background", close] };
}
type FanoutCase = { caseKey: string; state: AiCaseState; stage?: FanoutStage; pageUrl?: string; reason: string };

/** PURE, AND IT NEVER CONSULTS THE QUEUE: evidence in, one state out; `landing` is the coverage answer the
 *  producer already computed. RECURRENCE ALONE IS NEVER WORK (Codex, 2026-08-21): days>=3 on one question and
 *  one assistant measures that assistant's habit, so actionable needs a dimension beyond time: a second
 *  tracked question, a second assistant, a page here read-and-passed-over on an instrument that reports
 *  reading, or the caller's corroboration that real Google demand asks the same. And a reading claim is
 *  legal only where reading is reported: otherwise "never read" degrades to "not among the sources relied
 *  on", which prescribes a liftable answer rather than reachability work. */
export function resolveFanoutCase(row: FanoutRow, landing?: { pageUrl: string | null; refused: boolean },
  corroboration?: { googleDemand?: boolean }): FanoutCase {
  const caseKey = `fanout:${row.key}`;
  if (row.ownState === "cited") return { caseKey, state: "already_credited",
    reason: `Credited on ${count(row.ownCitedAnswers, "answer")} of the ${count(row.reportingAnswers, "answer")} that ran this search and reported their sources. Nothing to change here; watch that it holds.` };
  if (row.ownState === "unreported") return { caseKey, state: "unreported",
    reason: "The assistants that ran this search never reported which pages they used, so where this site stood on it is unknown. That is missing reporting, not a zero, and no page edit closes it." };
  if (!row.material) return { caseKey, state: "monitoring", reason: `${row.materialBecause}. Watched, and it becomes work the day it recurs.` };
  const dimension = row.parents.length >= 2 ? `behind ${count(row.parents.length, "tracked question")}`
    : row.engines.length >= 2 ? `across ${count(row.engines.length, "assistant")}`
      : row.retrievedNotCitedAnswers > 0 ? "with a page here read for it and passed over"
        : corroboration?.googleDemand ? "and people ask Google the same thing" : null;
  if (dimension == null) return { caseKey, state: "monitoring",
    reason: `${row.materialBecause}, on one question and one assistant with no consequence here yet. Watched, and it becomes work the day a second question, a second assistant, a read page or Google demand joins it.` };
  const stage: FanoutStage = row.ownState === "retrieved_not_cited" ? "owned_retrieved_not_cited"
    : row.retrievalReportingAnswers > 0 ? "rivals_cited_own_not_retrieved" : "own_not_in_reported_sources";
  if (landing && landing.pageUrl == null) return { caseKey, state: "no_page", stage,
    reason: `${row.materialBecause}, and no page of this account is for it yet, so no edit can win it. It is on the list of pages to build.` };
  return { caseKey, state: "actionable", stage, ...(landing?.pageUrl ? { pageUrl: landing.pageUrl } : {}),
    reason: stage === "owned_retrieved_not_cited"
      ? `${row.materialBecause} ${dimension}, and a page here was read for it and passed over ${count(row.retrievedNotCitedAnswers, "time")}.`
      : stage === "rivals_cited_own_not_retrieved"
        ? `${row.materialBecause} ${dimension}, and no assistant reports reading a page of this account for it.`
        : `${row.materialBecause} ${dimension}, and this site is not among the sources the assistants relied on for it. Whether any page here was read is not something these instruments report.` };
}
/** 1. THE ANSWERS THAT CREDIT SOMEBODY ELSE, staged before a page is ever chosen. WHERE THIS SITE STOOD across the stored answers is the case, and the case decides the work: a page an engine read and passed over needs an answer it can lift; a brand named in prose and never credited needs a passage that earns the citation; a page no engine reports reading needs to be reachable before any wording matters; and a question whose answers never report sources is a reporting gap no page edit can close, so it stays visible and mints nothing. RECURRENCE IS COUNTED IN DISTINCT DAYS AND ASSISTANTS over the stored window through the same projection Visibility renders, never in raw rows, so a card and the screen can never disagree. */
export async function aiCaseCards(bank: { query: string; refusedPages?: string[] }[], snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, u: Understanding, tenantId: string,
  units: readonly CanonicalDemandUnit[], windowObs: readonly CanonicalPairObservation[] | null, now: Date,
  persist: boolean, googleKeys?: ReadonlySet<string> | null): Promise<{ drafts: Draft[]; filed: boolean }> {
  const site = (snapshot.scope.site ?? "").replace(/^www\./, "").toLowerCase();
  if (!site) return { drafts: [], filed: true }; // nothing to conclude is not a filing that failed
  // THE STORED WINDOW, through the one shared projection: distinct days, assistants and the material follow-up searches behind every tracked question. The snapshot alone is the newest answer per question and engine, which cannot count days, and reading row totals as recurrence is the defect this replaced.
  const fanouts = windowObs && windowObs.length > 0 ? buildFanoutEvidence(windowObs, site) : null;
  const windows = new Map<string, { days: Set<string>; engines: Set<string>; reporting: number; rnc: number }>();
  for (const o of windowObs ?? []) {
    const w = windows.get(canonicalQueryKey(o.promptText)) ?? { days: new Set<string>(), engines: new Set<string>(), reporting: 0, rnc: 0 };
    w.days.add(o.reportingDay); w.engines.add(o.engine); w.reporting += o.citations != null ? 1 : 0;
    w.rnc += citesOwnSite(o.retrievedResults, site) && !citesOwnSite(o.citations, site) ? 1 : 0;
    windows.set(canonicalQueryKey(o.promptText), w);
  }
  // THE VERIFIED FACTS ON FILE, so a passage brief names the source it stands on instead of assigning the operator source homework. Only a current-rules, source-read, confirmed check qualifies; anything less is exactly the invented backing this producer exists to refuse.
  const facts = (await readFactChecks(tenantId).catch(() => [])).filter((f) => f.state === "checked" && f.sourceReadAt != null && f.confidence === "confirmed" && f.rulesVersion === VERIFICATION_RULES_VERSION);
  // "NEVER YOU" IS A CLAIM ABOUT EVERY ANSWER, SO IT IS COUNTED OVER EVERY ANSWER. Answers that DID credit this site were dropped on the way in, and the sentence then said "across 47 stored answers and never name this site" using a total built only from the answers that had already failed the test. Every answer that reported its sources is counted here, the ones crediting this site are counted SEPARATELY through the one canonical predicate every reading of this fact uses, and one of those retires the whole claim. An answer that reported nothing rides the row count and never the "never you" denominator.
  type Group = { key: string; prompt: string; promptId: string; answers: number; credited: number; rows: number; mentioned: number; engines: Set<string>; domains: Map<string, { n: number; url: string; title: string; engine: string }> };
  const byPrompt = new Map<string, Group>();
  for (const o of snapshot.research.aiObservations) {
    const key = canonicalQueryKey(o.promptText), g = byPrompt.get(key) ?? { key, prompt: plain(o.promptText), promptId: o.promptId, answers: 0, credited: 0, rows: 0, mentioned: 0, engines: new Set<string>(), domains: new Map() };
    byPrompt.set(key, g); g.rows += 1; g.mentioned += (o.brandMentions ?? []).length > 0 ? 1 : 0;
    const cites = o.citations ?? [];
    if (cites.length === 0) continue;
    g.answers += 1; g.engines.add(o.engine);
    if (citesOwnSite(cites, site)) { g.credited += 1; continue; }
    for (const c of new Map(cites.map((c) => [c.domain, c])).values()) {
      const d = g.domains.get(c.domain) ?? { n: 0, url: c.url.split("?")[0] ?? c.url, title: plain(c.title) || c.domain, engine: o.engine };
      d.n += 1; g.domains.set(c.domain, d);
    }
  }
  // A QUESTION WHOSE ANSWERS NEVER SAY WHAT THEY READ is missing reporting, not missing citations: it mints no absence card, the Visibility surfaces carry it as unreported, and the log names it so silence never reads as zero.
  const unreported = [...byPrompt.values()].filter((g) => g.rows > 0 && g.answers === 0);
  if (unreported.length > 0) log.info("[extra] questions whose stored answers report no sources stay unreported, never zero", { tenantId, count: unreported.length, prompts: unreported.slice(0, 5).map((g) => g.prompt) });
  const out: Draft[] = [];
  // EVERY TRACKED QUESTION FILES A VERDICT TOO (reviewer, 2026-08-20): only fanout: was ever written, so a
  // credited question read as unjudged. One helper, same shape, prompt-keyed.
  const decided: AiCaseDisposition[] = [];
  const notePrompt = (g: { key: string; prompt: string; promptId: string; rows: number; answers: number }, state: AiCaseState, reason: string, over: Partial<AiCaseDisposition> = {}): void => {
    const w = windows.get(g.key);
    decided.push({ caseKey: `prompt:${g.promptId}`, state, query: g.prompt, reason,
      days: w?.days.size ?? 0, engines: w?.engines.size ?? 0, parents: 1, executions: g.rows,
      decidedAt: now.toISOString(), ...over });
  };
  for (const g of [...byPrompt.values()].sort((a, b) => b.answers - a.answers || b.engines.size - a.engines.size || a.prompt.localeCompare(b.prompt))) {
    if (g.answers === 0) {
      if (g.rows > 0) notePrompt(g, "unreported", "The stored answers to this question never report which sources they used, so where this site stands on it is unknown. That is missing reporting, not a zero, and no page edit closes it.");
      continue;
    }
    if (!askable(g.prompt)) {
      notePrompt(g, "no_page", "This question asks for websites or describes a personal situation, so no page of this account is the answer to it as written.");
      continue;
    }
    if (g.credited > 0) {
      notePrompt(g, "already_credited", `Credited on ${count(g.credited, "answer")} of the ${count(g.answers, "answer")} that reported their sources. Nothing to change here; watch that it holds.`);
      continue;
    }
    // THE CANONICAL UNIT GOVERNS THE LANDING PAGE. When this question joined a demand unit, the pages that ALREADY EARN that audience on Google are where its answer belongs, before any word-overlap search. Unit pages still pass the same reading gate; a unit page whose job refuses the question falls through to the word-overlap path.
    const unit = units.find((un) => un.prompts.some((pr) => pr.promptId === g.promptId)) ?? null;
    let fit: Fit | null = null;
    if (unit) {
      const byKey = new Map(pages.map((pg) => [canonicalUrlKey(pg.url), pg]));
      const words = subjectWords(g.prompt, weak);
      for (const addr of unit.pages) {
        const page = byKey.get(canonicalUrlKey(addr));
        if (!page || pathOf(page.url) === "/" || STOREFRONT.test(pathOf(page.url))) continue;
        const read = await u.of(page);
        if (!read.job) { u.hold(page.url, `${read.reason} for "${g.prompt}"`); continue; }
        if (sectionFit(read.job, words, u.corpus, g.prompt) !== "fits") continue;
        const has = pageWords(page, weak);
        fit = { match: { page, hits: words.filter((w) => has.has(w)), missing: words.filter((w) => !has.has(w)) }, verdict: "fits" };
        break;
      }
    }
    fit ??= await bestPageFor(g.prompt, pages, weak, earned, children, u);
    if (fit.verdict === "needs_own_page") {
      noteNeedsOwnPage(tenantId, g.prompt, bank, fit.refused);
      notePrompt(g, "no_page", "No page of this account is for this question yet, so no edit can win it. It is on the list of pages to build.");
    }
    if (fit.verdict === "held") {
      u.hold(fit.match!.page.url, `${fit.reason} for "${g.prompt}"`);
      notePrompt(g, "held", "The page this question would land on has not been read yet, so the next work is that reading rather than a change.", { pageUrl: fit.match!.page.url });
      continue;
    }
    const match = fit.match;
    const top = [...g.domains.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
    if (!match || !top) continue;
    const [domain, cite] = top, path = pathOf(match.page.url);
    // THE ANSWERS THEMSELVES, and this account's standing across them. The snapshot window is the NEWEST row per question and engine, which cannot tell "never seen" from "seen and passed over": read off it alone this card said none of three answers credited the site while the record held fifty-four, two citing it and ten retrieving it (operator, 2026-08-17).
    const journeys = out.length < 3 ? await readAnswerJourneys(tenantId, g.promptId, domain, 40, site) : [];
    const stand = standingOf(journeys);
    const passages = journeys.filter((j) => j.citedPassage != null).slice(0, 2).map((j) => `The ${journeyLabel(j)} answer drew on ${domain}: "${j.citedPassage}"`);
    const linkOnly = journeys.length > 0 && passages.length === 0 ? [`The stored answers cite ${domain} in their source list without quoting it in prose, so the opening to win is being the page an engine can lift a direct answer from.`] : [];
    // THE STAGE, DECIDED BEFORE THE WORK IS NAMED: each stage is a different job, and pretending they all
    // needed "a section" was the defect. A reading claim is legal only where reading is reported (Codex,
    // 2026-08-21): with no retrieval-reporting instrument behind this question's stored answers, "never
    // read" degrades to "not among the sources".
    const w = windows.get(g.key) ?? null;
    const passedOver = stand.retrievedNotCitedEngines.length > 0 || (w?.rnc ?? 0) > 0;
    const mentioned = !passedOver && g.mentioned > 0;
    const retrievalCapable = (windowObs ?? []).some((o) => o.promptId === g.promptId
      && (o.retrievedResults != null || instrumentFacts(o.engine, o.observationMode).retrievalReporting));
    const stage = passedOver ? ("owned_retrieved_not_cited" as const) : mentioned ? ("owned_mentioned_not_cited" as const)
      : retrievalCapable ? ("rivals_cited_own_not_retrieved" as const) : ("own_not_in_reported_sources" as const);
    const unreach = stage === "rivals_cited_own_not_retrieved";
    const standLine = stand.answers > 0 ? `Across ${count(stand.answers, "stored answer")} on file (${engineList(stand.engines)}), this site is cited on ${stand.cited}${stand.lastCitedAt ? `, last on ${dayLabel(stand.lastCitedAt)}` : ""} and retrieved on ${stand.retrieved}.` : "";
    const recurLine = w ? `Over the stored window this question ran on ${count(w.days.size, "day")} across ${count(w.engines.size, "assistant")}, and ${count(w.reporting, "answer")} reported sources.` : "";
    // THE ASSISTANTS' OWN FOLLOW-UP SEARCHES behind this question, recurring ones only, off the same projection Visibility renders: the cluster travels with the card into shipment scope, so Results can remeasure it.
    const cluster = (fanouts?.rows ?? []).filter((f) => f.material && f.parents.some((pr) => pr.promptId === g.promptId)).slice(0, 5);
    const clusterLine = cluster.length > 0 ? `While answering it, assistants ran their own searches on repeat: ${cluster.map((f) => `"${f.query}" (${count(f.days, "day")}, ${count(f.engines.length, "assistant")})`).join("; ")}.` : "";
    const fact = mentioned ? facts.find((f) => f.page.toLowerCase() === path.toLowerCase()) ?? null : null;
    const engines = engineList([...g.engines].sort()), covers = asWritten(g.prompt, match.hits).join(", "), inst = [...g.domains.keys()].filter((d) => /\.(edu|gov)$|\.ac\.[a-z]{2}$/.test(d));
    // ONE WRITER, OFF THE STANDING: the words on the card can only claim what the standing carries.
    const copy = caseCopy({ voice: g.prompt, quoted: `"${g.prompt}"`, path, intent: intentOf(g.prompt), stage,
      retrievedNotCited: w?.rnc ?? 0, domain,
      covers, factLine: fact ? `A verified fact is already on file for this page (${fact.subject}, checked against ${fact.sources[0]?.url ?? "its source"}), so the passage stands on it.` : null });
    const tr = treatmentFor({ unreachable: unreach, passedOver, coversAsked: match.hits.length > 0 });
    out.push({
      page: match.page, slug: "ai_answer_gap", field: "section", query: g.prompt, asked: g.prompt, treatment: tr.treatment,
      ...(tr.draftable ? {} : { next: tr.work }),
      headline: copy.headline, before: null, after: tr.draftable ? `${copy.after} ${tr.work}` : copy.after,
      why: `AI answers for "${g.prompt}" credit ${domain} on ${count(cite.n, "answer")}, and the newest answer from each of ${engines} credits other sites. The page they credit is ${cite.url}. ${standLine} ${recurLine} ${labelOf(match.page)} at ${path} already covers ${covers}, so ${passedOver ? "the page is already being read and passed over: the work is making the answer liftable, not making it exist" : mentioned ? "the name is already in the answers: the work is a passage that converts the mention into a citation" : unreach ? "the work starts with making this page reachable, because no stored answer reports reading it" : "the work is a passage worth relying on, because these instruments report what they relied on rather than what they read"}.`,
      steps: copy.steps,
      hints: [`${engineLabel(cite.engine)} cited ${cite.url} ("${cite.title}") when answering "${g.prompt}"`,
        ...passages, ...linkOnly, ...(standLine ? [standLine] : []), ...(recurLine ? [recurLine] : []), ...(clusterLine ? [clusterLine] : []),
        ...(passedOver ? [`${stand.retrievedNotCitedEngines.length > 0 ? engineList(stand.retrievedNotCitedEngines) : "The stored window"} shows this page retrieved while answering and credited on none of those answers, so the page is reachable and not liftable`] : []),
        ...(mentioned ? [`Assistants say the name in prose on ${count(g.mentioned, "stored answer")} without crediting any page of this site`] : []),
        ...(fact ? [`Verified fact on file for this page: ${fact.subject}, checked against ${fact.sources[0]?.url ?? "its source"}`] : []),
        `The newest answer from each of ${engines} credited other sites and none credited this one`,
        `Cited domains on this question: ${[...g.domains.keys()].slice(0, 5).join(", ")}`],
      // THE AI SIDE RIDES IN ITS OWN UNITS: the reporting answers behind the claim, recurrence in distinct days and assistants off the stored window, how often the site was read and passed over, the rivals credited instead, the stage by name, and the landing page's own Google audience as the weight. The ranker reads these beside clicks; nothing here pretends to be a click, and a raw row total is never an audience.
      aiImpact: { answers: g.answers, mentionRate: g.rows > 0 ? g.mentioned / g.rows : 0, citedRivals: g.domains.size, audienceWeight: match.page.search?.impressions90d ?? null, prompts: 1, stage,
        ...(w ? { days: w.days.size, engines: w.engines.size, reportedAnswers: w.reporting, retrievedNotCited: w.rnc } : {}) },
      // THE CANONICAL CASE IDENTITY rides the scope, so every surface joins this Change to the search it was
      // aimed at on an identity and never on wording that merely resembles it, and the OBSERVATIONS it was
      // minted from ride with it, so a question later retired or reworded cannot strand its own measurement.
      aiScope: { caseKey: `prompt:${g.promptId}`, promptIds: [g.promptId], engines: [...g.engines].sort(),
        models: [...new Set((windowObs ?? []).filter((o) => o.promptId === g.promptId).map((o) => o.modelServed).filter((m) => typeof m === "string" && m.length > 0) as string[])],
        modes: [...new Set((windowObs ?? []).filter((o) => o.promptId === g.promptId).map((o) => o.observationMode).filter((m) => typeof m === "string" && m.length > 0) as string[])],
        fanouts: cluster.flatMap((f) => f.variants.map((v) => v.text)),
        observationIds: (windowObs ?? []).filter((o) => o.promptId === g.promptId).map((o) => o.observationId).slice(0, 40), stage },
      // THE CAUSE CARRIES ITS OWN RECEIPT, WEIGHED ALTERNATIVES AND KNOWN BLIND SPOTS (operator, 2026-08-17: empty arrays do not constitute causal evidence); every entry is computed from what this producer holds.
      cause: { cause: passedOver ? "retrieved_not_cited" : "ai_citation_gap", action: "section",
        evidenceKeys: ["ai-citations", `answers:${g.promptId}`, `cited:${cite.url}`, "copy-current", ...(passedOver ? ["retrieval:own-page"] : []), ...(mentioned ? ["brand-mentions"] : [])],
        explanation: passedOver ? `The stored record shows ${path} retrieved while answering "${g.prompt}" and credited nowhere (${domain} credited on ${count(cite.n, "answer")} instead). ${standLine} ${recurLine} The page is reachable and is being read: what it does not carry is an answer an engine can lift whole, and that is the cause by name.`
          : mentioned ? `Assistants name this brand in prose on ${count(g.mentioned, "stored answer")} while answering "${g.prompt}" and credit ${domain} instead (${count(cite.n, "answer")}). ${standLine} ${recurLine} A mention with no citable passage earns no credit, and no stored answer reports retrieving ${path}: the passage an engine could credit does not exist there yet.`
            : unreach ? `The newest stored answer from each of ${engines} on "${g.prompt}" credits other sites (${domain} on ${count(cite.n, "answer")}) and none credits this one, and no stored answer reports retrieving this page, while ${path} already covers ${covers}: before wording matters, the page has to be one the assistants reach at all.`
              : `The newest stored answer from each of ${engines} on "${g.prompt}" relies on other sites (${domain} on ${count(cite.n, "answer")}) and never this one, while ${path} already covers ${covers}. These instruments report the sources they relied on and not what they read, so absence from the reading is not shown; absence from the credit is.`,
        competingExplanations: [...(inst.length > 0 ? [{ cause: "competitor_content_gap" as const, reason: `the cited rivals include institutional sources (${inst.join(", ")}), so assistants may be preferring that authority, and a better section narrows the gap without guaranteeing the citation flips` }] : []),
          ...(passedOver ? [{ cause: "ai_citation_gap" as const, reason: "absence was ruled out by the retrieval record itself: the engine reports fetching this page, so the answer it wants is missing from the page rather than the page missing from the index" }]
            : unreach ? [{ cause: "technical_indexability" as const, reason: "no stored answer reports retrieving this page, so an access problem is not ruled out until a fetch is on file" }]
              : [{ cause: "technical_indexability" as const, reason: "these instruments do not report retrieval, so an access problem is neither shown nor ruled out by anything on file" }]),
          ...(stand.cited > 0 ? [{ cause: "no_problem" as const, reason: `this site HAS been cited on ${count(stand.cited, "stored answer")}${stand.lastCitedAt ? `, last on ${stand.lastCitedAt.slice(0, 10)}` : ""}, so the citation is winnable and this is a slipped position rather than an absent one`, fired: true }] : [])],
        notConsidered: [{ cause: "intent_shift" as const, missing: "no results page for this question is on file, so whether searchers now want a different shape of answer is not decided here" }],
        falsifier: passedOver ? "If a newly stored answer credits this site without the section shipping, the page was already liftable and this card retires itself."
          : mentioned ? "If a newly stored answer credits this site before the passage ships, the mention was already converting and this card retires itself."
            : "If newly stored answers to this question credit this site before the page is relinked, the gap was already closing and this card retires itself." },
      // WHAT THE NEXT PASS OWES, per stage, off the same writer: never a content plan this producer invented.
      ...(copy.next ? { next: copy.next } : {}),
      minutes: 30, confidence: g.answers >= 3 && (w == null || w.days.size >= 3) ? "medium" : "low", refs: g.answers,
      limitation: "This is read off the answers already stored for this question, not off a fresh answer bought today, and no rewrite guarantees a citation.",
    });
    notePrompt(g, "actionable", `Rivals are credited on this question and this site is not. A change is open for it on ${path}.`,
      { pageUrl: match.page.url, stage, proposalId: `${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap` });
    if (out.length >= MAX_PER_PRODUCER) break;
  }

  // ── SECOND SOURCE: THE SEARCHES THE ASSISTANTS RAN THEMSELVES. Classification is deliberately unbounded
  // (bounding it abandons the fourth strongest search in silence); only paid drafting is bounded, where the
  // money is spent. A cluster whose page already carries a card MERGES into it (operator, 2026-08-19).
  const trackedKeys = new Set((windowObs ?? []).map((o) => canonicalQueryKey(o.promptText)).filter(Boolean));
  const claimed = new Set(out.map((d) => canonicalQueryKey(d.query)));
  const byPage = new Map(out.map((d, i) => [pathOf(d.page.url), i]));
  const byKey = new Map(pages.map((pg) => [canonicalUrlKey(pg.url), pg]));
  const states: Record<string, number> = {};
  // WHAT THIS PASS CONCLUDED ABOUT EVERY SEARCH joins the same `decided` list the tracked questions filed
  // into: one write, both identities. Only this pass holds the landing evidence; re-deriving from evidence
  // alone, a screen put an action button under a search Decision had already refused for want of a page.
  const noteCase = (row: FanoutRow, state: AiCaseState, reason: string, over: Partial<AiCaseDisposition> = {}): void => {
    decided.push({ caseKey: `fanout:${row.key}`, state, query: row.query, reason, days: row.days,
      engines: row.engines.length, parents: row.parents.length, executions: row.executions,
      decidedAt: now.toISOString(), ...over });
  };
  for (const row of fanouts?.rows ?? []) {
    // GOOGLE CORROBORATION is the fourth road to actionable; unknown adds nothing and denies nothing.
    const evidence = resolveFanoutCase(row, undefined, { googleDemand: googleKeys?.has(row.key) ?? false });
    if (evidence.state !== "actionable" || trackedKeys.has(row.key) || claimed.has(row.key)) {
      const why = trackedKeys.has(row.key) ? "tracked_question" : claimed.has(row.key) ? "answered_by_a_card_this_pass" : evidence.state;
      states[why] = (states[why] ?? 0) + 1;
      // DECLINING TO OPEN A CASE IS A DECISION AND IT FILES: `covered`, with the covering thing named.
      if (why === "tracked_question") noteCase(row, "covered", `${row.materialBecause}. A question this account already tracks asks this search, so its standing is judged there rather than as a case of its own.`);
      else if (why === "answered_by_a_card_this_pass") noteCase(row, "covered", `${row.materialBecause}. A change opened this pass already targets this search, so it is covered there rather than as a case of its own.`);
      else noteCase(row, evidence.state, evidence.reason, evidence.stage ? { stage: evidence.stage } : {});
      continue;
    }
    // THE SUBJECT IS THE JOB, NEVER THE SEARCH TRACE: the words a page is judged against are the search when
    // a person could have typed it, and the parent question when they could not.
    const parent = [...row.parents].sort((a, b) => b.executions - a.executions)[0] ?? null;
    const subject = askable(row.query) ? row.query : parent ? plain(parent.promptText) : "";
    if (!subject) {
      states.unaskable = (states.unaskable ?? 0) + 1;
      noteCase(row, "no_page", `${row.materialBecause}, and it is a machine's own phrasing rather than a question a reader would type, so no page is written for it as it stands.`);
      continue;
    }
    // WHERE IT LANDS: the engine-reported page first (evidence), then the audience unit, then the words.
    let fit: Fit | null = null;
    for (const own of row.ownPages) {
      const page = byKey.get(canonicalUrlKey(own.url));
      if (!page || pathOf(page.url) === "/" || STOREFRONT.test(pathOf(page.url))) continue;
      const read = await u.of(page);
      if (!read.job) { u.hold(page.url, `${read.reason} for "${subject}"`); continue; }
      const words = subjectWords(subject, weak);
      if (sectionFit(read.job, words, u.corpus, subject) !== "fits") continue;
      const has = pageWords(page, weak);
      fit = { match: { page, hits: words.filter((w) => has.has(w)), missing: words.filter((w) => !has.has(w)) }, verdict: "fits" };
      break;
    }
    fit ??= await bestPageFor(subject, pages, weak, earned, children, u);
    if (fit.verdict === "held") {
      u.hold(fit.match!.page.url, `${fit.reason} for "${subject}"`); states.held = (states.held ?? 0) + 1;
      noteCase(row, "held", `${row.materialBecause}, and the page it would land on has not been read yet, so the next work is that reading rather than a change.`,
        { pageUrl: fit.match!.page.url, ...(evidence.stage ? { stage: evidence.stage } : {}) });
      continue;
    }
    if (fit.verdict !== "fits" || !fit.match) {
      // NO PAGE OF THIS ACCOUNT IS FOR IT: banked as coverage debt, which is a visible verdict and not a drop.
      noteNeedsOwnPage(tenantId, subject, bank, fit.refused);
      states.no_page = (states.no_page ?? 0) + 1;
      noteCase(row, "no_page", `${row.materialBecause}, and no page of this account is for it yet, so no edit can win it. It is on the list of pages to build.`,
        evidence.stage ? { stage: evidence.stage } : {});
      continue;
    }
    const variants = row.variants.map((v) => v.text);
    const held = byPage.get(pathOf(fit.match.page.url));
    if (held !== undefined) {
      // ONE PAGE, ONE CARD, AND THE SECOND CLUSTER IS NOT LOST: it joins the scope of the card already on that
      // page, so Results remeasures every search the change was actually aimed at.
      const d = out[held]!;
      d.aiScope = { ...d.aiScope!, fanouts: [...new Set([...(d.aiScope?.fanouts ?? []), ...variants])],
        promptIds: [...new Set([...(d.aiScope?.promptIds ?? []), ...row.parents.map((pr) => pr.promptId)])],
        observationIds: [...new Set([...(d.aiScope?.observationIds ?? []), ...row.observationIds])].slice(0, 60) };
      d.hints = [...d.hints, `The assistants also ran "${row.query}" while answering this: ${row.materialBecause}`];
      states.merged = (states.merged ?? 0) + 1;
      noteCase(row, "actionable", `${row.materialBecause}. It is answered by the change already open on ${pathOf(d.page.url)}, which now targets this search too.`,
        { pageUrl: d.page.url, ...(evidence.stage ? { stage: evidence.stage } : {}) });
      continue;
    }
    const path = pathOf(fit.match.page.url), stage = evidence.stage!;
    const readOver = stage === "owned_retrieved_not_cited";
    const unreachF = stage === "rivals_cited_own_not_retrieved";
    const rival = row.rivalPages[0] ?? null;
    // THE READER-FACING SUBJECT: the parent tracked question when one exists, else the search rendered as a
    // subject. The raw fan-out stays quoted below as the search the assistants RAN; it is never the thing the
    // copy is told to answer, because a retrieval trace is not a sentence a person publishes.
    const voice = parent && askable(plain(parent.promptText)) ? plain(parent.promptText) : readableSubject(subject);
    const copyF = caseCopy({ voice, quoted: parent && askable(plain(parent.promptText)) ? `"${voice}"` : `searches for ${voice}`,
      path, intent: intentOf(subject), stage, retrievedNotCited: row.retrievedNotCitedAnswers,
      domain: rival ? rival.url.replace(/^https?:\/\//, "").split("/")[0] ?? null : null,
      covers: asWritten(subject, fit.match.hits).join(", "), factLine: null });
    const trF = treatmentFor({ unreachable: unreachF, passedOver: readOver, coversAsked: fit.match.hits.length > 0 });
    out.push({
      page: fit.match.page, slug: "ai_answer_gap", field: "section", query: subject, asked: subject, treatment: trF.treatment,
      ...(trF.draftable ? {} : { next: trF.work }),
      headline: readOver
        ? `Assistants search "${row.query}" and read ${path} without crediting it`
        : unreachF
          ? `Assistants search "${row.query}" and none reports reading ${path}; make it the page they reach`
          : `Assistants search "${row.query}" and rely on other sites; ${path} is not among the sources they report`,
      before: null,
      after: trF.draftable ? `${copyF.after} ${trF.work}` : copyF.after,
      why: `${count(row.executions, "stored answer")} ran the search "${row.query}" while answering ${count(row.parents.length, "tracked question")}: it ${row.materialBecause}. ${rival ? `${rival.url} is credited on ${count(rival.answers, "of those answers")}.` : "No page is credited on it often enough to name a leader."} ${labelOf(fit.match.page)} at ${path} already covers ${asWritten(subject, fit.match.hits).join(", ")}, so ${readOver ? "the page is reachable and being read: the work is making the answer liftable" : unreachF ? "the work starts with being reachable for it at all" : "the work is a passage worth relying on, because whether the page was read is not something these instruments report"}.`,
      steps: copyF.steps,
      hints: [`Assistants ran this search themselves: ${row.materialBecause}`,
        ...(row.variants.length > 1 ? [`Wordings collapsed onto one search: ${variants.slice(0, 4).map((v) => `"${v}"`).join(", ")}`] : []),
        `Behind ${row.parents.slice(0, 2).map((pr) => `"${plain(pr.promptText)}"`).join(" and ")}${row.parents.length > 2 ? ` and ${count(row.parents.length - 2, "more question")}` : ""}`,
        ...(rival ? [`${rival.url} is credited on ${count(rival.answers, "answer")} that ran it`] : []),
        ...(readOver ? [`A page here was read for it and passed over ${count(row.retrievedNotCitedAnswers, "time")}`] : []),
        `Assistants that ran it: ${engineList(row.engines)}`],
      aiImpact: { answers: row.reportingAnswers, mentionRate: 0, citedRivals: row.rivalPagesTotal,
        audienceWeight: fit.match.page.search?.impressions90d ?? null, days: row.days, engines: row.engines.length,
        prompts: row.parents.length, reportedAnswers: row.reportingAnswers, retrievedNotCited: row.retrievedNotCitedAnswers, stage },
      aiScope: { caseKey: evidence.caseKey, promptIds: row.parents.map((pr) => pr.promptId), engines: row.engines,
        models: row.models.map((m) => m.modelServed).filter((m) => typeof m === "string" && m.length > 0) as string[],
        modes: [...new Set(row.models.map((m) => m.mode).filter(Boolean))],
        fanoutKey: row.key, fanouts: variants, observationIds: row.observationIds, stage },
      cause: { cause: readOver ? "retrieved_not_cited" : "ai_citation_gap", action: "section",
        evidenceKeys: ["ai-fanouts", `fanout:${row.key}`, ...row.parents.slice(0, 3).map((pr) => `answers:${pr.promptId}`), "copy-current"],
        explanation: `${count(row.executions, "stored answer")} across ${count(row.days, "day")} and ${count(row.engines.length, "assistant")} ran the search "${row.query}" while answering ${count(row.parents.length, "tracked question")}. ${readOver ? `${path} was read on ${count(row.retrievedNotCitedAnswers, "of those answers")} and credited on none of them, so the page is reachable and what it lacks is an answer an engine can lift.` : unreachF ? `No stored answer reports reading ${path} for it, so before wording matters the page has to be one the assistants reach at all.` : `The sources relied on for it are other sites, and these instruments do not report what they read, so absence from the reading is not shown; absence from the credit is.`}`,
        competingExplanations: [readOver
          ? { cause: "ai_citation_gap" as const, reason: "absence is ruled out by the retrieval record itself: the engine reports fetching this page, so what it wants is missing from the page rather than the page missing from the index" }
          : unreachF
            ? { cause: "technical_indexability" as const, reason: "no stored answer reports retrieving this page for this search, so an access problem is not ruled out until a fetch is on file" }
            : { cause: "technical_indexability" as const, reason: "these instruments do not report retrieval, so an access problem is neither shown nor ruled out by anything on file" }],
        notConsidered: [{ cause: "intent_shift" as const, missing: "no results page for this search is on file, so whether searchers want a different shape of answer is not decided here" }],
        falsifier: "If a newly stored answer credits this page on this search before anything ships, the gap was already closing and this card retires itself." },
      ...(copyF.next ? { next: copyF.next } : {}),
      minutes: 30, confidence: row.days >= 3 && row.engines.length >= 2 ? "medium" : "low", refs: row.executions,
      limitation: FANOUT_LINKAGE_CAVEAT,
    });
    byPage.set(path, out.length - 1);
    claimed.add(row.key);
    noteCase(row, "actionable", `${row.materialBecause}. A change is open for it on ${path}.`,
      { pageUrl: fit.match.page.url, stage, proposalId: `${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap` });
  }
  // FILED ONCE, AT THE END, so a surface reads what this pass concluded instead of guessing it again. A pass
  // that persists nothing files nothing: a dry run must never leave a verdict on disk for a screen to read.
  // A CONCLUSION THAT IS NOT ON RECORD IS NOT A CONCLUSION. When the file could not be written, this pass may
  // not be treated as having rewritten its family in full: the sweep behind it would then retire cards on the
  // strength of a pass whose verdicts nothing can read back.
  // AND A PASS THAT NEVER SAW THE WINDOW DECIDED NOTHING WORTH KEEPING. With the 28 day read failed or empty,
  // every verdict above was reached blind: recurrence at zero, every fan-out invisible. Filing those rows
  // would overwrite real verdicts with blindness, and reporting filed:true would authorize the sweep to
  // retire cards on the strength of a read that never happened. So the pass keeps its drafts, files nothing,
  // leaves an unavailable receipt in the log, and the family is held exactly as an unwritable store holds it.
  if (windowObs == null) {
    log.warn("[ai-cases] the stored AI window could not be read, so nothing is filed and nothing behind it is swept", { tenantId, decidedUnfiled: decided.length });
    return { drafts: out, filed: false };
  }
  const write = persist ? await recordAiCaseDispositions(tenantId, decided) : { filed: true as const };
  if (!write.filed) log.warn("[ai-cases] this pass decided these searches and could not file the decision, so it does not claim to have finished", { tenantId, reason: write.reason, decided: decided.length });
  // WHAT EVERY OTHER MATERIAL SEARCH BECAME, counted by state. Silence here would be the old defect wearing a
  // new coat: a search that reached no card and no debt has to be nameable, and it is.
  if (Object.keys(states).length > 0) log.info("[ai-cases] every search the assistants ran, by where it ended up", { tenantId, ...states });
  return { drafts: out, filed: write.filed };
}
/** ONE test surface for the copy layer: every derivation pinned through one export. */
/** THE TREATMENT PLANNER (Codex, 2026-08-23): between diagnosis and drafting, ONE closed decision about what kind of work this page actually needs. The stage rules are the point. A page RETRIEVED and passed over needs information gain, structure and precision, never a restatement; a page NO ANSWER REPORTS READING needs reachability work before wording; a page whose own coverage does not answer the asked intent needs a differentiation decision, not a forced block; and a page already carrying the answer gets that section REWRITTEN, never a duplicate beside it. */
function treatmentFor(x: { unreachable: boolean; passedOver: boolean; coversAsked: boolean }): { treatment: NonNullable<ChangeProposal["treatment"]>; draftable: boolean; work: string } {
  if (x.unreachable) return { treatment: "technical_reachability", draftable: false,
    work: "No stored answer reports reading this page while rivals are credited, so the work is reachability first: indexing, internal links to it, and whether this page truly serves the asked intent. Copy written before that lands cannot be selected." };
  if (!x.coversAsked) return { treatment: "consolidate_or_differentiate", draftable: false,
    work: "This page's own coverage serves a different intent than the question asks, so the decision is a dedicated page or deliberate repositioning, never a bolted-on block that answers past the page." };
  if (x.passedOver) return { treatment: "rewrite_existing_section", draftable: true,
    work: "Assistants already read this page and select other sources, so the work is INFORMATION GAIN in the section that covers this: mapping, structure, definitions or precise facts the page lacks, never a restatement of what it already says." };
  return { treatment: "add_answer_section", draftable: true,
    work: "The page is credited or mentioned without a liftable passage, so the work is one new section that answers the question outright in the required shape." };
}
export const AI_CASE_COPY = { caseCopy, intentOf, readableSubject, treatmentFor } as const;
