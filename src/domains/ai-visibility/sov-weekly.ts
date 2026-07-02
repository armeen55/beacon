/**
 * sov-weekly (BEACON 500 item 79) - cross-engine "share of the answers" per
 * topic, per ISO week, computed at READ time (no new store; the store-
 * classification file is untouched per the item's ownership rule).
 *
 * THREE SOURCES that never meet today, merged HONESTLY (never averaged into
 * one fake number):
 *   1. "native_poll"   - src/domains/ai-visibility (prompt_answer_observations,
 *      via run-engine-poll.ts): the real per-engine per-prompt answers, each
 *      one carrying `tracked_brand_mentioned`. Owned share = mentioned / polled
 *      for that (engine, topic, week). This is the only source with a genuine
 *      per-prompt "did the tenant get mentioned" signal, so it is the only
 *      source drop alerts fire from.
 *   2. "profound_visibility" - profound_visibility_rows (Supabase, tenant +
 *      dated): per-category, per-model, per-asset mentions/share-of-voice.
 *      Gives the tenant's own share AND the top competitor's share on the
 *      same topic, dated, but is a DIFFERENT metric (Profound's own SoV
 *      definition, not "fraction of prompts polled").
 *   3. "llm_mentions_cache" - the dataforseo-llm-mentions topic cache
 *      (readAllCachedLlmMentions): domain-citation counts for a topic when a
 *      real LLM was asked and forced to web-search. No native "mentioned yes/
 *      no" flag, no week bucketing (the cache holds only the latest fetch per
 *      topic) - so this source contributes a single always-current top-
 *      competitor-domain reading, explicitly labeled, never folded into a
 *      week trend.
 *
 * Topics come from the SAME `promptToTopic` humanizer the AI Questions
 * surface already uses (src/app/(shell)/prompts/ai-questions-data.ts), so a
 * topic label here means the same thing there. A prompt with no derivable
 * topic falls back to the page-family (path segment) of its best-known owned
 * target page, when one is known; otherwise it is dropped rather than
 * counted under a fake shared bucket (silent merging is the thing we must
 * never do).
 *
 * MINIMUM-PROMPTS FLOOR: with only days of native-poll history, a weekly
 * cell can be one or two prompts. `MIN_PROMPTS_PER_CELL` (3) gates BOTH the
 * displayed percentage (below floor: "still collecting") and drop alerts
 * (never alert off one prompt flipping).
 *
 * PURE MATH lives here (isoWeekKey, computeNativeWeeklySov, trend, drop
 * detection, flipped-prompt naming). The Supabase + json-store reads are the
 * one async loader at the bottom, injectable for tests.
 */

import "server-only";

import { getRepository } from "@/lib/persistence/repositories";
import { readAllCachedLlmMentions } from "@/domains/serp/dataforseo-llm-mentions";
import { log } from "@/lib/logger";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { cleanTopicLabel } from "@/domains/demand-graph/clean-topic-label";

/**
 * Turn a raw prompt/topic string into the same short, humanized topic label
 * the AI Questions surface uses (src/app/(shell)/prompts/ai-questions-data.ts
 * ::promptToTopic) - duplicated here (not imported) so this domain module
 * never depends on an app-route file; both call the same underlying
 * `cleanTopicLabel` domain helper so the label means the same thing on both
 * surfaces. PURE.
 */
function promptToTopic(prompt: string): string {
  const q = /^\s*(what|which|who|where|when|why|how|are|is|the|a|an|do|does|can|should|list|tell me)\b[\s,'’]*/i;
  let s = (prompt ?? "").trim();
  for (let i = 0; i < 3 && q.test(s); i++) s = s.replace(q, "");
  s = s.replace(/[?!.]+\s*$/g, "").trim();
  const cleaned = cleanTopicLabel(s || prompt);
  return cleaned.length > 56 ? cleaned.slice(0, 53).trimEnd() + "..." : cleaned;
}

// ---------------------------------------------------------------------------
// Engines (mirrors ai-visibility/engine-types.ts EngineId, kept independent
// so this pure module never imports from a sibling file the item's ownership
// rule keeps hands off of - the two sets are structurally identical).
// ---------------------------------------------------------------------------

export type SovEngineId = "chatgpt" | "perplexity" | "gemini" | "claude";

export const SOV_ENGINES: readonly SovEngineId[] = ["chatgpt", "perplexity", "gemini", "claude"];

export const SOV_ENGINE_PLAIN_NAME: Record<SovEngineId, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
};

