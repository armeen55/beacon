import "server-only";
/** decision/producers/ai-cases - THE ONE AEO DECISION PATH. Two sources of case (a tracked question the operator approved; a search the assistants ran themselves), one ladder, one family. Both stage the AI position BEFORE a page is chosen. THE STAGE IS WHAT HAPPENED, NEVER WHAT IS WRONG WITH THE PAGE: what a page lacks, if anything, is decided by the diagnosis reader against the complete stored copy, and only that verdict may order body work. CLASSIFICATION IS NEVER BOUNDED, only paid drafting is: every material search terminates somewhere a person can see, and same-page clusters collapse into ONE card carrying all of them, aggregation with a receipt and never a drop (operator, 2026-08-19). */
import { createHash } from "node:crypto";
import { log } from "@/lib/logger";
import type { ChangeProposal } from "../contracts";
import { dayLabel, engineLabel, engineList } from "@/lib/presenter";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { citesOwnSite } from "@/domains/evidence/ai-visibility/canonicalize-citation-url";
import { buildFanoutEvidence, FANOUT_LINKAGE_CAVEAT, instrumentFacts, type FanoutRow } from "@/domains/evidence/ai-visibility/fanout-evidence";
import { canonicalUrlKey, type EvidenceSnapshot, type OwnedPageEvidence } from "@/domains/evidence/snapshot";
import type { CanonicalPairObservation } from "@/domains/evidence/funnel/research-evidence";
import type { CanonicalDemandUnit } from "@/domains/evidence/demand-units";
import { journeyLabel, readAnswerJourneys, standingOf } from "@/domains/evidence/ai-visibility/answer-journeys";
import { sectionFit } from "./page-job";
import { DIAGNOSIS_CONTRACT, freshDiagnosis, readAiCaseDispositions, recordAiCaseDispositions, type AeoGapDiagnosis, type AiCaseDisposition, type AiCaseState } from "../ai-case-store";
import { callStructuredLLM } from "../llm/structured-drafter";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { asWritten, askable, bestPageFor, count, labelOf, MAX_PER_PRODUCER, noteNeedsOwnPage, pageWords, pathOf, plain,
  STOREFRONT, subjectWords, type Draft, type Fit, type Understanding } from "./page-fit";

/** WHERE A SEARCH ENDS UP AS FAR AS THE EVIDENCE ALONE CAN SAY. The vocabulary is the store's (ai-case-store) and is not spelled a second time here: two names for one set of states is the same defect this closure exists to remove. `held` and the landing states below need facts only a producer pass holds. */
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
/** A search rendered as a subject a reader would say, for copy that must not paste the machine's phrasing. */
const MARKERS = /\b(examples?|lists?|ideas?|websites?|sites?|best|top|guides?)\b/gi;
const readableSubject = (q: string): string => plain(q).replace(MARKERS, " ").replace(/\s+/g, " ").trim() || plain(q);
/** THE STAGE, SAID AS WHAT HAPPENED AND NOTHING MORE. Retrieval-and-no-citation never proves a missing or
 *  unliftable answer; the diagnosis layer below is the only thing allowed to claim what the page lacks. */
const OBS: Record<string, string> = {
  owned_retrieved_not_cited: "The assistants retrieved this page while answering and credited another source.",
  owned_mentioned_not_cited: "Assistants name this brand in prose while answering and credit other pages, never one of this site.",
  rivals_cited_own_not_retrieved: "No stored answer reports reading this page while rivals are credited.",
  own_not_in_reported_sources: "These instruments report the sources they relied on, not everything they read, so whether this page was read is unknown; the credit goes elsewhere.",
};
const OWED_WORK = "Whether this page already answers it has not been read against its complete stored copy, so no copy is ordered: that reading comes first.", OWED_NEXT = "The next funded pass reads the complete stored page against this search and banks what, if anything, it lacks. No writer runs before that verdict.";
/** The case as one object, and the card texts as pure derivations of it. */
type Standing = { quoted: string; path: string; intent: Intent; stage: FanoutStage | "owned_mentioned_not_cited"; domain: string | null };
function caseCopy(s: Standing): { headline: string; steps: string[] } {
  const q = s.quoted, credit = s.domain ? `credit ${s.domain} instead` : "credit other sites";
  const open = `Open the site editor on ${s.path}`, close = "Mark it done here and the next answers get checked against it";
  const steps = [open, `Apply the change this card carries for ${q} once its wording lands`, close];
  if (s.stage === "owned_retrieved_not_cited") return { headline: `Assistants read ${s.path} for ${q} and ${credit}`, steps };
  if (s.stage === "owned_mentioned_not_cited") return { headline: `Assistants name this brand for ${q} and ${credit}`, steps };
  if (s.stage === "rivals_cited_own_not_retrieved") return {
    headline: `AI answers cite ${s.domain ?? "other sites"} for ${q} and none reports reading ${s.path}; make it reachable first`,
    steps: [open, "Align the title and H1 with the subject's own words", `Link to ${s.path} from the strongest related pages`, close] };
  return { headline: `AI answers rely on other sites for ${q}; ${s.path} is not among the sources they report`, steps };
}
type FanoutCase = { caseKey: string; state: AiCaseState; stage?: FanoutStage; pageUrl?: string; reason: string };

