/**
 * 2026-07-02 D1 ground-truth fix - pins for tenant-question-library.ts:
 *   - tenant scoping: polling tenant A's library NEVER reads tenant B's rows
 *     (this was the root cause: run-engine-poll used to call the GLOBAL
 *     prompt-library store, which had no tenant filter at all)
 *   - fail-loud: zero active questions for a tenant logs a NAMED warning
 *     instead of silently returning as if that were fine
 *   - the idempotent reseed helper only fires when the tenant's library is
 *     genuinely empty, merges + dedupes + caps GSC and Profound seeds, and
 *     never touches a tenant that already has questions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Per-tenant row fixtures keyed "table:tenantId".
const rowsByKey: Record<string, unknown[]> = {};
const insertedRows: Array<{ table: string; rows: unknown[] }> = [];

function chainFor(table: string) {
  let tenantId: string | undefined;
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: string) => {
      if (col === "tenant_id") tenantId = val;
      return chain;
    }),
    order: vi.fn(() => chain),
    limit: vi.fn(() =>
      Promise.resolve({ data: rowsByKey[`${table}:${tenantId}`] ?? [], error: null }),
    ),
    insert: vi.fn((rows: unknown[]) => {
      insertedRows.push({ table, rows });
      return Promise.resolve({ data: rows, error: null });
    }),
  };
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => chainFor(table) }),
}));

import { log } from "@/lib/logger";
import {
  loadTenantQuestionLibrary,
  buildSeedCandidateSet,
  seedTenantQuestionLibraryIfEmpty,
  type SeedCandidate,
} from "./tenant-question-library";

const TENANT_A = "tenant-iranopedia";
const TENANT_B = "tenant-ritz-founder";

beforeEach(() => {
  for (const k of Object.keys(rowsByKey)) delete rowsByKey[k];
  insertedRows.length = 0;
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.info).mockClear();
});

describe("loadTenantQuestionLibrary - tenant scoping", () => {
  it("polling tenant A never returns tenant B's questions", async () => {
    rowsByKey[`tracked_prompts:${TENANT_A}`] = [
      { id: "a-1", text: "best persian food in tehran", topic_id: "iran", is_active: true },
    ];
    rowsByKey[`tracked_prompts:${TENANT_B}`] = [
      { id: "b-1", text: "best kitchen remodeler near me", topic_id: "ritz", is_active: true },
    ];

    const a = await loadTenantQuestionLibrary(TENANT_A);
    const b = await loadTenantQuestionLibrary(TENANT_B);

    expect(a.map((q) => q.id)).toEqual(["a-1"]);
    expect(a.map((q) => q.prompt_text)).toEqual(["best persian food in tehran"]);
    expect(b.map((q) => q.id)).toEqual(["b-1"]);
    // Cross-contamination check: neither list contains the other tenant's text.
    expect(a.some((q) => q.prompt_text.includes("kitchen remodeler"))).toBe(false);
    expect(b.some((q) => q.prompt_text.includes("persian food"))).toBe(false);
  });

  it("zero active questions for a tenant fails loud (named warning), returns empty", async () => {
    rowsByKey[`tracked_prompts:${TENANT_A}`] = [];

    const result = await loadTenantQuestionLibrary(TENANT_A);

    expect(result).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("ZERO active tracked_prompts"),
      expect.objectContaining({ tenantId: TENANT_A }),
    );
  });

  it("never falls back to another tenant's rows when the target tenant is empty", async () => {
    rowsByKey[`tracked_prompts:${TENANT_A}`] = [];
    rowsByKey[`tracked_prompts:${TENANT_B}`] = [
      { id: "b-1", text: "best kitchen remodeler near me", topic_id: "ritz", is_active: true },
    ];

    const result = await loadTenantQuestionLibrary(TENANT_A);

    expect(result).toEqual([]);
  });

  it("refuses an empty tenantId rather than reading unscoped rows", async () => {
    const result = await loadTenantQuestionLibrary("");
    expect(result).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("empty tenantId"));
  });
});

describe("buildSeedCandidateSet - merge, dedupe, cap", () => {
  it("dedupes near-identical text across sources and caps at the limit", () => {
    const gsc: SeedCandidate[] = [
      { text: "what is nowruz", topic: null, source: "gsc" },
      { text: "What Is Nowruz", topic: null, source: "gsc" }, // dup of above, case-insensitive
      { text: "best persian new year traditions", topic: null, source: "gsc" },
    ];
    const profound: SeedCandidate[] = [
      { text: "what is nowruz", topic: "iran", source: "profound" }, // dup of gsc entry
      { text: "history of the persian calendar", topic: "iran", source: "profound" },
    ];

    const out = buildSeedCandidateSet(gsc, profound, 10);
    const texts = out.map((c) => c.text.toLowerCase());
    expect(texts.filter((t) => t === "what is nowruz")).toHaveLength(1);
    expect(out.length).toBe(3); // 4 unique inputs minus 1 duplicate
  });

  it("caps the merged set at the given limit", () => {
    const many: SeedCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      text: `what is topic number ${i}`,
      topic: null,
      source: "gsc" as const,
    }));
    const out = buildSeedCandidateSet(many, [], 5);
    expect(out).toHaveLength(5);
  });

  it("never re-seeds the borrowed-account 'Evaluate the Frontier Models company X' junk", () => {
    // 2026-07-08: these leak in from a Profound import and must never re-enter a tenant's
    // tracked prompts. A real question that merely mentions an AI product still survives.
    const profound: SeedCandidate[] = [
      { text: "Evaluate the Frontier Models company ChatGPT on Iranopedia", topic: "iran", source: "profound" },
      { text: "Evaluate the Frontier Models company Grok on Iranopedia", topic: "iran", source: "profound" },
      { text: "what are the best persian dishes to try", topic: "iran", source: "profound" },
    ];
    const out = buildSeedCandidateSet([], profound, 10);
    const texts = out.map((c) => c.text.toLowerCase());
    expect(texts.some((t) => t.includes("frontier models company"))).toBe(false);
    expect(texts).toContain("what are the best persian dishes to try");
  });
});

describe("seedTenantQuestionLibraryIfEmpty - idempotent, tenant-scoped", () => {
  it("no-ops when the tenant already has questions", async () => {
    const loadExisting = vi.fn(async () => [{ id: "x-1", prompt_text: "already here", topic: null }]);
    const loadGsc = vi.fn(async () => [] as SeedCandidate[]);
    const loadProfound = vi.fn(async () => [] as SeedCandidate[]);

    const result = await seedTenantQuestionLibraryIfEmpty(TENANT_A, { loadExisting, loadGsc, loadProfound });

    expect(result.status).toBe("already_has_questions");
    expect(result.inserted).toBe(0);
    expect(loadGsc).not.toHaveBeenCalled();
    expect(loadProfound).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it("seeds from GSC + Profound sources when the tenant's library is genuinely empty", async () => {
    const loadExisting = vi.fn(async () => []);
    const loadGsc = vi.fn(async () => [
      { text: "what is nowruz", topic: null, source: "gsc" as const },
      { text: "best persian recipes", topic: null, source: "gsc" as const },
    ]);
    const loadProfound = vi.fn(async () => [
      { text: "history of persepolis", topic: "iran", source: "profound" as const },
    ]);

    const result = await seedTenantQuestionLibraryIfEmpty(TENANT_A, { loadExisting, loadGsc, loadProfound });

    expect(result.status).toBe("seeded");
    expect(result.inserted).toBe(3);
    expect(insertedRows).toHaveLength(1);
    const [{ table, rows }] = insertedRows;
    expect(table).toBe("tracked_prompts");
    // Every inserted row is scoped to the requesting tenant only.
    for (const r of rows as Array<{ tenant_id: string; account_id: string }>) {
      expect(r.tenant_id).toBe(TENANT_A);
      expect(r.account_id).toBe(TENANT_A);
    }
  });

  it("reports no_seed_sources when both GSC and Profound are empty for an empty tenant", async () => {
    const loadExisting = vi.fn(async () => []);
    const loadGsc = vi.fn(async () => [] as SeedCandidate[]);
    const loadProfound = vi.fn(async () => [] as SeedCandidate[]);

    const result = await seedTenantQuestionLibraryIfEmpty(TENANT_A, { loadExisting, loadGsc, loadProfound });

    expect(result.status).toBe("no_seed_sources");
    expect(insertedRows).toHaveLength(0);
  });
});
