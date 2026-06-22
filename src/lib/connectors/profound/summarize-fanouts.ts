/**
 * Pure summarizer for Profound Query-Fanout rows (#Iranopedia AEO wedge,
 * 2026-06-22). Turns the stored fanout envelope rows into a ranked list of the
 * sub-queries an AI engine expands the tracked prompts into — i.e. the exact
 * answer-blocks / FAQs worth adding to a page.
 *
 * Field-name DEFENSIVE on purpose: Profound's fanout response field names are
 * undocumented, so we read the sub-query / prompt / weight from a list of
 * likely keys instead of one hard-coded name. The raw rows are stored as JSONB
 * (profound_fanout_rows) so this can be re-tuned without re-spending the API.
 * No I/O — fully testable.
 */

export type FanoutRow = {
  dims: Record<string, string | null | undefined>;
  mets: Record<string, number | null | undefined>;
};

export type FanoutSeed = {
  /** The fan-out sub-query (what the engine actually searches for). */
  subQuery: string;
  /** Summed weight across rows (fan-out count / frequency). */
  weight: number;
  /** Distinct tracked prompts that expanded into this sub-query. */
  prompts: string[];
};

const QUERY_KEYS = ["query", "fanout_query", "fanout", "search_query", "sub_query", "expanded_query"];
const PROMPT_KEYS = ["prompt", "prompt_text", "source_prompt"];
const WEIGHT_KEYS = ["total_fanouts", "fanouts", "count", "fanouts_per_execution", "frequency", "share"];

function pickStr(
  obj: Record<string, string | null | undefined>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function pickNum(
  obj: Record<string, number | null | undefined>,
  keys: readonly string[],
): number {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/**
 * Rank fan-out sub-queries by total weight. `limit` caps the result (the
 * highest-leverage sub-questions to answer first). Deterministic.
 */
export function summarizeFanouts(
  rows: readonly FanoutRow[],
  opts: { limit?: number } = {},
): FanoutSeed[] {
  const byQuery = new Map<string, { weight: number; prompts: Set<string> }>();
  for (const r of rows) {
    if (r == null || r.dims == null) continue;
    const sub = pickStr(r.dims, QUERY_KEYS);
    if (!sub) continue;
    const weight = pickNum(r.mets ?? {}, WEIGHT_KEYS);
    const prompt = pickStr(r.dims, PROMPT_KEYS);
    let entry = byQuery.get(sub);
    if (!entry) {
      entry = { weight: 0, prompts: new Set() };
      byQuery.set(sub, entry);
    }
    entry.weight += weight;
    if (prompt) entry.prompts.add(prompt);
  }
  const seeds: FanoutSeed[] = [...byQuery.entries()].map(([subQuery, e]) => ({
    subQuery,
    weight: e.weight,
    prompts: [...e.prompts],
  }));
  seeds.sort((a, b) => b.weight - a.weight || a.subQuery.localeCompare(b.subQuery));
  return opts.limit != null ? seeds.slice(0, opts.limit) : seeds;
}
