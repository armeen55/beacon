/**
 * build-daily-candidates (2026-06-30) — turns Beacon's cached signals into eligible, exact,
 * one-variable daily-experiment candidates. PURE core (the live-page-facts fetch is the
 * caller's job, passed in as `facts`). Deterministic proposers only — NO LLM, NO generic
 * title templates, NO invented value props: a title proposal is a query-first REORDER of the
 * page's OWN title (drop filler), an H1 proposal aligns the H1 to the query it ranks for, a
 * meta proposal fires only when meta is genuinely MISSING (built from the on-page H1). If
 * nothing is materially better, the page yields no candidate (honest — never forces weak work).
 *
 * Eligibility (active treatments / controls / no-lift / compound) comes from the proof ledger
 * via the experiment model, so the active animal batch + its 17 controls are excluded by
 * construction. Controls are scored from the same untreated page family.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  deriveExperimentStates,
  assessEligibility,
  actionFamilyOf,
  type ExperimentEligibility,
} from "./experiment-eligibility";
import { pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";

export type PageFacts = { title: string | null; meta: string | null; h1: string | null };

export type GscPageInput = {
  url: string;
  pageLabel: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  topQuery: string;
  topQueryImpressions: number;
  topQueryPosition: number;
  topQueryCtr: number;
  ownership: number; // 0..1
};

export type SuggestedControl = {
  url: string;
  score: number;
  why: string;
  impressionsRatio: number;
  positionDifference: number;
  pageFamilyMatch: boolean;
};

export type BuiltCandidate = DailyCandidate & {
  pageLabel: string;
  leverField: "title" | "meta" | "h1";
  currentText: string;
  proposedText: string;
  whyNow: string;
  rollbackText: string;
  eligibility: ExperimentEligibility;
  suggestedControls: SuggestedControl[];
  enoughControls: boolean;
};

const CTR_CURVE: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025 };
function expectedCtr(pos: number): number {
  const p = Math.round(pos);
  if (p <= 0) return 0.28;
  if (p <= 10) return CTR_CURVE[p];
  if (p <= 15) return 0.018;
  if (p <= 20) return 0.012;
  return 0.006;
}

const FILLER_LEAD = /^(meet the|the|a|an|discover|explore|learn about|all about|guide to)\s+/i;
const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "with", "is", "are", "what", "how", "why", "vs"]);
function contentTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
}
/** Light singularization so "rug" matches "rugs" (avoid false "missing token"). */
const stem = (t: string): string => (t.length > 3 ? t.replace(/s$/, "") : t);
const stemSet = (s: string): Set<string> => new Set(contentTokens(s).map(stem));
/** The query's tokens that are NOT a broad geo/brand token (persian/iran/iranian) — the
 *  DISTINGUISHING terms a title/H1 must carry. */
const BROAD = new Set(["persian", "iran", "iranian", "irans", "farsi", "persia"]);
function distinguishingTokens(query: string): string[] {
  const d = contentTokens(query).filter((t) => !BROAD.has(t));
  return d.length > 0 ? d : contentTokens(query);
}

function titleLeadsWithQuery(title: string, query: string): boolean {
  const t = new Set(contentTokens(title).slice(0, 3).map(stem));
  const q = contentTokens(query).map(stem);
  return q.length > 0 && q.every((tok) => t.has(tok));
}

/** Query-first reorder of the page's OWN title: drop a filler lead; if the query isn't already
 *  led-with, prepend the query label and keep the existing brand/category tail. No invented
 *  copy. Returns null when the current title is already query-first + filler-free. */
function proposeTitle(currentTitle: string | null, query: string): string | null {
  if (!currentTitle) return null;
  const stripped = currentTitle.replace(FILLER_LEAD, "").trim();
  const hadFiller = stripped !== currentTitle.trim();
  if (!hadFiller && titleLeadsWithQuery(currentTitle, query)) return null; // already good
  // Title-case the query for the lead.
  const lead = query.replace(/\b\w/g, (c) => c.toUpperCase());
  if (titleLeadsWithQuery(stripped, query)) return stripped; // filler-drop alone fixes it
  // Prepend the query, keep any existing " | brand/category" tail from the stripped title.
  const tail = stripped.includes("|") ? " |" + stripped.split("|").slice(1).join("|") : "";
  const candidate = `${lead}${tail}`.trim();
  return candidate !== currentTitle.trim() ? candidate : null;
}

function proposeH1(currentH1: string | null, query: string): string | null {
  if (!currentH1) return null;
  const dist = distinguishingTokens(query);
  const h1Tokens = stemSet(currentH1);
  const missing = dist.filter((t) => !h1Tokens.has(stem(t)));
  if (missing.length === 0) return null; // H1 already carries the query
  // Conservative: lead the H1 with the query label (keep nothing invented).
  return query.replace(/\b\w/g, (c) => c.toUpperCase());
}

function proposeMeta(currentMeta: string | null, facts: PageFacts, query: string): string | null {
  if (currentMeta && currentMeta.trim().length > 0) return null; // only fill a MISSING meta
  const base = (facts.h1 || facts.title || query).replace(/\s*\|.*$/, "").trim();
  // Factual, derived from on-page H1 + the query it ranks for. ≤155 chars.
  const meta = `${base} — guide to ${query}.`.slice(0, 155);
  return meta;
}

