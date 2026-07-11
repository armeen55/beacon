/**
 * Ledger reclassification (runbook step 9). Runs the FROZEN C4 classifier on
 * every ledger row and reports the old-to-new transition with exactly one
 * primary reason code per changed row. COMPUTED ONLY: nothing here persists
 * anything, no verdict is rewritten anywhere (operator decision gates that).
 *
 * Binding verdict rule (C7): the single primary decision window is 28 days.
 * A row whose 28 day window has not closed against the finalized watermark
 * is MEASURING under C4, whatever the deployed system already claimed. The
 * 7 day C4 read is attached as CONTEXT ONLY, clearly labeled.
 */

import {
  addDays,
  pickProofMetric,
  isSnippetCapturePlay,
  summarizeVerdict,
  type ProofWindowResult,
} from "../measure";
import type { C4FrozenConfig, C4Lane, C4Read } from "./types";
import { classifyC4, judgedLaneOf } from "./classifier";
import { evaluateCandidate } from "./matching";
import { buildMatchedNullStats } from "./permutation";
import { normalizePathKey, preStatsFor, windowAgg, windowCovered, type SeriesIndex } from "./series";
import { trafficTierOf } from "../measure";

export type ReasonCode =
  | "METRIC_PREDECLARED"
  | "FLOOR_RAISED"
  | "PERMUTATION_GATE"
  | "IMPRESSIONS_DEMOTED"
  | "CONTROL_SET_RULE"
  | "UNIT_FIX"
  | "INSUFFICIENT_HISTORY"
  | "NOT_VERIFIED_LIVE";

/** Lean, store-independent projection of one shipped_change_proof row. */
export type LedgerRowLite = {
  id: string;
  path: string;
  page: string;
  actionType: string;
  shippedAt: string;
  verdict: string;
  confidence: string;
  controlPages: string[];
  /** Frozen-at-ship donor pool urls that the matcher KEPT or ranked, in
   *  stored order; the only predeclared alternate source (L4b). */
  donorPoolKept: string[];
  baseline: { clicks: number; impressions: number };
  windows: ProofWindowResult[];
  verifiedLive: boolean;
  /** verify_state canonical outcome, or null when never crawl-proven. */
  canonicalVerifyOutcome: string | null;
  /** Last non-success crawl attempt state, or null. */
  lastVerifyAttemptState: string | null;
  operatorVerdictOverride: string | null;
};

export type BindingVerdict = "won" | "lost" | "no_clear_effect" | "insufficient_data" | "measuring";

export type ReclassifiedRow = {
  id: string;
  storedVerdict: string;
  storedMetric: string;
  judgedLane: C4Lane;
  bindingVerdict: BindingVerdict;
  bindingRead: C4Read | null;
  /** Context-only C4 read at the longest CLOSED deployed window (never a
   *  verdict; labeled context on every surface). */
  contextRead: (C4Read & { windowDays: number }) | null;
  primaryReason: ReasonCode | null;
  changed: boolean;
  verification: "crawl_verified" | "operator_attested" | "crawl_not_found" | "unverified";
  controlsUsed: string[];
  controlsDropped: Array<{ path: string; reason: string }>;
  excludedFromWinLoss: boolean;
  notes: string[];
};

function verificationOf(row: LedgerRowLite): ReclassifiedRow["verification"] {
  if (row.canonicalVerifyOutcome === "verified_live" || row.canonicalVerifyOutcome === "verified_live_modified") {
    return "crawl_verified";
  }
  if (row.lastVerifyAttemptState === "not_found") return "crawl_not_found";
  if (row.verifiedLive) return "operator_attested";
  return "unverified";
}

/** Stored-rules read on the STORED windows: reconstructs whether the old
 *  verdict came through the impressions upgrade path (for the reason code). */
function storedWonOnImpressions(row: LedgerRowLite): boolean {
  try {
    const read = summarizeVerdict({
      windows: row.windows,
      baselineImpressions: row.baseline.impressions,
      baselineClicks: row.baseline.clicks,
      metric: pickProofMetric(row.actionType),
      snippetCapturePlay: isSnippetCapturePlay(row.actionType),
    });
    return read.verdict === "won" && read.wonOnImpressions;
  } catch {
    return false;
  }
}

