import "server-only";

/** Tenant examples are requalified against the full ledger before they can teach a writer. */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import { loadShippedChangesForTenant, type ShippedChangeRecord } from "@/domains/measurement/proof-gsc/shipped-change-store";
import { SHIPMENT_PROOF } from "@/domains/measurement/proof-gsc/shipment-proof";
import { actionFamilyOf, type ExperimentFamily } from "@/domains/measurement/proof-gsc/change-family";
import { readRecordsForLearning, learningVerdictOf } from "@/domains/measurement/proof-gsc/kernel";
import { classifyDraftPattern, aggregateWinsByPattern, bestConfidentPattern, patternInsightSentence, MIN_DECIDED_FOR_CONFIDENCE, PATTERN_LABEL, type DraftPatternId, type PatternOutcomeRow, type PatternCellTally } from "./draft-pattern";

const STORE = "winner-memory";
/** Newest-first cap per (tenant, actionFamily) - keep the store small and the
 *  few-shot fragment cheap; this is house-style memory, not an archive. */
const MAX_PER_FAMILY = 10;
/** How many of the retained winners get injected as few-shot examples. */
const FEW_SHOT_COUNT = 2;

type StructuralFeatures = {
  wordCount: number;
  /** First ~15 words read as a direct, concrete answer/claim rather than a
   *  dictionary-style definition or a deferral ("it depends", "varies"). */
  leadsWithAnswer: boolean;
  /** Contains at least one digit (a stat, a date, a price, a count). */
  hasNumber: boolean;
  /** The text (or its first heading-shaped line) is phrased as a question. */
  questionHeading: boolean;
};

type WinnerExample = {
  shipmentId?: string;
  appliedHash?: string;
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
 * Deterministic structural fingerprint of one piece of shipped copy. PURE, no I/O. Used both to build the winner store and (via the same function) to describe
 * the guidance line injected alongside the few-shot examples.
 */
function extractStructuralFeatures(text: string): StructuralFeatures {
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
  return readStore<StoredRow>(STORE, []);
}

/** Latest 28-day window's adjustedCtrLift, or null when not present. */
function matureCtrLift(record: ShippedChangeRecord): number | null {
  const w28 = record.windows.find((w) => w.day === 28 && w.ran);
  return w28 ? w28.adjustedCtrLift : null;
}

const appliedCopy = (r: ShippedChangeRecord): string => SHIPMENT_PROOF.components(r).map((c) => c.after).filter(Boolean).join("\n\n").trim();

/**
 * Read every mature, cleanly-won shipped change for this tenant, extract the before/after text + structural features, and persist the top MAX_PER_FAMILY
 * per actionFamily (newest ship first). Idempotent - re-running against the same ledger yields the same stored rows. Fail-soft: any error is swallowed and logged; callers never need a try/catch of their own.
 */
/** A recorded shipment whose own text still carries blanks: the words on the page are not the words on file, so it teaches nothing. */
const UNRECORDED = /\[[^\]]*\]|_{3,}|\b(?:NUMBER|YEAR|SOURCE|TBD|XXX+)\b/;