/** PURE, AND IT NEVER CONSULTS THE QUEUE: evidence in, one state out; `landing` is the coverage answer the producer already computed. RECURRENCE ALONE IS NEVER WORK (Codex, 2026-08-21): days>=3 on one question and one assistant measures that assistant's habit, so actionable needs a dimension beyond time: a second tracked question, a second assistant, a page here read-and-passed-over on an instrument that reports reading, or the caller's corroboration that real Google demand asks the same. And a reading claim is legal only where reading is reported: otherwise "never read" degrades to "not among the sources relied on", a stage fact that on its own prescribes no work at all. */
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
/** THE PASS'S OWN DIAGNOSIS PURSE, decided at the orchestration boundary and shared by tracked questions and fan-outs alike. The account cap and the pause live at the gateway; this is the per-pass funding decision the gateway cannot make, and without it a pass whose diagnoses all REFUSE keeps buying, because a refusal emits no card and the five-card output bound never notices. Unfunded cases stay owed for the next pass. */
export type AeoMeter = { draw(): boolean; refund(): void; spent(): { funded: number; attempted: number; cached: number; left: number } };
export function aeoMeter(funded: number): AeoMeter {
  let left = Math.max(0, funded), attempted = 0, cached = 0;
  return { draw: () => (left <= 0 ? false : (left -= 1, attempted += 1, true)),
    refund: () => { left += 1; attempted -= 1; cached += 1; },
    spent: () => ({ funded: Math.max(0, funded), attempted, cached, left }) };
}
/** THE PRE-WRITING DIAGNOSIS: what, if anything, this page LACKS for this search, read from the complete stored page and the credited passages, never inferred from the stage. Ruled by the aeo_gap reader through the one gateway (spend scope, daily and monthly budget, call cache), validated hard afterward: only ids the packet supplied, absence claims only against a complete page, scatter only across separate passages, and reachability never from a packet that carries no technical evidence. Null = the reader did not rule (unpaid pass, refused budget, unusable answer): NOTHING moves on null, the banked reading stays, no writer is hired. */
const GAP_SYSTEM = "You are Beacon's AEO gap reader. Decide what, if anything, the owned page LACKS for the given search, strictly from the numbered material supplied; never use outside knowledge. kinds: already_answered (the page already answers it clearly; cite the owned ids where), scattered_answer (every needed fact is present but spread across separate passages; cite them all), missing_information (a material proposition the credited answers carry is absent from the COMPLETE page; name it in missing and cite the evidence ids carrying it), extraction_or_structure_gap (the page answers it but the answer is buried or fragmented; name the defect in missing and cite the owned ids), authority_or_source_gap (same information, stronger sourcing or standing behind the credited page; cite the evidence ids), freshness_gap (the credited material is dated newer and conflicts; name the dated conflict in missing), reachability_gap (only with technical evidence, which this packet does not carry), unknown (the material does not show why). ownedIds and evidenceIds repeat ids exactly as given. explanation is one plain sentence for a site owner. Restating the page is never a gap: a question the page answers plainly is already_answered.";
const GAP_TREATMENT: Record<AeoGapDiagnosis["kind"], AeoGapDiagnosis["treatment"]> = {
  already_answered: null, unknown: null, authority_or_source_gap: null, freshness_gap: null, reachability_gap: null,
  scattered_answer: "rewrite_existing_section", extraction_or_structure_gap: "rewrite_existing_section", missing_information: "add_answer_section" };
