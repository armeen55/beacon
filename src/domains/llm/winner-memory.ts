import "server-only";

/**
 * winner-memory (BEACON_500 item 30, 2026-07-02) - feeds the drafters the house's
 * own MEASURED winners instead of letting every draft rediscover style nightly.
 *
 * daily-experiment-planner.ts's aggregateSettled already tallies won/lost/flat per
 * (pageFamily, actionFamily) for a debate line. This module goes one step
 * further: it retains the actual winning before/after TEXT (when the ledger has
 * it) plus deterministic structural features, and turns the top examples per
 * actionFamily into few-shot prompt fragments for structured-drafter.ts.
 *
 * Honesty notes:
 *   - ShippedChangeRecord.before/after are free-text fields the operator or the
 *     auto-record path may or may not populate (e.g. a title/meta edit records
 *     the literal before/after strings; an answer-block or new-page ship often
 *     only has the after text, or neither). When `before` is missing we retain
 *     `afterText` alone and mark `beforeText: null` - we NEVER fabricate a prior.
 *   - Only MATURE, cleanly-measured "won" verdicts are harvested (deriveMeasurementMaturity
 *     === "mature_result" + verdict "won"). An early/interim signal or an
 *     inconclusive/lost result is never retained as a "winner".
 *   - Idempotent: harvesting twice on the same ledger produces the same stored
 *     set (newest ship first, capped at MAX_PER_FAMILY). Fail-soft everywhere;
 *     never throws into a caller.
 *
 * PURE feature extractor (extractStructuralFeatures) is unit-tested directly;
 * harvestWinners/buildWinnerFewShots do I/O and are covered by the store round-trip.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import { loadShippedChanges, type ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { actionFamilyOf, type ExperimentFamily } from "@/domains/proof-gsc/change-family";
import { deriveMeasurementMaturity } from "@/domains/proof-gsc/measurement-maturity";
import { isCalibratedVerdict } from "@/domains/proof-gsc/verdict-calibration";
import { classifyDraftPattern, aggregateWinsByPattern, bestConfidentPattern, patternInsightSentence, MIN_DECIDED_FOR_CONFIDENCE, PATTERN_LABEL, type DraftPatternId, type PatternOutcomeRow, type PatternCellTally } from "./draft-pattern";

const STORE = "winner-memory";
/** Newest-first cap per (tenant, actionFamily) - keep the store small and the
 *  few-shot fragment cheap; this is house-style memory, not an archive. */
const MAX_PER_FAMILY = 10;
/** How many of the retained winners get injected as few-shot examples. */
const FEW_SHOT_COUNT = 2;

export type StructuralFeatures = {
  wordCount: number;
  /** First ~15 words read as a direct, concrete answer/claim rather than a
   *  dictionary-style definition or a deferral ("it depends", "varies"). */
  leadsWithAnswer: boolean;
  /** Contains at least one digit (a stat, a date, a price, a count). */
  hasNumber: boolean;
  /** The text (or its first heading-shaped line) is phrased as a question. */
  questionHeading: boolean;
};

export type WinnerExample = {
  tenantId: string;
  actionFamily: ExperimentFamily;
  page: string;
  /** The prior text, when the ledger actually recorded it. Honest null otherwise. */
  beforeText: string | null;
  afterText: string;
  features: StructuralFeatures;
  /** BEACON_500 item 74: the winning text's deterministic structural pattern, computed
   *  once at harvest time from the same afterText these features were extracted from. */
  pattern: DraftPatternId;
  /** Observational CTR lift (0-1 scale) from the mature 28-day window, when known. */
  measuredLift: number | null;
  verdict: "won";
  /** Fail-closed calibration quarantine, review fix 6 (2026-07-11): the source
   *  record's classifier version, copied at harvest time. Optional so a winner
   *  persisted BEFORE the quarantine reads as null = uncalibrated, and the read
   *  path below (loadWinners) refuses to serve it as a few-shot - the store is
   *  history, but only calibrated wins may teach the drafters. */
  calibrationVersion?: string | null;
  shippedAt: string;
  capturedAt: string;
};

// ── pure feature extraction ────────────────────────────────────────────────

const DEFERRAL_OPENERS = /^(it depends|varies|check|see|consult|refer to|this depends)\b/i;
/** A generic dictionary-style opener ("X is a ...", "X refers to ...") - the
 *  opposite of a direct, concrete answer. */
const DICTIONARY_OPENER = /^\s*[a-z0-9][^.!?]{0,80}\b(is|are|refers to|means)\b\s+(a|an|the)\b/i;

function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(" ");
}

function firstLine(text: string): string {
  return (text.split(/\n/)[0] ?? "").trim();
}

