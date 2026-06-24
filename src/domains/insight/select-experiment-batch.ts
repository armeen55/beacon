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
import { workbenchHref } from "./workbench-route";

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

/** Normalize em/en dashes to a hyphen so surfaced copy (drafts, evidence,
 *  before/rollback values pulled from live pages) never carries the em-dash
 *  tell. Hyphen keeps titles near-verbatim for rollback. */
function noDash(s: string): string {
  return s.replace(/\s*[—–]\s*/g, " - ");
}
function noDashN(s: string | null): string | null {
  return s == null ? null : noDash(s);
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
    return "We'll check results around day 7, then again at 14 and 28 days.";
  }
  return `Give Google ${window === "28d" ? "2 to 4" : "3 to 6"} weeks to pick up the change, then we'll check results at day 28.`;
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
    pageTitle: noDash(row.item.title),
    lever: c.lever,
    actionType: ACTION_OF[c.lever],
    family: familyOf(c.lever),
    whyNow: noDash(c.evidence || row.item.why),
    evidence: row.item.evidenceBySource.map((e) => ({ source: e.source, line: noDash(e.line) })),
    draft: noDashN(c.draft),
    draftSource: c.draftSource,
    before: noDashN(before),
    rollbackCopy: noDashN(rollbackCopy),
    targetQueries: row.topQueries.slice(0, 6).map(noDash),
    risk: c.risk,
    measurementWindow: row.item.estWindow,
    measurementMetric: c.measurementMetric,
    estClicksAtStake: c.estClicksAtStake,
    estConfidence: c.upsideConfidence,
    proofInstructions: `Make this change on your website, then click "I made this change" below so we can start measuring it. ${windowDaysLabel(
      row.item.estWindow,
      c.lever,
    )}`,
    gscIndexingInstruction: `Want Google to see this sooner? Open Google Search Console, paste this page address into the search box at the top (${row.item.canonUrl}), then click "Request indexing". This tells Google to come look at your change faster.`,
    status: statusOf(c),
    isOptionalSwing: isSwing,
    workbenchHref: workbenchHref(row.item.path),
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

/** Impact x confidence with risk / speed / readiness tie-breaks. Non-CTR levers
 *  carry no per-lever click estimate, so they fall back to a discounted slice of
 *  the page's overall opportunity value (a content fix captures the page's demand
 *  less directly than a CTR fix, hence the discount). */
function scoreOf(c: OptimizerCandidate, pageEstClicks: number): number {
  const impact = c.estClicksAtStake ?? Math.round(pageEstClicks * 0.5);
  const conf = CONF_W[c.upsideConfidence ?? "low"];
  const speedAdj = c.speed === "ctr_days" ? 1 : c.speed === "rank_weeks" ? 0.85 : 0.7;
  const readyAdj = c.safeNow ? 1 : 0.9;
  return impact * conf * RISK_W[c.risk] * speedAdj * readyAdj;
}

function isSwingLever(c: OptimizerCandidate): boolean {
  return c.lever === "new_page" || c.lever === "cannibalization" || (c.lever === "h2_sections" && c.risk === "high");
}

/**
 * Select the next batch of 5 to 10 experiments across pages. Pure + deterministic.
 */
export function selectExperimentBatch(rows: BatchPageRow[]): ExperimentCard[] {
  // 1) Build the candidate pool. Candidates come from the five single-move
  //    buckets PLUS the drafting/mapping opportunities parked in hold (so a page
  //    whose best move needs a draft still surfaces, routed to the Workbench).
  const pool: Scored[] = [];
  for (const row of rows) {
    // PAGE-LEVEL measuring exclusion: while ANY experiment is measuring on this
    // page, a second change would muddy its window. Skip the whole page, except a
    // non-overlapping cluster (cannibalization) push.
    const pageMeasuring = row.measuringActions.length > 0;
    // audit-8 #1: does the page's OPEN experiment itself overlap the cluster
    // (cannibalization) lever? The carve-out below allows a NON-overlapping
    // cluster push on an otherwise-measuring page — but it must NOT fire when the
    // open experiment IS a cluster consolidation, since re-shipping that is the
    // MAXIMALLY-overlapping change and would reset that exact proof window.
    const clusterMeasuring = row.measuringActions.some(
      (a) => a === ACTION_OF.cannibalization || /consolidat|cannibal|cluster/i.test(a),
    );
    const o = row.optimizer;
    const holds = o.holdDoNotTouch.filter((c) => c.blockedBy === "data" || c.blockedBy === "wix");
    const cands = [
      o.bestNextMove,
      o.safestChange,
      o.fastestMeasurable,
      o.highestUpside,
      o.biggerSwingLater,
      ...holds,
    ].filter((c): c is OptimizerCandidate => c != null);

    const seen = new Set<LeverKey>();
    for (const c of cands) {
      if (seen.has(c.lever)) continue;
      seen.add(c.lever);
      // page under measurement: skip every lever EXCEPT a non-overlapping cluster
      // push — and even that only when the open experiment isn't itself a cluster.
      if (pageMeasuring && (c.lever !== "cannibalization" || clusterMeasuring)) continue;
      if (c.blockedBy === "measuring" || c.blockedBy === "serp") continue; // open / SERP-owned
      // CTR levers need enough volume to read; content/structure levers are judged
      // by position (no click-at-stake estimate) so they are never volume-gated.
      if ((c.lever === "title" || c.lever === "meta") && (c.estClicksAtStake ?? 0) < MIN_CLICKS) continue;
      pool.push({
        row,
        cand: c,
        family: familyOf(c.lever),
        action: ACTION_OF[c.lever],
        score: scoreOf(c, row.item.estClicksAtStake),
        isSwing: isSwingLever(c),
      });
    }
  }
  pool.sort((a, b) => b.score - a.score);

  // 2) Diversity-aware selection, ONE card per page. The diversity pass drives
  //    which page contributes which family, so the batch is not all metas.
  const picked: Scored[] = [];
  const usedPages = new Set<string>();
  const perAction = new Map<string, number>();
  const canTake = (s: Scored) =>
    !usedPages.has(s.row.item.path) && (perAction.get(s.action) ?? 0) < PER_ACTION_CAP;
  const take = (s: Scored) => {
    picked.push(s);
    usedPages.add(s.row.item.path);
    perAction.set(s.action, (perAction.get(s.action) ?? 0) + 1);
  };

  // Pass 1: one of each wanted family (highest score first), distinct pages.
  for (const fam of WANTED_FAMILIES) {
    const cand = pool.find((s) => s.family === fam && canTake(s));
    if (cand) take(cand);
  }
  // Pass 2: fill by score up to the max, honoring per-action cap + one-per-page.
  for (const s of pool) {
    if (picked.length >= TARGET_MAX) break;
    if (canTake(s)) take(s);
  }
  // Pass 3: guarantee one clearly-optional bigger swing if one exists.
  if (!picked.some((s) => s.isSwing) && picked.length < TARGET_MAX) {
    const swing = pool.find((s) => s.isSwing && canTake(s));
    if (swing) take(swing);
  }

  void TARGET_MIN; // soft floor — return whatever is available up to it
  return picked
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_MAX)
    .map((s) => toCard(s.row, s.cand, s.isSwing));
}
