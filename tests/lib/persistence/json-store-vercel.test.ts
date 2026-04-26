import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Regression for Phase 0 (2026-04-24): json-store was calling mkdirSync on
 * every readStore call, including on Vercel where `process.cwd()/.data`
 * doesn't exist and cannot be created. Result: ENOENT/EROFS crashing any
 * route that touched a `.data` store (adjudicator cache, budget, history,
 * recommendation responses, etc.).
 *
 * These tests pin the hosted-safe contract: when VERCEL=1 AND .data does
 * not exist, readStore / writeStore / adjudicator cache / budget / history
 * must return safe defaults and must NOT attempt to create the directory.
 */

function makeIsolatedCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-vercel-test-"));
  // Intentionally do NOT create `.data` inside `dir`. The test verifies
  // that stores don't attempt to mkdir it on VERCEL=1.
  return dir;
}

describe("json-store on VERCEL=1 — safe against missing .data", () => {
  const previousVercel = process.env.VERCEL;
  const previousCwd = process.cwd();
  let isolatedCwd: string | null = null;

  beforeEach(() => {
    process.env.VERCEL = "1";
    isolatedCwd = makeIsolatedCwd();
    process.chdir(isolatedCwd);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (isolatedCwd) {
      try {
        fs.rmSync(isolatedCwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    isolatedCwd = null;
  });

  it("readStore on VERCEL=1 with no .data dir returns [] and does NOT create .data", async () => {
    const { readStore } = await import("@/lib/persistence/json-store");
    const result = await readStore<{ id: string }>("hosted-safe-cache-test");
    expect(result).toEqual([]);
    expect(fs.existsSync(path.join(isolatedCwd!, ".data"))).toBe(false);
  });

  it("writeStore on VERCEL=1 does NOT create .data and does NOT throw", async () => {
    const { writeStore } = await import("@/lib/persistence/json-store");
    await expect(
      writeStore("hosted-safe-cache-test", [{ id: "x" }]),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(isolatedCwd!, ".data"))).toBe(false);
  });

  it("readStore + writeStore + readStore round-trip on VERCEL=1 uses in-memory cache", async () => {
    const { readStore, writeStore } = await import(
      "@/lib/persistence/json-store"
    );
    const before = await readStore<{ id: string }>("round-trip-test");
    expect(before).toEqual([]);
    await writeStore("round-trip-test", [{ id: "a" }, { id: "b" }]);
    const after = await readStore<{ id: string }>("round-trip-test");
    expect(after).toEqual([{ id: "a" }, { id: "b" }]);
    expect(fs.existsSync(path.join(isolatedCwd!, ".data"))).toBe(false);
  });
});

describe("adjudicator stores on VERCEL=1 with no .data — safe defaults", () => {
  const previousVercel = process.env.VERCEL;
  const previousCwd = process.cwd();
  let isolatedCwd: string | null = null;

  beforeEach(() => {
    process.env.VERCEL = "1";
    isolatedCwd = makeIsolatedCwd();
    process.chdir(isolatedCwd);
    // Phase 7.8b-2-d (2026-04-26): canonical-store / adjudicator-cache module
    // init now reads through the tenant-aware json-store router, which requires
    // `.data/tenants.json` to exist for tenant resolution. Seed a minimal
    // registry; the original "no .data created" contract continues to hold for
    // the per-tenant subdirs checked in the assertions below.
    fs.mkdirSync(path.join(isolatedCwd, ".data"), { recursive: true });
    fs.writeFileSync(
      path.join(isolatedCwd, ".data", "tenants.json"),
      JSON.stringify(
        [
          {
            id: "tenant-ritz-founder",
            slug: "ritz-builders",
            business_name: "Ritz Builders",
            role: "founder",
            created_at: "2026-04-25T00:00:00.000Z",
            updated_at: "2026-04-25T00:00:00.000Z",
          },
        ],
        null,
        2,
      ),
    );
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (isolatedCwd) {
      try {
        fs.rmSync(isolatedCwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    isolatedCwd = null;
  });

  it("readCacheEntry returns null for missing hash, no per-tenant subdir created", async () => {
    const { readCacheEntry } = await import(
      "@/domains/recommendations/adjudicator-cache"
    );
    expect(await readCacheEntry("no-such-hash")).toBeNull();
    // Per-tenant subdir is the failure mode this test exists to catch on Vercel.
    expect(fs.existsSync(path.join(isolatedCwd!, ".data", "tenants", "ritz-builders"))).toBe(false);
  });

  it("checkBudget returns allowed=true at empty state, no per-tenant subdir created", async () => {
    const { checkBudget } = await import(
      "@/domains/recommendations/adjudicator-budget"
    );
    const r = await checkBudget();
    expect(r.allowed).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd!, ".data", "tenants", "ritz-builders"))).toBe(false);
  });

  it("appendHistory + writeCacheEntry + recordSpend all no-throw, no per-tenant subdir created", async () => {
    const { appendHistory } = await import(
      "@/domains/recommendations/adjudicator-history"
    );
    const { writeCacheEntry } = await import(
      "@/domains/recommendations/adjudicator-cache"
    );
    const { recordSpend } = await import(
      "@/domains/recommendations/adjudicator-budget"
    );

    await expect(
      appendHistory({
        timestamp: new Date().toISOString(),
        evidenceHash: "h",
        stableKey: "k",
        model: "gpt-5-mini",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        output: null,
        packetSummary: {
          schemaVersion: "v1",
          candidate: {
            stableKey: "k",
            deterministicAction: "create_new_page",
            clusterLabel: null,
          },
          promptCount: 0,
          inventoryCount: 0,
          excerptCount: 0,
        },
        source: "error",
      }),
    ).resolves.toBeUndefined();

    await expect(
      writeCacheEntry({
        evidenceHash: "h",
        stableKey: "k",
        model: "gpt-5-mini",
        output: {
          finalAction: "needs_review",
          primaryMotive: "improve_close_prompt",
          targetUrl: "needs_new_page",
          confidence: "low",
          confidenceReason: "",
          needsHumanReview: true,
          operatorTitle: "x",
          why: "x",
          specificRecommendation: "x",
          suggestedEdits: [],
          pageBrief: null,
          proposedSlug: null,
          evidenceRefs: [],
          risks: [],
          mergeWithUrls: null,
          noActionReason: "x",
        },
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        cachedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    await expect(recordSpend(0.001)).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(isolatedCwd!, ".data", "tenants", "ritz-builders"))).toBe(false);
  });
});
