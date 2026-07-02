import "server-only";

/**
 * embeddings (2026-07-02, master plan item 50) - the retrieval twin's OpenAI embedding client.
 * Budgeted (retrieval-budget.ts, fail-closed), cached (Supabase `retrieval_chunks`, hash-keyed -
 * re-embedding only happens on a content-hash miss), and batched (up to 100 inputs per call,
 * OpenAI's own per-request batch ceiling for the embeddings endpoint).
 *
 * Cost: text-embedding-3-small is ~$0.02 per 1M tokens. A full ~150-page Iranopedia index at
 * ~10 chunks x ~200 tokens/page is ~300k tokens - about $0.006, well under a cent. The budget
 * cap exists as a runaway guard, not a throttle.
 *
 * Fail-soft: any embedding failure (missing key, budget block, network error, malformed
 * response) returns a per-chunk "skipped" result rather than throwing - a partial index is
 * useful, a crashed index is not.
 */

import { createHash } from "node:crypto";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { checkBudget, recordSpend } from "./retrieval-budget";
import { log } from "@/lib/logger";

const OPENAI_EMBEDDINGS_API = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
const MAX_BATCH = 100;
/** $0.02 per 1M tokens, ~4 chars/token (OpenAI's own rough guidance for English text). */
const COST_PER_TOKEN_USD = 0.02 / 1_000_000;
const CHARS_PER_TOKEN = 4;

export type EmbeddableChunk = {
  /** content hash of embedText - the cache key (id in retrieval_chunks). */
  id: string;
  source: "owned" | "competitor";
  pageUrl: string;
  /** The text actually embedded, capped at 1200 chars to match the retrieval_chunks column. */
  chunkText: string;
};

export type EmbeddedChunk = EmbeddableChunk & { embedding: number[] };

export type EmbedBatchResult = {
  embedded: EmbeddedChunk[];
  /** Chunks already cached - $0, no OpenAI call made for these. */
  cacheHits: number;
  /** Chunks that failed to embed (budget block, no key, API error) - fail-soft, index continues. */
  skipped: Array<{ id: string; reason: string }>;
  /** Real money spent this call (0 when everything was a cache hit or nothing needed embedding). */
  spentUsd: number;
};

/** sha256 hex of the chunk's embed text - stable across runs on unchanged content. */
export function contentHashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateEmbedCostUsd(chunks: ReadonlyArray<{ chunkText: string }>): number {
  const totalChars = chunks.reduce((sum, c) => sum + c.chunkText.length, 0);
  return Number(((totalChars / CHARS_PER_TOKEN) * COST_PER_TOKEN_USD).toFixed(6));
}

function isConfigured(): boolean {
  return Boolean((process.env.OPENAI_API_KEY ?? "").trim());
}

/** Injectable embed fn for tests (default = real OpenAI call). */
export type EmbedFn = (inputs: string[]) => Promise<{ vectors: number[][] } | { error: string }>;

function defaultEmbed(apiKey: string): EmbedFn {
  return async (inputs) => {
    try {
      const res = await fetch(OPENAI_EMBEDDINGS_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, input: inputs }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return { error: `openai_${res.status}` };
      const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
      const rows = json.data ?? [];
      if (rows.length !== inputs.length) return { error: "row_count_mismatch" };
      const vectors = [...rows].sort((a, b) => a.index - b.index).map((r) => r.embedding);
      return { vectors };
    } catch (e) {
      return { error: e instanceof Error ? e.message.slice(0, 80) : "fetch_failed" };
    }
  };
}

/** Ids per IN-list read. Each id is a 64-char sha256 hex string; supabase-js sends `.in()`
 *  as a GET query-string parameter by default, so an unbounded id list can build a URL long
 *  enough to get rejected outright ("Bad Request" - observed on a real 539-id lookup). Read
 *  in bounded slices instead, same posture as the embed/write batching. */
const READ_BATCH = 100;

/**
 * Read any already-cached embeddings for the given chunk ids (content hashes) from
 * `retrieval_chunks`, batched. Fail-soft: a slice that errors is skipped (its chunks just
 * fall through to a fresh embed) rather than discarding every hit found by other slices.
 */
