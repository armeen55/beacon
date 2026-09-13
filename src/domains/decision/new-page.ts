import "server-only";
import { dayLabel } from "@/lib/presenter";

/** Earned new pages use the canonical editor, validator and store. Partial pages resume from banked pieces. */

import { log } from "@/lib/logger";
import { CURRENT_CLAIM } from "@/lib/constants";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { answerIntelFacts } from "@/domains/evidence/answer-intel"; import { comparisonObservations, jobComparison, type JobComparison } from "@/domains/evidence/comparison"; import { authorizedCorrections, readFactChecks } from "@/domains/evidence/pages/fact-checks"; import type { EvidenceRequirement } from "./producers/contract";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { PageCoverageReading } from "@/domains/evidence/page-intersection";
import { AUTOPUBLISH_RE, COPY_RULES, HOST_RE } from "./copy-sanitize";
import { earnedNewPage, type CoverageDecision } from "./coverage-adjudication";
import type { DecidedTopic } from "./coverage-pass";
import type { OwnedCandidate } from "./owned-coverage";
import { callStructuredLLM } from "./llm/structured-drafter"; import { DRAFT_BUDGET } from "./draft-budget";
import { draftFieldForPage, reviewFinishedCopy } from "./drafted-copy";
import { loadOwnedPageBodies, type OwnedPageBody } from "@/domains/evidence/pages/owned-context";
import { copyKey, evidenceShortfall, REVIEW_CONTRACT } from "./proof"; import { nextObligation } from "./obligation";
import type { NewPageBrief } from "./llm/schemas";
import type { BundleComponent, BundleEvidenceItem, ChangeBundle, ChangeProposal } from "./contracts";
import { effortForFamily } from "./contracts";
import { assembleCopy } from "./assemble-copy";
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
/** NO SCHEMA IS DERIVED: recommending Article or FAQPage off the draft's own shape is a guess wearing a standard's name. Structured data returns when the evidence speaks to eligibility. */
/** Any written figure: a count, a money amount, a percentage, a year. */
const FIGURE_RE = /\d[\d,.]*%?/g;
/** Verdict pattern ids are reused; the investigation's evidence is rebuilt only once. */
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
  const shared = (d.evidence ?? []).filter((e) => PATTERN_KEY.test(e.id)).map((e) => e.fact.trim()).filter(Boolean);
  if (shared.length > 0) add("pattern", "winning_page", shared.join(" "), null);
  const fans = inv.fanOuts.filter((f) => !!f.query.trim());
  const asked = inv.trackedPrompts.map((p) => p.promptText.trim()).filter(Boolean);
  const quote = fans.find((f) => !CURRENT_CLAIM.test(f.query)) ?? fans[0];
  if (quote != null) add("asked", "ai_observation", `To answer this, an AI engine went and searched ${num(fans.length)} ${fans.length === 1 ? "thing" : "things"} of its own, like "${quote.query.trim()}".`, quote.observedAt, { observationId: quote.observationId });
  else if (asked.length > 0) add("asked", "ai_observation", `No AI engine has shown a search of its own here. What is on file is a question people ask, like "${asked[0]}".`, null);
  const said = answerIntelFacts(inv.answerIntel);
  for (const f of said.facts) add(f.key, "ai_observation", f.fact, f.observedAt, f);
  if (inv.trackedPrompts.length === 0) missing.push("No tracked AI engine has been asked about this, so how assistants answer it today is unknown.");
  if (said.withheld) missing.push(said.withheld);
  return { items, missing };
}

