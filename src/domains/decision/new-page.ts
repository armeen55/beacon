import "server-only";

/**
 * decision/new-page (N4, 2026-07-28): the ONE builder of a researched new page, and the only
 * thing on the far side of an EARNED create_new verdict. It writes nothing off a keyword, a
 * tracked question, a competitor's page, an engine's fan-out or a search volume: the ONLY
 * door in is `earnedNewPage(decision)`, which the coverage ladder opens exclusively when the
 * page by page comparison proved the winners share searches this account reaches on no page
 * of its own. Turning a rival's example prompt into an article is what shipped duplicates of
 * pages the account already owned, and that door stays shut.
 *
 * ONE bundle through the EXISTING pipeline: a ChangeProposal carrying a ChangeBundle, the
 * same record, validator, ranker, persistence and Changes surfaces an existing-page repair
 * uses. No second queue, schema, status vocabulary or drafting framework exists here.
 *
 * ONE strict model call, AFTER the verdict. It writes the page's own words and its section
 * plan; it can neither decide that the page should exist nor change what wins here, because
 * no field in its schema carries a verdict, a shape or an intent. Then every claim is checked
 * back against what was supplied, and the WHOLE draft is refused when the model invents a
 * number, an address, a publisher or a question, turns one tracked question into the page,
 * writes an outline that would fit any topic, skips why the pages this account already owns
 * lost, cites an evidence id nobody gave it, or promises to put anything live.
 */

import { log } from "@/lib/logger";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { TopicInvestigation } from "@/domains/evidence/topic-investigation";
import type { PageCoverageReading } from "@/domains/evidence/page-intersection";
import { AUTOPUBLISH_RE, CODE_SUFFIX, HOST_RE, SPELLED_PROPORTION_RE } from "./copy-sanitize";
import { earnedNewPage, type CoverageDecision } from "./coverage-adjudication";
import type { DecidedTopic } from "./coverage-pass";
import type { OwnedCandidate } from "./owned-coverage";
import { callStructuredLLM } from "./llm/structured-drafter";
import type { NewPageBrief } from "./llm/schemas";
import type { BundleComponent, BundleEvidenceItem, ChangeBundle, ChangeProposal } from "./contracts";
import { effortForFamily } from "./contracts";
import { validateProposal } from "./validate-proposal";
import type { ProposeOptions } from "./propose";

export type NewPageOutcome = { status: "built"; proposal: ChangeProposal } | { status: "none"; reason: string };

const num = (n: number): string => n.toLocaleString("en-US");
const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "a day I did not record");
const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
/** What the pages that win here ARE, in words an operator reads. */
const SHAPE: Record<string, string> = { informational_guide: "a guide that explains the subject", list: "a list", definition: "a short definition",
  comparison: "a comparison", product: "a product page", category: "a category page", tool: "a tool people use", forum: "a discussion thread" };
/** Structured data is warranted by the SHAPE that actually wins, never by taste. A shape
 *  whose winners carry no agreed markup gets none rather than a guess. */
/** NO SCHEMA IS DERIVED. Recommending Article because a page explains something, or FAQPage
 *  because the draft happens to contain questions, is a guess wearing a standard's name, and
 *  the blanket FAQPage recommendation was already removed once for exactly that reason. A page
 *  may carry questions without earning FAQPage. Structured data returns when the evidence
 *  actually speaks to eligibility, which nothing on file does today. */
/** Any written figure: a count, a money amount, a percentage, a year. */
const FIGURE_RE = /\d[\d,.]*%?/g;

const SYSTEM = [
  "You write ONE page brief for a page that does not exist yet. The decision that this page should exist is already made and is not yours to revisit.",
  "Write in plain business English a page's own reader would understand. First person only where the brief speaks to the site owner.",
  "Rules you may not break.",
  "1. Use ONLY the facts below. Never add a number, a percentage, a date, a web address, a publisher, a search phrase or a claim that is not written there.",
  "2. Every evidence id you cite must be copied exactly from EVIDENCE. Every address in internalLinks must be copied exactly from OWN PAGES. Every question in faqQuestions must be copied exactly from OBSERVED QUESTIONS.",
  "3. Leave internalLinks or faqQuestions empty when the supplied lists do not honestly support them. An empty list is a correct answer.",
  "4. Every section heading must be specific to this topic. A heading that would fit any subject is a failure.",
  "5. whyExistingPagesLose must name at least one of the OWN PAGES addresses and say plainly why strengthening it is not the answer.",
  "6. Never promise to put anything live, publish anything, or do anything to the site yourself. The site owner writes and publishes this page.",
  "7. No em dash and no en dash. Never use the words experiment, control, baseline, treatment or SERP.",
].join("\n");