async function diagnoseGap(c: { tenantId: string; caseKey: string; query: string; stage: string; pageUrl: string; observationIds: readonly string[];
  passages: readonly string[]; banked?: AeoGapDiagnosis; meter: AeoMeter; persist: boolean; now: Date }): Promise<AeoGapDiagnosis | null> {
  const body = (await loadOwnedPageBodies(c.tenantId, [c.pageUrl]).catch(() => new Map())).get(canonicalUrlKey(c.pageUrl)) ?? null;
  const obsIds = [...c.observationIds].slice(0, 40).sort();
  const owned: [string, string][] = body == null ? [] : [
    ...body.passages.slice(0, 40).map((t: string, i: number) => [`own-${i + 1}`, t.slice(0, 700)] as [string, string]),
    ...body.faqs.slice(0, 12).map((f: { question: string; answer: string }, i: number) => [`faq-${i + 1}`, `${f.question} ${f.answer}`.slice(0, 500)] as [string, string])];
  const ev: [string, string][] = c.passages.slice(0, 4).map((t, i) => [`ans-${i + 1}`, t.slice(0, 700)] as [string, string]);
  // THE PACKET IS THE IDENTITY. Everything the reading is made from, canonicalized in one string: change any of
  // it and the banked verdict is stale by construction rather than by a subset test that only notices additions.
  const packet = createHash("sha256").update(JSON.stringify([c.tenantId, c.caseKey, c.query, c.stage, canonicalUrlKey(c.pageUrl),
    body?.contentHash ?? "", body?.completeness ?? "", obsIds, ev.map(([, t]) => t), DIAGNOSIS_CONTRACT])).digest("hex").slice(0, 32);
  if (freshDiagnosis(c.banked, packet)) return c.banked!;
  if (!c.persist || body == null || owned.length === 0) return null;
  // THE PASS FUNDS THE ATTEMPT BEFORE IT IS MADE. A refusal costs a unit exactly as a verdict does, because both
  // bought a reading; only a cache hit is given back, because it reached no provider.
  if (!c.meter.draw()) return null;
  const completeness = body.completeness;
  const user = [`Search or question: "${c.query}"`, `What the assistants did (the stage): ${c.stage}`,
    `The owned page, ${completeness === "complete" ? "complete" : `INCOMPLETE (${completeness}): what is not shown is UNKNOWN, never absent`}. Its stored passages and FAQ entries, by id:`,
    ...owned.map(([id, t]) => `${id}: ${t}`),
    ev.length > 0 ? "What credited answers drew on, by id:" : "NO credited passage is on file for this search, so nothing outside this page is in evidence here.",
    ...ev.map(([id, t]) => `${id}: ${t}`), "Return the JSON now."].join("\n");
  const r = await callStructuredLLM({ kind: "aeo_gap", tenantId: c.tenantId, system: GAP_SYSTEM, user, grounded: user,
    projectedCostUsd: 0.005, maxTokens: 900, timeoutMs: 95_000, now: c.now }).catch(() => null);
  if (r && (r as { cached?: true }).cached) c.meter.refund(); // a cache hit reached no provider, so it cost no unit
  if (r?.status !== "drafted") return null;
  const v = r.value as { kind: AeoGapDiagnosis["kind"]; ownedIds: string[]; evidenceIds: string[]; missing: string; explanation: string };
  const known = new Set([...owned, ...ev].map(([id]) => id));
  if ([...v.ownedIds, ...v.evidenceIds].some((id) => !known.has(id))) return null; // an id nobody supplied rules nothing
  let kind = v.kind; const limits: string[] = [];
  const hasCredited = ev.length > 0, dated = /\b(19|20)\d{2}\b|\b\d{1,2}\/\d{1,2}\b/.test(v.missing);
  if (kind === "already_answered" && v.ownedIds.length === 0) return null;
  if (kind === "scattered_answer" && new Set(v.ownedIds).size < 2) return null;
  if (kind === "extraction_or_structure_gap" && (v.ownedIds.length === 0 || !v.missing.trim())) return null;
  // NOTHING OUTSIDE THIS PAGE IS IN EVIDENCE WITHOUT A CREDITED PASSAGE. A fan-out packet carries none, so it may
  // read the page's own shape and nothing about what a rival has, is sourced better on, or is fresher about.
  if (!hasCredited && (kind === "missing_information" || kind === "authority_or_source_gap" || kind === "freshness_gap")) {
    kind = "unknown"; limits.push("no credited passage is on file for this search, so nothing outside this page is in evidence"); }
  if (kind === "missing_information" && (v.evidenceIds.length === 0 || !v.missing.trim())) return null;
  if (kind === "missing_information" && completeness !== "complete") { kind = "unknown"; limits.push("the stored copy of this page is incomplete, so absence cannot be claimed; a full page read comes first"); }
  if (kind === "authority_or_source_gap" && v.evidenceIds.length === 0) kind = "unknown";
  if (kind === "freshness_gap" && (v.evidenceIds.length === 0 || !dated)) { kind = "unknown"; limits.push("no dated conflict is named in the supplied evidence"); }
  if (kind === "reachability_gap") { kind = "unknown"; limits.push("this packet carries no technical reachability evidence, so reachability is not diagnosable here"); }
  return { kind, treatment: GAP_TREATMENT[kind], explanation: v.explanation, ownedIds: v.ownedIds, evidenceIds: v.evidenceIds,
    ...(v.missing.trim() ? { missing: v.missing.trim() } : {}), ...(limits.length > 0 ? { limitation: limits.join("; ") } : {}),
    packet, contentHash: body.contentHash ?? "", completeness, observationIds: obsIds, version: DIAGNOSIS_CONTRACT, decidedAt: c.now.toISOString() };
}
/** WHAT THE DIAGNOSIS AUTHORIZES, closed. `emit: false` files the verdict and mints no card at all; `hire: false` keeps the card visible while refusing the writer a call. Treatment derives from the diagnosis and never from the stage; an unruled case keeps the stage treatment only as the card's working identity. */
type GapGate = { emit: false; state: AiCaseState; reason: string; diagnosis: AeoGapDiagnosis }
  | { emit: true; hire: boolean; treatment: "rewrite_existing_section" | "add_answer_section" | null; work: string; next?: string; diagnosis?: AeoGapDiagnosis };