/** Canonicalize a raw `platform` column value to a SovEngineId. Accepts the
 *  native-poll lowercase labels, the legacy "openai" alias, and mixed casing
 *  from older recovered rows. Unknown platforms return null (never guessed). */
export function canonicalizeSovEngine(raw: string | null | undefined): SovEngineId | null {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === "chatgpt" || lower === "openai") return "chatgpt";
  if (lower === "perplexity") return "perplexity";
  if (lower === "gemini") return "gemini";
  if (lower === "claude") return "claude";
  return null;
}

/** A cell floor below one prompt is not signal. */
export const MIN_PROMPTS_PER_CELL = 3;

/** Owned share drop that counts as an alert-worthy fall, in percentage points. */
export const SOV_DROP_THRESHOLD_POINTS = 15;

// ---------------------------------------------------------------------------
// ISO week bucketing (pure)
// ---------------------------------------------------------------------------

/** `YYYY-Www` ISO week key (Monday-start weeks, ISO 8601 week numbering).
 *  Pure, UTC-based so it is stable regardless of server timezone. */
export function isoWeekKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO: Thursday of this week decides the week-owning year.
  const dayNum = (utc.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  utc.setUTCDate(utc.getUTCDate() - dayNum + 3);
  const isoYearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((utc.getTime() - isoYearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** Monday (UTC midnight) that starts the given ISO week key. Inverse-ish of
 *  isoWeekKey; used to sort/derive human date ranges for the UI. Pure. */
export function isoWeekStartDate(weekKey: string): Date {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return new Date(NaN);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayNum * 86_400_000);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
}

/** Sort ascending by the ISO week's real calendar order (string sort works
 *  for same-format keys but this is explicit + testable). Pure. */
export function compareIsoWeeks(a: string, b: string): number {
  return isoWeekStartDate(a).getTime() - isoWeekStartDate(b).getTime();
}

// ---------------------------------------------------------------------------
// Source 1: native poll (prompt_answer_observations) - PURE reduce
// ---------------------------------------------------------------------------

export type NativeSovInputRow = {
  promptId: string;
  promptText: string;
  engine: SovEngineId;
  topic: string;
  mentioned: boolean;
  observedAtIso: string;
};

/** Project a raw observation row into a NativeSovInputRow. Returns null when
 *  the engine is unrecognized, the topic can't be derived, or the timestamp
 *  is unusable - callers drop nulls rather than count junk into a bucket. */
export function projectObservationForSov(
  row: Pick<PromptAnswerObservation, "prompt_id" | "platform" | "topic" | "tracked_brand_mentioned" | "observed_at" | "metadata">,
  fallbackTopicForPrompt?: (promptId: string) => string | null,
): NativeSovInputRow | null {
  const engine = canonicalizeSovEngine(row.platform);
  if (!engine) return null;
  if (!row.observed_at || Number.isNaN(Date.parse(row.observed_at))) return null;
  const rawTopic = (row.topic ?? "").trim();
  const promptText =
    typeof row.metadata?.prompt_text === "string" && row.metadata.prompt_text.trim().length > 0
      ? row.metadata.prompt_text.trim()
      : rawTopic;
  let topic = rawTopic.length > 0 ? promptToTopic(rawTopic) : "";
  if (!topic || topic.length === 0) {
    const fallback = fallbackTopicForPrompt?.(row.prompt_id) ?? null;
    topic = fallback ? promptToTopic(fallback) : "";
  }
  if (!topic) return null;
  return {
    promptId: row.prompt_id,
    promptText: promptText || topic,
    engine,
    topic,
    mentioned: row.tracked_brand_mentioned === true,
    observedAtIso: row.observed_at,
  };
}

export type NativeSovCell = {
  engine: SovEngineId;
  topic: string;
  weekKey: string;
  /** Distinct prompts polled in this (engine, topic, week) cell. */
  promptsPolled: number;
  /** Distinct prompts where the tenant was mentioned at least once. */
  promptsMentioned: number;
  /** promptsMentioned / promptsPolled, 0..1. Meaningless below the floor -
   *  callers must check `belowFloor` before displaying this as a percent. */
  ownedShare: number;
  /** True when promptsPolled < MIN_PROMPTS_PER_CELL - "still collecting". */
  belowFloor: boolean;
  /** The distinct prompt texts polled, for flipped-prompt naming later. */
  promptTextById: Record<string, string>;
  /** Which distinct prompts mentioned the tenant (by id). */
  mentionedPromptIds: string[];
};

/**
 * Reduce native-poll observation rows into per (engine, topic, week) cells.
 * A prompt counts once per cell (mentioned = true if ANY observation for
 * that prompt in that cell mentioned the tenant - a prompt polled twice in
 * the same week with one hit still counts as "mentioned"). PURE.
 */
export function computeNativeWeeklySov(rows: ReadonlyArray<NativeSovInputRow>): NativeSovCell[] {
  type Acc = {
    engine: SovEngineId;
    topic: string;
    weekKey: string;
    prompts: Map<string, { text: string; mentioned: boolean }>;
  };
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    const weekKey = isoWeekKey(r.observedAtIso);
    const key = `${r.engine}::${r.topic}::${weekKey}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { engine: r.engine, topic: r.topic, weekKey, prompts: new Map() };
      byKey.set(key, acc);
    }
    const existing = acc.prompts.get(r.promptId);
    if (existing) {
      existing.mentioned = existing.mentioned || r.mentioned;
    } else {
      acc.prompts.set(r.promptId, { text: r.promptText, mentioned: r.mentioned });
    }
  }
  const out: NativeSovCell[] = [];
  for (const acc of byKey.values()) {
    const promptsPolled = acc.prompts.size;
    const mentionedPromptIds = [...acc.prompts.entries()].filter(([, v]) => v.mentioned).map(([id]) => id);
    const promptTextById: Record<string, string> = {};
    for (const [id, v] of acc.prompts) promptTextById[id] = v.text;
    out.push({
      engine: acc.engine,
      topic: acc.topic,
      weekKey: acc.weekKey,
      promptsPolled,
      promptsMentioned: mentionedPromptIds.length,
      ownedShare: promptsPolled > 0 ? mentionedPromptIds.length / promptsPolled : 0,
      belowFloor: promptsPolled < MIN_PROMPTS_PER_CELL,
      promptTextById,
      mentionedPromptIds,
    });
  }
  out.sort(
    (a, b) =>
      a.engine.localeCompare(b.engine) ||
      a.topic.localeCompare(b.topic) ||
      compareIsoWeeks(a.weekKey, b.weekKey),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Source 2: Profound visibility rows - PURE reduce (dated, per category)
// ---------------------------------------------------------------------------

export type ProfoundSovInputRow = {
  categoryId: string;
  /** ISO date (YYYY-MM-DD) the row was observed/pulled for. */
  date: string;
  assetName: string;
  shareOfVoice: number;
  mentionsCount: number;
  executions: number;
  isOwned: boolean;
};

export type ProfoundSovCell = {
  topic: string;
  weekKey: string;
  ownShareOfVoice: number;
  executions: number;
  topCompetitor: { assetName: string; shareOfVoice: number; mentions: number } | null;
};

/** Reduce Profound visibility rows into per (topic=categoryId, week) cells.
 *  `shareOfVoice` here is PROFOUND'S OWN metric definition (asset share of
 *  observed answers) - a different unit from native `ownedShare`, so callers
 *  must never combine the two numbers into one series. PURE. */
export function computeProfoundWeeklySov(rows: ReadonlyArray<ProfoundSovInputRow>): ProfoundSovCell[] {
  type Acc = {
    topic: string;
    weekKey: string;
    executions: number;
    ownSovWeighted: number;
    ownWeight: number;
    competitors: Map<string, { mentions: number; sovWeighted: number; sovWeight: number }>;
  };
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    if (!r.categoryId || !r.date || Number.isNaN(Date.parse(r.date))) continue;
    const weekKey = isoWeekKey(r.date);
    const key = `${r.categoryId}::${weekKey}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { topic: r.categoryId, weekKey, executions: 0, ownSovWeighted: 0, ownWeight: 0, competitors: new Map() };
      byKey.set(key, acc);
    }
    const exec = Number.isFinite(r.executions) ? r.executions : 0;
    if (exec > acc.executions) acc.executions = exec;
    const w = exec > 0 ? exec : 1;
    if (r.isOwned) {
      acc.ownSovWeighted += r.shareOfVoice * w;
      acc.ownWeight += w;
    } else if (r.assetName) {
      let c = acc.competitors.get(r.assetName);
      if (!c) {
        c = { mentions: 0, sovWeighted: 0, sovWeight: 0 };
        acc.competitors.set(r.assetName, c);
      }
      c.mentions += r.mentionsCount;
      c.sovWeighted += r.shareOfVoice * w;
      c.sovWeight += w;
    }
  }
  const out: ProfoundSovCell[] = [];
  for (const acc of byKey.values()) {
    let top: ProfoundSovCell["topCompetitor"] = null;
    for (const [assetName, c] of acc.competitors) {
      const sov = c.sovWeight > 0 ? c.sovWeighted / c.sovWeight : 0;
      if (!top || c.mentions > top.mentions) top = { assetName, shareOfVoice: sov, mentions: c.mentions };
    }
    out.push({
      topic: acc.topic,
      weekKey: acc.weekKey,
      ownShareOfVoice: acc.ownWeight > 0 ? acc.ownSovWeighted / acc.ownWeight : 0,
      executions: acc.executions,
      topCompetitor: top,
    });
  }
  out.sort((a, b) => a.topic.localeCompare(b.topic) || compareIsoWeeks(a.weekKey, b.weekKey));
  return out;
}