/** The evidence this brief may cite, each id paired with the plain fact behind it, plus what
 *  I honestly do not hold. Nothing enters either list that was not observed. */
function receiptOf(inv: TopicInvestigation, owned: readonly OwnedCandidate[], d: CoverageDecision, r: PageCoverageReading | null):
{ items: BundleEvidenceItem[]; missing: string[] } {
  const items: BundleEvidenceItem[] = [];
  const missing: string[] = [];
  const add = (key: string, kind: BundleEvidenceItem["kind"], fact: string, observedAt: string | null): void => { items.push({ key, kind, fact, observedAt }); };

  const dem = inv.demand;
  const demand = [dem.monthlySearchVolume != null ? `about ${num(dem.monthlySearchVolume)} searches a month` : null,
    dem.gscImpressions != null ? `${num(dem.gscImpressions)} views in Google over 90 days` : null,
    dem.difficulty != null ? `the hardest of these searches scores ${num(dem.difficulty)} out of 100 to compete for` : null,
  ].filter((s): s is string => !!s);
  if (demand.length > 0) add("demand", "keyword", `People look for "${inv.label}": ${demand.join(", ")}.`, null);
  if (dem.monthlySearchVolume == null) missing.push(`I do not have a monthly search count for "${inv.label}", so I cannot tell you the size of this in searches.`);
  if (dem.difficulty == null) missing.push("I do not have a difficulty score for these searches, so I cannot tell you how hard they are to compete for.");

  inv.exactSerps.forEach((s, i) => add(`look${i + 1}`, "serp",
    `I looked at Google for "${s.query}" on ${day(s.observedAt)}: ${s.organicResults} results from ${s.distinctDomains} sites.`, s.observedAt));
  add("shape", "serp", `What wins for "${inv.label}" is ${SHAPE[inv.pageType] ?? "one settled shape"}, and ${inv.distinctResultDomains} sites come up for it.`, null);
  inv.winners.filter((w) => w.extractState === "current").slice(0, 4).forEach((w, i) => add(`win${i + 1}`, "winning_page",
    `${w.domain} wins here, and I read its page on ${day(w.fetchedAt)}${w.wordCount != null ? `, ${num(w.wordCount)} words` : ""}, ${w.headings} sections.`, w.fetchedAt));
  if (r) {
    const top = r.shared.slice(0, 6).map((s) => `"${s.keyword}"`).join(", ");
    add("shared", "keyword", `I put the pages that win here side by side search by search: ${num(r.shared.length)} searches come up on pages from at least two of ${r.winnerPublishers.length} sites, including ${top}.`, null);
    if (r.largestSearchVolume != null) add("size", "keyword", `The biggest single search in that set gets about ${num(r.largestSearchVolume)} searches a month, and ${r.keywordsWithVolume} of them carry a count at all.`, null);
    else missing.push("None of the searches those winning pages share carries a monthly count I can show you.");
  }
  owned.slice(0, 4).forEach((c, i) => {
    add(`owned${i + 1}`, "page_extract", `I checked your page ${c.url}${c.title ? ` ("${c.title}")` : ""}${c.wordCount != null ? `, ${num(c.wordCount)} words across ${c.outlineLength} sections` : ""}, and it is not the answer to this.`, c.fetchedAt);
    if (!c.bodyHeld) missing.push(`I do not hold the words of your page ${c.url}, so I judged it on its address and its title only.`);
  });
  if (owned.length === 0) missing.push("You own no page my evidence connects to this at all, so there was nothing of yours to strengthen instead.");
  add("verdict", "diagnosis", d.explanation, null);
  d.alternativesRuledOut.slice(0, 4).forEach((a, i) => add(`ruledout${i + 1}`, "diagnosis", `${a.alternative}: ${a.reason}`, null));
  if (inv.trackedPrompts.length === 0) missing.push("No AI engine I track has been asked about this, so I cannot tell you how assistants answer it today.");
  return { items, missing };
}

/** Build ONE researched new page from an EARNED verdict, or hand back the honest reason
 *  nothing was built. `none` is a real answer and costs the operator nothing. */