async function readCachedEmbeddings(tenantId: string, ids: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!isSupabaseConfigured() || ids.length === 0) return out;
  try {
    const sb = getSupabaseAdmin();
    for (let i = 0; i < ids.length; i += READ_BATCH) {
      const slice = ids.slice(i, i + READ_BATCH);
      const { data, error } = await sb.from("retrieval_chunks").select("id, embedding").eq("tenant_id", tenantId).in("id", slice);
      if (error || !data) {
        if (error) log.warn?.("[retrieval-twin] cache read slice failed (non-fatal)", { error: error.message, batchStart: i });
        continue;
      }
      for (const row of data as { id: string; embedding: unknown }[]) {
        if (Array.isArray(row.embedding)) out.set(row.id, row.embedding as number[]);
      }
    }
  } catch (e) {
    log.warn?.("[retrieval-twin] cache read failed (non-fatal)", { error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

/** Rows per upsert call. Each row carries a ~1536-float embedding as jsonb (a few KB), so a
 *  single unbatched upsert of hundreds of rows can hit Postgres's statement timeout (observed
 *  on a real 539-chunk index run) - write in bounded slices instead, same posture as the
 *  embed batching above. */
const WRITE_BATCH = 50;

/** Persist freshly-embedded chunks to the cache table, batched. Fail-soft: a write failure on
 *  one slice is logged and the remaining slices still attempt to write - losing the cache
 *  benefit for a few chunks next time never breaks the current run's already-returned results. */
async function writeCache(tenantId: string, rows: EmbeddedChunk[]): Promise<void> {
  if (!isSupabaseConfigured() || rows.length === 0) return;
  try {
    const sb = getSupabaseAdmin();
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      const slice = rows.slice(i, i + WRITE_BATCH);
      const payload = slice.map((r) => ({
        tenant_id: tenantId,
        id: r.id,
        source: r.source,
        page_url: r.pageUrl,
        chunk_text: r.chunkText,
        embedding: r.embedding,
      }));
      const { error } = await sb.from("retrieval_chunks").upsert(payload, { onConflict: "tenant_id,id" });
      if (error) log.warn?.("[retrieval-twin] cache write failed (non-fatal)", { error: error.message, batchStart: i });
    }
  } catch (e) {
    log.warn?.("[retrieval-twin] cache write threw (non-fatal)", { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Embed a bounded batch of chunks, cache-first, budgeted, fail-soft. Only chunks missing
 * from the cache trigger a real OpenAI call (batched up to MAX_BATCH inputs per request).
 * Never throws.
 */
export async function embedChunks(
  tenantId: string,
  chunks: ReadonlyArray<EmbeddableChunk>,
  deps: { embed?: EmbedFn; now?: () => Date } = {},
): Promise<EmbedBatchResult> {
  const embedded: EmbeddedChunk[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let spentUsd = 0;

  if (chunks.length === 0) return { embedded, cacheHits: 0, skipped, spentUsd: 0 };

  const dedupedById = new Map<string, EmbeddableChunk>();
  for (const c of chunks) dedupedById.set(c.id, c);
  const unique = [...dedupedById.values()];

  const cached = await readCachedEmbeddings(tenantId, unique.map((c) => c.id));
  const toEmbed: EmbeddableChunk[] = [];
  for (const c of unique) {
    const hit = cached.get(c.id);
    if (hit) embedded.push({ ...c, embedding: hit });
    else toEmbed.push(c);
  }
  const cacheHits = embedded.length;

  if (toEmbed.length === 0) return { embedded, cacheHits, skipped, spentUsd: 0 };

  const apiKey = process.env.OPENAI_API_KEY;
  const embed = deps.embed ?? (isConfigured() && apiKey ? defaultEmbed(apiKey) : null);
  if (!embed) {
    for (const c of toEmbed) skipped.push({ id: c.id, reason: "no_openai_key" });
    return { embedded, cacheHits, skipped, spentUsd: 0 };
  }

  const toCache: EmbeddedChunk[] = [];
  for (let i = 0; i < toEmbed.length; i += MAX_BATCH) {
    const batch = toEmbed.slice(i, i + MAX_BATCH);
    const projectedCostUsd = estimateEmbedCostUsd(batch);

    // Fail-closed: an unreadable budget state blocks this batch rather than letting it
    // through (matches structured-drafter.ts's contract).
    const budget = await checkBudget({ now: deps.now?.(), projectedCostUsd }).catch(() => ({
      allowed: false as const,
      reason: "budget check unavailable - failing closed",
    }));
    if (!budget.allowed) {
      for (const c of batch) skipped.push({ id: c.id, reason: (budget as { reason?: string }).reason ?? "budget_blocked" });
      continue;
    }

    const result = await embed(batch.map((c) => c.chunkText));
    if ("error" in result) {
      for (const c of batch) skipped.push({ id: c.id, reason: `embed_${result.error}` });
      continue;
    }

    const actualCostUsd = estimateEmbedCostUsd(batch);
    spentUsd += actualCostUsd;
    await recordSpend(actualCostUsd, { now: deps.now?.() }).catch(() => {});

    for (let j = 0; j < batch.length; j += 1) {
      const vec = result.vectors[j];
      if (!Array.isArray(vec) || vec.length === 0) {
        skipped.push({ id: batch[j].id, reason: "empty_vector" });
        continue;
      }
      const row: EmbeddedChunk = { ...batch[j], embedding: vec };
      embedded.push(row);
      toCache.push(row);
    }
  }

  await writeCache(tenantId, toCache);
  return { embedded, cacheHits, skipped, spentUsd: Number(spentUsd.toFixed(6)) };
}

/** Exposed for the cost-estimate line in the operator receipt. */
export function tokensForChunks(chunks: ReadonlyArray<{ chunkText: string }>): number {
  return chunks.reduce((sum, c) => sum + estimateTokens(c.chunkText), 0);
}
