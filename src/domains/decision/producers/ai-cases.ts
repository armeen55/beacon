import "server-only";
/** decision/producers/ai-cases - THE ONE AEO DECISION PATH. Two sources of case, one ladder, one family.
 *
 *  A tracked question the operator approved watching is one source. THE SEARCHES THE ASSISTANTS RAN THEMSELVES
 *  are the other, and they were decoration until now: a fan-out that recurred across days and assistants could
 *  sit in the canonical demand layer for ever and never reach a page, a verdict, a draft or a refusal
 *  (operator, 2026-08-19). Both sources stage the AI position BEFORE a page is chosen, because the stage is
 *  the work: a page an engine read and passed over needs an answer it can lift; a brand named in prose and
 *  never credited needs a passage that earns the citation; a page no engine reports reading needs to be
 *  reachable before any wording matters; and a question whose answers never report sources is a reporting gap
 *  no page edit can close.
 *
 *  CLASSIFICATION IS NEVER BOUNDED, only paid drafting is. Every material search terminates somewhere a person
 *  can see: a card on the page it belongs to, a coverage need when no page of this account is for it, or a
 *  named evidence state. "Process at most three" would abandon the fourth silently, which is the defect this
 *  file exists to close. Clusters that belong to the same page collapse into ONE card carrying all of them,
 *  which is aggregation with a receipt and never a drop. */
import { log } from "@/lib/logger";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { buildFanoutEvidence, FANOUT_LINKAGE_CAVEAT, type FanoutRow } from "@/domains/evidence/ai-visibility/fanout-evidence";
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
type FanoutCase = { caseKey: string; state: AiCaseState; stage?: "owned_retrieved_not_cited" | "rivals_cited_own_not_retrieved"; pageUrl?: string; reason: string };

/** PURE, AND IT NEVER CONSULTS THE QUEUE. A search cannot need an existing Change to decide whether a Change
 *  should exist: that circle can never create the first one. Evidence in, one state out. `landing` is the
 *  owned-page coverage answer the producer already computed; without one the state is decided as far as the
 *  evidence alone can decide it, which is exactly what a surface needs before anything is persisted. */