/**
 * Validate the FROZEN AT SHIP control set against the frozen C4 matching
 * bands using PRE ship data only; refill from the predeclared donor pool
 * (never a fresh re-selection). Contaminated controls (treated pages
 * themselves) are dropped and replaced from the same predeclared list.
 */
export function resolveLedgerControls(args: {
  index: SeriesIndex;
  row: LedgerRowLite;
  shipDate: string;
  config: C4FrozenConfig;
  /** Paths of every treated page in the ledger (for contamination checks). */
  treatedPaths: ReadonlySet<string>;
}): { controls: string[]; dropped: Array<{ path: string; reason: string }> } {
  const { index, config } = args;
  const treatedPre = preStatsFor(index, normalizePathKey(args.row.page), args.shipDate, config.preWindowDays);
  const dropped: Array<{ path: string; reason: string }> = [];
  const kept: string[] = [];
  const consider = (candidatePath: string, source: "stored" | "alternate"): boolean => {
    const path = normalizePathKey(candidatePath);
    if (kept.includes(path)) return false;
    if (args.treatedPaths.has(path)) {
      dropped.push({ path, reason: `${source}_contaminated_treated_page` });
      return false;
    }
    const stats = preStatsFor(index, path, args.shipDate, config.preWindowDays);
    const m = evaluateCandidate(treatedPre, stats, config.matching);
    if (!m.pass) {
      dropped.push({ path, reason: `${source}_${m.reason}` });
      return false;
    }
    kept.push(path);
    return true;
  };
  for (const cp of args.row.controlPages) {
    if (kept.length >= config.maxControls) break;
    consider(cp, "stored");
  }
  if (kept.length < config.maxControls) {
    for (const alt of args.row.donorPoolKept) {
      if (kept.length >= config.maxControls) break;
      const path = normalizePathKey(alt);
      if (args.row.controlPages.map(normalizePathKey).includes(path)) continue;
      consider(alt, "alternate");
    }
  }
  return { controls: kept, dropped };
}

/**
 * One C4 read for a ledger row at a given window and control list. Exported
 * standalone so the sensitivity pass (step 10) can re-gate a row under
 * dropped or alternate controls with the IDENTICAL code path.
 */
export function ledgerReadAtWindow(args: {
  index: SeriesIndex;
  rowId: string;
  path: string;
  shipDate: string;
  judgedLane: C4Lane;
  controls: ReadonlyArray<string>;
  windowDays: number;
  config: C4FrozenConfig;
  lastFinalizedDate: string;
  nullPoolPaths: ReadonlyArray<string>;
}): C4Read {
  const { index, config, shipDate, path } = args;
  const preStart = addDays(shipDate, -config.preWindowDays);
  const postEnd = addDays(shipDate, args.windowDays);
  const closed = args.lastFinalizedDate >= addDays(addDays(shipDate, args.windowDays), -1);
  const covered = windowCovered(index, preStart, shipDate) && windowCovered(index, shipDate, postEnd);
  const treatedPreAgg = windowAgg(index, path, preStart, shipDate);
  const tier = trafficTierOf(treatedPreAgg.impressions);
  const floorEntry = config.floors[args.judgedLane][String(args.windowDays)]?.[tier] ?? {
    floor: config.minFloors[args.judgedLane],
    calibrated: false,
    n: 0,
    widened: false,
  };
  const nullPool = args.nullPoolPaths.filter((p) => p !== path && !args.controls.includes(p));
  const nullBuild = buildMatchedNullStats({
    index,
    lane: args.judgedLane,
    shipDate,
    windowDays: args.windowDays,
    poolPaths: nullPool,
    config,
    salt: `ledger:${args.rowId}:${args.windowDays}`,
  });
  return classifyC4({
    lane: args.judgedLane,
    treatedPre: treatedPreAgg,
    treatedPost: windowAgg(index, path, shipDate, postEnd),
    controls: args.controls.map((c) => ({
      pre: windowAgg(index, c, preStart, shipDate),
      post: windowAgg(index, c, shipDate, postEnd),
    })),
    controlsInsufficient: args.controls.length < config.minControls,
    historyComplete: closed && covered,
    floorEntry,
    nullStats: nullBuild.stats,
    config,
  });
}