export async function harvestWinners(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<{ harvested: number; families: number }> {
  if (!tenantId) return { harvested: 0, families: 0 };
  const now = opts.now ?? new Date();
  try {
    const records = await loadShippedChangesForTenant(tenantId), reads = readRecordsForLearning(records, now);
    const won = records.filter((_, i) => learningVerdictOf(reads[i]!) === "won");

    // A SHIPMENT WHOSE RECORDED WORDING STILL CARRIES BLANKS TAUGHT NOTHING, because those are not the words that went live. /tabriz and /isfahan were shipped as "<City> has a population of NUMBER as of
    // YEAR (SOURCE)." and the operator filled the blanks by hand, so the ledger holds a template and the page holds the real line. Left in, the template becomes a WinnerExample and this product starts
    // teaching itself to write blanks; it also classifies as prose_other while its filled-in twin /shiraz classifies as stat_first, so one intended change lands in two pattern cells. Out until the
    // published wording is recorded, which is a fact about the RECORD and not a judgement about the change.
    const byFamily = new Map<ExperimentFamily, WinnerExample[]>();
    for (const r of won) {
      const afterText = appliedCopy(r);
      if (afterText === "" || UNRECORDED.test(afterText)) continue; // nothing to learn from - honest skip, no fabrication
      const family = actionFamilyOf(r.actionType);
      const example: WinnerExample = {
        shipmentId: r.id, appliedHash: SHIPMENT_PROOF.of(r)!.appliedHash,
        tenantId,
        actionFamily: family,
        page: r.page,
        beforeText: SHIPMENT_PROOF.components(r).map((c) => c.before).filter(Boolean).join("\n\n") || null,
        afterText,
        features: extractStructuralFeatures(afterText),
        pattern: classifyDraftPattern(afterText),
        measuredLift: matureCtrLift(r),
        verdict: "won",
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
    const identity = (rows: WinnerExample[]): string => JSON.stringify(rows.map(({ capturedAt: _capturedAt, ...r }) => r).sort((a, b) => (a.shipmentId ?? "").localeCompare(b.shipmentId ?? "")));
    if (identity(all.filter((r) => r.tenantId === tenantId)) === identity(nextForTenant)) return { harvested: 0, families: byFamily.size };
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

/** Cached examples require current applied-copy and measurement qualification. */
async function loadWinners(tenantId: string): Promise<WinnerExample[]> {
  if (!tenantId) return [];
  try {
    const all = await readAll();
    const records = await loadShippedChangesForTenant(tenantId), reads = readRecordsForLearning(records);
    const qualified = new Map(records.filter((_, i) => learningVerdictOf(reads[i]!) === "won").map((r) => [r.id, r]));
    return all
      .filter((r) => r.tenantId === tenantId)
      .filter((w) => { const r = qualified.get(w.shipmentId ?? ""); return r != null && SHIPMENT_PROOF.of(r)?.appliedHash === w.appliedHash && appliedCopy(r) === w.afterText; })
      .sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** Retained winners for one tenant + actionFamily/lever, newest ship first. */
async function loadWinnersForLever(
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
 * Build a prompt fragment showing the top FEW_SHOT_COUNT same-lever MEASURED winners (real ships that reached a mature "won" verdict), each with its
 * structural fingerprint. Returns '' when no winners exist for this tenant + lever - the caller must leave the prompt byte-identical to today in that
 * case (no example section, no placeholder text). Additive only: this text is appended to an existing system prompt, never substituted for it.
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
      // Honest: no prior text survives in the ledger for this ship - retain the winning AFTER text + its structural fingerprint only, say so plainly.
      lines.push(`- Winning text (no prior text retained): "${w.afterText}" (${liftPct}; ${featureLine(w.features)})`);
    }
  }
  return lines.join("\n");
}

// ── pattern aggregation (BEACON_500 item 74) ──────────────────────────────── Read-time only: classifies EVERY decided shipped artifact (win, loss, or flat -
// not just wins) into a structural pattern and tallies outcomes by (pattern, pageFamily). Never mutates shipped_change_proof or move_drafts - this is a pure
// projection computed fresh from loadShippedChanges() on every call.

/** Map a mature kernel read to the pattern-tally vocabulary. A 28-day directional
 *  improvement is "won", a decline "lost", clear-but-flat "inconclusive"; a read
 *  that has not matured, is confounded, or is too thin is null (excluded). */
function decidedVerdictOf(
  read: ReturnType<typeof readRecordsForLearning>[number],
): "won" | "lost" | "inconclusive" | null {
  if (read.learning.eligible !== true || read.basisDay !== 28) return null; // still measuring or unqualified
  if (read.verdict === "confounded" || read.verdict === "insufficient_evidence") return null;
  if (read.verdict === "directional_improvement" || read.verdict === "stronger_improvement") return "won";
  if (read.verdict === "directional_decline") return "lost";
  return "inconclusive";
}

/** One shipped artifact tagged with its pattern + page family - the row shape the
 *  aggregate is built from, retained alongside the tally so a caller can point at a
 *  REAL example page for a confident cell (never a fabricated "the block that won"). */
type TaggedShippedRow = PatternOutcomeRow & { page: string };

/** Same read as loadPatternAggregate, but also returns the tagged rows the tally was
 *  built from (so a caller can name a real winning page for a confident cell). */
async function loadPatternAggregateWithRows(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<{ cells: PatternCellTally[]; rows: TaggedShippedRow[] }> {
  if (!tenantId) return { cells: [], rows: [] };
  const now = opts.now ?? new Date();
  try {
    const records = await loadShippedChangesForTenant(tenantId);
    const reads = readRecordsForLearning(records, now);
    const rows: TaggedShippedRow[] = [];
    records.forEach((r, i) => {
      const afterText = appliedCopy(r);
      if (afterText === "" || UNRECORDED.test(afterText)) return; // nothing to classify - honest skip
      const verdict = decidedVerdictOf(reads[i]);
      if (verdict == null) return; // pending / confounded / thin - excluded from the tally
      rows.push({
        pattern: classifyDraftPattern(afterText),
        pageFamily: pageFamilyOfUrl(r.page || r.path),
        verdict,
        citationVerdict: null,
        page: r.page || r.path,
      });
    });
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
 * Pattern-aware few-shot fragment (item 74): same winning examples as buildWinnerFewShots, but when the pattern aggregate has a CONFIDENT cell for this
 * move's page family, appends one explicit style hint naming the winning pattern. Returns the EXACT SAME string as buildWinnerFewShots (byte-identical) whenever no
 * confident cell exists for this page family - the caller's prompt is unaffected until the ledger has actually earned an opinion. Examples are always framed as
 * STYLE references only; the caller's system prompt still owns the no-invented- numbers rule for the model's own output.
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