export async function buildNewPageProposal(decided: DecidedTopic, tenantId: string, opts: ProposeOptions = {}): Promise<NewPageOutcome> {
  const { investigation: inv, candidates: owned, decision, reading } = decided;
  // THE ONLY DOOR. A verdict short of this is an investigation, and an investigation is
  // never a page: no receipt is built, no prompt is assembled and no call is made.
  if (!earnedNewPage(decision) || decision.topicKey !== inv.key || !reading) {
    return { status: "none", reason: "I have not proved you are missing a page here, so I am building nothing." };
  }
  // The three-publishers-I-have-READ floor lives in the coverage ladder now, one gate above the only
  // door into this file, so a second copy here would just be a second place for that number to drift.
  const now = opts.now ?? new Date();
  const { items, missing } = receiptOf(inv, owned, decision, reading);
  const keys = new Set(items.map((i) => i.key));
  const facts = items.map((i) => i.fact);
  // The exact lists the brief may echo, and nothing else.
  const ownedByKey = new Map(owned.map((c) => [canonicalUrlKey(c.url), c]));
  const questions = new Map<string, string>();
  for (const q of [...inv.fanOuts.map((f) => f.query), ...inv.trackedPrompts.map((p) => p.promptText), ...(reading?.shared ?? []).map((s) => s.keyword), ...inv.queries]) {
    if (q.trim()) questions.set(norm(q), q.trim());
  }
  // EVERY HOST I ACTUALLY SHOWED IT, the observed questions included. Rule 2 orders the model to
  // copy a tracked question exactly, so a fan-out like "is the haft seen guide on wikipedia.org
  // accurate" made obedience a refusal and threw the whole page away.
  const hosts = new Set([...inv.winners.map((w) => w.domain), ...inv.resultDomains, ...owned.map((c) => publisherHost(c.url)),
    ...[...questions.values(), ...inv.queries].flatMap((q) => q.match(HOST_RE) ?? [])].map(norm).filter(Boolean));
  // What this topic is ABOUT, so an outline that would fit any subject can be spotted.
  const subject = new Set([...topicTokens(inv.label), ...(reading?.shared ?? []).flatMap((s) => topicTokens(s.keyword))]);

  const user = [
    `TOPIC: ${inv.label}`,
    `WHAT PEOPLE SEARCH: ${inv.queries.slice(0, 8).map((q) => `"${q}"`).join(", ")}`,
    `WHAT A SEARCHER WANTS: ${inv.demand.intent ?? "not established"}`,
    `WHAT WINS HERE, AND WHAT THIS PAGE MUST BE: ${SHAPE[inv.pageType] ?? inv.pageType}`,
    "EVIDENCE (cite these ids and no others)",
    ...items.map((i) => `  ${i.key}: ${i.fact}`),
    "OWN PAGES (the only addresses you may name)",
    ...(owned.length > 0 ? owned.map((c) => `  ${c.url}`) : ["  none"]),
    "OBSERVED QUESTIONS (the only questions you may turn into an FAQ)",
    ...(questions.size > 0 ? [...questions.values()].slice(0, 12).map((q) => `  ${q}`) : ["  none"]),
    "Write the brief for this one page.",
  ].join("\n");

  const call = await callStructuredLLM({
    kind: "new_page_brief", tenantId, system: SYSTEM, user, grounded: facts.join(" "),
    projectedCostUsd: 0.03, maxTokens: 2600, complete: opts.complete, now, bypassCache: opts.bypassCache,
  });
  if (call.status !== "drafted") {
    log.warn("[new-page] no usable brief", { tenantId, topicKey: inv.key, status: call.status });
    return { status: "none", reason: "I could not write this page to a standard I would hand you, so I am handing you nothing rather than filler." };
  }
  const v = call.value as NewPageBrief;

  // ── every claim back against what was supplied; one failure throws the whole draft ──
  const prose = [v.proposedTitle, v.metaDescription, v.openingAnswer, v.whyExistingPagesLose,
    ...v.sections.flatMap((s) => [s.heading, s.covers]), ...v.sourceRequirements, ...v.factRequirements,
    ...v.internalLinks.map((l) => l.anchor), ...v.faqQuestions].join(" ");
  const strayHost = (prose.match(HOST_RE) ?? []).map(norm).filter((h) => !CODE_SUFFIX.test(h)).find((h) => !hosts.has(h) && !hosts.has(publisherHost(h)));
  // EVERY FIGURE BACK TO THE EVIDENCE. The drafter's own grounded-number firewall tolerates
  // formatting and ALLOWS bare years and 7/14/28 day windows, so "28% of the searches" walks
  // through it; and the final validator only ever sees the title, description, opening answer,
  // outline and FAQ. That leaves whyExistingPagesLose, every section brief and every source or
  // fact requirement ungoverned - the fields an invented statistic actually reaches the operator
  // through. Written exactly as I supplied it, percent sign included, or not at all.
  const fig = (t: string): string[] => (t.match(FIGURE_RE) ?? []).map((f) => f.replace(/[.,]+$/, ""));
  const figures = new Set(fig(facts.join(" ")));
  const strayFigure = fig(prose).find((f) => !figures.has(f));
  const headings = v.sections.map((s) => norm(s.heading));
  const offTopic = v.sections.find((s) => !topicTokens(`${s.heading} ${s.covers}`).some((t) => subject.has(t)));
  const badLink = v.internalLinks.find((l) => !ownedByKey.has(canonicalUrlKey(l.url)));
  const badQuestion = v.faqQuestions.find((q) => !questions.has(norm(q)));
  const promptAsPage = questions.has(norm(v.proposedTitle));
  const refusal =
    [...v.sections.flatMap((s) => s.evidenceKeys), ...v.headKeys].some((k) => !keys.has(k)) ? "leaned on something I never gave it"
      : strayHost ? "named a website I never showed it"
        : strayFigure ? `quoted ${strayFigure}, which is a figure I never gave it`
        : badLink ? "linked to a page of yours I never gave it"
          : badQuestion ? "answered a question nobody has actually asked"
            : promptAsPage ? "turned one question I track into the whole page"
              : offTopic ? "wrote an outline that would fit any subject"
                : new Set(headings).size !== headings.length ? "repeated the same section twice"
                  : owned.length > 0 && !owned.some((c) => v.whyExistingPagesLose.toLowerCase().includes(c.url.toLowerCase()) || (c.path.length > 1 && v.whyExistingPagesLose.toLowerCase().includes(c.path.toLowerCase())))
                    ? "did not say why the pages you already have cannot carry this"
                    : SPELLED_PROPORTION_RE.test(prose) ? "wrote out a proportion I never measured"
                      : AUTOPUBLISH_RE.test(prose) ? "wrote as though something here goes live by itself"
                      : null;
  if (refusal) {
    log.warn("[new-page] brief disagrees with the evidence", { tenantId, topicKey: inv.key, refusal });
    return { status: "none", reason: `The page I drafted for "${inv.label}" ${refusal}, so I threw it away rather than hand it to you.` };
  }

  // ── one bundle: the pieces to paste, and everything they rest on ──
  const outline = v.sections.map((s) => s.heading);
  const schemaTypes: string[] = []; // NO SCHEMA IS DERIVED (see above): none, not a guess.
  // THE MODEL'S OWN CITATIONS for the three pieces a reader sees first, validated against the
  // supplied ids like every other key. A generic set assigned afterwards proved nothing.
  const core = v.headKeys.filter((k) => keys.has(k));
  const sectionKeys = [...new Set(v.sections.flatMap((s) => s.evidenceKeys))];
  const components: BundleComponent[] = [
    { kind: "title", label: "Page title", before: null, after: v.proposedTitle, evidenceKeys: core, risk: "safe" },
    { kind: "meta", label: "Description", before: null, after: v.metaDescription, evidenceKeys: core, risk: "safe" },
    { kind: "opening_answer", label: "Opening answer", before: null, after: v.openingAnswer, evidenceKeys: core, risk: "review" },
    { kind: "section", label: "Sections to write", before: null, after: v.sections.map((s) => `- ${s.heading}: ${s.covers}`).join("\n"), evidenceKeys: sectionKeys, risk: "review" },
  ];
  if (v.sourceRequirements.length > 0 || v.factRequirements.length > 0) {
    components.push({ kind: "source_pack", label: "What to source and check before this goes out", before: null,
      after: [...v.sourceRequirements, ...v.factRequirements].map((s) => `- ${s}`).join("\n"), evidenceKeys: core, risk: "review" });
  }
  if (v.internalLinks.length > 0) {
    components.push({ kind: "internal_links", label: "Link to these pages of your own", before: null,
      after: v.internalLinks.map((l) => `${l.anchor} -> ${ownedByKey.get(canonicalUrlKey(l.url))!.path}`).join("\n"),
      evidenceKeys: [...core, ...[...keys].filter((k) => k.startsWith("owned"))], risk: "safe" });
  }
  const shared = reading.shared.length;
  const dates = items.map((i) => i.observedAt).filter((d): d is string => !!d).sort();
  const bundle: ChangeBundle = {
    // TWO BRANCHES EARN THIS PAGE, and one of them is "your pages reach some of this, but too
    // little to build on". Claiming "none of your own pages comes up for" there put a statement
    // and its flat contradiction on one screen, every single time that branch fired.
    objective: reading.ownedCoveredKeywords === 0
      ? `Give yourself a page for "${inv.label}", which ${num(shared)} searches the winning pages share and none of your own pages comes up for.`
      : `Give yourself a page for "${inv.label}": the winning pages share ${num(shared)} searches, and pages of yours reach only ${num(reading.ownedCoveredKeywords)} of them.`,
    metric: `Clicks from search for "${inv.label}" over the next 28 days.`,
    scope: { queries: inv.queries.slice(0, 8), prompts: inv.trackedPrompts.map((p) => p.promptText) },
    components,
    receipt: { items, missing, freshestObservedAt: dates.at(-1) ?? null },
    alternatives: decision.alternativesRuledOut.map((a) => ({ option: a.alternative, reason: a.reason })),
    risks: [
      "A page that does not exist yet has no history, so give it the full 28 days before you judge it.",
      "Read every line once and add your own sources before it goes out. You write and publish this page, I only draft it.",
      ...missing.slice(0, 2),
    ],
    confidenceReasons: [decision.explanation, v.whyExistingPagesLose,
      dates.at(-1) ? `The newest evidence I used was observed on ${day(dates.at(-1)!)}.` : "None of the evidence behind this carries a single observation date."],
    measurementPlan: "Once the page is live, record it on Results with its address and I will read clicks, views, and average position for these searches at 7, 14, and 28 days, compared against pages you did not touch.",
  };

  const proposal: ChangeProposal = {
    id: `${tenantId}::${inv.key}::new_page::bundle`,
    tenantId, kind: "new_page", changeFamily: "new_page", publish: "manual",
    pagePath: null, pageUrl: null, pageLabel: v.proposedTitle, primaryQuery: inv.label,
    opportunityType: "Cover a subject you have no page for",
    status: "needs_review",
    recommendedChange: { kind: "new_page", proposedTitle: v.proposedTitle, metaDescription: v.metaDescription,
      openingAnswer: v.openingAnswer, outline, faqQuestions: v.faqQuestions, schemaTypes },
    whyItMatters: `${decision.explanation} You write and publish it yourself; I will measure it once you tell me it is live.`,
    estimatedEffortMinutes: effortForFamily("new_page"),
    riskLevel: "low",
    // A page nobody has read yet is never high confidence, however well the comparison
    // settled it: the writing is still ahead of us.
    confidence: "medium",
    limitations: [...new Set(missing)],
    // THE QUESTIONS TRAVEL WITH THE DRAFT. The final validator grounds every address in the copy
    // against this text, and it never saw the question list the prompt ordered the model to copy
    // verbatim - so an observed question that names a site ("is the haft seen guide on
    // wikipedia.org accurate") was drafted correctly and then thrown away by the last gate.
    evidence: { query: inv.label, hints: [...facts.slice(0, 5), ...[...questions.values()].slice(0, 8)], evidenceRefCount: items.length },
    impactScore: null, upsidePerMonth: null, bundle, createdAt: now.toISOString(),
  };
  // THE QUESTIONS ARE EVIDENCE TOO. The validator grounds every address in the copy against this
  // text, and the facts alone never carried the question list the prompt ordered the model to
  // copy verbatim, so an observed question naming a site was drafted correctly and killed here.
  const verdict = validateProposal(proposal, { evidenceText: [...facts, ...questions.values()].join(" "), now });
  if (verdict.status === "rejected") {
    log.warn("[new-page] brief failed the one validator", { tenantId, topicKey: inv.key, reasons: verdict.reasons.slice(0, 3) });
    return { status: "none", reason: `The page I drafted for "${inv.label}" did not pass my own safety checks, so I am handing you nothing rather than risk it.` };
  }
  return { status: "built", proposal: { ...proposal, status: verdict.status, limitations: [...new Set([...proposal.limitations, ...verdict.reasons])] } };
}
