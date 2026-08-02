/**
 * draft-pattern (BEACON_500 item 74) - deterministic structural fingerprinting for a
 * drafted/shipped block of copy, PLUS a pure aggregation of proof-ledger outcomes by
 * (pattern, page family) so the drafter can eventually say "stat-first blocks win here".
 *
 * Two responsibilities, both PURE (no I/O, no LLM):
 *   1. classifyDraftPattern(text) - a single deterministic pattern id from the content's
 *      own markdown/HTML/plain-text shape. Never guesses intent, only reads structure.
 *   2. aggregateWinsByPattern(rows) - tallies decided (non-pending) proof-ledger verdicts
 *      by (pattern, pageFamily), with a hard minimum-sample floor before any cell is
 *      considered "confident" enough to quote. Below the floor the cell stays silent,
 *      exactly the discipline the planner's proof-history voice already uses for (pageFamily,
 *      actionFamily) tallies.
 *
 * Tenant-agnostic: pattern ids and page families are derived from content/URLs, never a
 * hardcoded topic list (English-first, no tenant-specific vocabulary anywhere in here).
 */

export type DraftPatternId =
  | "definition_first"
  | "stat_first"
  | "table"
  | "qa_pair"
  | "step_list"
  | "prose_other";

/** Human-safe, jargon-free label for a pattern id - usable directly in operator copy. */
export const PATTERN_LABEL: Record<DraftPatternId, string> = {
  definition_first: "definition-first",
  stat_first: "stat-first",
  table: "table",
  qa_pair: "question and answer",
  step_list: "step list",
  prose_other: "plain prose",
};

const STEP_LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+\S/m;
const TABLE_ROW = /^\s*\|.*\|\s*$/m;
const TABLE_SEPARATOR = /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/m;
const HEADING_QUESTION = /^\s*#{0,6}\s*.*\?\s*$/m;
const WH_QUESTION_OPEN = /^\s*#{0,6}\s*(what|when|where|who|why|how|which|is|are|does|do|can)\b/i;
const DICTIONARY_OPENER = /^\s*[a-z0-9][^.!?]{0,80}\b(is|are|refers to|means)\b\s+(a|an|the)\b/i;
const NUMBER_LEAD = /^\s*\D{0,40}?\d[\d,.]*\s*(%|percent|x|times|per|million|billion|thousand)?\b/i;

function stripMarkup(text: string): string {
  return text.replace(/<[^>]+>/g, " ");
}

function firstWords(text: string, n: number): string {
  return text.trim().split(/\s+/).slice(0, n).join(" ");
}

function countLines(text: string, re: RegExp): number {
  const matches = text.match(new RegExp(re.source, `${re.flags.includes("g") ? re.flags : `${re.flags}g`}`));
  return matches ? matches.length : 0;
}

/**
 * Classify one draft/answer-block's content into a single structural pattern id.
 * Deterministic, order-of-checks matters (most distinctive shape wins first):
 *   table > step_list > qa_pair > stat_first > definition_first > prose_other.
 * A table or a >=2-row step list is a stronger structural signal than a numeric lead,
 * so those checks run first - text can accidentally start with a digit (a date, a
 * count) without being "a list" or "a table".
 */
export function classifyDraftPattern(raw: string): DraftPatternId {
  const text = stripMarkup(raw ?? "").trim();
  if (text === "") return "prose_other";

  // Table: at least one markdown pipe-row plus a header-separator row, OR >=2 pipe rows.
  const pipeRows = countLines(text, TABLE_ROW);
  if (TABLE_SEPARATOR.test(text) || pipeRows >= 2) return "table";

  // Step list: at least 2 bullet/numbered lines (one alone could just be a stray dash).
  const listLines = countLines(text, STEP_LIST_LINE);
  if (listLines >= 2) return "step_list";

  // Q&A pair: a question-form heading/line followed by more content, or the text is
  // itself framed as a direct question-answer exchange.
  const firstLine = (text.split(/\n/)[0] ?? "").trim();
  if ((HEADING_QUESTION.test(firstLine) || WH_QUESTION_OPEN.test(firstLine)) && text.split(/\n/).length > 1) {
    return "qa_pair";
  }
  if (/\?/.test(firstLine) && firstLine.length <= 140) return "qa_pair";

  // Stat-first: the opening ~12 words carry a concrete number (not just a dictionary
  // opener that happens to mention a count later).
  const lead = firstWords(text, 12);
  if (NUMBER_LEAD.test(lead) || /^\s*\d/.test(text)) return "stat_first";

  // Definition-first: the classic "X is a/an/the ..." dictionary opener.
  if (DICTIONARY_OPENER.test(lead)) return "definition_first";

  return "prose_other";
}

// ── aggregation ──────────────────────────────────────────────────────────────