/** Build ONE researched new page from an EARNED verdict, or hand back the honest reason nothing was built. `none` is a real answer and costs nothing. */
export async function buildNewPageProposal(decided: DecidedTopic, tenantId: string, opts: ProposeOptions & { /** THE PAGES THAT WIN THESE SEARCHES, as the pass already holds them, so the writer of a section this account has no page for is handed the same reading the writer of an existing page's section gets. Absent means nobody has read them, and unknown is never absence. */ research?: Parameters<typeof jobComparison>[0]; /** THE HALF WRITTEN PAGE THIS TOPIC ALREADY HAS ON FILE, when the last pass could not finish it: its brief and every piece already written, so this pass buys only what is still owed. */ held?: ChangeProposal | null } = {}): Promise<NewPageOutcome> {
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
  const ownedByKey = new Map(owned.map((c) => [canonicalUrlKey(c.url), c]));
  const askedQuestions = new Map<string, string>();
  for (const q of [...inv.fanOuts.map((f) => f.query), ...inv.trackedPrompts.map((p) => p.promptText)]) if (q.trim()) askedQuestions.set(norm(q), q.trim());
  const questions = new Map(askedQuestions);
  for (const q of [...(reading?.shared ?? []).map((s) => s.keyword), ...inv.queries]) if (q.trim()) questions.set(norm(q), q.trim());
  const hosts = new Set([...inv.winners.map((w) => w.domain), ...inv.resultDomains, ...owned.map((c) => publisherHost(c.url)),
    ...[...questions.values(), ...inv.queries].flatMap((q) => q.match(HOST_RE) ?? [])].map(norm).filter(Boolean));
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

  const spent = (): boolean => !!opts.attempts && (opts.attempts.left -= 1) < 0;
  /* THE BRIEF IS BOUGHT ONCE FOR THIS PAGE (production, topic inv_3446de602284, 2026-09-06). A pass that planned the page and could not finish it keeps the plan on its own row, so the next pass reads it back instead of paying for the same outline again and the whole twelve-call allowance goes to the sections that are still owed. A STORED PLAN IS NEVER TRUSTED FOR BEING STORED: it goes through every refusal below exactly as a freshly bought one does. */
  const stored = opts.held?.newPageDraft ?? null;
  if (!stored && spent()) { log.info("[new-page] the pass has spent its whole attempt budget, so no brief was bought", { tenantId, topicKey: inv.key }); return { status: "none", reason: "This pass has spent its whole attempt budget, so this page was not written for yet." }; }
  const call = stored ? null : await callStructuredLLM({
    kind: "new_page_brief", tenantId, system: SYSTEM, user, grounded: facts.join(" "),
    projectedCostUsd: 0.03, maxTokens: 2600, complete: opts.complete, now, bypassCache: opts.bypassCache,
  }); if (call) { opts.attempts?.record?.(call); DRAFT_BUDGET.refundIfNoCallMade(opts.attempts, call); } /* real requests and real dollars onto this page's own allowance, and the attempt back when the brief was served from the cache */
  if (call && call.status !== "drafted") { log.warn("[new-page] no usable brief", { tenantId, topicKey: inv.key, status: call.status }); return { status: "none", reason: `The brief call for this page came back ${call.status}${(call as { errors?: readonly string[] }).errors?.length ? ` (${(call as { errors?: readonly string[] }).errors!.slice(0, 2).join("; ").slice(0, 200)})` : ""}, so nothing is handed over rather than filler.` }; } /* the receipt says WHICH door failed (production 06:10Z, 2026-09-11): the standard sentence hid a transport or schema failure at the brief call behind quality words */
  const v = { ...(stored ? stored.brief : call!.value) } as NewPageBrief;

  const fig = (t: string): string[] => (t.match(FIGURE_RE) ?? []).map((f) => f.replace(/[.,]+$/, ""));
  const figures = new Set(fig([...facts, ...(stored?.pieces ?? []).flatMap((p) => p.supportFacts).filter((f) => /^fact-|^owned-page/.test(f.id)).map((f) => f.fact)].join(" ")));
  const own = String(v.sections.length);
  for (const s of v.sections) s.heading = s.heading.replace(/^\s*\d{1,2}[.)]\s*/, "");
  const lead = v.proposedTitle.match(/^(?:the\s+)?(\d{1,2})\b/i) ?? v.proposedTitle.match(/\bthe\s+(\d{1,2})\s/i);
  if (lead && lead[1] !== own && !figures.has(lead[1])) {
    const echo = new RegExp(`\\b${lead[1]}\\b`, "g");
    v.proposedTitle = v.proposedTitle.replace(echo, own);
    v.metaDescription = v.metaDescription.replace(echo, own);
    v.openingAnswer = v.openingAnswer.replace(echo, own);
  }

  const prose = [v.proposedTitle, v.metaDescription, v.openingAnswer, v.whyExistingPagesLose,
    ...v.sections.flatMap((s) => [s.heading, s.covers]), ...v.sourceRequirements, ...v.factRequirements,
    ...v.internalLinks.map((l) => l.anchor), ...v.faqQuestions].join(" ");
  const strayHost = (prose.match(HOST_RE) ?? []).map(norm).filter((h) => !COPY_RULES.codeSuffix.test(h)).find((h) => !hosts.has(h) && !hosts.has(publisherHost(h)));
  const proseBody = [v.whyExistingPagesLose, ...v.sections.flatMap((s) => [s.heading, s.covers]),
    ...v.sourceRequirements, ...v.factRequirements, ...v.internalLinks.map((l) => l.anchor), ...v.faqQuestions].join(" ");
  const measured = (f: string): boolean => f.includes("%") || /[.,]/.test(f) || Number(f) > 10; /* ship mode (operator, 2026-09-10): the researched hardest-languages page was thrown away every drive for "quoted 1", its own rank phrasing; a bare small integer is list structure, not a measurement, and only a measured figure must trace to the evidence */
  const structural = fig([v.proposedTitle, v.metaDescription, v.openingAnswer].join(" ")).find((f) => measured(f) && !figures.has(f) && f !== own);
  const strayFigure = fig(proseBody).find((f) => measured(f) && !figures.has(f)) ?? structural;
  const headings = v.sections.map((s) => norm(s.heading));
  const offTopic = v.sections.filter((s) => !topicTokens(`${s.heading} ${s.covers}`).some((t) => subject.has(t))).length * 2 > v.sections.length;
  const badLink = v.internalLinks.find((l) => !ownedByKey.has(canonicalUrlKey(l.url)));
  const badQuestion = v.faqQuestions.find((q) => !questions.has(norm(q)));
  const cite = (ks: readonly string[]): string[] => ks.filter((k) => keys.has(k));
  const metaTitle = /\b(lists?|pages?|sections?|outlines?|guides?)\b[^,]*\b(must|should|needs?)\b|\bthings? (?:a|an|every|the)\b[^,]*\b(lists?|pages?)\b/i.test(v.proposedTitle);
  const refusal =
    metaTitle ? "wrote a title about the page itself rather than the topic"
      : cite(v.headKeys).length === 0 || v.sections.some((s) => cite(s.evidenceKeys).length === 0) ? "wrote a section it could not point at one piece of the evidence for"
      : strayHost ? "named a website it was never shown"
        : strayFigure ? `quoted ${strayFigure}, which is a figure it was never given`
        : badLink ? "linked to a page of yours it was never given"
          : badQuestion ? "answered a question nobody has actually asked"
              : offTopic ? "wrote an outline that would fit any subject"
                : new Set(headings).size !== headings.length ? "repeated the same section twice"
                    : COPY_RULES.proportion.test(prose) ? "wrote out a proportion nothing measured"
                      : AUTOPUBLISH_RE.test(prose) ? "wrote as though something here goes live by itself"
                      : null;
  if (refusal) {
    log.warn("[new-page] brief disagrees with the evidence", { tenantId, topicKey: inv.key, refusal });
    return { status: "none", reason: `The page drafted for "${inv.label}" ${refusal}, so it was thrown away rather than handed over.` };
  }

  // Banked source-bound pieces resume independently; the outline is never published as copy.
  const bankedBodies = await loadOwnedPageBodies(tenantId, owned.map((c) => c.url)).catch(() => new Map<string, OwnedPageBody>());
  const qualified = Object.fromEntries(owned.map((c) => ({ c, text: bankedBodies.get(canonicalUrlKey(c.url))?.passages.join("\n\n") || c.openingSample || "" })).filter(({ text }) => text.trim()).slice(0, 4).map(({ c, text }, i) => [`owned-page-${i + 1}`, `${c.path}: ${text}`]));
  const outline = v.sections.map((s) => s.heading); let openingCopy = v.openingAnswer;
  type Piece = NonNullable<ChangeProposal["newPageDraft"]>["pieces"][number]; // WHAT A FINISHED PIECE OF THIS PAGE IS, in exactly the shape the row keeps it in: the words, the claims, the sources behind them and the ruling each one got.
  const kept = [...(stored?.pieces ?? [])] as Piece[], metadata = [...(stored?.metadata ?? [])], made = new Map<string, Piece>(kept.slice(1).map((a) => [norm(a.heading ?? ""), a] as const)); const written = (): string[] => v.sections.map((s) => made.get(norm(s.heading))).filter((a): a is Piece => !!a).map((a) => `${(a.heading ?? "").trim()}\n\n${a.after}`.replace(/[–—]/g, " "));
  if (kept[0]) openingCopy = kept[0].after;
  const soFar = (): OwnedPageBody => ({ url: owned[0]?.url ?? `https://${inv.key}`, title: v.proposedTitle, h1: v.proposedTitle, metaDescription: v.metaDescription,
    headings: [v.proposedTitle, ...v.sections.filter((s) => made.has(norm(s.heading))).map((s) => s.heading)], passages: [openingCopy, ...written()], openingSample: openingCopy, vocabulary: "", cardTexts: [], faqs: [],
    entityNames: [], internalLinks: [], fetchedAt: now.toISOString(), completeness: "complete", contentHash: null, heldNote: "This page does not exist yet; these are the words drafted for it so far." });
  const seen = (body = soFar()): JobComparison | null => opts.research ? jobComparison(opts.research, inv.queries, { url: body.url, text: [body.title ?? "", ...body.passages].join(" "), headings: body.headings, passages: body.passages }, undefined, inv.demandBasis === "ai" ? "aeo" : "seo") : null;
  /* AND THE READINGS THIS ACCOUNT HAS ALREADY BOUGHT FOR WHAT IT CANNOT ANSWER: statements carrying no wording of their own (an answer no page of this account holds), checked and confirmed, through the ONE authorization rule every other consumer applies. A page that does not exist yet has no version for a fact to be bound to, so that conjunct is not asked and is not pretended, exactly as the AI-case door already asks it of a missing answer. */ const home = owned.find((c) => c.bodyHeld) ?? owned[0] ?? null; /* WHERE A PROPOSITION FOR THIS SUBJECT IS INVENTORIED: the account's own page the coverage read named, because a proposition is seeded against a page whose words are on file and a page that does not exist yet has none. The information really is missing from this account, which is the whole reason a new page was earned. */
  const readings = home ? authorizedCorrections((await readFactChecks(tenantId, home.path).catch(() => [])).filter((f) => f.current.trim() === ""), undefined, tenantId) : []; const about = (heading: string, text: string): boolean => { const ask = topicTokens(heading), bag = new Set(topicTokens(text)); return ask.length > 0 && ask.filter((w) => bag.has(w)).length * 3 >= ask.length * 2; }; /* two thirds of a heading's own content words, the share `evidence/comparison` already asks of a passage before it calls it an answer to a search */
  const factsFor = (heading: string) => readings.filter((f) => about(heading, `${f.subject} ${f.proposed ?? ""}`)).slice(0, 4);
  const whyRefused = new Map<string, string>(); /* every piece's refusal, finally kept: the receipt names them instead of "0 of N sections written" */
  const write = (heading: string, covers: string, checked: typeof readings, c: JobComparison | null): Promise<Piece | null> =>
    draftFieldForPage({ field: "answer_block", body: soFar(), query: inv.label, ownedPaths: owned.map((c) => c.path), minutes: 15, evidenceHints: facts, facts: qualified, checked, unpublished: true, comparison: c, refusalKey: heading, /* THE OPENING THIS MODEL JUST WROTE IS NOT A READING OF A PAGE (probe, 2026-09-05): `soFar` is the outline model's own opening plus this page's earlier drafted sections, and it entered the next section's packet as `page-copy-N`, which every gate reads as words observed on a live page. It rides as generated draft context now, so it can still be seen and can never be cited as the page's own. */
      brief: `Write the section headed "${heading}". ${covers} Write no figure that is not in the evidence you were given, including a list length such as 5 or 10: name the items without counting them.` },
    { tenantId, now, complete: opts.complete, bypassCache: opts.bypassCache, refusals: whyRefused, ...(opts.attempts ? { attempts: opts.attempts } : {}) });
  const repair = opts.held && stored?.repair?.of === copyKey(opts.held) ? stored.repair : null, remaining = [...(repair?.targets ?? [])]; let repairAttempted = false;
  if (repair) {
    if (nextObligation(opts.held!)?.kind === "terminal") return { status: "built", proposal: { ...opts.held!, status: "needs_review" } };
    const parts = opts.held!.bundle?.components ?? [], valid = /^(structural_synthesis|use_stored_verified_evidence)$/.test(repair.resolution) && remaining.length > 0 && new Set(remaining.map((t) => t.component)).size === remaining.length && remaining.every((t) => t.component >= 0 && Number.isInteger(t.component) && parts[t.component]?.kind === (t.component === 0 ? "title" : t.component === 1 ? "meta" : t.component === 2 ? "opening_answer" : "section") && t.component < kept.length + 2 && (t.component < 3 || norm(parts[t.component]!.label) === norm(kept[t.component - 2]?.heading ?? "")));
    if (!valid) return { status: "built", proposal: { ...opts.held!, status: "needs_review" } };
    for (const target of [...remaining]) {
      if (opts.attempts && opts.attempts.left < 1) break;
      const n = target.component, part = parts[n]!, body = soFar(), old = n >= 2 ? kept[n - 2] : null, heading = n > 2 ? old!.heading! : v.proposedTitle;
      body.passages = body.passages.filter((p) => p !== old?.after && p !== `${old?.heading}\n\n${old?.after}`); if (n === 2) body.openingSample = "";
      const banked = (opts.held!.supportFacts ?? []).filter((f) => /^(fact-|owned-page-)/.test(f.id)), before = opts.attempts?.left;
      const done = await draftFieldForPage({ field: n === 0 ? "title" : n === 1 ? "meta" : "answer_block", body, query: inv.label, ownedPaths: owned.map((c) => c.path), minutes: 15, evidenceHints: facts, facts: banked.length ? {} : qualified, banked, unpublished: true, comparison: seen(body), refusalKey: String(n), brief: `${n >= 2 ? `Write the section headed "${heading}". ` : ""}Revise only this ${part.kind}, not the rest of the page. Previous copy: ${part.after}. Required repair: ${target.instruction}. Use the banked source evidence; never publish these instructions or add unsupported claims.` }, { tenantId, now, complete: opts.complete, bypassCache: opts.bypassCache, refusals: whyRefused, attempts: opts.attempts });
      repairAttempted ||= !!done || (before != null && opts.attempts!.left < before); if (!done) break;
      const piece: Piece = { ...done, heading: n > 2 ? old!.heading : done.heading };
      if (n < 2) { const at = metadata.findIndex((m) => m.component === n); if (at >= 0) metadata[at] = { component: n, piece }; else metadata.push({ component: n, piece }); if (n === 0) v.proposedTitle = done.after; else v.metaDescription = done.after; }
      else { kept[n - 2] = piece; if (n > 2) made.set(norm(old!.heading!), piece); else openingCopy = done.after; }
      remaining.splice(remaining.findIndex((t) => t.component === n), 1);
    }
  }
  const first = kept[0] ?? await write(v.proposedTitle, `Answer "${inv.label}" outright in the first lines a reader sees. The planning opening is context, never a source: "${v.openingAnswer}". Verify it against the banked readings and refine it to fit.`, readings, seen()); if (first) openingCopy = first.after; const owedSource: string[] = [];
  for (const s of v.sections) { if (!first) break; if (made.has(norm(s.heading))) continue; // ONE BUDGET LINE, NOT TWO: the canonical editor decrements the pass's own allowance before every charged call and refuses on it, so the extra bookkeeping decrement this loop used to make for the second drafter now just burns a call nobody spends. An exhausted budget leaves a partial draft, which the shortfall check below refuses whole.
    const c = seen(), fx = factsFor(s.heading), obs = c ? comparisonObservations(c) : []; /* A SECTION IS WRITTEN OFF SOMETHING OR IT IS RESEARCHED, NEVER GUESSED AT. Where the winners of these searches WERE read and they carry nothing this page does not already plan, and no checked reading speaks to this heading either, there is nothing for a writer to say that the plan does not already say: no call is made, and the heading is filed below as the proposition to go and source. Where nobody has read a winner at all the comparison is unread, unknown is not absence, and the section is written on what this account's own pages carry, exactly as before. */ if (obs.length === 0 && fx.length === 0 && (c?.winners ?? []).some((w) => w.read)) { owedSource.push(s.heading); continue; }
    const done = await write(s.heading, s.covers, fx, c); if (!done) break; made.set(norm(s.heading), done); }
  const pieces: Piece[] = first ? [first, ...v.sections.map((s) => made.get(norm(s.heading))).filter((a): a is Piece => !!a)] : [], body = written();
  if (body.length < outline.length) { const owed = outline.filter((h) => !made.has(norm(h))); log.warn("[new-page] partial draft, nothing proposed", { tenantId, topicKey: inv.key, owed: owed.length, unsourced: owedSource.length });
    const need: EvidenceRequirement | null = owedSource.length > 0 && home ? { kind: "factual_source", query: `${owedSource[0]} ${inv.label}`.slice(0, 120), url: home.url, reasonCode: "new_page_section_unsourced", missingTopic: owedSource[0]! } : null;
    return { status: "built", proposal: { id: `${tenantId}::${inv.key}::new_page::bundle`, tenantId, kind: "new_page", changeFamily: "new_page", publish: "manual", pagePath: null, pageUrl: null, pageLabel: v.proposedTitle, primaryQuery: inv.label, opportunityType: "Cover a subject you have no page for", status: "needs_review", researchOnly: true, treatment: "new_page", obligation: need ? { kind: "evidence", need } : { kind: "sections", owed: owed.length }, research: need ? { missing: `Nothing checked stands behind ${num(owedSource.length)} of the ${num(outline.length)} sections this page needs: ${owedSource.join(", ")}.`, next: `A source is being read for "${owedSource[0]}", and that section gets written once it lands.` } : { missing: `${num(owed.length)} of the ${num(outline.length)} sections this page needs are not written yet: ${owed.join(", ")}.`, next: `The next pass writes "${owed[0]}", and what is already written costs nothing a second time.` }, recommendedChange: { kind: "new_page", proposedTitle: v.proposedTitle, metaDescription: v.metaDescription, openingAnswer: openingCopy, outline, faqQuestions: v.faqQuestions, schemaTypes: [] }, whyItMatters: `${decision.explanation} ${num(body.length)} of its ${num(outline.length)} sections are written and kept, ${need ? "and the rest wait on a source." : "and the rest are written on the next pass."}`, estimatedEffortMinutes: effortForFamily("new_page"), operatorSteps: [need ? "Nothing to do yet: a source is being read for the sections that still owe one" : "Nothing to do yet: the remaining sections are written on the next pass"], riskLevel: "low", confidence: "medium", limitations: [...new Set([...missing, ...(need ? owedSource.map((h) => `Nothing checked stands behind "${h}" yet, so it is being sourced before it is written.`) : owed.map((h) => `"${h}" is not written yet, and it is written on the next pass.`))])], evidence: { query: inv.label, hints: [...facts.slice(0, 5), ...[...questions.values()].slice(0, 8)], evidenceRefCount: items.length }, impactScore: null, upsidePerMonth: null, createdAt: now.toISOString(), newPageDraft: { brief: v as unknown as Record<string, unknown>, pieces } } }; }

  const schemaTypes: string[] = []; // NO SCHEMA IS DERIVED (see above): none, not a guess.
  const core = cite(v.headKeys);
  const sectionKeys = [...new Set(v.sections.flatMap((s) => cite(s.evidenceKeys)))];
  const components: BundleComponent[] = [
    { kind: "title", label: "Page title", before: null, after: v.proposedTitle, evidenceKeys: core, risk: "safe" },
    { kind: "meta", label: "Meta description", before: null, after: v.metaDescription, evidenceKeys: core, risk: "safe" },
    { kind: "opening_answer", label: "Opening answer", before: null, after: openingCopy, evidenceKeys: core, risk: "review" },
    ...pieces.slice(1).map((piece): BundleComponent => ({ kind: "section", label: piece.heading!, before: null, after: `${piece.heading}\n\n${piece.after}`, evidenceKeys: sectionKeys, risk: "review" })),
  ];
  if (v.internalLinks.length > 0) {
    components.push({ kind: "internal_links", label: "Link to these pages of your own", before: null,
      after: v.internalLinks.map((l) => `${l.anchor} -> ${ownedByKey.get(canonicalUrlKey(l.url))!.path}`).join("\n"),
      evidenceKeys: [...core, ...[...keys].filter((k) => k.startsWith("owned"))], risk: "safe" });
  }
  const { claims, review: ruled, supportFacts, gain, editor } = assembleCopy(components, [...metadata.map((m) => ({ copy: m.piece, index: m.component })), ...pieces.map((copy, n) => ({ copy, index: n + 2 }))]);
  const sourcePack = claims.map((claim) => `${claim.text}\n${claim.supportedBy.map((id) => { const f = supportFacts.find((fact) => fact.id === id); return `${f?.fact ?? "Source not banked"}${f?.sources?.length ? `\n${f.sources.map((s) => `${s.url} (${s.kind})`).join("\n")}` : ""}`; }).join("\n")}`).join("\n\n");
  if (sourcePack) components.push({ kind: "source_pack", label: "Evidence behind the claims", before: null, after: sourcePack, evidenceKeys: core, risk: "review" });
  const shared = reading?.shared.length ?? 0;
  const dates = items.map((i) => i.observedAt).filter((d): d is string => !!d).sort();
  const bundle: ChangeBundle = {
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
      "Read every line and check its linked evidence before it goes out. You publish manually; Beacon only drafts it.",
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
      openingAnswer: openingCopy, outline, faqQuestions: v.faqQuestions, schemaTypes },
    whyItMatters: `${decision.explanation} You write and publish it yourself; measurement starts once you say it is live.`,
    estimatedEffortMinutes: effortForFamily("new_page"),
    operatorSteps: ["Create a new page in your site editor and give it the title above",
      "Paste the opening answer, then each section in the order it is written, under its own heading",
      "Check the evidence behind the claims and add the cited links in your site editor",
      "Publish it, then come back here with its address and mark it done, and measurement starts"],
    riskLevel: "low",
    confidence: "medium",
    limitations: [...new Set(missing)],
    evidence: { query: inv.label, hints: [...facts.slice(0, 5), ...[...questions.values()].slice(0, 8)], evidenceRefCount: items.length },
    impactScore: null, upsidePerMonth: null, bundle, createdAt: now.toISOString(), newPageDraft: { brief: v as unknown as Record<string, unknown>, pieces, ...(metadata.length ? { metadata } : {}) },
    ...(claims.length > 0 ? { claims, supportFacts } : {}), ...(gain ? { informationGain: gain } : {}),
  };
  const verdict = validateProposal(proposal, { evidenceText: [...facts, ...questions.values(), ...supportFacts.filter((f) => /^fact-|^owned-page/.test(f.id)).map((f) => f.fact)].join(" "), now });
  const row: ChangeProposal = { ...proposal, ...(opts.held?.previousCopy ? { previousCopy: opts.held.previousCopy } : {}), ...(ruled.length > 0 ? { semanticReview: { editor, of: copyKey(proposal), version: REVIEW_CONTRACT, claims: ruled } } : {}), limitations: [...new Set([...proposal.limitations, ...verdict.reasons])] };
  if (repairAttempted) row.previousCopy = { after: opts.held!.bundle!.components.filter((p) => /^(title|meta|opening_answer|section)$/.test(p.kind)).map((p) => p.after).join("\n\n"), retiredBecause: opts.held!.faults?.[0] ?? repair!.targets[0]!.instruction, at: now.toISOString(), attempts: (opts.held!.previousCopy?.attempts ?? 0) + 1 };
  if (repair && remaining.length) row.newPageDraft = { ...row.newPageDraft!, repair: { ...repair, of: copyKey(row), targets: remaining } };
  if (verdict.verdict === "rejected") {
    log.warn("[new-page] brief failed the one validator", { tenantId, topicKey: inv.key, reasons: verdict.reasons.slice(0, 3),
      title: v.proposedTitle, sections: v.sections.length,
      where: [proposal.whyItMatters, ...bundle.components.map((c) => `${c.kind}: ${c.after}`), ...bundle.risks]
        .filter((t) => /\b5\b/.test(t)).map((t) => t.slice(0, 220)).slice(0, 3) });
    return { status: "built", proposal: { ...row, faults: verdict.reasons } };
  }
  if (repair && remaining.length) return { status: "built", proposal: { ...row, faults: opts.held!.faults, limitations: [...new Set([...row.limitations, ...opts.held!.limitations])] } };
  const heldReview = opts.held?.semanticReview;
  const reviewed = heldReview?.scope === "whole_page" && heldReview.of === copyKey(row) && heldReview.version === REVIEW_CONTRACT && COPY_RULES.accepted(heldReview.editor)
    ? { row: { ...row, semanticReview: heldReview }, detail: "Unchanged whole-page acceptance reused." }
    : await reviewFinishedCopy(row, { tenantId, now, attempts: opts.attempts, complete: opts.complete, bypassCache: opts.bypassCache });
  const final = reviewed.row ?? row, short = evidenceShortfall(final);
  return { status: "built", proposal: { ...final, status: !!short || verdict.verdict !== "ready" ? "needs_review" : "ready",
    ...(short ? { limitations: [...new Set([...final.limitations, short])] } : {}) } };
}
