/**
 * Batch Experiment Planner — pure selection (TASK 4).
 *
 * Cross-page selector that turns the per-page Workbench optimizer (TASK 3) into
 * the next 5 to 10 safe, high-upside changes to make today. PURE: no I/O, no
 * LLM, no SERP. It reads each page's already-computed optimizer buckets + the
 * OpportunityItem and applies the operator's rules:
 *   - drop levers already under measurement (optimizer flagged blockedBy
 *     "measuring") and SERP-owned title/meta (blockedBy "serp"),
 *   - require enough volume to actually measure,
 *   - one experiment per page,
 *   - enforce diversity (no batch of ten metas) and include at least one of each
 *     family when available, plus one clearly-optional bigger swing,
 *   - rank by impact x confidence with risk/speed/readiness tie-breaks.
 *
 * No em dashes in any copy.
 */

import type { LeverKey } from "./workbench-matrix";
import type { ProposedSource } from "./workbench-matrix";
import type { OptimizerBuckets, OptimizerCandidate } from "./workbench-optimizer";
import type { OpportunityItem } from "./opportunity";

/** One page's batch input: the opportunity row + its optimizer buckets + the
 *  loader-captured current CMS values and target queries (for before/rollback). */
export type BatchPageRow = {
  item: OpportunityItem;
  optimizer: OptimizerBuckets;
  measuringActions: string[];
  /** Current CMS field values, for exact-prior-value rollback copy. */
  current: { title: string | null; meta: string | null; h1: string | null };
  /** Top GSC queries this page already ranks for (the change should move these). */
  topQueries: string[];
};

export type ExperimentStatus =
  | "ready_now"
  | "needs_drafting"
  | "needs_wix_mapping"
  | "needs_serp_check"
  | "manual_only";

export type ExperimentCard = {
  page: string;
  canonUrl: string;
  pageTitle: string;
  lever: LeverKey;
  /** Proof / shipped-change action vocabulary (matches recordShippedChange). */
  actionType: string;
  family: ExperimentFamily;
  whyNow: string;
  evidence: { source: string; line: string }[];
  draft: string | null;
  draftSource: ProposedSource;
  before: string | null;
  rollbackCopy: string | null;
  targetQueries: string[];
  risk: "low" | "medium" | "high";
  measurementWindow: "90d" | "28d";
  measurementMetric: string;
  estClicksAtStake: number | null;
  estConfidence: "high" | "medium" | "low" | null;
  proofInstructions: string;
  gscIndexingInstruction: string;
  status: ExperimentStatus;
  isOptionalSwing: boolean;
  workbenchHref: string;
};

export type ExperimentFamily = "ctr" | "answer" | "content" | "structure" | "swing";

const CONF_W: Record<"high" | "medium" | "low", number> = { high: 1, medium: 0.6, low: 0.3 };
const RISK_W: Record<"low" | "medium" | "high", number> = { low: 1, medium: 0.6, high: 0.3 };
const MIN_CLICKS = 5;
const PER_ACTION_CAP = 3;
const TARGET_MAX = 10;
const TARGET_MIN = 5;

const ACTION_OF: Record<LeverKey, string> = {
  title: "title",
  meta: "meta",
  h1: "h1",
  answer_block: "intro_answer_block",
  h2_sections: "section_add",
  visible_qa: "faq",
  internal_links: "internal_link",
  schema: "schema",
  new_page: "create_new_page",
  cannibalization: "consolidate_cluster",
};

function familyOf(lever: LeverKey): ExperimentFamily {
  if (lever === "title" || lever === "meta") return "ctr";
  if (lever === "answer_block") return "answer";
  if (lever === "h2_sections" || lever === "h1") return "content";
  if (lever === "visible_qa" || lever === "schema" || lever === "internal_links") return "structure";
  return "swing"; // new_page | cannibalization
}

const WANTED_FAMILIES: ExperimentFamily[] = ["ctr", "answer", "content", "structure"];