/** Minimum DECIDED (non-pending) samples in a (pattern, pageFamily) cell before its
 *  win rate is trusted enough to surface anywhere. Below this the cell stays silent. */
export const MIN_DECIDED_FOR_CONFIDENCE = 3;

type LedgerVerdict = "won" | "lost" | "inconclusive" | "insufficient_data" | "measuring";

/** One shipped artifact's outcome, already resolved to a page family + verdict by the
 *  caller (this module never touches the ledger or Supabase itself). */
export type PatternOutcomeRow = {
  pattern: DraftPatternId;
  pageFamily: string;
  verdict: LedgerVerdict;
  /** Optional citation verdict riding alongside the GSC verdict (master plan item 5),
   *  folded into the same win/loss tally when present, since a citation win is also a
   *  real win for an answer-shaped block even when the GSC read is still inconclusive. */
  citationVerdict?: "gained" | "lost" | "no_change" | "insufficient_data" | null;
};

export type PatternCellTally = {
  pattern: DraftPatternId;
  pageFamily: string;
  wins: number;
  losses: number;
  pending: number;
  /** Total DECIDED samples (wins + losses; inconclusive/insufficient_data count toward
   *  the sample floor as decided-but-neutral, matching proof-history-voice's "flat"). */
  decided: number;
  /** wins / decided, only meaningful once `decided >= MIN_DECIDED_FOR_CONFIDENCE`. */
  winRate: number;
  /** True once this cell has cleared the minimum-sample floor. */
  confident: boolean;
};

function foldVerdict(row: PatternOutcomeRow): "won" | "lost" | "flat" | "pending" {
  if (row.verdict === "measuring") return "pending";
  if (row.verdict === "won") return "won";
  if (row.verdict === "lost") return "lost";
  // inconclusive / insufficient_data: a GSC "flat" read can still be a citation win.
  // An answer block that never moved CTR but started getting quoted by AI is a real win.
  if (row.citationVerdict === "gained") return "won";
  if (row.citationVerdict === "lost") return "lost";
  return "flat";
}

/**
 * Pure tally of decided outcomes by (pattern, pageFamily). Cells below
 * MIN_DECIDED_FOR_CONFIDENCE stay `confident: false` - callers must never quote a
 * winRate from an unconfident cell. Deterministic order (insertion order of first
 * occurrence), so output is stable for snapshot-style tests.
 */
export function aggregateWinsByPattern(rows: PatternOutcomeRow[]): PatternCellTally[] {
  const order: string[] = [];
  const byKey = new Map<string, { pattern: DraftPatternId; pageFamily: string; wins: number; losses: number; flat: number; pending: number }>();
  for (const r of rows) {
    const key = `${r.pattern}::${r.pageFamily}`;
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, { pattern: r.pattern, pageFamily: r.pageFamily, wins: 0, losses: 0, flat: 0, pending: 0 });
    }
    const cell = byKey.get(key)!;
    const folded = foldVerdict(r);
    if (folded === "won") cell.wins += 1;
    else if (folded === "lost") cell.losses += 1;
    else if (folded === "flat") cell.flat += 1;
    else cell.pending += 1;
  }
  return order.map((key) => {
    const c = byKey.get(key)!;
    const decided = c.wins + c.losses + c.flat;
    const winRate = decided > 0 ? c.wins / decided : 0;
    return {
      pattern: c.pattern,
      pageFamily: c.pageFamily,
      wins: c.wins,
      losses: c.losses,
      pending: c.pending,
      decided,
      winRate,
      confident: decided >= MIN_DECIDED_FOR_CONFIDENCE,
    };
  });
}

/**
 * The single best CONFIDENT pattern for a page family, or null when no cell has
 * cleared the sample floor yet (an honest, expected state for a young ledger). Ties
 * break on higher decided-sample count, then alphabetically on pattern id (stable).
 */
export function bestConfidentPattern(cells: PatternCellTally[], pageFamily: string): PatternCellTally | null {
  const candidates = cells.filter((c) => c.pageFamily === pageFamily && c.confident);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.winRate - a.winRate || b.decided - a.decided || a.pattern.localeCompare(b.pattern))[0]!;
}

/** Plain, jargon-free sentence describing a confident cell - usable directly in operator
 *  copy (no "experiment"/"control"/"cell" words). Never invents a multiplier claim beyond
 *  a simple win-rate percentage rounded to the nearest 10 (avoids false precision). */
export function patternInsightSentence(cell: PatternCellTally): string {
  const pct = Math.round(cell.winRate * 100);
  const label = PATTERN_LABEL[cell.pattern];
  return `${label} blocks won ${pct} percent of the time on ${cell.pageFamily} pages here (${cell.wins} of ${cell.decided} decided).`;
}