// ---------------------------------------------------------------------------
// Source 3: dataforseo-llm-mentions topic cache - single current reading
// ---------------------------------------------------------------------------

export type LlmMentionsSovReading = {
  topic: string;
  /** Top cited domain for the topic (competitor proxy - domains are not
   *  brand names, so this is reported as-is, never mapped to a brand). */
  topDomain: string | null;
  topDomainCount: number;
  fetchedAtIso: string;
};

/** Reduce cached llm-mentions records (already deduped by topic upstream) to
 *  one reading per topic. No week bucketing - the cache holds only the
 *  latest fetch per topic, so this is always a "right now" reading, labeled
 *  as such at the merge boundary. PURE. */
export function computeLlmMentionsSovReadings(
  records: ReadonlyArray<{ topic: string; mentions: ReadonlyArray<{ domain: string; count: number }>; fetchedAt: string }>,
): LlmMentionsSovReading[] {
  return records.map((r) => {
    const top = [...r.mentions].sort((a, b) => b.count - a.count)[0] ?? null;
    return {
      topic: r.topic,
      topDomain: top?.domain ?? null,
      topDomainCount: top?.count ?? 0,
      fetchedAtIso: r.fetchedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Merged per-topic weekly table (honest labeling, never averaged)
// ---------------------------------------------------------------------------

export type SovSourceLabel = "native_poll" | "profound_visibility" | "llm_mentions_cache";

export type MergedTopicWeek = {
  topic: string;
  weekKey: string;
  /** One entry per engine that had a native-poll cell this week for this
   *  topic. This is the ONLY series drop alerts fire from. */
  nativeByEngine: Array<{ engine: SovEngineId; source: "native_poll" } & Omit<NativeSovCell, "engine" | "topic" | "weekKey">>;
  /** Profound's own SoV reading for the same topic + week, when synced rows
   *  exist. Explicitly a DIFFERENT metric (never merged into nativeByEngine). */
  profound: ({ source: "profound_visibility" } & Omit<ProfoundSovCell, "topic" | "weekKey">) | null;
};

/** Merge native + Profound cells into one per-(topic, week) row. Each
 *  series keeps its own source label; nothing is averaged across sources.
 *  The llm-mentions reading is deliberately NOT weekly (see above) and is
 *  surfaced separately by `mergeLlmMentionsIntoTopics`. PURE. */
export function mergeSovWeekly(
  native: ReadonlyArray<NativeSovCell>,
  profound: ReadonlyArray<ProfoundSovCell>,
): MergedTopicWeek[] {
  const byKey = new Map<string, MergedTopicWeek>();
  const keyOf = (topic: string, weekKey: string) => `${topic}::${weekKey}`;
  for (const cell of native) {
    const key = keyOf(cell.topic, cell.weekKey);
    let row = byKey.get(key);
    if (!row) {
      row = { topic: cell.topic, weekKey: cell.weekKey, nativeByEngine: [], profound: null };
      byKey.set(key, row);
    }
    row.nativeByEngine.push({
      engine: cell.engine,
      source: "native_poll",
      promptsPolled: cell.promptsPolled,
      promptsMentioned: cell.promptsMentioned,
      ownedShare: cell.ownedShare,
      belowFloor: cell.belowFloor,
      promptTextById: cell.promptTextById,
      mentionedPromptIds: cell.mentionedPromptIds,
    });
  }
  for (const cell of profound) {
    const key = keyOf(cell.topic, cell.weekKey);
    let row = byKey.get(key);
    if (!row) {
      row = { topic: cell.topic, weekKey: cell.weekKey, nativeByEngine: [], profound: null };
      byKey.set(key, row);
    }
    row.profound = {
      source: "profound_visibility",
      ownShareOfVoice: cell.ownShareOfVoice,
      executions: cell.executions,
      topCompetitor: cell.topCompetitor,
    };
  }
  return [...byKey.values()].sort(
    (a, b) => a.topic.localeCompare(b.topic) || compareIsoWeeks(a.weekKey, b.weekKey),
  );
}

// ---------------------------------------------------------------------------
// Trend + drop detection (pure)
// ---------------------------------------------------------------------------

export type SovTrendPoint = {
  engine: SovEngineId;
  topic: string;
  weekKey: string;
  ownedShare: number;
  belowFloor: boolean;
  promptsPolled: number;
};

export type SovTrend = {
  engine: SovEngineId;
  topic: string;
  /** Latest week in the series. */
  latestWeekKey: string;
  latestShare: number;
  latestBelowFloor: boolean;
  /** Change vs the immediately-prior week, in percentage points. Null when
   *  there is no usable prior week (both weeks must clear the floor). */
  weekOverWeekPoints: number | null;
  /** Change vs 4 weeks back, in percentage points. Same floor rule. */
  fourWeekPoints: number | null;
  /** Human arrow phrase for the UI, e.g. "up 12 pts", "down 15 pts", "flat",
   *  or "still collecting" when either side is below the floor. */
  trendPhrase: string;
};

function pointsPhrase(points: number | null): string {
  if (points === null) return "still collecting";
  const rounded = Math.round(points);
  if (rounded === 0) return "flat";
  return rounded > 0 ? `up ${rounded} pts` : `down ${Math.abs(rounded)} pts`;
}

/** Build week-over-week + 4-week trend for every (engine, topic) series.
 *  Input must already be sorted or will be sorted here by week ascending.
 *  PURE. Points are computed on shares that clear MIN_PROMPTS_PER_CELL on
 *  BOTH sides; otherwise the comparison is null ("still collecting"), never
 *  a misleading number built off a 1-prompt cell. */
export function computeSovTrend(cells: ReadonlyArray<NativeSovCell>): SovTrend[] {
  const bySeries = new Map<string, NativeSovCell[]>();
  for (const c of cells) {
    const key = `${c.engine}::${c.topic}`;
    const arr = bySeries.get(key) ?? [];
    arr.push(c);
    bySeries.set(key, arr);
  }
  const out: SovTrend[] = [];
  for (const [, series] of bySeries) {
    const sorted = [...series].sort((a, b) => compareIsoWeeks(a.weekKey, b.weekKey));
    const latest = sorted[sorted.length - 1]!;
    const prior = sorted.length >= 2 ? sorted[sorted.length - 2]! : null;
    const fourBack = sorted.length >= 5 ? sorted[sorted.length - 5]! : null;

    const wow =
      prior && !latest.belowFloor && !prior.belowFloor
        ? (latest.ownedShare - prior.ownedShare) * 100
        : null;
    const fourWk =
      fourBack && !latest.belowFloor && !fourBack.belowFloor
        ? (latest.ownedShare - fourBack.ownedShare) * 100
        : null;

    out.push({
      engine: latest.engine,
      topic: latest.topic,
      latestWeekKey: latest.weekKey,
      latestShare: latest.ownedShare,
      latestBelowFloor: latest.belowFloor,
      weekOverWeekPoints: wow,
      fourWeekPoints: fourWk,
      trendPhrase: pointsPhrase(wow),
    });
  }
  out.sort((a, b) => a.topic.localeCompare(b.topic) || a.engine.localeCompare(b.engine));
  return out;
}

export type SovDropAlert = {
  engine: SovEngineId;
  topic: string;
  weekKey: string;
  priorWeekKey: string;
  priorShare: number;
  currentShare: number;
  dropPoints: number;
  /** Distinct prompts polled this week for this (engine, topic) cell - the
   *  denominator flippedPrompts.length is "out of". */
  promptsPolled: number;
  /** True when the drop is a fall to zero from a nonzero prior share. */
  droppedToZero: boolean;
  /** The exact prompts that stopped mentioning the tenant this week (were
   *  mentioned in the prior week, not mentioned in the current week, and
   *  were polled in both weeks - a real flip, not a prompt that simply
   *  wasn't asked again). */
  flippedPrompts: Array<{ promptId: string; promptText: string }>;
  /** Ready-to-render operator/customer line: names engine, topic, week
   *  count, and the flipped prompts. No lab jargon, no dashes. */
  headline: string;
};

/**
 * Drop detection over consecutive-week native cells for one (engine, topic)
 * series. Fires when, comparing the LATEST week to the immediately prior
 * week (both clearing MIN_PROMPTS_PER_CELL):
 *   - owned share fell by >= SOV_DROP_THRESHOLD_POINTS, OR
 *   - owned share fell to exactly zero from a nonzero prior share
 *     (regardless of point size - "went to zero" is always alert-worthy).
 * Never fires off a single prompt: both weeks must clear the floor, and
 * flipped prompts are named only when the SAME prompt id was polled in
 * both weeks (so a prompt that was simply dropped from rotation is not
 * mistaken for one that "stopped" mentioning the tenant). PURE.
 */
export function detectSovDropAlerts(cells: ReadonlyArray<NativeSovCell>): SovDropAlert[] {
  const bySeries = new Map<string, NativeSovCell[]>();
  for (const c of cells) {
    const key = `${c.engine}::${c.topic}`;
    const arr = bySeries.get(key) ?? [];
    arr.push(c);
    bySeries.set(key, arr);
  }
  const out: SovDropAlert[] = [];
  for (const [, series] of bySeries) {
    const sorted = [...series].sort((a, b) => compareIsoWeeks(a.weekKey, b.weekKey));
    if (sorted.length < 2) continue;
    const current = sorted[sorted.length - 1]!;
    const prior = sorted[sorted.length - 2]!;
    if (current.belowFloor || prior.belowFloor) continue; // never alert off a thin cell

    const dropPoints = (prior.ownedShare - current.ownedShare) * 100;
    const droppedToZero = prior.ownedShare > 0 && current.ownedShare === 0;
    if (dropPoints < SOV_DROP_THRESHOLD_POINTS && !droppedToZero) continue;

    const flipped: Array<{ promptId: string; promptText: string }> = [];
    for (const [promptId, wasMentioned] of Object.entries(
      Object.fromEntries(prior.mentionedPromptIds.map((id) => [id, true])),
    )) {
      if (!wasMentioned) continue;
      const polledNow = promptId in current.promptTextById;
      const mentionedNow = current.mentionedPromptIds.includes(promptId);
      if (polledNow && !mentionedNow) {
        flipped.push({ promptId, promptText: current.promptTextById[promptId] ?? prior.promptTextById[promptId] ?? promptId });
      }
    }
    flipped.sort((a, b) => a.promptText.localeCompare(b.promptText));

    const engineName = SOV_ENGINE_PLAIN_NAME[current.engine];
    const flippedCount = flipped.length;
    const base = droppedToZero
      ? `${engineName} stopped mentioning you on ${current.topic} this week`
      : `${engineName} dropped you ${Math.round(dropPoints)} points on ${current.topic} this week`;
    const detail =
      flippedCount > 0
        ? ` (${flippedCount} of ${current.promptsPolled} question${current.promptsPolled === 1 ? "" : "s"} stopped mentioning you: ${flipped
            .slice(0, 3)
            .map((f) => `"${f.promptText}"`)
            .join(", ")}${flippedCount > 3 ? `, +${flippedCount - 3} more` : ""})`
        : ".";
    const headline = base + detail;

    out.push({
      engine: current.engine,
      topic: current.topic,
      weekKey: current.weekKey,
      priorWeekKey: prior.weekKey,
      priorShare: prior.ownedShare,
      currentShare: current.ownedShare,
      dropPoints,
      promptsPolled: current.promptsPolled,
      droppedToZero,
      flippedPrompts: flipped,
      headline,
    });
  }
  out.sort((a, b) => b.dropPoints - a.dropPoints || a.topic.localeCompare(b.topic));
  return out;
}

// ---------------------------------------------------------------------------
// Loader (I/O) - the async boundary. Every read is paged at the 1000-row
// PostgREST cap via the repository's existing queryAllPagedScoped path (same
// helper profound-topic-signals.ts and every other tenant-scoped reader
// uses). Fail-soft per source: one source erroring never blanks the others.
// ---------------------------------------------------------------------------

export type SovWeeklyLoadResult = {
  tenantId: string;
  /** Raw per (engine, topic, week) native-poll cells, sorted. */
  nativeCells: NativeSovCell[];
  /** Raw per (topic, week) Profound cells, sorted. */
  profoundCells: ProfoundSovCell[];
  /** Current (non-weekly) llm-mentions cache readings, one per topic. */
  llmMentionsReadings: LlmMentionsSovReading[];
  /** Merged native+Profound per (topic, week) table. */
  merged: MergedTopicWeek[];
  /** Trend per (engine, topic) series, latest week. */
  trends: SovTrend[];
  /** Drop alerts fired off the native-poll series. */
  dropAlerts: SovDropAlert[];
  /** Distinct ISO weeks with at least one native-poll cell (any engine). */
  nativeWeeksCovered: string[];
  /** Distinct ISO weeks with at least one Profound cell. */
  profoundWeeksCovered: string[];
  /** True when a source read failed (partial result; others still valid). */
  partial: boolean;
};

const OBSERVATION_PAGE_LOOKBACK_DAYS = 120;

/** Normalize a Profound `asset_name` the same way profound-topic-signals.ts
 *  does, for consistent owned-vs-competitor classification. Pure. */
function normAssetName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/**
 * Load + compute the full weekly SoV table for a tenant. Read-only; never
 * writes. `ownAliases` (normalized brand/domain aliases) identifies which
 * Profound `asset_name` rows are the tenant's own - pass the same set
 * `buildOwnAliasSet` produces in profound-topic-signals.ts (duplicated call,
 * not a shared import, so this loader has no compile dependency on the
 * recommendation-intelligence domain, which owns that file).
 */
export async function loadSovWeeklyForTenant(
  tenantId: string,
  ownAliases: ReadonlySet<string>,
): Promise<SovWeeklyLoadResult> {
  let partial = false;

  // Source 1: native poll observations (prompt_answer_observations), paged,
  // lean-projected to only the columns this module reads.
  let nativeRows: NativeSovInputRow[] = [];
  try {
    const repo = getRepository().forTenant(tenantId);
    const since = new Date(Date.now() - OBSERVATION_PAGE_LOOKBACK_DAYS * 86_400_000).toISOString();
    const observations = (await repo.getPromptAnswerObservations({
      since,
      columns: "prompt_id,platform,topic,tracked_brand_mentioned,observed_at,metadata",
    })) as Pick<
      PromptAnswerObservation,
      "prompt_id" | "platform" | "topic" | "tracked_brand_mentioned" | "observed_at" | "metadata"
    >[];
    nativeRows = observations
      .map((o) => projectObservationForSov(o))
      .filter((r): r is NativeSovInputRow => r !== null);
  } catch (err) {
    log.warn("[sov-weekly] native-poll observations read failed (partial result)", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    partial = true;
  }
  const nativeCells = computeNativeWeeklySov(nativeRows);

  // Source 2: Profound visibility rows, paged, tenant-scoped.
  let profoundRows: ProfoundSovInputRow[] = [];
  try {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    const sb = getSupabaseAdmin();
    const PAGE_SIZE = 1000;
    type Row = {
      category_id: string;
      date: string;
      asset_name: string;
      share_of_voice: number;
      mentions_count: number;
      executions: number;
    };
    const raw: Row[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("profound_visibility_rows")
        .select("category_id, date, asset_name, share_of_voice, mentions_count, executions")
        .eq("tenant_id", tenantId)
        .order("date")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[sov-weekly] profound_visibility_rows read failed (partial result)", {
          tenantId,
          error: error.message,
        });
        partial = true;
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      raw.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    profoundRows = raw.map((r) => ({
      categoryId: r.category_id,
      date: r.date,
      assetName: r.asset_name ?? "",
      shareOfVoice: Number(r.share_of_voice) || 0,
      mentionsCount: Number(r.mentions_count) || 0,
      executions: Number(r.executions) || 0,
      isOwned: ownAliases.has(normAssetName(r.asset_name ?? "")),
    }));
  } catch (err) {
    log.warn("[sov-weekly] profound_visibility_rows unavailable (partial result)", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    partial = true;
  }
  const profoundCells = computeProfoundWeeklySov(profoundRows);

  // Source 3: dataforseo-llm-mentions cache - GLOBAL store (single-tenant
  // deployment today), current reading only, no week bucketing.
  let llmMentionsReadings: LlmMentionsSovReading[] = [];
  try {
    const records = await readAllCachedLlmMentions();
    llmMentionsReadings = computeLlmMentionsSovReadings(records);
  } catch (err) {
    log.warn("[sov-weekly] llm-mentions cache unavailable (partial result)", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    partial = true;
  }

  const merged = mergeSovWeekly(nativeCells, profoundCells);
  const trends = computeSovTrend(nativeCells);
  const dropAlerts = detectSovDropAlerts(nativeCells);

  const nativeWeeksCovered = [...new Set(nativeCells.map((c) => c.weekKey))].sort(compareIsoWeeks);
  const profoundWeeksCovered = [...new Set(profoundCells.map((c) => c.weekKey))].sort(compareIsoWeeks);

  return {
    tenantId,
    nativeCells,
    profoundCells,
    llmMentionsReadings,
    merged,
    trends,
    dropAlerts,
    nativeWeeksCovered,
    profoundWeeksCovered,
    partial,
  };
}