/** WHAT THE DIAGNOSIS AUTHORIZES, closed. `emit: false` files the verdict and mints no card; `hire: false` keeps the card visible while refusing the writer a call; a null treatment names no work at all, which is what an unruled case honestly is. MISSING INFORMATION NEVER HIRES (operator, 2026-08-28): the writer would have to STATE the missing proposition, and nothing on file binds that exact proposition to the facts that support it. A confirmed fact elsewhere on the same page is a page match, not claim support, and treating it as support is how "Tehran is in Iran" comes to authorize a claim about knot density. It stays acquisition-first, always. */
function gateOf(d: AeoGapDiagnosis | null): GapGate {
  if (!d) return { emit: true, hire: false, treatment: null, work: OWED_WORK, next: OWED_NEXT };
  if (d.treatment == null) {
    const why = d.kind === "already_answered" ? `The page already answers this question, so no duplicate copy is recommended. ${d.explanation}`
      : d.kind === "authority_or_source_gap" ? `${d.explanation} The information matches; the difference is the credited source's standing, so no generic copy is ordered.`
        : d.kind === "freshness_gap" ? `${d.explanation} The work is an exact update tied to the dated evidence, not new body copy.`
          : `The evidence does not show why the assistants chose another source, so no content change is authorized yet.${d.limitation ? ` ${d.limitation}` : ""}`;
    return { emit: false, state: "monitoring", reason: why, diagnosis: d };
  }
  if (d.kind === "missing_information") return { emit: true, hire: false, treatment: d.treatment,
    work: `The complete page lacks one thing the credited answers carry: ${d.missing ?? "the named proposition"}. An authoritative source for it is acquired and checked against that exact statement first; the credited page's wording stays briefing and never becomes published copy.`,
    next: "The fact pass acquires an authoritative source for the missing proposition and checks it against that exact statement; the section is written only after that evidence is on file.", diagnosis: d };
  // SCATTER AND STRUCTURE HIRE ON THE PAGE'S OWN WORDS, with the exact passages the reading named: no claim from
  // outside the page is involved, so no external factual authorization is owed.
  const work = d.kind === "scattered_answer"
    ? `The facts are on this page in ${count(new Set(d.ownedIds).size, "separate passage")} and no single passage answers the question, so the work is one structural synthesis of the page's own material, keeping every fact, link and call to action. ${d.explanation}`
    : `The page answers this and the answer is buried: ${d.missing ?? d.explanation} The work is a structural rewrite of the named material, adding no new claims.`;
  return { emit: true, hire: true, treatment: d.treatment, work, diagnosis: d };
}
/** 1. THE ANSWERS THAT CREDIT SOMEBODY ELSE, staged before a page is ever chosen. WHERE THIS SITE STOOD across the stored answers is the case, and the case decides the work: a page an engine read and passed over needs an answer it can lift; a brand named in prose and never credited needs a passage that earns the citation; a page no engine reports reading needs to be reachable before any wording matters; and a question whose answers never report sources is a reporting gap no page edit can close, so it stays visible and mints nothing. RECURRENCE IS COUNTED IN DISTINCT DAYS AND ASSISTANTS over the stored window through the same projection Visibility renders, never in raw rows, so a card and the screen can never disagree. */
export async function aiCaseCards(bank: { query: string; refusedPages?: string[] }[], snapshot: EvidenceSnapshot, pages: OwnedPageEvidence[], weak: ReadonlySet<string>,
  earned: ReadonlyMap<string, Set<string>>, children: ReadonlyMap<string, number>, u: Understanding, tenantId: string,
  units: readonly CanonicalDemandUnit[], windowObs: readonly CanonicalPairObservation[] | null, now: Date,
  persist: boolean, meter: AeoMeter, googleKeys?: ReadonlySet<string> | null): Promise<{ drafts: Draft[]; filed: boolean; hold: ReadonlySet<string> }> {
  const site = (snapshot.scope.site ?? "").replace(/^www\./, "").toLowerCase();
  if (!site) return { drafts: [], filed: true, hold: new Set<string>() }; // nothing to conclude is not a filing that failed
  // THE STORED WINDOW, through the one shared projection: distinct days, assistants and the material follow-up searches behind every tracked question. The snapshot alone is the newest answer per question and engine, which cannot count days, and reading row totals as recurrence is the defect this replaced.
  const fanouts = windowObs && windowObs.length > 0 ? buildFanoutEvidence(windowObs, site) : null;
  // THE BANKED VERDICTS, read once: a fresh diagnosis is served on, a stale one is re-earned, and a case this
  // pass cannot rule keeps whatever reading is on file (the writer coalesces, so absence strips nothing).
  const bankedFile = await readAiCaseDispositions(tenantId);
  const banked = new Map(bankedFile.state === "read" ? bankedFile.rows.map((r) => [r.caseKey, r] as const) : []);
  const holdIds = new Set<string>();
  const windows = new Map<string, { days: Set<string>; engines: Set<string>; reporting: number; rnc: number }>();
  for (const o of windowObs ?? []) {
    const w = windows.get(canonicalQueryKey(o.promptText)) ?? { days: new Set<string>(), engines: new Set<string>(), reporting: 0, rnc: 0 };
    w.days.add(o.reportingDay); w.engines.add(o.engine); w.reporting += o.citations != null ? 1 : 0;
    w.rnc += citesOwnSite(o.retrievedResults, site) && !citesOwnSite(o.citations, site) ? 1 : 0;
    windows.set(canonicalQueryKey(o.promptText), w);
  }
  // THE VERIFIED FACTS ON FILE, so a passage brief names the source it stands on instead of assigning the operator source homework. Only a current-rules, source-read, confirmed check qualifies; anything less is exactly the invented backing this producer exists to refuse.
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
    // THE STAGE, DECIDED BEFORE THE WORK IS NAMED: each stage is a different job, and pretending they all needed "a section" was the defect. A reading claim is legal only where reading is reported (Codex, 2026-08-21): with no retrieval-reporting instrument behind this question's stored answers, "never read" degrades to "not among the sources".
    const w = windows.get(g.key) ?? null;
    const passedOver = stand.retrievedNotCitedEngines.length > 0 || (w?.rnc ?? 0) > 0;
    const mentioned = !passedOver && g.mentioned > 0;
    const retrievalCapable = (windowObs ?? []).some((o) => o.promptId === g.promptId
      && (o.retrievedResults != null || instrumentFacts(o.engine, o.observationMode).retrievalReporting));
    const stage = passedOver ? ("owned_retrieved_not_cited" as const) : mentioned ? ("owned_mentioned_not_cited" as const)
      : retrievalCapable ? ("rivals_cited_own_not_retrieved" as const) : ("own_not_in_reported_sources" as const);
    const unreach = stage === "rivals_cited_own_not_retrieved" && match.page.content == null; // the card's own rule: an access problem is ruled out the moment a fetch is on file, so a page whose stored crawl exists moves on to content work instead of waiting on reachability forever
    const standLine = stand.answers > 0 ? `Across ${count(stand.answers, "stored answer")} on file (${engineList(stand.engines)}), this site is cited on ${stand.cited}${stand.lastCitedAt ? `, last on ${dayLabel(stand.lastCitedAt)}` : ""} and retrieved on ${stand.retrieved}.` : "";
    const recurLine = w ? `Over the stored window this question ran on ${count(w.days.size, "day")} across ${count(w.engines.size, "assistant")}, and ${count(w.reporting, "answer")} reported sources.` : "";
    // THE ASSISTANTS' OWN FOLLOW-UP SEARCHES behind this question, recurring ones only, off the same projection Visibility renders: the cluster travels with the card into shipment scope, so Results can remeasure it.
    const cluster = (fanouts?.rows ?? []).filter((f) => f.material && f.parents.some((pr) => pr.promptId === g.promptId)).slice(0, 5);
    const clusterLine = cluster.length > 0 ? `While answering it, assistants ran their own searches on repeat: ${cluster.map((f) => `"${f.query}" (${count(f.days, "day")}, ${count(f.engines.length, "assistant")})`).join("; ")}.` : "";
    const engines = engineList([...g.engines].sort()), inst = [...g.domains.keys()].filter((d) => /\.(edu|gov)$|\.ac\.[a-z]{2}$/.test(d));
    const copy = caseCopy({ quoted: `"${g.prompt}"`, path, intent: intentOf(g.prompt), stage, domain });
    const obsIds = (windowObs ?? []).filter((o) => o.promptId === g.promptId).map((o) => o.observationId).slice(0, 40);
    // NO TREATMENT WITHOUT A DIAGNOSIS, INCLUDING THE DECISION ONES. "No stored answer reported retrieval" is missing instrumentation, never proof of an indexing defect, and zero title tokens is not proof that a consolidation is the right call: both are stage facts, so they ask for the evidence they lack instead.
    const gate = gateOf(await diagnoseGap({ tenantId, caseKey: `prompt:${g.promptId}`, query: g.prompt, stage, pageUrl: match.page.url,
      observationIds: obsIds, passages: journeys.filter((j) => j.citedPassage != null).slice(0, 3).map((j) => j.citedPassage!),
      banked: banked.get(`prompt:${g.promptId}`)?.diagnosis, meter, persist, now }));
    if (gate && !gate.emit) { notePrompt(g, gate.state, gate.reason, { pageUrl: match.page.url, stage, diagnosis: gate.diagnosis }); continue; }
    out.push({
      page: match.page, slug: "ai_answer_gap", field: "section", query: g.prompt, asked: g.prompt,
      ...(gate.treatment ? { treatment: gate.treatment } : {}),
      ...(gate.next ? { next: gate.next } : {}),
      headline: copy.headline, before: null, after: `${OBS[stage]} ${gate.work}`,
      why: `AI answers for "${g.prompt}" credit ${domain} on ${count(cite.n, "answer")}, and the newest answer from each of ${engines} credits other sites. The page they credit is ${cite.url}. ${standLine} ${recurLine} ${gate.diagnosis ? gate.diagnosis.explanation : "Whether this page already answers it is read from its complete stored copy before any change is ordered."}`,
      steps: copy.steps,
      hints: [`${engineLabel(cite.engine)} cited ${cite.url} ("${cite.title}") when answering "${g.prompt}"`,
        ...passages, ...linkOnly, ...(standLine ? [standLine] : []), ...(recurLine ? [recurLine] : []), ...(clusterLine ? [clusterLine] : []),
        ...(passedOver ? [`${stand.retrievedNotCitedEngines.length > 0 ? engineList(stand.retrievedNotCitedEngines) : "The stored window"} shows this page retrieved while answering and credited on none of those answers, so the page is reachable; why the credit went elsewhere is what the whole-page reading decides`] : []),
        ...(mentioned ? [`Assistants say the name in prose on ${count(g.mentioned, "stored answer")} without crediting any page of this site`] : []),
        ...(gate.diagnosis ? [`Beacon's own reading of the complete stored page: ${gate.diagnosis.explanation}`] : []),
        `The newest answer from each of ${engines} credited other sites and none credited this one`,
        `Cited domains on this question: ${[...g.domains.keys()].slice(0, 5).join(", ")}`],
      // THE AI SIDE RIDES IN ITS OWN UNITS: the reporting answers behind the claim, recurrence in distinct days and assistants off the stored window, how often the site was read and passed over, the rivals credited instead, the stage by name, and the landing page's own Google audience as the weight. The ranker reads these beside clicks; nothing here pretends to be a click, and a raw row total is never an audience.
      aiImpact: { answers: g.answers, mentionRate: g.rows > 0 ? g.mentioned / g.rows : 0, citedRivals: g.domains.size, audienceWeight: match.page.search?.impressions90d ?? null, prompts: 1, stage,
        ...(w ? { days: w.days.size, engines: w.engines.size, reportedAnswers: w.reporting, retrievedNotCited: w.rnc } : {}) },
      // THE CANONICAL CASE IDENTITY rides the scope, so every surface joins this Change to the search it was aimed at on an identity and never on wording that merely resembles it, and the OBSERVATIONS it was minted from ride with it, so a question later retired or reworded cannot strand its own measurement.
      aiScope: { caseKey: `prompt:${g.promptId}`, promptIds: [g.promptId], engines: [...g.engines].sort(),
        models: [...new Set((windowObs ?? []).filter((o) => o.promptId === g.promptId).map((o) => o.modelServed).filter((m) => typeof m === "string" && m.length > 0) as string[])],
        modes: [...new Set((windowObs ?? []).filter((o) => o.promptId === g.promptId).map((o) => o.observationMode).filter((m) => typeof m === "string" && m.length > 0) as string[])],
        fanouts: cluster.flatMap((f) => f.variants.map((v) => v.text)),
        observationIds: obsIds, stage },
      // THE CAUSE CARRIES ITS OWN RECEIPT, WEIGHED ALTERNATIVES AND KNOWN BLIND SPOTS (operator, 2026-08-17: empty arrays do not constitute causal evidence); every entry is computed from what this producer holds.
      cause: { cause: passedOver ? "retrieved_not_cited" : "ai_citation_gap", action: "section",
        evidenceKeys: ["ai-citations", `answers:${g.promptId}`, `cited:${cite.url}`, "copy-current", ...(passedOver ? ["retrieval:own-page"] : []), ...(mentioned ? ["brand-mentions"] : [])],
        explanation: passedOver ? `The stored record shows ${path} retrieved while answering "${g.prompt}" and credited nowhere (${domain} credited on ${count(cite.n, "answer")} instead). ${standLine} ${recurLine} The page is reachable and is being read; why the credit went elsewhere is what the whole-page reading decides, and nothing here claims it.`
          : mentioned ? `Assistants name this brand in prose on ${count(g.mentioned, "stored answer")} while answering "${g.prompt}" and credit ${domain} instead (${count(cite.n, "answer")}). ${standLine} ${recurLine} The name reaches the answer while the credit does not, and no stored answer reports retrieving ${path}; what the page lacks, if anything, is what the whole-page reading decides.`
            : unreach ? `The newest stored answer from each of ${engines} on "${g.prompt}" credits other sites (${domain} on ${count(cite.n, "answer")}) and none credits this one, and no stored answer reports retrieving this page: before wording matters, the page has to be one the assistants reach at all.`
              : `The newest stored answer from each of ${engines} on "${g.prompt}" relies on other sites (${domain} on ${count(cite.n, "answer")}) and never this one. These instruments report the sources they relied on and not what they read, so absence from the reading is not shown; absence from the credit is.`,
        competingExplanations: [...(inst.length > 0 ? [{ cause: "competitor_content_gap" as const, reason: `the cited rivals include institutional sources (${inst.join(", ")}), so assistants may be preferring that authority, and a better section narrows the gap without guaranteeing the citation flips` }] : []),
          ...(passedOver ? [{ cause: "ai_citation_gap" as const, reason: "the retrieval record rules out index absence: the engine reports fetching this page and credited another source, and why it chose the other source is what the whole-page reading decides" }]
            : unreach ? [{ cause: "technical_indexability" as const, reason: "no stored answer reports retrieving this page, so an access problem is not ruled out until a fetch is on file" }]
              : [{ cause: "technical_indexability" as const, reason: "these instruments do not report retrieval, so an access problem is neither shown nor ruled out by anything on file" }]),
          ...(stand.cited > 0 ? [{ cause: "no_problem" as const, reason: `this site HAS been cited on ${count(stand.cited, "stored answer")}${stand.lastCitedAt ? `, last on ${stand.lastCitedAt.slice(0, 10)}` : ""}, so the citation is winnable and this is a slipped position rather than an absent one`, fired: true }] : [])],
        notConsidered: [{ cause: "intent_shift" as const, missing: "no results page for this question is on file, so whether searchers now want a different shape of answer is not decided here" }],
        falsifier: passedOver ? "If a newly stored answer credits this site before anything ships, the gap was already closing and this card retires itself."
          : mentioned ? "If a newly stored answer credits this site before the passage ships, the mention was already converting and this card retires itself."
            : "If newly stored answers to this question credit this site before the page is relinked, the gap was already closing and this card retires itself." },
      minutes: 30, confidence: g.answers >= 3 && (w == null || w.days.size >= 3) ? "medium" : "low", refs: g.answers,
      limitation: "This is read off the answers already stored for this question, not off a fresh answer bought today, and no rewrite guarantees a citation.",
    });
    if (!gate.hire) holdIds.add(`${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap`);
    notePrompt(g, "actionable", `Rivals are credited on this question and this site is not. A change is open for it on ${path}.`,
      { pageUrl: match.page.url, stage, proposalId: `${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap`, ...(gate.diagnosis ? { diagnosis: gate.diagnosis } : {}) });
    if (out.length >= MAX_PER_PRODUCER) break;
  }

  // ── SECOND SOURCE: THE SEARCHES THE ASSISTANTS RAN THEMSELVES. Classification is deliberately unbounded (bounding it abandons the fourth strongest search in silence); only paid drafting is bounded, where the money is spent. A cluster whose page already carries a card MERGES into it (operator, 2026-08-19).
  const trackedKeys = new Set((windowObs ?? []).map((o) => canonicalQueryKey(o.promptText)).filter(Boolean));
  const claimed = new Set(out.map((d) => canonicalQueryKey(d.query)));
  const byPage = new Map(out.map((d, i) => [pathOf(d.page.url), i]));
  const byKey = new Map(pages.map((pg) => [canonicalUrlKey(pg.url), pg]));
  const states: Record<string, number> = {};
  // WHAT THIS PASS CONCLUDED ABOUT EVERY SEARCH joins the same `decided` list the tracked questions filed into: one write, both identities. Only this pass holds the landing evidence; re-deriving from evidence alone, a screen put an action button under a search Decision had already refused for want of a page.
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
    const unreachF = stage === "rivals_cited_own_not_retrieved" && fit.match.page.content == null; // same rule as above: a banked fetch settles the reachability question
    const rival = row.rivalPages[0] ?? null;
    // THE READER-FACING SUBJECT: the parent tracked question when one exists, else the search rendered as a subject. The raw fan-out stays quoted below as the search the assistants RAN; it is never the thing the copy is told to answer, because a retrieval trace is not a sentence a person publishes.
    const voice = parent && askable(plain(parent.promptText)) ? plain(parent.promptText) : readableSubject(subject);
    const copyF = caseCopy({ quoted: parent && askable(plain(parent.promptText)) ? `"${voice}"` : `searches for ${voice}`,
      path, intent: intentOf(subject), stage, domain: rival ? rival.url.replace(/^https?:\/\//, "").split("/")[0] ?? null : null });
    const decisionF = unreachF ? { treatment: "technical_reachability" as const, work: "No stored answer reports reading this page while rivals are credited, so the work is reachability first: indexing, internal links to it, and whether this page truly serves this intent." }
      : fit.match.hits.length === 0 ? { treatment: "consolidate_or_differentiate" as const, work: "This page's own coverage serves a different intent than the search asks, so the decision is a dedicated page or deliberate repositioning, never a bolted-on block." } : null;
    const gateF = gateOf(await diagnoseGap({ tenantId, caseKey: `fanout:${row.key}`, query: subject, stage, pageUrl: fit.match.page.url,
      observationIds: row.observationIds, passages: [], banked: banked.get(`fanout:${row.key}`)?.diagnosis, meter, persist, now }));
    if (!gateF.emit) {
      states.diagnosed = (states.diagnosed ?? 0) + 1;
      noteCase(row, gateF.state, gateF.reason, { pageUrl: fit.match.page.url, stage, diagnosis: gateF.diagnosis });
      continue;
    }
    out.push({
      page: fit.match.page, slug: "ai_answer_gap", field: "section", query: subject, asked: subject,
      ...(gateF.treatment ? { treatment: gateF.treatment } : {}),
      ...(gateF.next ? { next: gateF.next } : {}),
      headline: readOver
        ? `Assistants search "${row.query}" and read ${path} without crediting it`
        : unreachF
          ? `Assistants search "${row.query}" and none reports reading ${path}; make it the page they reach`
          : `Assistants search "${row.query}" and rely on other sites; ${path} is not among the sources they report`,
      before: null,
      after: `${OBS[stage]} ${gateF.work}`,
      why: `${count(row.executions, "stored answer")} ran the search "${row.query}" while answering ${count(row.parents.length, "tracked question")}: it ${row.materialBecause}. ${rival ? `${rival.url} is credited on ${rival.answers} of those answers.` : "No page is credited on it often enough to name a leader."} ${gateF.diagnosis ? gateF.diagnosis.explanation : "Whether this page already answers it is read from its complete stored copy before any change is ordered."}`,
      steps: copyF.steps,
      hints: [`Assistants ran this search themselves: ${row.materialBecause}`,
        ...(row.variants.length > 1 ? [`Wordings collapsed onto one search: ${variants.slice(0, 4).map((v) => `"${v}"`).join(", ")}`] : []),
        `Behind ${row.parents.slice(0, 2).map((pr) => `"${plain(pr.promptText)}"`).join(" and ")}${row.parents.length > 2 ? ` and ${count(row.parents.length - 2, "more question")}` : ""}`,
        ...(rival ? [`${rival.url} is credited on ${count(rival.answers, "answer")} that ran it`] : []),
        ...(readOver ? [`A page here was read for it and passed over ${count(row.retrievedNotCitedAnswers, "time")}`] : []),
        ...(gateF.diagnosis ? [`Beacon's own reading of the complete stored page: ${gateF.diagnosis.explanation}`] : []),
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
        explanation: `${count(row.executions, "stored answer")} across ${count(row.days, "day")} and ${count(row.engines.length, "assistant")} ran the search "${row.query}" while answering ${count(row.parents.length, "tracked question")}. ${readOver ? `${path} was read on ${row.retrievedNotCitedAnswers} of those answers and credited on none of them, so the page is reachable; why the credit went elsewhere is decided by the whole-page reading, never assumed.` : unreachF ? `No stored answer reports reading ${path} for it, so before wording matters the page has to be one the assistants reach at all.` : `The sources relied on for it are other sites, and these instruments do not report what they read, so absence from the reading is not shown; absence from the credit is.`}`,
        competingExplanations: [readOver
          ? { cause: "ai_citation_gap" as const, reason: "the retrieval record rules out index absence: the engine reports fetching this page and credited another source, and why it chose the other source is what the whole-page reading decides" }
          : unreachF
            ? { cause: "technical_indexability" as const, reason: "no stored answer reports retrieving this page for this search, so an access problem is not ruled out until a fetch is on file" }
            : { cause: "technical_indexability" as const, reason: "these instruments do not report retrieval, so an access problem is neither shown nor ruled out by anything on file" }],
        notConsidered: [{ cause: "intent_shift" as const, missing: "no results page for this search is on file, so whether searchers want a different shape of answer is not decided here" }],
        falsifier: "If a newly stored answer credits this page on this search before anything ships, the gap was already closing and this card retires itself." },
      minutes: 30, confidence: row.days >= 3 && row.engines.length >= 2 ? "medium" : "low", refs: row.executions,
      limitation: FANOUT_LINKAGE_CAVEAT,
    });
    if (!gateF.hire) holdIds.add(`${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap`);
    byPage.set(path, out.length - 1);
    claimed.add(row.key);
    noteCase(row, "actionable", `${row.materialBecause}. A change is open for it on ${path}.`,
      { pageUrl: fit.match.page.url, stage, proposalId: `${tenantId}::${path.toLowerCase()}::existing_edit::ai_answer_gap`, ...(gateF.diagnosis ? { diagnosis: gateF.diagnosis } : {}) });
  }
  // FILED ONCE, AT THE END, so a surface reads what this pass concluded instead of guessing it again. A pass that persists nothing files nothing: a dry run must never leave a verdict on disk for a screen to read. A CONCLUSION THAT IS NOT ON RECORD IS NOT A CONCLUSION. When the file could not be written, this pass may not be treated as having rewritten its family in full: the sweep behind it would then retire cards on the strength of a pass whose verdicts nothing can read back. AND A PASS THAT NEVER SAW THE WINDOW DECIDED NOTHING WORTH KEEPING. With the 28 day read failed or empty, every verdict above was reached blind: recurrence at zero, every fan-out invisible. Filing those rows would overwrite real verdicts with blindness, and reporting filed:true would authorize the sweep to retire cards on the strength of a read that never happened. So the pass keeps its drafts, files nothing, leaves an unavailable receipt in the log, and the family is held exactly as an unwritable store holds it.
  if (windowObs == null) {
    log.warn("[ai-cases] the stored AI window could not be read, so nothing is filed and nothing behind it is swept", { tenantId, decidedUnfiled: decided.length });
    return { drafts: out, filed: false, hold: holdIds };
  }
  const write = persist ? await recordAiCaseDispositions(tenantId, decided) : { filed: true as const };
  if (!write.filed) log.warn("[ai-cases] this pass decided these searches and could not file the decision, so it does not claim to have finished", { tenantId, reason: write.reason, decided: decided.length });
  // WHAT EVERY OTHER MATERIAL SEARCH BECAME, counted by state. Silence here would be the old defect wearing a
  // new coat: a search that reached no card and no debt has to be nameable, and it is.
  if (Object.keys(states).length > 0) log.info("[ai-cases] every search the assistants ran, by where it ended up", { tenantId, ...states });
  return { drafts: out, filed: write.filed, hold: holdIds };
}
/** ONE test surface for the copy layer: every derivation pinned through one export. */
export const AI_CASE_COPY = { caseCopy, intentOf, readableSubject, gateOf, diagnoseGap, aeoMeter } as const;
