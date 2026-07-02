/**
 * build-today-preview (2026-06-30) - server-side assembly of a Daily Experiment PREVIEW plan from
 * cached signals only ($0, no live fetch, no paid calls, no reservations, no proof rows). This is
 * the canonical pipeline the preview server action calls; it mirrors the proven dry-run script.
 *   GSC signals + page_snapshots facts + proof topology → candidates (Safe Meta/Link/Answer) →
 *   diversified planner → frozen DailyExperimentPlanRecord (status=preview).
 */
import "server-only";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { buildDailyCandidates, type GscPageInput, type PageFacts, type BuiltCandidate } from "./build-daily-candidates";
import { reviewRecommendation, passesDailyGate } from "@/domains/recommendations/recommendation-quality";
import { planDailyExperiments, pageFamilyOf as pageFamilyOfPath } from "./daily-experiment-planner";
import { deriveExperimentStates, actionFamilyOf } from "./experiment-eligibility";
import { buildLinkDestinations, toLinkPath } from "./safe-internal-link";
import { buildDailyPlanRecord } from "./build-daily-plan-record";
import type { DailyExperimentPlanRecord } from "./daily-plan-types";
import { classifyQueryIntent } from "./answer-intent";
import { proposeAnswerGap } from "./safe-answer-block";
import { enrichDailyCandidatesWithLlm, type MetaTitleDrafter } from "./daily-llm-enrich";
import { draftAtomicEditStructured, draftAnswerBlockStructured, draftTeamVerdictStructured } from "@/domains/llm/structured-drafter";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { readCachedSerpPatterns, enrichPickSerpPatterns } from "@/domains/serp/research-enrichment-producer";
import type { SerpPattern } from "@/domains/serp/research-enrichment";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
import {
  buildKeywordBrief, buildSerpEvidence, buildCompetitorEvidence,
  type CachedDemand, type SerpPatternLite, type EvidenceCompetitor, type DailyEvidenceBrief,
} from "./daily-evidence-brief";
import { normalizePath } from "./daily-plan-types";
import { aggregateSettled, proofHistoryLine } from "./proof-history-voice";
import { reviewCandidateWithTeam } from "./team-review";

