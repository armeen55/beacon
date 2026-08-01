import "server-only";
import { createHash } from "node:crypto";
import { dualWriteUpsertScoped } from "@/lib/persistence/dual-write";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import type { ObservationMode, ResearchEngine } from "@/domains/evidence/funnel/research-evidence";
import type { ParsedAiAnswer } from "@/domains/evidence/dataforseo/funnel-boundary";
import type { PromptAnswerObservation } from "./prompt-answer-observations";

/**
 * ai-observations - THE canonical record of one AI answer, kept WHOLE.
 *
 * Before this, an answer was collapsed at capture: the text was hashed and thrown away, the retrieved
 * pages were never stored at all, and a re-read of the same answer meant buying it again. One row here
 * holds the full text, the whole journey (fan-outs, the pages it reported retrieving, cited sources, brands,
 * the reported web-search state), the money receipt and the cache identity of the raw envelope, so any
 * later analysis re-reads what was already paid for and never repurchases it.
 *
 * IDENTITY is (tenant, prompt, prompt version, engine, reporting day, sample slot). A retry of the same
 * intent reuses that identity and upserts the SAME row; a deliberate second sample of the same pair on the
 * same day is a different SLOT and therefore a different row. Nothing else may mint an id here.
 *
 * prompt_answer_observations is now a DECLARED PROJECTION of this record (projectPromptAnswerObservation),
 * derived by the same writer at the same moment, so the native-intel readers keep working off one truth.
 */

/** THE frozen seam with Runtime's planner: exactly the pairs that are due, nothing implied. `day` is the
 *  REPORTING DAY the planner filtered on, carried so the row is stored on the day the plan meant. It used to
 *  be re-derived from the wall clock at write time, so a run resumed past midnight landed rows on a day the
 *  planner and the analysis pass never looked at, and nothing on a resumed run was ever analyzed. */
export type DueObservation = {
  promptId: string;
  version: number;
  text: string;
  engine: "chatgpt" | "claude" | "gemini" | "perplexity";
  slot: 0 | 1 | 2;
  day: string;
};

/** observed = a real answer in hand. unavailable = the engine had nothing to give. unsupported = I cannot
 *  ask this engine at all, so no money moved. failed = the provider refused or broke, with the reason.
 *  pending = the request is accepted and in flight; the free collect finishes it on the same identity. */
export type AiObservationStatus = "observed" | "unavailable" | "unsupported" | "failed" | "pending";

type ObservedLink = { url: string; domain: string; title: string | null };

export type AiObservationRecord = {
  id: string;
  tenant_id: string;
  site: string;
  prompt_id: string;
  prompt_version: number;
  prompt_text: string;
  engine: ResearchEngine;
  model_requested: string | null;
  model_served: string | null;
  observation_mode: ObservationMode;
  /** The UTC day this observation belongs to; part of the identity. */
  reporting_day: string;
  sample_slot: number;
  language: string;
  location: number;
  requested_at: string;
  completed_at: string | null;
  capability_version: string;
  /** The evidence_cache identity of the RAW envelope this row was read from. */
  cache_key: string | null;
  cost_usd: number;
  status: AiObservationStatus;
  failure_reason: string | null;
  answer_text: string | null;
  answer_hash: string | null;
  /** The retrieval journey behind this answer. Every list keeps the tri-state: null = the provider does
   *  not report it on this path, [] = it reported none, nonempty = what it actually reported. Retrieved
   *  pages are kept strictly apart from cited ones: "it read this" and "it credited this" differ. */
  journey: {
    fan_outs: string[] | null;
    retrieved_results: ObservedLink[] | null;
    cited_sources: ObservedLink[] | null;
    brand_mentions: string[] | null;
    web_search_reported: boolean | null;
  };
  /** Null until a later strict-schema pass analyzes the stored text. No provider call. */
  analysis: Record<string, unknown> | null;
  analysis_hash: string | null;
};

/** ONE US/English observation frame, the same one the registry sends on every LLM ask. */
const OBSERVATION_LANGUAGE = "en";
const OBSERVATION_LOCATION = 2840;
const AI_OBSERVATIONS_TABLE = "ai_observations";