type Proposal = { leverField: "title" | "meta" | "h1"; actionType: string; proposed: string; current: string };
function chooseProposal(facts: PageFacts, query: string): Proposal | null {
  const t = proposeTitle(facts.title, query);
  if (t) return { leverField: "title", actionType: "edit_title", proposed: t, current: facts.title ?? "" };
  const h = proposeH1(facts.h1, query);
  if (h) return { leverField: "h1", actionType: "edit_h1", proposed: h, current: facts.h1 ?? "" };
  const m = proposeMeta(facts.meta, facts, query);
  if (m) return { leverField: "meta", actionType: "edit_meta", proposed: m, current: facts.meta ?? "(none)" };
  return null;
}

function scoreControl(treated: GscPageInput, control: GscPageInput): SuggestedControl {
  const impressionsRatio = treated.impressions > 0 ? control.impressions / treated.impressions : 0;
  const positionDifference = Math.abs(control.position - treated.position);
  const familyMatch = pageFamilyOf(control.url) === pageFamilyOf(treated.url);
  // 1 = perfect; penalize impression-scale mismatch + position gap; reward family match.
  const impScore = 1 - Math.min(1, Math.abs(Math.log10((control.impressions + 1) / (treated.impressions + 1))));
  const posScore = 1 - Math.min(1, positionDifference / 10);
  const score = Number(((impScore * 0.4 + posScore * 0.4 + (familyMatch ? 0.2 : 0)) || 0).toFixed(3));
  return {
    url: control.url, score, impressionsRatio: Number(impressionsRatio.toFixed(2)), positionDifference: Number(positionDifference.toFixed(1)),
    pageFamilyMatch: familyMatch,
    why: `${familyMatch ? "same family" : "cross-family"}, ~${Math.round(control.impressions)} impr, pos ${control.position.toFixed(1)}`,
  };
}

export const MIN_CONTROLS = 3;

export function buildDailyCandidates(input: {
  tenantId: string;
  pages: GscPageInput[];
  facts: Map<string, PageFacts>;
  proofLedger: ShippedChangeRecord[];
  now?: Date;
}): BuiltCandidate[] {
  const now = input.now ?? new Date();
  const states = deriveExperimentStates(input.proofLedger, now);

  // The untreated/uncontrolled pool that controls can be drawn from.
  const cleanPool = input.pages.filter((p) => {
    const st = states.get(p.url.replace(/^https?:\/\/[^/]+/, "") || "/");
    return !st || (st.activeTreatments.length === 0 && st.activeControlAssignments.length === 0);
  });

  const out: BuiltCandidate[] = [];
  for (const p of input.pages) {
    const facts = input.facts.get(p.url) ?? { title: null, meta: null, h1: null };
    const proposal = chooseProposal(facts, p.topQuery);
    if (!proposal) continue; // nothing materially better → no candidate (honest)

    const actionFamily = actionFamilyOf(proposal.actionType);
    const external = { ownershipUncertain: p.ownership < 0.12, highRisk: false };
    const elig = assessEligibility({ url: p.url, family: actionFamily, states, external });
    if (!elig.eligible) {
      out.push(buildCandidate(p, proposal, actionFamily, elig, []));
      continue; // kept for the planner to report as excluded
    }

    // controls: same family first, untreated, not this page, similar scale/position.
    const pf = pageFamilyOf(p.url);
    const controls = cleanPool
      .filter((c) => c.url !== p.url)
      .map((c) => scoreControl(p, c))
      .filter((c) => c.pageFamilyMatch || c.score >= 0.5)
      .sort((a, b) => (b.pageFamilyMatch ? 1 : 0) - (a.pageFamilyMatch ? 1 : 0) || b.score - a.score)
      .slice(0, 5);
    void pf;
    out.push(buildCandidate(p, proposal, actionFamily, elig, controls));
  }
  return out;
}

function buildCandidate(
  p: GscPageInput,
  proposal: Proposal,
  actionFamily: ReturnType<typeof actionFamilyOf>,
  elig: ExperimentEligibility,
  controls: SuggestedControl[],
): BuiltCandidate {
  const ctrOpportunityClicks = Math.max(0, expectedCtr(p.topQueryPosition) - p.topQueryCtr) * p.topQueryImpressions;
  return {
    url: p.url,
    pageLabel: p.pageLabel,
    pageFamily: pageFamilyOf(p.url),
    actionFamily,
    targetQuery: p.topQuery,
    impressions: p.impressions,
    position: p.topQueryPosition,
    ctr: p.topQueryCtr,
    ownership: p.ownership,
    ctrOpportunityClicks,
    effortMinutes: 1,
    external: { ownershipUncertain: p.ownership < 0.12 },
    leverField: proposal.leverField,
    currentText: proposal.current,
    proposedText: proposal.proposed,
    whyNow: `Ranks #${p.topQueryPosition.toFixed(1)} for "${p.topQuery}" (${p.topQueryImpressions} impr) at ${(p.topQueryCtr * 100).toFixed(1)}% CTR — ${proposal.leverField} is the weak link.`,
    rollbackText: proposal.current,
    eligibility: elig,
    suggestedControls: controls,
    enoughControls: controls.length >= MIN_CONTROLS,
  };
}