const ANIMAL = /\/iran-animals(\/|$)/;
const pathOf = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
const labelOf = (u: string) => (pathOf(u).split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");

const PLANNER_CONFIG = {
  maxExperiments: 8, maxPerPageFamily: 4, maxPerActionFamily: 4, maxHighTraffic: 2,
  effortBudgetMinutes: 45, maxLinksPerDestination: 1, backups: 2,
} as const;

export type TodayPreviewResult = {
  record: DailyExperimentPlanRecord;
  candidatesEvaluated: number;
  excludedByReason: Record<string, number>;
};

export async function buildTodayExperimentPreview(tenantId: string, now: Date = new Date()): Promise<TodayPreviewResult> {
  const [signals, ledger, snaps, keywordDemand, serpPatterns, changePacks] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId),
    loadProofLedger(tenantId).catch(() => []),
    getPageSnapshots(),
    // Slice E: $0 cached DataForSEO keyword demand (volume + paid-competition) for the "how we know"
    // brief. Cache-only read (no call, no spend); empty until a live keyword run populates it.
    readAllCachedKeywordDemand().catch(() => []),
    // Slice E-2: $0 cached live-SERP reaction (winning shape + domains) per query. Populated by the
    // operator-gated SERP producer; empty (brief section absent) until then.
    readCachedSerpPatterns().catch(() => new Map()),
    // Slice E-2: competitor teardown per owned page (top competitor + what to steal), from the cached
    // demand graph + cached page audits (compute, NO paid call, NO live fetch). Fail-soft to none.
    loadChangePacksForTenant(tenantId, { limit: 120 }).then((r) => r.packets).catch(() => []),
  ]);

  // Keyword demand indexed by lowercased term, for the daily card's keyword-research evidence.
  const demandByTerm = new Map<string, CachedDemand>();
  for (const k of keywordDemand) {
    demandByTerm.set(k.keyword.toLowerCase(), { volume: k.searchVolume, competition: k.competitionLevel });
  }

  // SERP patterns indexed by lowercased query (the shape build-today-preview's brief looks up).
  const serpByTerm = new Map<string, SerpPatternLite>();
  for (const [q, p] of serpPatterns as Map<string, { format: string; winningDomains: string[]; elementImplication: string }>) {
    serpByTerm.set(q.toLowerCase(), { format: p.format, winningDomains: p.winningDomains ?? [], elementImplication: p.elementImplication ?? "" });
  }

  // Competitor teardown indexed by normalized owned-page path. Only keep a RELEVANT, on-topic
  // competitor (relevance gate + not loosely-matched) so a page never shows an off-topic rival.
  // Also index the FULL packet per page (first = the page's highest-ranked move) - the input the
  // specialist team debates in the R1 review below.
  const competitorByPath = new Map<string, EvidenceCompetitor>();
  const packetByPath = new Map<string, (typeof changePacks)[number]>();
  for (const p of changePacks) {
    const ownedUrl = p.yourPage?.url;
    if (ownedUrl && !packetByPath.has(normalizePath(ownedUrl))) packetByPath.set(normalizePath(ownedUrl), p);
    const c = p.competitor;
    if (!ownedUrl || !c || !c.domain || c.looselyMatched || (c.relevance ?? 0) < 0.3) continue;
    const ev = buildCompetitorEvidence({ domain: c.domain, url: c.topUrl, facts: c.facts });
    if (ev) competitorByPath.set(normalizePath(ownedUrl), ev);
  }

  // Facts from Beacon's own cached crawl ($0, no live fetch).
  const factsByPath = new Map<string, PageFacts>();
  for (const s of snaps as Array<{ url?: string; page?: string; title: string | null; meta_description: string | null; h1: string | null; body_paragraph_sample?: string[]; internal_links?: Array<{ href: string }>; fetched_at?: string }>) {
    const u = s.url ?? s.page;
    if (!u) continue;
    factsByPath.set(pathOf(u), {
      title: s.title, meta: s.meta_description, h1: s.h1,
      openingParagraph: (s.body_paragraph_sample ?? []).find((p) => p && p.trim().length >= 80) ?? null,
      bodyParagraphs: s.body_paragraph_sample ?? [],
      internalLinkPaths: (s.internal_links ?? []).map((l) => toLinkPath(l.href)),
      snapshotFetchedAt: s.fetched_at,
    });
  }

  // Active topology (treated/control paths) + protected-destination predicate.
  const states = deriveExperimentStates(ledger, now);
  const activeTreated = new Set<string>();
  const activeControl = new Set<string>();
  for (const [p, st] of states) {
    if (st.activeTreatments.length) activeTreated.add(toLinkPath(p));
    if (st.activeControlAssignments.length) activeControl.add(toLinkPath(p));
  }
  const activeProofIds = ledger.filter((r) => r.verdict === "measuring").map((r) => r.id);
  const isProtected = (p: string): string | null =>
    ANIMAL.test(p) ? "animal_family" : activeControl.has(p) || activeTreated.has(p) ? "active_experiment" : null;
  const linkDestinations = buildLinkDestinations(snaps as Parameters<typeof buildLinkDestinations>[0], isProtected);

  // GSC candidate pool (non-animal, measurable band). Capture each page's impression-weighted intent
  // (the searcher's dominant question) so the LLM "write it" pass can draft the RIGHT answer type.
  const inputs: GscPageInput[] = [];
  const intentByUrl = new Map<string, string | undefined>();
  // Each page's top searches (impression-sorted): the query set the keyword-research brief looks up.
  const queriesByUrl = new Map<string, string[]>();
  for (const s of signals.values()) {
    if (ANIMAL.test(s.page)) continue;
    const sortedQueries = [...s.topQueries].sort((a, b) => b.impressions - a.impressions);
    const tq = sortedQueries[0];
    if (!tq || s.impressions90d < 200 || s.position90d < 3 || s.position90d > 50) continue;
    inputs.push({
      url: s.page, pageLabel: labelOf(s.page), impressions: s.impressions90d, clicks: s.clicks90d, ctr: s.ctr90d, position: s.position90d,
      topQuery: tq.query, topQueryImpressions: tq.impressions, topQueryPosition: tq.position, topQueryCtr: tq.ctr,
      ownership: s.impressions90d > 0 ? tq.impressions / s.impressions90d : 0,
    });
    intentByUrl.set(s.page, classifyQueryIntent(sortedQueries.map((q) => ({ query: q.query, impressions: q.impressions })))?.dominant);
    queriesByUrl.set(s.page, sortedQueries.slice(0, 8).map((q) => q.query));
  }
  inputs.sort((a, b) => (b.topQueryImpressions / Math.max(1, b.topQueryPosition)) - (a.topQueryImpressions / Math.max(1, a.topQueryPosition)));

  const facts = new Map<string, PageFacts>();
  for (const p of inputs) { const f = factsByPath.get(pathOf(p.url)); if (f) facts.set(p.url, f); }

  // D-2: LLM-WRITTEN answers for pages with an answer GAP (no on-page answer for the real intent, e.g.
  // the chaharshanbe date). Grounded in the page body + the searcher's intent; the drafter's
  // numeric-fidelity firewall blocks any fabricated date/number, and the operator approves before it
  // goes live. Capped to the top pages by demand (inputs is demand-sorted) so cost stays bounded;
  // OpenAI only, off unless BEACON_LLM_PROVIDER=openai. Fails soft (no write -> honest gap remains).
  const ANSWER_WRITE_CAP = 6;
  const writtenAnswersByUrl = new Map<string, { text: string; question: string }>();
  const gapPages = inputs
    .map((p) => ({ p, f: facts.get(p.url) }))
    .filter((x): x is { p: GscPageInput; f: PageFacts } => !!x.f)
    .map((x) => ({ ...x, gap: proposeAnswerGap({ label: x.p.pageLabel, h1: x.f.h1, topQuery: x.p.topQuery, bodyParagraphs: x.f.bodyParagraphs ?? [] }) }))
    .filter((x) => x.gap != null)
    .slice(0, ANSWER_WRITE_CAP);
  await Promise.all(
    gapPages.map(async ({ p, f, gap }) => {
      try {
        const res = await draftAnswerBlockStructured({
          query: p.topQuery,
          pageLabel: p.pageLabel,
          brief: gap!.question,
          outline: (f.bodyParagraphs ?? []).slice(0, 8),
          faqs: [],
          intent: gap!.intent,
        });
        if (res.status === "drafted" && res.value.answer?.trim()) {
          writtenAnswersByUrl.set(p.url, { text: res.value.answer.trim(), question: gap!.question });
        }
      } catch {
        /* fail soft: no written answer for this page -> the honest gap remains */
      }
    }),
  );

  const built = buildDailyCandidates({ tenantId, pages: inputs, facts, proofLedger: ledger, linkDestinations, writtenAnswersByUrl });

  // Move 4 - RECOMMENDATION-QUALITY GATE: no candidate enters the plan unless it passes
  // the deterministic review (page-query intent fit, action↔goal incl. year-intent, copy
  // quality, factual firewall, origin-definitiveness). Lever eligibility (proof-block /
  // control / contamination / insufficient-controls) is enforced downstream by the planner;
  // this gate adds the CONTENT-quality vetoes the planner can't see. Pure, no I/O.
  const qaByUrl = new Map(built.map((b) => [b.url, reviewRecommendation({
    lever: b.leverField,
    pagePath: pathOf(b.url),
    pageLabel: b.pageLabel ?? labelOf(b.url),
    targetQuery: b.targetQuery,
    currentText: b.currentText,
    proposedText: b.proposedText,
    controlsAvailable: b.suggestedControls.length,
  })]));
  const gatedBuilt = built.filter((b) => { const r = qaByUrl.get(b.url); return r ? passesDailyGate(r) : true; });
  const qaRejected = built.length - gatedBuilt.length;

  // R1 (2026-07-01) - THE TEAM DECIDES: every surviving candidate is debated by the full specialist
  // team (GSC, GA4, Clarity, DataForSEO, Profound, Wix, strategist) over the page's fused evidence
  // packet. The debate (a) VETOES candidates the team routes off content work (fix the experience
  // first / hold until winnable), (b) tilts the planner's deterministic score with the router's
  // bounded multiplier, and (c) freezes the named-voices debate on the candidate so the card shows
  // the REAL argument that chose tonight's batch. Pages without a packet keep pre-team behavior
  // exactly (the team abstains - it never fabricates).
  const nowIso = now.toISOString();
  // Item 80 - the PROOF-HISTORY voice: what the measured ledger already says about this page
  // family + lever family. The team's own past results speak in the debate ("a description
  // change on a flags page showed no lift last month"), so learning is visible, not implied.
  const settledByKey = aggregateSettled(ledger, pageFamilyOfPath, actionFamilyOf);
  const historyLine = (pageFamily: string, actionFamily: string): string | null =>
    proofHistoryLine(settledByKey, pageFamily, actionFamily);

  let teamVetoed = 0;
  const teamReviewed = gatedBuilt.filter((b) => {
    const result = reviewCandidateWithTeam(packetByPath.get(normalizePath(b.url)), nowIso);
    if (result.review) {
      b.teamReview = result.review;
      const hist = historyLine(b.pageFamily ?? "", b.actionFamily);
      if (hist) {
        b.teamReview.voices.push({ specialist: "proof", label: "Results so far", claim: hist, confidencePct: 65 });
      }
    }
    b.teamScoreMultiplier = result.scoreMultiplier;
    if (result.vetoed) { teamVetoed += 1; return false; }
    return true;
  });

  const plan = planDailyExperiments({ tenantId, date: now.toISOString().slice(0, 10), candidates: teamReviewed, proofLedger: ledger, config: { ...PLANNER_CONFIG, now } });

  const byUrl = new Map(built.map((b) => [b.url, b]));
  const selected = plan.selected.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];
  const backups = plan.backups.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];

  // Slice D-1: LLM "write it" pass - sharpen the description/title copy at plan time so cards arrive
  // full. Budgeted + fail-closed inside the structured drafter (off when BEACON_LLM_PROVIDER != openai
  // or the cap is hit); on any miss it keeps the deterministic text. Only drop-in field levers here;
  // answer-block writing (a new add-operation) is a later slice.
  const llmDrafter: MetaTitleDrafter = async ({ query, pageLabel, field, currentValue, intent }) => {
    const r = await draftAtomicEditStructured({ query, pageLabel, field, currentValue, outline: [], intent });
    return r.status === "drafted" ? { text: r.value.after, rationale: r.value.rationale } : null;
  };
  await enrichDailyCandidatesWithLlm(selected, intentByUrl, llmDrafter).catch(() => 0);

  // Item 29 - live SERP for tonight's picks (<= 8 target queries, ~$0.02 a night) so the
  // Google-results teammate almost never abstains on the batch. Same gauntlet as every
  // DataForSEO call (14d cache, fail-closed cap, ledger); dry-run/unconfigured -> $0 no-op.
  const serpRun = await enrichPickSerpPatterns(selected.map((c) => c.targetQuery)).catch(() => ({ fetched: 0, spentUsd: 0 }));
  if (serpRun.fetched > 0) {
    const refreshed = await readCachedSerpPatterns().catch(() => new Map<string, SerpPattern>());
    for (const [q, p] of refreshed) {
      serpByTerm.set(q, { format: p.format, winningDomains: p.winningDomains ?? [], elementImplication: p.elementImplication ?? "" });
    }
  }

  // Slice E: attach the "how we know" evidence to each selected move: keyword research (volume +
  // competition), the live Google SERP reaction (winning shape + domains + what to do), and the top
  // competitor teardown (what to steal). All $0 cached reads; each section is omitted when absent, so
  // the card degrades gracefully (an all-empty brief is not attached). Runs BEFORE the strategist
  // verdict pass so the keyword voice is part of what the strategist synthesizes.
  for (const c of selected) {
    const queries = queriesByUrl.get(c.url) ?? [c.targetQuery];
    const kw = buildKeywordBrief(queries, demandByTerm);
    const serp = buildSerpEvidence(queries, serpByTerm);
    const competitor = competitorByPath.get(normalizePath(c.url));
    if (kw || serp || competitor) {
      c.evidenceBrief = {
        keywords: kw?.keywords ?? [],
        addressableVolume: kw?.addressableVolume ?? null,
        ...(serp ? { serp } : {}),
        ...(competitor ? { competitor } : {}),
      };
    }
    // Item 29 - the LIVE-GOOGLE voice: when a SERP pattern exists for this pick's queries and the
    // debate's Google teammate abstained, say what wins on Google now as its own line.
    if (serp && c.teamReview && !c.teamReview.voices.some((v) => v.label === "Live Google results")) {
      const led = serp.winningDomains.slice(0, 2).join(" and ");
      const FORMAT_PLAIN: Record<string, string> = {
        ugc: "community discussion", product: "store and product", list: "list-style",
        faq: "question-and-answer", guide: "in-depth guide", mixed: "a mix of",
      };
      const shape = FORMAT_PLAIN[serp.format] ?? serp.format;
      c.teamReview.voices.push({
        specialist: "dataforseo",
        label: "Live Google results",
        claim: `On Google right now, ${shape} pages win for this search${led ? `, led by ${led}` : ""}.`,
        confidencePct: 75,
      });
    }
    // Item 28 - the KEYWORD-RESEARCH voice: real monthly demand speaks in the roundtable as its
    // own teammate line, not buried in the expander. Deterministic, from the cached universe.
    const best = (kw?.keywords ?? []).filter((k) => typeof k.volume === "number" && k.volume > 0).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
    if (best && c.teamReview) {
      const comp = best.competition != null ? `, ${best.competition} competition` : "";
      const more = kw?.addressableVolume && kw.addressableVolume > (best.volume ?? 0)
        ? ` (${kw.addressableVolume.toLocaleString()} across the page's queries)`
        : "";
      c.teamReview.voices.push({
        specialist: "dataforseo",
        label: "Keyword research",
        claim: `${(best.volume ?? 0).toLocaleString()} searches a month for "${best.term}"${comp}${more}.`,
        confidencePct: 80,
      });
    }
  }

  // Item 25 - the strategist WRITES the team verdict for each pick: a grounded 1-3 sentence
  // synthesis of the real specialist claims (budget-gated, numeric-fidelity firewalled, fail-soft
  // to the deterministic verdict). Selected picks only (max 8/night, ~$0.08 worst case).
  const LEVER_PLAIN: Record<string, string> = {
    meta: "a sharper description", title: "a sharper title", h1: "a clearer headline",
    internal_link: "an internal link", answer_block: "a direct answer at the top",
  };
  await Promise.all(
    selected.map(async (c) => {
      const t = c.teamReview;
      if (!t || t.voices.length === 0) return;
      try {
        const r = await draftTeamVerdictStructured({
          pageLabel: c.pageLabel,
          targetQuery: c.targetQuery,
          leverPlain: LEVER_PLAIN[c.leverField] ?? c.leverField,
          proposedText: c.proposedText,
          voices: t.voices.map((v) => ({ label: v.label, claim: v.claim })),
          objections: t.objections.map((o) => ({ label: o.label, reason: o.reason })),
          whyNot: t.whyNot,
        });
        if (r.status === "drafted" && r.value.verdict.trim()) {
          t.verdict = r.value.verdict.trim();
        }
      } catch {
        /* keep the deterministic verdict */
      }
    }),
  );

  const record = buildDailyPlanRecord({
    tenantId, date: now.toISOString().slice(0, 10), now, selected, backups,
    activeSnapshot: { proofIds: activeProofIds, treatedUrls: [...activeTreated], controlUrls: [...activeControl], influencedUrls: [] },
  });

  const excludedByReason: Record<string, number> = {};
  for (const e of plan.excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] ?? 0) + 1;

  if (qaRejected > 0) excludedByReason.quality_rejected = qaRejected;
  if (teamVetoed > 0) excludedByReason.team_vetoed = teamVetoed;
  return { record, candidatesEvaluated: built.length, excludedByReason };
}
