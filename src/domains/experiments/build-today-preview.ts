/**
 * build-today-preview (2026-06-30) — server-side assembly of a Daily Experiment PREVIEW plan from
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
import { planDailyExperiments } from "./daily-experiment-planner";
import { deriveExperimentStates } from "./experiment-eligibility";
import { buildLinkDestinations, toLinkPath } from "./safe-internal-link";
import { buildDailyPlanRecord } from "./build-daily-plan-record";
import type { DailyExperimentPlanRecord } from "./daily-plan-types";
import { classifyQueryIntent } from "./answer-intent";
import { enrichDailyCandidatesWithLlm, type MetaTitleDrafter } from "./daily-llm-enrich";
import { draftAtomicEditStructured } from "@/domains/llm/structured-drafter";

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
  const [signals, ledger, snaps] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId),
    loadProofLedger(tenantId).catch(() => []),
    getPageSnapshots(),
  ]);

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
  for (const s of signals.values()) {
    if (ANIMAL.test(s.page)) continue;
    const tq = [...s.topQueries].sort((a, b) => b.impressions - a.impressions)[0];
    if (!tq || s.impressions90d < 200 || s.position90d < 3 || s.position90d > 50) continue;
    inputs.push({
      url: s.page, pageLabel: labelOf(s.page), impressions: s.impressions90d, clicks: s.clicks90d, ctr: s.ctr90d, position: s.position90d,
      topQuery: tq.query, topQueryImpressions: tq.impressions, topQueryPosition: tq.position, topQueryCtr: tq.ctr,
      ownership: s.impressions90d > 0 ? tq.impressions / s.impressions90d : 0,
    });
    intentByUrl.set(s.page, classifyQueryIntent([...s.topQueries].map((q) => ({ query: q.query, impressions: q.impressions })))?.dominant);
  }
  inputs.sort((a, b) => (b.topQueryImpressions / Math.max(1, b.topQueryPosition)) - (a.topQueryImpressions / Math.max(1, a.topQueryPosition)));

  const facts = new Map<string, PageFacts>();
  for (const p of inputs) { const f = factsByPath.get(pathOf(p.url)); if (f) facts.set(p.url, f); }

  const built = buildDailyCandidates({ tenantId, pages: inputs, facts, proofLedger: ledger, linkDestinations });

  // Move 4 — RECOMMENDATION-QUALITY GATE: no candidate enters the plan unless it passes
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

  const plan = planDailyExperiments({ tenantId, date: now.toISOString().slice(0, 10), candidates: gatedBuilt, proofLedger: ledger, config: { ...PLANNER_CONFIG, now } });

  const byUrl = new Map(built.map((b) => [b.url, b]));
  const selected = plan.selected.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];
  const backups = plan.backups.map((s) => byUrl.get(s.url)).filter(Boolean) as BuiltCandidate[];

  // Slice D-1: LLM "write it" pass — sharpen the description/title copy at plan time so cards arrive
  // full. Budgeted + fail-closed inside the structured drafter (off when BEACON_LLM_PROVIDER != openai
  // or the cap is hit); on any miss it keeps the deterministic text. Only drop-in field levers here;
  // answer-block writing (a new add-operation) is a later slice.
  const llmDrafter: MetaTitleDrafter = async ({ query, pageLabel, field, currentValue, intent }) => {
    const r = await draftAtomicEditStructured({ query, pageLabel, field, currentValue, outline: [], intent });
    return r.status === "drafted" ? { text: r.value.after, rationale: r.value.rationale } : null;
  };
  await enrichDailyCandidatesWithLlm(selected, intentByUrl, llmDrafter).catch(() => 0);

  const record = buildDailyPlanRecord({
    tenantId, date: now.toISOString().slice(0, 10), now, selected, backups,
    activeSnapshot: { proofIds: activeProofIds, treatedUrls: [...activeTreated], controlUrls: [...activeControl], influencedUrls: [] },
  });

  const excludedByReason: Record<string, number> = {};
  for (const e of plan.excluded) excludedByReason[e.reason] = (excludedByReason[e.reason] ?? 0) + 1;

  if (qaRejected > 0) excludedByReason.quality_rejected = qaRejected;
  return { record, candidatesEvaluated: built.length, excludedByReason };
}