/**
 * Deterministic structural fingerprint of one piece of shipped copy. PURE, no I/O.
 * Used both to build the winner store and (via the same function) to describe
 * the guidance line injected alongside the few-shot examples.
 */
export function extractStructuralFeatures(text: string): StructuralFeatures {
  const t = (text ?? "").trim();
  if (t === "") {
    return { wordCount: 0, leadsWithAnswer: false, hasNumber: false, questionHeading: false };
  }
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  const lead = firstWords(t, 15);
  const leadsWithAnswer = !DEFERRAL_OPENERS.test(lead) && !DICTIONARY_OPENER.test(lead) && wordCount > 0;
  const hasNumber = /\d/.test(t);
  const heading = firstLine(t);
  const questionHeading = /\?\s*$/.test(heading) || /^(what|when|where|who|why|how|which|is|are|does|do|can)\b/i.test(heading);
  return { wordCount, leadsWithAnswer, hasNumber, questionHeading };
}

// ── harvest ─────────────────────────────────────────────────────────────────

type StoredRow = WinnerExample;

async function readAll(): Promise<StoredRow[]> {
  try {
    return await readStore<StoredRow>(STORE, []);
  } catch {
    return [];
  }
}

/** Latest 28-day window's adjustedCtrLift, or null when not present. */
function matureCtrLift(record: ShippedChangeRecord): number | null {
  const w28 = record.windows.find((w) => w.day === 28 && w.ran);
  return w28 ? w28.adjustedCtrLift : null;
}

function isMatureWon(record: ShippedChangeRecord, now: Date): boolean {
  if (record.verdict !== "won") return false;
  // Fail-closed calibration quarantine (2026-07-11): an uncalibrated "won" is
  // not a trustworthy winner, so it is never harvested as house style. With no
  // calibrated wins, buildWinnerFewShots returns "" and the drafters run without
  // few-shots (their existing designed fallback).
  if (!isCalibratedVerdict(record)) return false;
  const maturity = deriveMeasurementMaturity({
    shippedAt: record.shippedAt,
    now,
    latestGscDate: record.measuredAt,
    windows: record.windows.map((w) => ({ day: w.day, ran: w.ran })),
    verdict: record.verdict,
    controlsUsed: record.controlPages.length,
    baselineImpressions: record.baseline?.impressions ?? 0,
    live: record.verifiedLive,
  });
  return maturity === "mature_result";
}

/**
 * Read every mature, cleanly-won shipped change for this tenant, extract the
 * before/after text + structural features, and persist the top MAX_PER_FAMILY
 * per actionFamily (newest ship first). Idempotent - re-running against the
 * same ledger yields the same stored rows. Fail-soft: any error is swallowed
 * and logged; callers never need a try/catch of their own.
 */
export async function harvestWinners(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<{ harvested: number; families: number }> {
  if (!tenantId) return { harvested: 0, families: 0 };
  const now = opts.now ?? new Date();
  try {
    const records = await loadShippedChanges();
    const won = records.filter((r) => isMatureWon(r, now));

    const byFamily = new Map<ExperimentFamily, WinnerExample[]>();
    for (const r of won) {
      const afterText = (r.after ?? "").trim();
      if (afterText === "") continue; // nothing to learn from - honest skip, no fabrication
      const family = actionFamilyOf(r.actionType);
      const example: WinnerExample = {
        tenantId,
        actionFamily: family,
        page: r.page,
        beforeText: r.before && r.before.trim() !== "" ? r.before.trim() : null,
        afterText,
        features: extractStructuralFeatures(afterText),
        pattern: classifyDraftPattern(afterText),
        measuredLift: matureCtrLift(r),
        verdict: "won",
        // Review fix 6: copy the source record's version so the READ path can
        // re-verify calibration at serve time (a later registry change or a
        // legacy stored row must never leak an uncalibrated few-shot).
        calibrationVersion: r.calibrationVersion ?? null,
        shippedAt: r.shippedAt,
        capturedAt: now.toISOString(),
      };
      const list = byFamily.get(family) ?? [];
      list.push(example);
      byFamily.set(family, list);
    }

    const nextForTenant: WinnerExample[] = [];
    for (const [, list] of byFamily) {
      const capped = [...list]
        .sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1)) // newest ship first
        .slice(0, MAX_PER_FAMILY);
      nextForTenant.push(...capped);
    }

    const all = await readAll();
    const others = all.filter((r) => r.tenantId !== tenantId);
    await writeStore(STORE, [...others, ...nextForTenant]);

    return { harvested: nextForTenant.length, families: byFamily.size };
  } catch (e) {
    log.warn("[winner-memory] harvest failed (non-blocking)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { harvested: 0, families: 0 };
  }
}