export function reclassifyLedgerRow(args: {
  index: SeriesIndex;
  row: LedgerRowLite;
  config: C4FrozenConfig;
  lastFinalizedDate: string;
  treatedPaths: ReadonlySet<string>;
  /** Untreated pool paths for the matched null. */
  nullPoolPaths: ReadonlyArray<string>;
}): ReclassifiedRow {
  const { index, row, config } = args;
  const shipDate = row.shippedAt.slice(0, 10);
  const path = normalizePathKey(row.page);
  const storedMetric = pickProofMetric(row.actionType);
  const judgedLane = judgedLaneOf(row.actionType);
  const verification = verificationOf(row);
  const notes: string[] = [];

  const { controls, dropped } = resolveLedgerControls({
    index,
    row,
    shipDate,
    config,
    treatedPaths: args.treatedPaths,
  });

  const readAtWindow = (windowDays: number): C4Read =>
    ledgerReadAtWindow({
      index,
      rowId: row.id,
      path,
      shipDate,
      judgedLane,
      controls,
      windowDays,
      config,
      lastFinalizedDate: args.lastFinalizedDate,
      nullPoolPaths: args.nullPoolPaths,
    });

  // Binding verdict: the single predeclared primary window (C7).
  const primaryClosed =
    args.lastFinalizedDate >= addDays(addDays(shipDate, config.primaryWindowDays), -1);
  let bindingVerdict: BindingVerdict;
  let bindingRead: C4Read | null = null;
  if (!primaryClosed) {
    bindingVerdict = "measuring";
    notes.push(
      `primary ${config.primaryWindowDays} day window closes ${addDays(shipDate, config.primaryWindowDays)}; finalized watermark ${args.lastFinalizedDate}`,
    );
  } else {
    bindingRead = readAtWindow(config.primaryWindowDays);
    bindingVerdict = bindingRead.verdict;
  }

  // Context-only read at the longest CLOSED deployed window (7 first; the
  // deployed 14 day window has no C4 floor and is not read).
  const contextWindow = [7].find(
    (w) => args.lastFinalizedDate >= addDays(addDays(shipDate, w), -1),
  );
  const contextRead = contextWindow != null ? { ...readAtWindow(contextWindow), windowDays: contextWindow } : null;

  const excludedFromWinLoss = verification === "crawl_not_found" || verification === "unverified";

  const storedDecided = row.verdict === "won" || row.verdict === "lost";
  const equivalent =
    (row.verdict === "inconclusive" && bindingVerdict === "no_clear_effect") ||
    row.verdict === bindingVerdict;
  const changed = !equivalent;

  let primaryReason: ReasonCode | null = null;
  if (changed) {
    if (excludedFromWinLoss && storedDecided) primaryReason = "NOT_VERIFIED_LIVE";
    else if (bindingVerdict === "measuring") primaryReason = "INSUFFICIENT_HISTORY";
    else if (bindingRead?.abstention === "insufficient_history") primaryReason = "INSUFFICIENT_HISTORY";
    else if (bindingRead?.abstention === "no_clean_controls" || bindingRead?.abstention === "missing_rate_data") {
      primaryReason = "CONTROL_SET_RULE";
    } else if (storedDecided && storedWonOnImpressions(row)) primaryReason = "IMPRESSIONS_DEMOTED";
    else if (storedMetric === "position") primaryReason = "METRIC_PREDECLARED";
    else if (bindingRead != null && bindingRead.stat != null && bindingRead.floor != null) {
      const clearedFloor = Math.abs(bindingRead.stat) >= bindingRead.floor;
      const passedGate = bindingRead.permutationP != null && bindingRead.permutationP <= config.permutation.alpha;
      if (clearedFloor && !passedGate) {
        // The verdict now hinges on the null. For CTR judged rows the old
        // null compared wrong units (the confirmed unit bug), so the
        // unit-correct null IS the change; other lanes get the plain gate.
        primaryReason = judgedLane === "ctr" ? "UNIT_FIX" : "PERMUTATION_GATE";
      } else {
        primaryReason = "FLOOR_RAISED";
      }
    } else {
      primaryReason = "CONTROL_SET_RULE";
    }
  }

  if (row.operatorVerdictOverride === "inconclusive") {
    notes.push("operator override pinned the stored verdict to inconclusive");
  }

  return {
    id: row.id,
    storedVerdict: row.verdict,
    storedMetric,
    judgedLane,
    bindingVerdict,
    bindingRead,
    contextRead,
    primaryReason,
    changed,
    verification,
    controlsUsed: controls,
    controlsDropped: dropped,
    excludedFromWinLoss,
    notes,
  };
}
