/**
 * engine-gaps (2026-07-01, master plan item 4) - PURE per-engine citation
 * diff. Takes tonight's (or the recent window's) per-prompt-per-engine check
 * results and reduces them to:
 *   1. a per-prompt engine matrix (did this engine point people at your site,
 *      yes / no / not checked),
 *   2. per-engine totals ("ChatGPT recommends you for 4 of 25 questions"),
 *   3. a concrete gap list ("Perplexity recommends you here, Gemini does not").
 *
 * HONESTY RULES: an engine that was not actually checked never appears in a
 * gap (absence of data is not absence of citations), and every operator line
 * says plainly which engines were checked. No lab jargon, no dashes.
 */

import { ALL_ENGINES, ENGINE_PLAIN_NAME, type EngineId } from "./engine-types";

/** One engine's verdict for one prompt. `citedYou` = the engine's answer
 *  pointed people at the tenant's own site (an owned domain in citations). */
export type EngineCheckRow = {
  promptId: string;
  promptText: string;
  engine: EngineId;
  citedYou: boolean;
  /** Owned-site URLs the engine cited (when citedYou). Used to route the gap
   *  to the exact page that already wins on the citing engine. */
  ownedUrls?: string[];
};

export type PromptEngineMatrixRow = {
  promptId: string;
  promptText: string;
  /** Engine -> cited yes/no. Engines absent from the map were NOT checked. */
  byEngine: Partial<Record<EngineId, boolean>>;
  /** Engines that pointed people at your site for this prompt. */
  citedEngines: EngineId[];
  /** Engines that were CHECKED and did not point people at your site. */
  missingEngines: EngineId[];
  /** First owned URL any citing engine pointed at (the page to strengthen). */
  ownedUrl: string | null;
};

export type EngineGapReport = {
  /** Engines with at least one real check in the input. */
  enginesChecked: EngineId[];
  promptsChecked: number;
  perEngine: Array<{ engine: EngineId; promptsChecked: number; citedYou: number }>;
  matrix: PromptEngineMatrixRow[];
  /** Prompts where at least one engine cites you and at least one checked
   *  engine does not - the concrete, fixable divergence. Sorted so the
   *  widest gaps (most engines missing) come first. */
  gaps: PromptEngineMatrixRow[];
};

/** Pure reduce: check rows -> matrix -> gaps. Later rows for the same
 *  (prompt, engine) win, so callers can feed newest-last without prep. */
export function computeEngineGaps(rows: EngineCheckRow[]): EngineGapReport {
  const byPrompt = new Map<string, { promptText: string; byEngine: Map<EngineId, boolean>; ownedUrls: string[] }>();
  const engineTotals = new Map<EngineId, { promptsChecked: number; citedYou: number }>();

  for (const row of rows) {
    let p = byPrompt.get(row.promptId);
    if (!p) {
      p = { promptText: row.promptText, byEngine: new Map(), ownedUrls: [] };
      byPrompt.set(row.promptId, p);
    }
    p.byEngine.set(row.engine, row.citedYou);
    if (row.citedYou) {
      for (const u of row.ownedUrls ?? []) {
        if (u && !p.ownedUrls.includes(u)) p.ownedUrls.push(u);
      }
    }
  }

  const matrix: PromptEngineMatrixRow[] = [];
  for (const [promptId, p] of byPrompt) {
    const citedEngines: EngineId[] = [];
    const missingEngines: EngineId[] = [];
    const byEngine: Partial<Record<EngineId, boolean>> = {};
    for (const engine of ALL_ENGINES) {
      const v = p.byEngine.get(engine);
      if (v === undefined) continue; // not checked -> never counted either way
      byEngine[engine] = v;
      if (v) citedEngines.push(engine);
      else missingEngines.push(engine);
      const t = engineTotals.get(engine) ?? { promptsChecked: 0, citedYou: 0 };
      t.promptsChecked += 1;
      if (v) t.citedYou += 1;
      engineTotals.set(engine, t);
    }
    matrix.push({
      promptId,
      promptText: p.promptText,
      byEngine,
      citedEngines,
      missingEngines,
      ownedUrl: p.ownedUrls[0] ?? null,
    });
  }

  const enginesChecked = ALL_ENGINES.filter((e) => engineTotals.has(e));
  const gaps = matrix
    .filter((m) => m.citedEngines.length >= 1 && m.missingEngines.length >= 1)
    .sort(
      (a, b) =>
        b.missingEngines.length - a.missingEngines.length ||
        b.citedEngines.length - a.citedEngines.length ||
        a.promptText.localeCompare(b.promptText),
    );

  return {
    enginesChecked,
    promptsChecked: matrix.length,
    perEngine: enginesChecked.map((engine) => ({ engine, ...engineTotals.get(engine)! })),
    matrix,
    gaps,
  };
}

// ---------------------------------------------------------------------------
// Operator copy (Beacon voice: first person, concrete numbers, a next step,
// plain business language, hyphens only).
// ---------------------------------------------------------------------------

const list = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * One honest headline for the Today AI band. Null unless at least 2 engines
 * were actually checked AND a gap exists (the line's whole job is the gap).
 * Example: "ChatGPT recommends you for 4 of 25 questions I checked, Gemini
 * for 1 of 25. Tonight's plan includes 2 changes aimed at the gap."
 */
export function engineGapHeadline(
  report: Pick<EngineGapReport, "enginesChecked" | "perEngine" | "gaps">,
  plannedGapChanges: number,
): string | null {
  if (report.enginesChecked.length < 2 || report.gaps.length === 0) return null;
  const ranked = [...report.perEngine].sort((a, b) => b.citedYou - a.citedYou || a.engine.localeCompare(b.engine));
  const parts = ranked.map((p, i) =>
    i === 0
      ? `${ENGINE_PLAIN_NAME[p.engine]} recommends you for ${p.citedYou} of ${p.promptsChecked} questions I checked`
      : `${ENGINE_PLAIN_NAME[p.engine]} for ${p.citedYou} of ${p.promptsChecked}`,
  );
  const head = `${parts.join(", ")}.`;
  const tail =
    plannedGapChanges > 0
      ? ` Tonight's plan includes ${plannedGapChanges} change${plannedGapChanges === 1 ? "" : "s"} aimed at the gap.`
      : ` I am lining up changes aimed at the gap.`;
  return head + tail;
}

/**
 * The per-prompt gap sentence woven into a daily card's "why now". Example:
 * "Perplexity already points people at this page when they ask "best persian
 * rugs". ChatGPT and Gemini do not yet, so this change also aims at that gap."
 */
export function promptGapSentence(row: Pick<PromptEngineMatrixRow, "promptText" | "citedEngines" | "missingEngines">): string {
  const cited = list(row.citedEngines.map((e) => ENGINE_PLAIN_NAME[e]));
  const missing = list(row.missingEngines.map((e) => ENGINE_PLAIN_NAME[e]));
  const citedVerb = row.citedEngines.length === 1 ? "points" : "point";
  const missingVerb = row.missingEngines.length === 1 ? "does" : "do";
  return `${cited} already ${citedVerb} people at this page when they ask "${row.promptText}". ${missing} ${missingVerb} not yet, so this change also aims at that gap.`;
}
