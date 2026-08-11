import "server-only";

/**
 * llm/call-cache (2026-07-03 R16; Slice 3 2026-07-23 account isolation) - PER-ACCOUNT content-hash cache for structured LLM calls: prompt + inputs hash -> the VALIDATED output, scoped to ONE account.
 *
 * An identical request never pays twice WITHIN an account: re-opening a Move or a nightly re-prepare of the same evidence finds the prior validated output at
 * $0. The explicit "Regenerate" passes `bypassCache: true` and always pays for a fresh take (which REPLACES the cached entry).
 *
 * ISOLATION (Slice 3): every read/write/recentTexts takes an EXPLICIT `tenantId` and routes storage per-account (the "llm-call-cache" json-store is now
 * TENANT_SCOPED: `.data/tenants/{slug}/llm-call-cache.json`, Supabase-mirrored per scope key). The account is folded INTO the content hash AND recorded on each
 * entry, so a byte-identical prompt from account B is a MISS against account A's cache and B pays for its own generation. A missing/empty tenantId THROWS before
 * any storage access - no global fallback, no cross-account reuse. The prior GLOBAL blob (`llm-call-cache::global`) is left inert: its rows' ownership is
 * unprovable, so they are never migrated or read. Fresh per-account caches start empty (a one-time $0-cache refill per account; accepted and honest).
 *
 * The cache rows double as the de-templating history: the last outputs for a lever family (SAME account only) are what a new draft is compared against.
 *
 * VITEST: the drafter consults the cache outside tests only unless a CacheImpl is injected - pinned suites stay byte-identical and no test touches the real cache.
 */

import { createHash } from "node:crypto";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";

const LLM_CALL_CACHE_STORE = "llm-call-cache";
const LLM_CALL_CACHE_MAX_ENTRIES = 300;

export type LlmCallCacheEntry = {
  /** sha256 of tenantId | promptId | version | kind | system | user. */
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
}): string {
  return createHash("sha256")
    .update(
      [requireTenant(parts.tenantId), parts.promptId, String(parts.promptVersion), parts.kind, parts.system, parts.user].join(
        "\u0000",
      ),
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

/** Pure prune: replace/insert the entry, cap to max by last-used. Exported for tests. */
function upsertAndPrune(
  rows: LlmCallCacheEntry[],
  entry: LlmCallCacheEntry,
  max = LLM_CALL_CACHE_MAX_ENTRIES,
): LlmCallCacheEntry[] {
  const kept = rows.filter((r) => r.key !== entry.key);
  kept.push(entry);
  const sorted = sortByLastUsedDesc(kept);
  return sorted.slice(0, max);
}

/** Read this account's rows only (routed per-tenant; owner re-checked in memory). */
async function readAll(tenantId: string): Promise<LlmCallCacheEntry[]> {
  try {
    const rows = await readStore<LlmCallCacheEntry>(LLM_CALL_CACHE_STORE, undefined, { tenantId });
    return Array.isArray(rows)
      ? rows.filter((r) => r && typeof r.key === "string" && r.tenantId === tenantId)
      : [];
  } catch {
    return [];
  }
}

/** The store-backed default cache. Fail-soft everywhere: a cache problem only costs the discount. */
export const storeCacheImpl: CacheImpl = {
  async read(tenantId, key) {
    const t = requireTenant(tenantId);
    const rows = await readAll(t);
    const hit = rows.find((r) => r.key === key) ?? null;
    if (!hit) return null;
    // Touch lastUsedAt best-effort so the prune keeps hot entries.
    try {
      const touched: LlmCallCacheEntry = { ...hit, lastUsedAt: new Date().toISOString() };
      await writeStore<LlmCallCacheEntry>(LLM_CALL_CACHE_STORE, upsertAndPrune(rows, touched), { tenantId: t });
    } catch (e) {
      log.warn("[llm-call-cache] touch failed (non-fatal)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return hit;
  },
  async write(tenantId, entry) {
    const t = requireTenant(tenantId);
    try {
      const rows = await readAll(t);
      await writeStore<LlmCallCacheEntry>(LLM_CALL_CACHE_STORE, upsertAndPrune(rows, { ...entry, tenantId: t }), {
        tenantId: t,
      });
    } catch (e) {
      log.warn("[llm-call-cache] write failed (non-fatal)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
  async recentTexts(tenantId, kind, limit) {
    const t = requireTenant(tenantId);
    const rows = await readAll(t);
    return sortByLastUsedDesc(rows.filter((r) => r.kind === kind && typeof r.primaryText === "string" && r.primaryText.length > 0))
      .slice(0, limit)
      .map((r) => r.primaryText as string);
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