/** Retained winners for one tenant, newest ship first. Fail-soft → [].
 *  Fail-closed calibration quarantine, review fix 6 (2026-07-11): the READ path
 *  is gated too - a stored winner persisted before the quarantine (no version on
 *  record) or under an unregistered version is never served as a few-shot, even
 *  though it stays in the store as history. Every few-shot builder flows through
 *  here (loadWinnersForLever -> buildWinnerFewShots), so one gate covers all. */
export async function loadWinners(tenantId: string): Promise<WinnerExample[]> {
  if (!tenantId) return [];
  try {
    const all = await readAll();
    return all
      .filter((r) => r.tenantId === tenantId)
      .filter((r) => isCalibratedVerdict({ verdict: r.verdict, calibrationVersion: r.calibrationVersion ?? null }))
      .sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** Retained winners for one tenant + actionFamily/lever, newest ship first. */
export async function loadWinnersForLever(
  tenantId: string,
  lever: ExperimentFamily,
): Promise<WinnerExample[]> {
  const all = await loadWinners(tenantId);
  return all.filter((w) => w.actionFamily === lever);
}

// ── few-shot prompt injection ───────────────────────────────────────────────

function featureLine(f: StructuralFeatures): string {
  const bits: string[] = [`${f.wordCount} words`];
  bits.push(f.leadsWithAnswer ? "leads with a direct answer" : "does not lead with a direct answer");
  bits.push(f.hasNumber ? "includes a concrete number" : "no number");
  bits.push(f.questionHeading ? "question-form heading" : "statement-form heading");
  return bits.join(", ");
}

/**
 * Build a prompt fragment showing the top FEW_SHOT_COUNT same-lever MEASURED
 * winners (real ships that reached a mature "won" verdict), each with its
 * structural fingerprint. Returns '' when no winners exist for this tenant +
 * lever - the caller must leave the prompt byte-identical to today in that
 * case (no example section, no placeholder text). Additive only: this text is
 * appended to an existing system prompt, never substituted for it.
 */
export async function buildWinnerFewShots(
  tenantId: string,
  lever: ExperimentFamily,
): Promise<string> {
  if (!tenantId) return "";
  const winners = await loadWinnersForLever(tenantId, lever);
  if (winners.length === 0) return "";

  const top = winners.slice(0, FEW_SHOT_COUNT);
  const lines: string[] = [
    "",
    `House patterns that measurably lifted CTR for this kind of change (${top.length} real example${top.length > 1 ? "s" : ""}, use as STYLE guidance only, never copy the topic):`,
  ];
  for (const w of top) {
    const liftPct = w.measuredLift != null ? `${(w.measuredLift * 100).toFixed(1)}pp CTR lift` : "measured win";
    if (w.beforeText) {
      lines.push(`- Before: "${w.beforeText}" -> After: "${w.afterText}" (${liftPct}; ${featureLine(w.features)})`);
    } else {
      // Honest: no prior text survives in the ledger for this ship - retain the
      // winning AFTER text + its structural fingerprint only, say so plainly.
      lines.push(`- Winning text (no prior text retained): "${w.afterText}" (${liftPct}; ${featureLine(w.features)})`);
    }
  }
  return lines.join("\n");
}

// ── pattern aggregation (BEACON_500 item 74) ────────────────────────────────
// Read-time only: classifies EVERY decided shipped artifact (win, loss, or flat -
// not just wins) into a structural pattern and tallies outcomes by (pattern,
// pageFamily). Never mutates shipped_change_proof or move_drafts - this is a pure
// projection computed fresh from loadShippedChanges() on every call.

/** A mature/decided GSC verdict counts toward the pattern tally; "measuring" (an
 *  active, still-running window) is honestly excluded as pending, matching the
 *  same maturity gate harvestWinners already applies to "won". */
function isDecided(record: ShippedChangeRecord, now: Date): boolean {
  if (record.verdict === "measuring") return false;
  // Fail-closed calibration quarantine (2026-07-11): the pattern aggregate learns
  // "which structure wins" from decided verdicts, so an uncalibrated row must not
  // feed it either. With no calibrated decided rows the aggregate is empty and
  // buildWinnerFewShotsWithPattern adds no style hint (byte-identical to a fresh
  // tenant).
  if (!isCalibratedVerdict(record)) return false;
  const maturity = deriveMeasurementMaturity({
    shippedAt: record.shippedAt,
    now,
    latestGscDate: record.measuredAt,
    windows: record.windows.map((w) => ({ day: w.day, ran: w.ran })),
    verdict: record.verdict,
    controlsUsed: record.controlPages.length,
    baselineImpressions: record.baseline?.impressions ?? 0,
    live: record.verifiedLive,
  });
  return maturity === "mature_result" || maturity === "inconclusive";
}

function ledgerVerdictOf(record: ShippedChangeRecord): "won" | "lost" | "inconclusive" | "insufficient_data" {
  if (record.verdict === "won") return "won";
  if (record.verdict === "lost") return "lost";
  if (record.verdict === "insufficient_data") return "insufficient_data";
  return "inconclusive";
}

/** One shipped artifact tagged with its pattern + page family - the row shape the
 *  aggregate is built from, retained alongside the tally so a caller can point at a
 *  REAL example page for a confident cell (never a fabricated "the block that won"). */
export type TaggedShippedRow = PatternOutcomeRow & { page: string };

/**
 * Read every shipped artifact for this tenant (any verdict, not just wins), classify
 * its after-text pattern, and tally decided outcomes by (pattern, pageFamily). Cells
 * below MIN_DECIDED_FOR_CONFIDENCE stay `confident: false` in the output - callers
 * must never quote a winRate from an unconfident cell. Fail-soft -> [] on any error.
 */
export async function loadPatternAggregate(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<PatternCellTally[]> {
  const { cells } = await loadPatternAggregateWithRows(tenantId, opts);
  return cells;
}

/** Same read as loadPatternAggregate, but also returns the tagged rows the tally was
 *  built from (so a caller can name a real winning page for a confident cell). */
export async function loadPatternAggregateWithRows(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<{ cells: PatternCellTally[]; rows: TaggedShippedRow[] }> {
  if (!tenantId) return { cells: [], rows: [] };
  const now = opts.now ?? new Date();
  try {
    const records = await loadShippedChanges();
    const rows: TaggedShippedRow[] = [];
    for (const r of records) {
      const afterText = (r.after ?? "").trim();
      if (afterText === "") continue; // nothing to classify - honest skip
      if (!isDecided(r, now)) continue; // pending window - excluded from the tally entirely
      rows.push({
        pattern: classifyDraftPattern(afterText),
        pageFamily: pageFamilyOfUrl(r.page || r.path),
        verdict: ledgerVerdictOf(r),
        citationVerdict: r.citationOutcome?.verdict ?? null,
        page: r.page || r.path,
      });
    }
    return { cells: aggregateWinsByPattern(rows), rows };
  } catch (e) {
    log.warn("[winner-memory] pattern aggregate failed (non-blocking)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { cells: [], rows: [] };
  }
}

/** The most recent WON page matching a confident cell's (pattern, pageFamily), or null
 *  when none of the decided rows for that cell happened to be a win (a confident cell
 *  can be confident about a LOSS pattern too - never invent a "won on X" claim then). */
function winningPageForCell(rows: TaggedShippedRow[], cell: PatternCellTally): string | null {
  const match = rows.find((r) => r.pattern === cell.pattern && r.pageFamily === cell.pageFamily && r.verdict === "won");
  return match?.page ?? null;
}

/** First path segment groups a page family (mirrors daily-experiment-planner's
 *  pageFamilyOf, duplicated here as a tiny pure helper to avoid an experiments->llm
 *  edit surface; both must stay in lockstep with the same "first path segment" rule). */
function pageFamilyOfUrl(urlOrPath: string): string {
  const path = (urlOrPath ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

/**
 * Pattern-aware few-shot fragment (item 74): same winning examples as
 * buildWinnerFewShots, but when the pattern aggregate has a CONFIDENT cell for this
 * move's page family, appends one explicit style hint naming the winning pattern.
 * Returns the EXACT SAME string as buildWinnerFewShots (byte-identical) whenever no
 * confident cell exists for this page family - the caller's prompt is unaffected
 * until the ledger has actually earned an opinion. Examples are always framed as
 * STYLE references only; the caller's system prompt still owns the no-invented-
 * numbers rule for the model's own output.
 */
export async function buildWinnerFewShotsWithPattern(
  tenantId: string,
  lever: ExperimentFamily,
  pageFamily: string,
): Promise<{ fragment: string; patternHint: (PatternCellTally & { winningPage: string | null }) | null }> {
  const fragment = await buildWinnerFewShots(tenantId, lever);
  if (!tenantId || !pageFamily) return { fragment, patternHint: null };
  const { cells, rows } = await loadPatternAggregateWithRows(tenantId);
  const best = bestConfidentPattern(cells, pageFamily);
  if (!best) return { fragment, patternHint: null };
  const winningPage = winningPageForCell(rows, best);
  const hintLine = `\nWinning style for ${pageFamily} pages here: ${patternInsightSentence(best)} Where it fits the topic, favor a ${PATTERN_LABEL[best.pattern]} structure - this is a STYLE cue only, never license to invent a number that is not in the grounding.`;
  return { fragment: fragment + hintLine, patternHint: { ...best, winningPage } };
}

/** Re-exported for callers that only need the sample floor constant. */
export { MIN_DECIDED_FOR_CONFIDENCE };
export type { DraftPatternId, PatternCellTally };
