/**
 * coverage-map (2026-07-02, master-plan item 9) - PURE per-hub coverage math.
 *
 * For each topic hub: how many questions people ask, how many an owned page
 * answers, the coverage percent, how many the AI engines have been checked on
 * (and cited the tenant for), and the top missing questions ranked by demand,
 * each with a create-page pointer when the demand graph already carries a
 * matching create_page move.
 *
 * Zero-observation honesty: a hub with no AI checks says so plainly instead of
 * implying "0 of 0". No LLM, no I/O, deterministic. Copy is first-person plain
 * business language with no em or en dashes.
 */

import { sharedTokenCount, tokenizeTopic, type TopicHub } from "./build-hubs";

/** A create_page move already on the board (from the demand graph). */
export type CreatePagePointer = {
  label: string;
  demandKey: string;
};

export type MissingQuestion = {
  text: string;
  demand: number;
  /** The matching create_page move when the demand graph already has one. */
  createPage: CreatePagePointer | null;
};

export type HubCoverageRow = {
  key: string;
  label: string;
  totalQuestions: number;
  answeredCount: number;
  /** 0..100, rounded. */
  coveragePercent: number;
  /** Questions in this hub an AI engine has actually been observed answering. */
  aiCheckedCount: number;
  /** Of those checked, how many cited or recommended the tenant. */
  aiCitedCount: number;
  /** Top unanswered questions, demand desc, capped at 3. */
  topMissing: MissingQuestion[];
  /** The one-line operator sentence for this hub. */
  summary: string;
};

export type CoverageMap = {
  /** Per-hub rows, bounded by maxHubs, ranked by OPPORTUNITY: unanswered
   *  demand + demand AI was checked on but did not cite you for (desc), then
   *  total demand desc, then label asc. A map that only showed the topics you
   *  already own would enable no decision. */
  rows: HubCoverageRow[];
  /** Across the rendered rows. */
  totalQuestions: number;
  totalAnswered: number;
  /** Terms that did not cluster into a real hub (the honest remainder). */
  otherCount: number;
};

const MAX_MISSING = 3;
export const DEFAULT_MAX_HUBS = 12;

/** Best create_page move for a question, by token overlap (2 shared tokens, or
 *  1 when either side has a single significant token). Deterministic ties:
 *  higher overlap first, then label asc. */
function matchCreatePage(
  questionTokens: ReadonlySet<string>,
  moves: ReadonlyArray<{ pointer: CreatePagePointer; tokens: Set<string> }>,
): CreatePagePointer | null {
  if (questionTokens.size === 0) return null;
  let best: CreatePagePointer | null = null;
  let bestShared = 0;
  for (const m of moves) {
    if (m.tokens.size === 0) continue;
    const shared = sharedTokenCount(questionTokens, m.tokens);
    const needed = questionTokens.size === 1 || m.tokens.size === 1 ? 1 : 2;
    if (shared < needed) continue;
    if (shared > bestShared || (shared === bestShared && best !== null && m.pointer.label.localeCompare(best.label) < 0)) {
      best = m.pointer;
      bestShared = shared;
    }
  }
  return best;
}

/** The one-line hub sentence. Exported so tests pin the exact copy contract. */
export function hubSummaryLine(row: Omit<HubCoverageRow, "summary">): string {
  const qWord = row.totalQuestions === 1 ? "question" : "questions";
  let line = `${row.label}: I found ${row.totalQuestions} ${qWord} people ask; you answer ${row.answeredCount} (${row.coveragePercent} percent).`;
  if (row.aiCheckedCount > 0) {
    line += ` AI recommends you on ${row.aiCitedCount} of ${row.aiCheckedCount} I checked.`;
  } else {
    line += ` I have not checked this topic with AI yet.`;
  }
  if (row.topMissing.length > 0) {
    const texts = row.topMissing.map((m) => m.text).join("; ");
    line +=
      row.topMissing.length === 1
        ? ` The missing page that would lift you most: ${texts}.`
        : ` The ${row.topMissing.length} missing pages that would lift you most: ${texts}.`;
  } else if (row.answeredCount === row.totalQuestions) {
    line += ` You answer every question I found here.`;
  }
  return line;
}