export type AiObservationDraft = {
  tenantId: string;
  site: string;
  promptId: string;
  promptVersion: number;
  promptText: string;
  engine: ResearchEngine;
  mode: ObservationMode;
  slot: number;
  /** THE reporting day this reading belongs to, taken from the PLAN and never from a clock: one run, one
   *  day, whatever hour the request actually left. */
  day: string;
  /** Full ISO instant the request was made. It records WHEN, never WHICH DAY THIS COUNTS FOR. */
  requestedAt: string;
  completedAt?: string | null;
  capability: string;
  cacheKey?: string | null;
  costUsd?: number;
  modelRequested?: string | null;
  status: AiObservationStatus;
  failureReason?: string | null;
  parsed?: ParsedAiAnswer | null;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The deterministic identity. Same intent, same id, forever: a retry can only ever overwrite itself. */
export function aiObservationId(i: { tenantId: string; promptId: string; promptVersion: number; engine: string; day: string; slot: number }): string {
  return `obs_${sha(`${i.tenantId}|${i.promptId}|${i.promptVersion}|${i.engine}|${i.day}|${i.slot}`).slice(0, 40)}`;
}

/** Pure: one draft -> the canonical row. Nothing is invented; what the provider did not report stays null. */
export function buildAiObservation(d: AiObservationDraft): AiObservationRecord {
  const day = d.day;
  const p = d.parsed ?? null;
  const text = p?.answerText ?? null;
  return {
    id: aiObservationId({ tenantId: d.tenantId, promptId: d.promptId, promptVersion: d.promptVersion, engine: d.engine, day, slot: d.slot }),
    tenant_id: d.tenantId, site: d.site, prompt_id: d.promptId, prompt_version: d.promptVersion, prompt_text: d.promptText,
    engine: d.engine, model_requested: d.modelRequested ?? null, model_served: p?.modelServed ?? null,
    observation_mode: d.mode, reporting_day: day, sample_slot: d.slot,
    language: OBSERVATION_LANGUAGE, location: OBSERVATION_LOCATION,
    requested_at: d.requestedAt, completed_at: d.completedAt ?? null,
    capability_version: d.capability, cache_key: d.cacheKey ?? null, cost_usd: d.costUsd ?? 0,
    status: d.status, failure_reason: d.failureReason ?? null,
    answer_text: text, answer_hash: text ? sha(text).slice(0, 16) : null,
    journey: {
      fan_outs: p?.fanOutQueries ?? null, retrieved_results: p?.retrievedResults ?? null,
      cited_sources: p?.citations ?? null, brand_mentions: p?.brandMentions ?? null,
      web_search_reported: p?.webSearchReported ?? null,
    },
    analysis: null, analysis_hash: null,
  };
}

/**
 * THE legacy projection. prompt_answer_observations is derived from the canonical record at write time and
 * is never independently composed: the id keeps its pre-6I shape (the consumer look stays "+scraper", a
 * changed served model yields a distinct row) so every native-intel reader keeps working unchanged.
 */
export function projectPromptAnswerObservation(rec: AiObservationRecord, runId: string): PromptAnswerObservation {
  const cited = rec.journey.cited_sources, observed = cited !== null;
  const domains = (cited ?? []).map((c) => c.domain);
  const model = rec.model_served ?? rec.model_requested ?? rec.engine, consumer = rec.observation_mode === "consumer_search";
  const observedAt = rec.completed_at ?? rec.requested_at;
  return {
    id: `${rec.tenant_id}|${rec.engine}${consumer ? "+scraper" : ""}|${rec.prompt_id}|${model}|${observedAt.slice(0, 10)}`,
    prompt_id: rec.prompt_id, run_id: runId, tenant_id: rec.tenant_id, platform: rec.engine, observed_at: observedAt, topic: "",
    answer_hash: rec.answer_hash, search_queries: rec.journey.fan_outs ?? undefined,
    position: null, tracked_brand_mentioned: null, tracked_brand_cited: null,
    citation_count: domains.length, owned_citation_count: 0, citation_domains: domains, citation_categories: {}, mentions: [],
    citation_urls: observed ? (cited ?? []).map((c) => c.url) : null,
    metadata: { source: "research-funnel", observationMode: rec.observation_mode, scraper: consumer,
      webSearchReported: rec.journey.web_search_reported, modelServed: rec.model_served, modelRequested: rec.model_requested,
      citationsObserved: observed, prompt_text: rec.prompt_text, observationId: rec.id },
  };
}

/** THE one production write of a canonical observation: tenant-checked, fail-closed, upserted on identity. */
export async function recordAiObservation(rec: AiObservationRecord, tenantId: string): Promise<void> {
  await dualWriteUpsertScoped(AI_OBSERVATIONS_TABLE, [rec], "id", tenantId);
}

/** ONE page of a paginated read, and the ceiling on a whole read. Bounded so no single visit pulls an
 *  unbounded table into memory; a range past the ceiling is a fault I say out loud, never a quiet cut. */
const PAGE_ROWS = 1000, MAX_ROWS = 40_000;

/**
 * Read stored observations back for RE-ANALYSIS. Everything a later pass needs is already on the row, so
 * re-reading an answer costs nothing and no provider is called. A failed read throws (an empty list would
 * read as "this account has no answers", which is a different and false claim).
 *
 * EVERY FILTER IS IN THE QUERY, and a NAMED DAY RANGE is then PAGED until it is exhausted: asking for a
 * range means asking for all of it. It used to be one `.limit(2000)` over the newest rows, so an account
 * asking 35 questions of 4 engines (140 first readings a day) had its "28 day" history cut around day 14
 * and every total under it covered a fortnight while claiming a month.
 */
export async function readAiObservations(
  tenantId: string, opts: { day?: string; fromDay?: string; toDay?: string; promptId?: string; limit?: number; slot?: number } = {},
): Promise<AiObservationRecord[]> {
  const whole = opts.fromDay !== undefined || opts.toDay !== undefined;
  const want = Math.min(Math.max(1, Math.floor(opts.limit ?? (whole ? MAX_ROWS : 500))), MAX_ROWS);
  const rows: AiObservationRecord[] = [];
  let exhausted = false;
  while (!exhausted && rows.length < want) {
    const size = Math.min(PAGE_ROWS, want - rows.length);
    let q = getSupabaseAdmin().from(AI_OBSERVATIONS_TABLE).select("*").eq("tenant_id", tenantId);
    if (opts.day) q = q.eq("reporting_day", opts.day);
    if (opts.fromDay) q = q.gte("reporting_day", opts.fromDay);
    if (opts.toDay) q = q.lte("reporting_day", opts.toDay);
    if (opts.promptId) q = q.eq("prompt_id", opts.promptId);
    // The slot is asked for HERE: filtering it afterwards spends every page on samples the caller drops.
    if (opts.slot !== undefined) q = q.eq("sample_slot", opts.slot);
    // Newest first, id breaking every tie: without a unique tiebreaker two rows stamped the same instant
    // can land on both sides of a page edge, so one is read twice and another never at all.
    const { data, error } = await q.order("requested_at", { ascending: false }).order("id", { ascending: false })
      .range(rows.length, rows.length + size - 1);
    if (error) throw new Error(`[ai_observations] read failed: ${error.message}`);
    const page = (data ?? []) as AiObservationRecord[];
    rows.push(...page);
    exhausted = page.length < size; // a short page is the end of the range; a full one means keep walking
  }
  if (!exhausted && rows.length >= MAX_ROWS) throw new Error(`[ai_observations] read hit the ${MAX_ROWS} row ceiling; ask for a narrower day range`);
  return rows;
}

/** The READER's view of a stored observation: the identity, where it stands, and the text an analysis pass
 *  works on. Planners and analyzers consume this; only the writer handles the stored column shape, so no
 *  caller has to cast a database row into the shape it wanted. */
export type AiObservationView = {
  id: string;
  promptId: string;
  version: number;
  engine: string;
  slot: number;
  day: string;
  status: AiObservationStatus;
  observedAt: string | null;
  promptText: string;
  answerText: string | null;
  answerHash: string | null;
  /** The addresses this answer CREDITED, in the order it credited them. null keeps the
   *  row's own tri-state: this path does not report citations at all, which is a
   *  different claim from "it credited nothing". */
  citationUrls: string[] | null;
  analysis: Record<string, unknown> | null;
  analysisHash: string | null;
};

/** Pure: stored row -> reader's view. */
function viewAiObservation(r: AiObservationRecord): AiObservationView {
  return {
    id: r.id, promptId: r.prompt_id, version: r.prompt_version, engine: r.engine, slot: r.sample_slot,
    day: r.reporting_day, status: r.status, observedAt: r.completed_at, promptText: r.prompt_text,
    answerText: r.answer_text, answerHash: r.answer_hash, analysis: r.analysis, analysisHash: r.analysis_hash,
    citationUrls: r.journey?.cited_sources?.map((c) => c.url || c.domain) ?? null,
  };
}

/** THE re-analysis read: everything a later pass needs, already bought, in the reader's own shape. */
export async function readAiObservationViews(
  tenantId: string, opts: { day?: string; promptId?: string; limit?: number; slot?: number } = {},
): Promise<AiObservationView[]> {
  return (await readAiObservations(tenantId, opts)).map(viewAiObservation);
}

/**
 * Persist the analysis of an answer ALREADY in hand. Zero provider calls, zero repurchase: the text was
 * bought once and the verdict lands beside it. A write that matched no row throws, so a lost analysis can
 * never read as a saved one.
 */
export async function persistAnswerAnalysis(
  tenantId: string, observationId: string, analysis: Record<string, unknown>, analysisHash: string,
): Promise<void> {
  const { data, error } = await getSupabaseAdmin().from(AI_OBSERVATIONS_TABLE)
    .update({ analysis, analysis_hash: analysisHash })
    .eq("tenant_id", tenantId).eq("id", observationId).select("id");
  if (error) throw new Error(`[ai_observations] analysis write failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) throw new Error(`[ai_observations] analysis write matched no row for ${observationId}`);
}