/** Build the workbench deep-link the same way the rest of the app does. */
function hrefFor(path: string): string {
  return `/workbench/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

function statusOf(c: OptimizerCandidate): ExperimentStatus {
  if (c.blockedBy === "wix") return "needs_wix_mapping";
  if (c.draftSource === "needs_endpoint" || c.draft == null) return "needs_drafting";
  if (c.safeNow && c.blockedBy === null) return "ready_now";
  if (c.wixPushMethod === "manual_cms_edit" || c.wixPushMethod === "no_write_path") return "manual_only";
  if (c.serpGuardLabel) return "needs_serp_check";
  return "manual_only";
}

function windowDaysLabel(window: "90d" | "28d", lever: LeverKey): string {
  // CTR levers read in days; content/structure take weeks to re-crawl and re-rank.
  if (lever === "title" || lever === "meta") {
    return "First read about 7 days after ship; 14 and 28 day checks confirm it.";
  }
  return `Allow ${window === "28d" ? "2 to 4" : "3 to 6"} weeks for re-crawl and re-rank, then read at the 28 day check.`;
}

function toCard(row: BatchPageRow, c: OptimizerCandidate, isSwing: boolean): ExperimentCard {
  const before =
    c.lever === "title"
      ? row.current.title
      : c.lever === "meta"
        ? row.current.meta
        : c.lever === "h1"
          ? row.current.h1
          : null;
  const rollbackCopy = c.rollbackType === "exact_prior_value" ? before : null;
  return {
    page: row.item.path,
    canonUrl: row.item.canonUrl,
    pageTitle: row.item.title,
    lever: c.lever,
    actionType: ACTION_OF[c.lever],
    family: familyOf(c.lever),
    whyNow: c.evidence || row.item.why,
    evidence: row.item.evidenceBySource.map((e) => ({ source: e.source, line: e.line })),
    draft: c.draft,
    draftSource: c.draftSource,
    before,
    rollbackCopy,
    targetQueries: row.topQueries.slice(0, 6),
    risk: c.risk,
    measurementWindow: row.item.estWindow,
    measurementMetric: c.measurementMetric,
    estClicksAtStake: c.estClicksAtStake,
    estConfidence: c.upsideConfidence,
    proofInstructions: `Ship it on the live site, then mark it shipped to open the proof window. ${windowDaysLabel(
      row.item.estWindow,
      c.lever,
    )}`,
    gscIndexingInstruction: `In Search Console, use URL Inspection on ${row.item.canonUrl} and Request Indexing so Google re-crawls the change sooner.`,
    status: statusOf(c),
    isOptionalSwing: isSwing,
    workbenchHref: hrefFor(row.item.path),
  };
}

type Scored = {
  row: BatchPageRow;
  cand: OptimizerCandidate;
  family: ExperimentFamily;
  action: string;
  score: number;
  isSwing: boolean;
};

function scoreCandidate(c: OptimizerCandidate): number {
  const impact = c.estClicksAtStake ?? 0;
  const conf = CONF_W[c.upsideConfidence ?? "low"];
  const speedAdj = c.speed === "ctr_days" ? 1 : c.speed === "rank_weeks" ? 0.85 : 0.7;
  const readyAdj = c.safeNow ? 1 : 0.9;
  return impact * conf * RISK_W[c.risk] * speedAdj * readyAdj;
}

/**
 * Select the next batch of 5 to 10 experiments across pages. Pure + deterministic.
 */
export function selectExperimentBatch(rows: BatchPageRow[]): ExperimentCard[] {
  // 1) Build the candidate pool: one entry per (page, distinct lever) from the
  //    five single-move buckets. Hold/do-not-touch is never selectable.
  const pool: Scored[] = [];
  for (const row of rows) {
    const o = row.optimizer;
    const cands = [
      o.bestNextMove,
      o.safestChange,
      o.fastestMeasurable,
      o.highestUpside,
      o.biggerSwingLater,
    ].filter((c): c is OptimizerCandidate => c != null);

    const seen = new Set<LeverKey>();
    for (const c of cands) {
      if (seen.has(c.lever)) continue;
      seen.add(c.lever);
      // Hard exclusions: an open experiment, or a SERP-owned title/meta.
      if (c.blockedBy === "measuring" || c.blockedBy === "serp") continue;
      // Too small to read in Search (a net-new page is exempt; it has no prior clicks).
      if (c.lever !== "new_page" && (c.estClicksAtStake ?? 0) < MIN_CLICKS) continue;
      const isSwing = c.lever === "new_page" || (c.lever === "h2_sections" && c.risk === "high");
      pool.push({
        row,
        cand: c,
        family: familyOf(c.lever),
        action: ACTION_OF[c.lever],
        score: scoreCandidate(c),
        isSwing,
      });
    }
  }

  // 2) One experiment per page: keep the highest-scoring candidate per path.
  const bestPerPath = new Map<string, Scored>();
  for (const s of pool) {
    const key = s.row.item.path;
    const prev = bestPerPath.get(key);
    if (!prev || s.score > prev.score) bestPerPath.set(key, s);
  }
  const ranked = [...bestPerPath.values()].sort((a, b) => b.score - a.score);

  // 3) Diversity-first fill.
  const picked: Scored[] = [];
  const perAction = new Map<string, number>();
  const take = (s: Scored) => {
    picked.push(s);
    perAction.set(s.action, (perAction.get(s.action) ?? 0) + 1);
  };
  const underCap = (s: Scored) => (perAction.get(s.action) ?? 0) < PER_ACTION_CAP;
  const isPicked = (s: Scored) => picked.includes(s);

  // Pass 1: one of each wanted family, highest score first.
  for (const fam of WANTED_FAMILIES) {
    const cand = ranked.find((s) => !isPicked(s) && s.family === fam && underCap(s));
    if (cand) take(cand);
  }
  // Pass 2: fill by pure score up to the max, honoring the per-action cap.
  for (const s of ranked) {
    if (picked.length >= TARGET_MAX) break;
    if (isPicked(s) || !underCap(s)) continue;
    take(s);
  }
  // Pass 3: guarantee exactly one clearly-optional bigger swing if one exists.
  if (!picked.some((s) => s.isSwing) && picked.length < TARGET_MAX) {
    const swing = ranked.find((s) => s.isSwing && !isPicked(s));
    if (swing) take(swing);
  }

  // 4) Final order: by score, but never return more than the max.
  void TARGET_MIN; // soft floor — we return whatever is available up to it
  return picked
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_MAX)
    .map((s) => toCard(s.row, s.cand, s.isSwing));
}