export function buildCoverageMap(input: {
  hubs: ReadonlyArray<TopicHub>;
  other?: TopicHub | null;
  createPageMoves?: ReadonlyArray<CreatePagePointer>;
  maxHubs?: number;
}): CoverageMap {
  const maxHubs = Math.max(1, input.maxHubs ?? DEFAULT_MAX_HUBS);
  const moves = (input.createPageMoves ?? [])
    .filter((m) => m.label && m.demandKey)
    .map((pointer) => ({ pointer, tokens: new Set(tokenizeTopic(pointer.label)) }));

  const ranked: Array<{ row: HubCoverageRow; opportunity: number; totalDemand: number }> = [];
  for (const hub of input.hubs) {
    if (hub.terms.length === 0) continue;
    const answered = hub.terms.filter((t) => t.answeredBy != null);
    const checked = hub.terms.filter((t) => t.aiChecked);
    const cited = checked.filter((t) => t.aiCited);
    const missing = hub.terms.filter((t) => t.answeredBy == null);
    const topMissing: MissingQuestion[] = missing
      .slice(0, MAX_MISSING) // hub.terms is already demand desc
      .map((t) => ({
        text: t.text,
        demand: t.demand,
        createPage: matchCreatePage(new Set(tokenizeTopic(t.text)), moves),
      }));
    const base = {
      key: hub.key,
      label: hub.label,
      totalQuestions: hub.terms.length,
      answeredCount: answered.length,
      coveragePercent: Math.round((answered.length / hub.terms.length) * 100),
      aiCheckedCount: checked.length,
      aiCitedCount: cited.length,
      topMissing,
    };
    // Opportunity weight: demand you do not answer + demand AI checked but did
    // not pick you for. This is what ranks the map - a gap-finder, not a trophy
    // shelf of topics you already own.
    const opportunity =
      missing.reduce((s, t) => s + t.demand, 0) +
      checked.filter((t) => !t.aiCited).reduce((s, t) => s + t.demand, 0);
    ranked.push({ row: { ...base, summary: hubSummaryLine(base) }, opportunity, totalDemand: hub.totalDemand });
  }
  ranked.sort(
    (a, b) =>
      b.opportunity - a.opportunity ||
      b.totalDemand - a.totalDemand ||
      a.row.label.localeCompare(b.row.label),
  );
  const rows = ranked.slice(0, maxHubs).map((r) => r.row);

  return {
    rows,
    totalQuestions: rows.reduce((s, r) => s + r.totalQuestions, 0),
    totalAnswered: rows.reduce((s, r) => s + r.answeredCount, 0),
    otherCount: input.other?.terms.length ?? 0,
  };
}

/**
 * The daily-candidate feed: the highest-demand missing questions across hubs,
 * ready for the daily plan builder to consume as create-page seeds. PURE.
 * Wiring into build-daily-candidates is a one-line follow-up (its levers are
 * page edits today; coverage gaps are page creations).
 */
export type CoverageCandidateSeed = {
  hubKey: string;
  hubLabel: string;
  question: string;
  demand: number;
  createPage: CreatePagePointer | null;
};

export function coverageCandidateSeeds(map: CoverageMap, cap = 10): CoverageCandidateSeed[] {
  const seeds: CoverageCandidateSeed[] = [];
  for (const row of map.rows) {
    for (const m of row.topMissing) {
      seeds.push({ hubKey: row.key, hubLabel: row.label, question: m.text, demand: m.demand, createPage: m.createPage });
    }
  }
  return seeds
    .sort((a, b) => b.demand - a.demand || a.question.localeCompare(b.question))
    .slice(0, Math.max(1, cap));
}
