import "server-only";

/** Tenant-scoped structured-output reuse and same-family writing history.
 * Request identity includes model and schema; reads never mutate banked entries.
 * Unavailable storage throws rather than impersonating an empty cache. */

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { getTenant } from "@/domains/account";

const LLM_CALL_CACHE_MAX_ENTRIES = 300;

export type LlmCallCacheEntry = {
  /** Content hash of the tenant, prompts, inputs, requested model and schema. */
  key: string;
  /** The owning account. Recorded on every entry (defense in depth). */
  tenantId: string;
  /** The lever family (structured-draft kind) - the de-templating bucket. */
  kind: string;
  promptId: string;
  promptVersion: number;
  /** The schema-validated output value (re-validated on every read). */
  value: unknown;
  /** The primary customer-facing text, for the de-templating history. */
  primaryText: string | null;
  repeatFlag?: string;
  createdAt: string;
  lastUsedAt: string;
};

/** Injectable seam so tests exercise cache behavior without real persistence.
 *  Every method takes the EXPLICIT owning account - never resolved ambiently. */
export type CacheImpl = {
  read: (tenantId: string, key: string) => Promise<LlmCallCacheEntry | null>;
  write: (tenantId: string, entry: LlmCallCacheEntry) => Promise<void>;
  recentTexts: (tenantId: string, kind: string, limit: number) => Promise<string[]>;
};

/** Deterministic content hash for one structured call, SCOPED to the account so
 *  identical prompts from different accounts never collide onto one entry. */
export function llmCallCacheKey(parts: {
  tenantId: string;
  promptId: string;
  promptVersion: number;
  kind: string;
  system: string;
  user: string;
  model: string;
  schema: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([requireTenant(parts.tenantId), parts.promptId, parts.promptVersion, parts.kind, parts.system, parts.user, parts.model, parts.schema]),
    )
    .digest("hex");
}

/** Fail-closed: an absent/empty account identity is a programming error, never a
 *  license to read or write a shared cache. Throws BEFORE any storage access. */
function requireTenant(tenantId: string): string {
  const t = (tenantId ?? "").trim();
  if (!t) throw new Error("[llm-call-cache] tenantId is required (fail-closed; no global fallback).");
  return t;
}

/** Newest-first by lastUsedAt; ties keep input order. */
function sortByLastUsedDesc(rows: LlmCallCacheEntry[]): LlmCallCacheEntry[] {
  return [...rows].sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : a.lastUsedAt > b.lastUsedAt ? -1 : 0));
}

const scopeKey = (tenantId: string, key: string): string => `llm-call-cache::${JSON.stringify([tenantId, key])}`;
const storeName = (tenantId: string): string => `llm-call-cache::${JSON.stringify([tenantId])}`;
function inventory(content: unknown): LlmCallCacheEntry[] {
  if (!Array.isArray(content) || content.some((r) => !r || typeof r.key !== "string" || typeof r.tenantId !== "string" || typeof r.kind !== "string" || typeof r.lastUsedAt !== "string")) throw new Error("[llm-call-cache] unreadable cache inventory");
  return content as LlmCallCacheEntry[];
}
function ownedEntry(content: unknown, tenantId: string, key?: string): LlmCallCacheEntry {
  const rows = inventory(content), entry = rows[0];
  if (rows.length !== 1 || !entry || entry.tenantId !== tenantId || key !== undefined && entry.key !== key) throw new Error("[llm-call-cache] cache identity mismatch");
  return entry;
}
/** Historical blobs are read-only. Unknown old model identities never match a new request hash.
 * One pull serves a burst; no disk fallback, mutation, eviction or automatic stored-data deletion. */
const legacy = new Map<string, { at: number; rows: LlmCallCacheEntry[] }>();
async function legacyRows(tenantId: string): Promise<LlmCallCacheEntry[]> {
  const hit = legacy.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const account = await getTenant(tenantId, { strict: true });
  if (!account?.slug) throw new Error("[llm-call-cache] account identity unavailable");
  const { data, error } = await getSupabaseAdmin().from("json_store_blobs").select("content").eq("scope_key", `llm-call-cache::tenant:${account.slug}`).maybeSingle();
  if (error || data === undefined) throw new Error("[llm-call-cache] historical cache unavailable");
  const rows = data === null ? [] : inventory(data.content).filter((r) => r.tenantId === tenantId);
  if (legacy.size >= 16) legacy.delete(legacy.keys().next().value!);
  legacy.set(tenantId, { at: Date.now(), rows });
  return rows;
}

/** Independent primary-key upserts are safe across processes; reads never write. */
export const storeCacheImpl: CacheImpl = {
  async read(tenantId, key) {
    const t = requireTenant(tenantId);
    const { data, error } = await getSupabaseAdmin().from("json_store_blobs").select("content").eq("scope_key", scopeKey(t, key)).maybeSingle();
    if (error || data === undefined) throw new Error("[llm-call-cache] cache read unavailable");
    return data === null ? (await legacyRows(t)).find((r) => r.key === key) ?? null : ownedEntry(data.content, t, key);
  },
  async write(tenantId, entry) {
    const t = requireTenant(tenantId);
    const key = scopeKey(t, entry.key);
    const { data, error } = await getSupabaseAdmin().from("json_store_blobs").upsert({ scope_key: key, store_name: storeName(t), content: [{ ...entry, tenantId: t }], updated_at: new Date().toISOString() }, { onConflict: "scope_key" }).select("scope_key");
    if (error || !Array.isArray(data) || data.length !== 1 || data[0]?.scope_key !== key) throw new Error("[llm-call-cache] cache write unacknowledged");
  },
  async recentTexts(tenantId, kind, limit) {
    const t = requireTenant(tenantId);
    const count = Math.min(LLM_CALL_CACHE_MAX_ENTRIES, Math.max(0, Math.floor(limit)));
    if (!Number.isFinite(count) || count === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("json_store_blobs").select("content").eq("store_name", storeName(t)).eq("content->0->>kind", kind).order("updated_at", { ascending: false }).limit(count);
    if (error || !Array.isArray(data)) throw new Error("[llm-call-cache] writing history unavailable");
    const rows = data.map((r) => ownedEntry(r.content, t)), keys = new Set(rows.map((r) => r.key));
    if (rows.length < count) rows.push(...(await legacyRows(t)).filter((r) => r.kind === kind && !keys.has(r.key)));
    return sortByLastUsedDesc(rows).filter((r) => typeof r.primaryText === "string" && r.primaryText.length > 0).slice(0, count).map((r) => r.primaryText as string);
  },
};

/**
 * The cache the drafter should use: the store-backed impl in production, the injected impl in tests, and NOTHING under vitest without injection (keeps every pinned suite hermetic).
 */
export function resolveCacheImpl(injected?: CacheImpl): CacheImpl | null {
  if (injected) return injected;
  if (process.env.VITEST === "true") return null;
  return storeCacheImpl;
}