export function resolveFanoutCase(row: FanoutRow, landing?: { pageUrl: string | null; refused: boolean }): FanoutCase {
  const caseKey = `fanout:${row.key}`;
  if (row.ownState === "cited") return { caseKey, state: "already_credited",
    reason: `Credited on ${count(row.ownCitedAnswers, "answer")} of the ${count(row.reportingAnswers, "answer")} that ran this search and reported their sources. Nothing to change here; watch that it holds.` };
  if (row.ownState === "unreported") return { caseKey, state: "unreported",
    reason: "The assistants that ran this search never reported which pages they used, so where this site stood on it is unknown. That is missing reporting, not a zero, and no page edit closes it." };
  if (!row.material) return { caseKey, state: "monitoring", reason: `${row.materialBecause}. Watched, and it becomes work the day it recurs.` };
  const stage = row.ownState === "retrieved_not_cited" ? ("owned_retrieved_not_cited" as const) : ("rivals_cited_own_not_retrieved" as const);
  if (landing && landing.pageUrl == null) return { caseKey, state: "no_page", stage,
    reason: `${row.materialBecause}, and no page of this account is for it yet, so no edit can win it. It is on the list of pages to build.` };
  return { caseKey, state: "actionable", stage, ...(landing?.pageUrl ? { pageUrl: landing.pageUrl } : {}),
    reason: stage === "owned_retrieved_not_cited"
      ? `${row.materialBecause}, and a page here was read for it and passed over ${count(row.retrievedNotCitedAnswers, "time")}.`
      : `${row.materialBecause}, and no assistant reports reading a page of this account for it.` };
}
/** 1. THE ANSWERS THAT CREDIT SOMEBODY ELSE, staged before a page is ever chosen. WHERE THIS SITE STOOD across the stored answers is the case, and the case decides the work: a page an engine read and passed over needs an answer it can lift; a brand named in prose and never credited needs a passage that earns the citation; a page no engine reports reading needs to be reachable before any wording matters; and a question whose answers never report sources is a reporting gap no page edit can close, so it stays visible and mints nothing. RECURRENCE IS COUNTED IN DISTINCT DAYS AND ASSISTANTS over the stored window through the same projection Visibility renders, never in raw rows, so a card and the screen can never disagree. */
export async function aiCaseCards(bank: { query: string; refusedPages?: string[] }[], snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, u: Understanding, tenantId: string,
  units: readonly CanonicalDemandUnit[], windowObs: readonly CanonicalPairObservation[] | null, now: Date,
  persist: boolean): Promise<{ drafts: Draft[]; filed: boolean }> {
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
  // EVERY TRACKED QUESTION FILES A VERDICT TOO. The store documents two identities and only fanout: was ever
  // written, so the case line on a tracked-question card could never render and a credited question read as
  // unjudged (reviewer, 2026-08-20). One helper, same shape, prompt-keyed.
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
    // THE STAGE, DECIDED BEFORE THE WORK IS NAMED. Read and passed over, named in prose and never credited, or never retrieved at all: each is a different job, and pretending they all needed "a section" was the defect.
    const w = windows.get(g.key) ?? null;
    const passedOver = stand.retrievedNotCitedEngines.length > 0 || (w?.rnc ?? 0) > 0;
    const mentioned = !passedOver && g.mentioned > 0;
    const stage = passedOver ? ("owned_retrieved_not_cited" as const) : mentioned ? ("owned_mentioned_not_cited" as const) : ("rivals_cited_own_not_retrieved" as const);
    const standLine = stand.answers > 0 ? `Across ${count(stand.answers, "stored answer")} on file (${stand.engines.join(", ")}), this site is cited on ${stand.cited}${stand.lastCitedAt ? `, last on ${stand.lastCitedAt.slice(0, 10)}` : ""} and retrieved on ${stand.retrieved}.` : "";
    const recurLine = w ? `Over the stored window this question ran on ${count(w.days.size, "day")} across ${count(w.engines.size, "assistant")}, and ${count(w.reporting, "answer")} reported sources.` : "";
    // THE ASSISTANTS' OWN FOLLOW-UP SEARCHES behind this question, recurring ones only, off the same projection Visibility renders: the cluster travels with the card into shipment scope, so Results can remeasure it.
    const cluster = (fanouts?.rows ?? []).filter((f) => f.material && f.parents.some((pr) => pr.promptId === g.promptId)).slice(0, 5);
    const clusterLine = cluster.length > 0 ? `While answering it, assistants ran their own searches on repeat: ${cluster.map((f) => `"${f.query}" (${count(f.days, "day")}, ${count(f.engines.length, "assistant")})`).join("; ")}.` : "";
    const fact = mentioned ? facts.find((f) => f.page.toLowerCase() === path.toLowerCase()) ?? null : null;
    const engines = [...g.engines].sort().join(", "), covers = asWritten(g.prompt, match.hits).join(", "), inst = [...g.domains.keys()].filter((d) => /\.(edu|gov)$|\.ac\.[a-z]{2}$/.test(d));
    const readers = stand.retrievedNotCitedEngines.length > 0 ? stand.retrievedNotCitedEngines.join(" and ") : "An assistant";
    out.push({
      page: match.page, slug: "ai_answer_gap", field: "section", query: g.prompt, asked: g.prompt,
      headline: passedOver ? `${readers} reads ${path} for "${g.prompt}" and cites ${domain} instead; give it the answer it can lift`
        : mentioned ? `Assistants name this brand for "${g.prompt}" and credit ${domain}; give ${path} a passage worth citing`
          : `AI answers cite ${domain} for "${g.prompt}" and never read ${path}; make it reachable, then liftable`, before: null,
      after: passedOver
        ? `Add a short section that answers "${g.prompt}" outright: the answer in the first two sentences, then the specifics only this page has, under a heading a reader would search for. The section must add structure the page does not have: where the page states a question and its reply separately, connect them into one sentence a reader can use; where it marks one form as more formal, carry that note into the sentence; pair every expression with its English meaning in the same sentence. This page is ALREADY being read by the engine and passed over, so a restatement of its list changes nothing: what is missing is a block an engine can lift whole.`
        : mentioned
          ? `Write the passage an assistant can credit on ${path}: the direct answer to "${g.prompt}" in the first two sentences, every factual claim backed by a source the page names. ${fact ? `A verified fact is already banked for this page (${fact.subject}, checked against ${fact.sources[0]?.url ?? "its source"}), so the passage stands on it.` : "No verified source fact is banked for this page yet, so the fact is acquired first; a passage never invents its backing."} Assistants already say the name in prose and hand the credit elsewhere, so the missing thing is a passage that earns the citation, not awareness.`
          : `Make ${path} the page an assistant can reach and lift for "${g.prompt}": align the title and H1 with the question's own words, link it from the strongest related pages so it sits one hop from where crawlers already go, confirm it is indexed, then put the answer in the first two sentences under a heading a reader would search for. No stored answer reports reading this page, so reachability comes before wording.`,
      why: `AI answers for "${g.prompt}" cite ${domain} on ${count(cite.n, "answer")}, and the newest answer from each of ${engines} credits other sites. The page they cite is ${cite.url}. ${standLine} ${recurLine} ${labelOf(match.page)} at ${path} already covers ${covers}, so ${passedOver ? "the page is already being read and passed over: the work is making the answer liftable, not making it exist" : mentioned ? "the name is already in the answers: the work is a passage that converts the mention into a citation" : "the work starts with making this page reachable, because no stored answer reports reading it"}.`,
      steps: passedOver ? [`Open the site editor on ${path}`, `Add a section that answers "${g.prompt}"`, "Put the answer in the first two sentences, before any background", "Mark it done here and the next answers get checked against it"]
        : mentioned ? [`Open the site editor on ${path}`, `Write the direct answer to "${g.prompt}" with its source named in the passage`, fact ? `Build on the banked verified fact: ${fact.subject}` : "Hold publishing until the fact pass banks a verified source for the claim", "Mark it done here and the next answers get checked against it"]
          : [`Open the site editor on ${path}`, "Align the title and H1 with the question's own words", `Link to ${path} from the strongest related pages`, "Mark it done here and the next answers get checked against it"],
      hints: [`${cite.engine} cited ${cite.url} ("${cite.title}") when answering "${g.prompt}"`,
        ...passages, ...linkOnly, ...(standLine ? [standLine] : []), ...(recurLine ? [recurLine] : []), ...(clusterLine ? [clusterLine] : []),
        ...(passedOver ? [`${stand.retrievedNotCitedEngines.length > 0 ? stand.retrievedNotCitedEngines.join(", ") : "The stored window"} shows this page retrieved while answering and credited nowhere, so the page is reachable and not liftable`] : []),
        ...(mentioned ? [`Assistants say the name in prose on ${count(g.mentioned, "stored answer")} without crediting any page of this site`] : []),
        ...(fact ? [`Verified fact banked for this page: ${fact.subject}, checked against ${fact.sources[0]?.url ?? "its source"}`] : []),
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
            : `The newest stored answer from each of ${engines} on "${g.prompt}" cites other sites (${domain} on ${count(cite.n, "answer")}) and none credits this one, and no stored answer reports retrieving this page, while ${path} already covers ${covers}: before wording matters, the page has to be one the assistants reach at all.`,
        competingExplanations: [...(inst.length > 0 ? [{ cause: "competitor_content_gap" as const, reason: `the cited rivals include institutional sources (${inst.join(", ")}), so assistants may be preferring that authority, and a better section narrows the gap without guaranteeing the citation flips` }] : []),
          ...(passedOver ? [{ cause: "ai_citation_gap" as const, reason: "absence was ruled out by the retrieval record itself: the engine reports fetching this page, so the answer it wants is missing from the page rather than the page missing from the index" }]
            : [{ cause: "technical_indexability" as const, reason: "no stored answer reports retrieving this page, so an access problem is not ruled out until a fetch is on file" }]),
          ...(stand.cited > 0 ? [{ cause: "no_problem" as const, reason: `this site HAS been cited on ${count(stand.cited, "stored answer")}${stand.lastCitedAt ? `, last on ${stand.lastCitedAt.slice(0, 10)}` : ""}, so the citation is winnable and this is a slipped position rather than an absent one`, fired: true }] : [])],
        notConsidered: [{ cause: "intent_shift" as const, missing: "no results page for this question is on file, so whether searchers now want a different shape of answer is not decided here" }],
        falsifier: passedOver ? "If a newly stored answer credits this site without the section shipping, the page was already liftable and this card retires itself."
          : mentioned ? "If a newly stored answer credits this site before the passage ships, the mention was already converting and this card retires itself."
            : "If newly stored answers to this question credit this site before the page is relinked, the gap was already closing and this card retires itself." },
      // WHAT THE NEXT PASS OWES, said exactly, per stage. A page an engine already reads does not need its own list read back to it; a passage may only stand on a verified fact; a page nobody retrieves is checked for reachability before anybody writes a word for it.
      next: passedOver ? `The cited pages pair every expression with its English meaning and its pronunciation in one entry. This page carries the expressions and not the usage around them, so the next work is the facts it lacks: which reply answers which question, which form is formal, and what a reader says first. Those are not on the page, so they are researched before any section is written.`
        : mentioned && !fact ? `No verified source fact is banked for ${path}. The fact pass acquires one for the claim this passage will make, and the wording lands only after the fact is confirmed; a passage with invented backing never ships.`
          : !passedOver && !mentioned ? `Reachability is checked first: the next pass confirms the page is indexed and linked before any wording is written, because a section on a page no assistant reads changes nothing.`
            : undefined,
      minutes: 30, confidence: g.answers >= 3 && (w == null || w.days.size >= 3) ? "medium" : "low", refs: g.answers,
      limitation: "This is read off the answers already stored for this question, not off a fresh answer bought today, and no rewrite guarantees a citation.",
    });
    notePrompt(g, "actionable", `Rivals are credited on this question and this site is not. A change is open for it on ${path}.`,
      { pageUrl: match.page.url, stage, proposalId: `${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap` });
    if (out.length >= MAX_PER_PRODUCER) break;
  }

  // ── SECOND SOURCE: THE SEARCHES THE ASSISTANTS RAN THEMSELVES ───────────────────────────────────────────
  // EVERY MATERIAL SEARCH TERMINATES SOMEWHERE A PERSON CAN SEE. Classification below is deliberately
  // unbounded: bounding it would abandon the fourth strongest search of the account in silence, which reads
  // exactly like having decided it did not matter. What IS bounded is paid drafting, and that bound lives
  // where the money is spent, not here. A cluster whose page already carries a card this pass MERGES into it,
  // so one page still holds one card and nothing is dropped to make that true (operator, 2026-08-19).
  const trackedKeys = new Set((windowObs ?? []).map((o) => canonicalQueryKey(o.promptText)).filter(Boolean));
  const claimed = new Set(out.map((d) => canonicalQueryKey(d.query)));
  const byPage = new Map(out.map((d, i) => [pathOf(d.page.url), i]));
  const byKey = new Map(pages.map((pg) => [canonicalUrlKey(pg.url), pg]));
  const states: Record<string, number> = {};
  // WHAT THIS PASS CONCLUDED ABOUT EVERY SEARCH joins the same `decided` list the tracked questions filed
  // into: one write, both identities. The resolver is pure and a surface can call it, but only this pass holds
  // the landing evidence: which pages exist, which have been read, and whether any of their jobs actually fit.
  // Re-deriving the verdict from evidence alone, a screen called a search Decision had already refused for
  // want of a page "actionable" and put a button under it.
  const noteCase = (row: FanoutRow, state: AiCaseState, reason: string, over: Partial<AiCaseDisposition> = {}): void => {
    decided.push({ caseKey: `fanout:${row.key}`, state, query: row.query, reason, days: row.days,
      engines: row.engines.length, parents: row.parents.length, executions: row.executions,
      decidedAt: now.toISOString(), ...over });
  };
  for (const row of fanouts?.rows ?? []) {
    const evidence = resolveFanoutCase(row);
    if (evidence.state !== "actionable" || trackedKeys.has(row.key) || claimed.has(row.key)) {
      const why = trackedKeys.has(row.key) ? "tracked_question" : claimed.has(row.key) ? "answered_by_a_card_this_pass" : evidence.state;
      states[why] = (states[why] ?? 0) + 1;
      // DECLINING TO OPEN A CASE IS A DECISION AND IT FILES. "A tracked question already asks this" was held
      // in a counter nobody could read, so on the screen the account's strongest search looked unjudged. It is
      // `covered` now, with the covering thing named.
      if (why === "tracked_question") noteCase(row, "covered", `${row.materialBecause}. A question this account already tracks asks this search, so its standing is judged there rather than as a case of its own.`);
      else if (why === "answered_by_a_card_this_pass") noteCase(row, "covered", `${row.materialBecause}. A change opened this pass already targets this search, so it is covered there rather than as a case of its own.`);
      else noteCase(row, evidence.state, evidence.reason, evidence.stage ? { stage: evidence.stage } : {});
      continue;
    }
    // THE SUBJECT IS THE JOB, NEVER THE SEARCH TRACE. A fan-out is how an assistant went looking; printing it
    // as a heading shipped "Add a section on Encyclopaedia Iranica Persian literature Ferdowsi Hafez Saadi".
    // So the words a page is judged against are the search when a person could have typed it, and the parent
    // question when they could not.
    const parent = [...row.parents].sort((a, b) => b.executions - a.executions)[0] ?? null;
    const subject = askable(row.query) ? row.query : parent ? plain(parent.promptText) : "";
    if (!subject) {
      states.unaskable = (states.unaskable ?? 0) + 1;
      noteCase(row, "no_page", `${row.materialBecause}, and it is a machine's own phrasing rather than a question a reader would type, so no page is written for it as it stands.`);
      continue;
    }
    // WHERE IT LANDS: the page the ENGINE ITSELF reported reading for this search comes first, because that is
    // evidence and every other route is inference. Then the audience unit that owns its parent questions.
    // Then, and only then, the words.
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
    const rival = row.rivalPages[0] ?? null;
    out.push({
      page: fit.match.page, slug: "ai_answer_gap", field: "section", query: subject, asked: subject,
      headline: readOver
        ? `Assistants search "${row.query}" and read ${path} without crediting it; give it the answer it can lift`
        : `Assistants search "${row.query}" and never read ${path}; make it the page they reach`,
      before: null,
      after: readOver
        ? `Add a short section that answers "${subject}" outright: the answer in the first two sentences, then the specifics only this page has, under a heading a reader would search for. The assistants already open this page while answering and credit somebody else, so a restatement of what it lists changes nothing: what is missing is a block an engine can lift whole.`
        : `Make ${path} the page an assistant reaches for "${subject}": align the title and H1 with the question's own words, link it from the strongest related pages, confirm it is indexed, then put the answer in the first two sentences. No stored answer reports reading this page for this search, so reachability comes before wording.`,
      why: `${count(row.executions, "stored answer")} ran the search "${row.query}" while answering ${count(row.parents.length, "tracked question")}: it ${row.materialBecause}. ${rival ? `${rival.url} is credited on ${count(rival.answers, "of those answers")}.` : "No page is credited on it often enough to name a leader."} ${labelOf(fit.match.page)} at ${path} already covers ${asWritten(subject, fit.match.hits).join(", ")}, so ${readOver ? "the page is reachable and being read: the work is making the answer liftable" : "the work starts with being reachable for it at all"}.`,
      steps: readOver
        ? [`Open the site editor on ${path}`, `Add a section that answers "${subject}"`, "Put the answer in the first two sentences, before any background", "Mark it done here and the next answers get checked against it"]
        : [`Open the site editor on ${path}`, "Align the title and H1 with the words of this search", `Link to ${path} from the strongest related pages`, "Mark it done here and the next answers get checked against it"],
      hints: [`Assistants ran this search themselves: ${row.materialBecause}`,
        ...(row.variants.length > 1 ? [`Wordings collapsed onto one search: ${variants.slice(0, 4).map((v) => `"${v}"`).join(", ")}`] : []),
        `Behind ${row.parents.slice(0, 2).map((pr) => `"${plain(pr.promptText)}"`).join(" and ")}${row.parents.length > 2 ? ` and ${count(row.parents.length - 2, "more question")}` : ""}`,
        ...(rival ? [`${rival.url} is credited on ${count(rival.answers, "answer")} that ran it`] : []),
        ...(readOver ? [`A page here was read for it and passed over ${count(row.retrievedNotCitedAnswers, "time")}`] : []),
        `Assistants that ran it: ${row.engines.join(", ")}`],
      aiImpact: { answers: row.reportingAnswers, mentionRate: 0, citedRivals: row.rivalPagesTotal,
        audienceWeight: fit.match.page.search?.impressions90d ?? null, days: row.days, engines: row.engines.length,
        prompts: row.parents.length, reportedAnswers: row.reportingAnswers, retrievedNotCited: row.retrievedNotCitedAnswers, stage },
      aiScope: { caseKey: evidence.caseKey, promptIds: row.parents.map((pr) => pr.promptId), engines: row.engines,
        models: row.models.map((m) => m.modelServed).filter((m) => typeof m === "string" && m.length > 0) as string[],
        modes: [...new Set(row.models.map((m) => m.mode).filter(Boolean))],
        fanoutKey: row.key, fanouts: variants, observationIds: row.observationIds, stage },
      cause: { cause: readOver ? "retrieved_not_cited" : "ai_citation_gap", action: "section",
        evidenceKeys: ["ai-fanouts", `fanout:${row.key}`, ...row.parents.slice(0, 3).map((pr) => `answers:${pr.promptId}`), "copy-current"],
        explanation: `${count(row.executions, "stored answer")} across ${count(row.days, "day")} and ${count(row.engines.length, "assistant")} ran the search "${row.query}" while answering ${count(row.parents.length, "tracked question")}. ${readOver ? `${path} was read on ${count(row.retrievedNotCitedAnswers, "of those answers")} and credited on none of them, so the page is reachable and what it lacks is an answer an engine can lift.` : `No stored answer reports reading ${path} for it, so before wording matters the page has to be one the assistants reach at all.`}`,
        competingExplanations: [readOver
          ? { cause: "ai_citation_gap" as const, reason: "absence is ruled out by the retrieval record itself: the engine reports fetching this page, so what it wants is missing from the page rather than the page missing from the index" }
          : { cause: "technical_indexability" as const, reason: "no stored answer reports retrieving this page for this search, so an access problem is not ruled out until a fetch is on file" }],
        notConsidered: [{ cause: "intent_shift" as const, missing: "no results page for this search is on file, so whether searchers want a different shape of answer is not decided here" }],
        falsifier: "If a newly stored answer credits this page on this search before anything ships, the gap was already closing and this card retires itself." },
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