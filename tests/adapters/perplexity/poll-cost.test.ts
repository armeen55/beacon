/**
 * Sprint 6A.3c (2026-04-26) — pollPerplexityForTenant cost + budget tests.
 *
 * Hermetic via tmpdir cwd (matches the pattern in
 * `tests/lib/cost/budget.test.ts`). NO real network calls — provider
 * mocked through `opts.client` (the existing DI seam from Sprint 5).
 *
 * Coverage:
 *   - Pre-flight tenant budget block: zero provider calls, status=failed,
 *     skipReason=budget_blocked, all prompts attributed as skippedBudget
 *   - Pre-flight monthly budget block: same shape
 *   - Mid-run per-run cap: loop halts, status=partial, skipReason=per_run_blocked,
 *     remaining prompts counted as skipped
 *   - Success path: recordSpend called with `${platform}:${model}:${promptId}`,
 *     cost aggregated, ledger reflects spend
 *   - Sample throws: no spend recorded for failed call, errorCount increments
 *   - Missing usage: no crash, cost=0, observation still persists
 *   - Returned result always carries cost block + skipReason + budgetReason
 *   - Normal no-cap run produces identical-to-before observation behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pollPerplexityForTenant } from "@/adapters/perplexity/poll";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { QueryClient } from "@/lib/querying/types";

// ── Test isolation ──────────────────────────────────────────────────────

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = { ...process.env };

let workdir: string;

type SpendEntry = {
  tenant_id: string;
  date: string;
  amount_usd: number;
  label: string;
  timestamp: string;
};

function ledgerPath(): string {
  return join(workdir, ".data", "cost-ledger.json");
}

function readLedger(): SpendEntry[] {
  if (!existsSync(ledgerPath())) return [];
  return JSON.parse(readFileSync(ledgerPath(), "utf-8")) as SpendEntry[];
}

function seedLedger(entries: SpendEntry[]): void {
  mkdirSync(join(workdir, ".data"), { recursive: true });
  writeFileSync(ledgerPath(), JSON.stringify(entries, null, 2), "utf-8");
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "beacon-poll-cost-test-"));
  process.chdir(workdir);
  process.env = { ...ORIGINAL_ENV };
  // Operator-locked defaults; tests override per case.
  delete process.env.BEACON_DAILY_BUDGET_USD_PER_TENANT;
  delete process.env.BEACON_MONTHLY_BUDGET_USD;
  delete process.env.BEACON_PER_RUN_BUDGET_USD;
  delete process.env.VERCEL;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env = { ...ORIGINAL_ENV };
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ── Fixture builders ────────────────────────────────────────────────────

const TENANT = "tenant-test";
const FROZEN_NOW = new Date("2026-04-26T12:00:00Z");

function makePrompt(id: string, text = `prompt ${id}`): TrackedPrompt {
  return {
    id,
    account_id: "acc",
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: null,
    platforms: [],
    tags: [],
    is_active: true,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-26T00:00:00Z",
  };
}

function makeOwnedEntity(): TrackedEntity {
  return {
    id: "own",
    account_id: "acc",
    entity_type: "brand",
    name: "Ritz Builders",
    aliases: ["Ritz", "Ritzbuilders"],
    domain: "ritzbuilders.com",
    url: null,
    location_scope: null,
    service_scope: null,
    is_active: true,
    is_owned: true,
    metadata: {},
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-26T00:00:00Z",
  };
}

/**
 * Mock client that returns canned answers + optional usage. Tracks call
 * count so tests can verify provider calls were/weren't made.
 */
function makeMockClient(opts: {
  answer?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  webSearchCalls?: number;
  /** Per-call override; index into prompts. */
  perPromptUsage?: Array<{ inputTokens: number; outputTokens: number; webSearchCalls?: number }>;
  throwOn?: number; // throw on the Nth (0-indexed) call
}): QueryClient & { calls: number } {
  let calls = 0;
  const client = {
    platform: "perplexity",
    model: opts.model ?? "sonar",
    calls: 0,
    async sample(_prompt: string) {
      const idx = calls;
      calls += 1;
      this.calls = calls;
      if (opts.throwOn !== undefined && idx === opts.throwOn) {
        throw new Error("simulated provider failure");
      }
      const usageOverride = opts.perPromptUsage?.[idx];
      const inputTokens = usageOverride?.inputTokens ?? opts.inputTokens ?? 100;
      const outputTokens = usageOverride?.outputTokens ?? opts.outputTokens ?? 200;
      const webSearchCalls =
        usageOverride?.webSearchCalls ?? opts.webSearchCalls ?? 0;
      return {
        answer_text: opts.answer ?? "Ritz Builders is a Bay Area builder.",
        citations: [],
        model: opts.model ?? "sonar",
        usage: { inputTokens, outputTokens, webSearchCalls },
      };
    },
  };
  return client as QueryClient & { calls: number };
}

// ── Pre-flight tenant cap ───────────────────────────────────────────────

describe("pollPerplexityForTenant — pre-flight tenant budget block", () => {
  it("zero provider calls when tenant daily cap is exhausted; status=failed; skipReason=budget_blocked", async () => {
    // Seed ledger to push tenant over the $10 default cap.
    const today = new Date().toISOString().slice(0, 10);
    seedLedger([
      {
        tenant_id: TENANT,
        date: today,
        amount_usd: 11,
        label: "test:over-cap",
        timestamp: today + "T01:00:00Z",
      },
    ]);

    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p1"), makePrompt("p2"), makePrompt("p3")],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(client.calls).toBe(0);
    expect(result.observations).toHaveLength(0);
    expect(result.observationRun.status).toBe("failed");
    expect(result.skipReason).toBe("budget_blocked");
    expect(result.budgetReason).toMatch(/daily budget exhausted/);
    expect(result.cost.promptsSkippedBudget).toBe(3);
    expect(result.cost.totalUsd).toBe(0);
  });
});

describe("pollPerplexityForTenant — pre-flight monthly budget block", () => {
  it("zero provider calls when monthly cap is exhausted; status=failed; skipReason=budget_blocked", async () => {
    // Seed ledger with a row in current month at $200 (cap), but TODAY's
    // tenant spend is $0 so tenant-daily check passes; monthly fires.
    const monthKey = FROZEN_NOW.toISOString().slice(0, 7);
    seedLedger([
      {
        tenant_id: TENANT,
        date: `${monthKey}-15`,
        amount_usd: 200,
        label: "test:month-over-cap",
        timestamp: `${monthKey}-15T01:00:00Z`,
      },
    ]);

    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p1"), makePrompt("p2")],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(client.calls).toBe(0);
    expect(result.skipReason).toBe("budget_blocked");
    expect(result.budgetReason).toMatch(/monthly budget exhausted/);
    expect(result.observationRun.status).toBe("failed");
    expect(result.cost.promptsSkippedBudget).toBe(2);
  });
});

// ── Mid-run per-run cap ─────────────────────────────────────────────────

describe("pollPerplexityForTenant — mid-run per-run budget block", () => {
  it("halts loop when running cost exceeds per-run cap; status=partial; skipReason=per_run_blocked", async () => {
    // Set per-run cap to a tight $0.001 so the SECOND prompt's pre-call
    // check trips. (sonar @ $1/M × 100k = $0.0001 input + $1/M × 200k =
    // $0.0002 output = $0.0003 per call → after 2 calls running > $0.0006
    // but cap is $0.001 — we need to run more or trip earlier. Easier:
    // set cap to $0.0001 so any positive spend trips the next prompt.)
    process.env.BEACON_PER_RUN_BUDGET_USD = "0.0001";

    const client = makeMockClient({
      inputTokens: 100,
      outputTokens: 200,
    });
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1"),
        makePrompt("p2"),
        makePrompt("p3"),
        makePrompt("p4"),
      ],
      trackedEntities: [makeOwnedEntity()],
    });

    // The first prompt fires (running cost = 0 at start, allowed).
    // Second prompt's pre-call check sees totalUsd > cap → blocks.
    expect(client.calls).toBe(1);
    expect(result.observations).toHaveLength(1);
    expect(result.skipReason).toBe("per_run_blocked");
    expect(result.budgetReason).toMatch(/Per-run budget exhausted/);
    expect(result.observationRun.status).toBe("partial");
    expect(result.cost.promptsCompleted).toBe(1);
    expect(result.cost.promptsSkippedBudget).toBe(3);
  });
});

// ── Success path: cost aggregation + recordSpend ───────────────────────

describe("pollPerplexityForTenant — success path records spend", () => {
  it("recordSpend appends one ledger row per successful sample; cost aggregates", async () => {
    const client = makeMockClient({
      inputTokens: 1_000_000, // $1.00 input on sonar
      outputTokens: 500_000, // $0.50 output on sonar
      model: "sonar",
    });
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p1"), makePrompt("p2")],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(client.calls).toBe(2);
    expect(result.observations).toHaveLength(2);
    expect(result.skipReason).toBeNull();
    expect(result.observationRun.status).toBe("completed");
    // 2 prompts × ($1 + $0.50) = $3.00 total
    expect(result.cost.totalUsd).toBeCloseTo(3, 4);
    expect(result.cost.inputTokens).toBe(2_000_000);
    expect(result.cost.outputTokens).toBe(1_000_000);
    expect(result.cost.promptsCompleted).toBe(2);
    expect(result.cost.promptsSkippedBudget).toBe(0);

    const ledger = readLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[0].tenant_id).toBe(TENANT);
    expect(ledger[0].label).toMatch(/^perplexity:sonar:/);
    expect(ledger[0].amount_usd).toBeCloseTo(1.5, 4);
  });

  it("aggregates web_search calls across the chunk (OpenAI-style usage)", async () => {
    const client = makeMockClient({
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 2000,
      webSearchCalls: 1,
    });
    // Override platform to chatgpt so pricing maps to openai.
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      platform: "chatgpt",
      pollSource: "openai-native-poll",
      trackedPrompts: [makePrompt("p1"), makePrompt("p2"), makePrompt("p3")],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(result.cost.webSearchCalls).toBe(3);
    // 3 calls × (1000 in × $2.50/M + 2000 out × $10/M + 1 search × $30/1k)
    // = 3 × ($0.0025 + $0.02 + $0.03) = 3 × $0.0525 = $0.1575
    expect(result.cost.totalUsd).toBeCloseTo(0.1575, 4);
  });
});

// ── Failure handling ────────────────────────────────────────────────────

describe("pollPerplexityForTenant — failure modes", () => {
  it("sample throw does not record spend; errorCount increments", async () => {
    const client = makeMockClient({
      throwOn: 0, // first prompt throws
      inputTokens: 1000,
      outputTokens: 500,
    });
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p-fail"), makePrompt("p-ok")],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(client.calls).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.observations).toHaveLength(1); // only p-ok succeeded
    expect(result.cost.promptsCompleted).toBe(1);

    const ledger = readLedger();
    // Only ONE row recorded — the failed call didn't spend.
    expect(ledger).toHaveLength(1);
    expect(ledger[0].label).toMatch(/p-ok/);
  });

  it("missing usage in sample response → cost=0, no crash, observation persisted", async () => {
    const noUsageClient: QueryClient = {
      platform: "perplexity",
      model: "sonar",
      async sample(_prompt: string) {
        return {
          answer_text: "answer without usage",
          citations: [],
          model: "sonar",
          // Intentionally NO usage field.
        };
      },
    };
    const result = await pollPerplexityForTenant(TENANT, {
      client: noUsageClient,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p1")],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(result.observations).toHaveLength(1);
    expect(result.cost.totalUsd).toBe(0);
    expect(result.cost.inputTokens).toBe(0);
    expect(result.cost.promptsCompleted).toBe(1);
    expect(result.skipReason).toBeNull();
  });
});

// ── Result shape ────────────────────────────────────────────────────────

describe("pollPerplexityForTenant — result shape", () => {
  it("always returns cost block + skipReason + budgetReason fields", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [],
      trackedEntities: [makeOwnedEntity()],
    });

    expect(result).toHaveProperty("cost");
    expect(result.cost).toMatchObject({
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 0,
      promptsCompleted: 0,
      promptsSkippedBudget: 0,
    });
    expect(result.skipReason).toBeNull();
    expect(result.budgetReason).toBeNull();
  });

  it("scope_label includes cost summary on a normal run", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p1")],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(result.observationRun.scope_label).toMatch(/cost=\$/);
    expect(result.observationRun.scope_label).not.toMatch(/BUDGET_BLOCKED/);
  });

  it("scope_label includes BUDGET_BLOCKED marker when pre-flight blocks", async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedLedger([
      {
        tenant_id: TENANT,
        date: today,
        amount_usd: 11,
        label: "test:over",
        timestamp: today + "T01:00:00Z",
      },
    ]);
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [makePrompt("p1")],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(result.observationRun.scope_label).toMatch(/BUDGET_BLOCKED/);
  });
});

// ── Sprint 6A.3d — identical-text prompt dedupe ─────────────────────────

describe("pollPerplexityForTenant — identical-text dedupe (Sprint 6A.3d)", () => {
  it("exact duplicate text causes one provider call, not two", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1", "What are the best builders in Atherton?"),
        makePrompt("p2", "What are the best builders in Atherton?"), // exact dupe
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(client.calls).toBe(1);
    expect(result.cost.promptsCompleted).toBe(1);
    expect(result.cost.promptsDeduped).toBe(1);
    expect(result.observations).toHaveLength(1);
  });

  it("normalizes by trim + lowercase (case + leading/trailing whitespace ignored)", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1", "Best builders in Atherton?"),
        makePrompt("p2", "  best BUILDERS in Atherton?  "),
        makePrompt("p3", "BEST BUILDERS IN ATHERTON?"),
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(client.calls).toBe(1);
    expect(result.cost.promptsCompleted).toBe(1);
    expect(result.cost.promptsDeduped).toBe(2);
  });

  it("does NOT dedupe distinct-but-similar prompts (single character difference)", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1", "Best builders in Atherton?"),
        makePrompt("p2", "Best builders in Atherton."),  // period instead of ?
        makePrompt("p3", "Best builder in Atherton?"),    // singular
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(client.calls).toBe(3);
    expect(result.cost.promptsCompleted).toBe(3);
    expect(result.cost.promptsDeduped).toBe(0);
  });

  it("includes promptsDeduped in result.cost", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1", "Same prompt"),
        makePrompt("p2", "Same prompt"),
        makePrompt("p3", "Same prompt"),
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(result.cost.promptsDeduped).toBe(2);
    expect(result.cost.promptsCompleted).toBe(1);
  });

  it("scope_label includes deduped marker when dedupes happen", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1", "Same prompt"),
        makePrompt("p2", "Same prompt"),
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(result.observationRun.scope_label).toMatch(/deduped=1/);
  });

  it("dedupe + budget gate compose correctly (dedupe runs INSIDE the loop)", async () => {
    // 4 prompts, 2 are dupes; per-run cap is set tight enough to halt
    // mid-run AFTER the first unique prompt. Result: 1 completed, 1
    // deduped (the second matching unique), and the rest skipped.
    process.env.BEACON_PER_RUN_BUDGET_USD = "0.0001";
    const client = makeMockClient({
      inputTokens: 100,
      outputTokens: 200,
    });
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1", "first prompt"),
        makePrompt("p2", "second prompt"), // would be a real call but blocked
        makePrompt("p3", "first prompt"),  // dedupe of p1
        makePrompt("p4", "another"),
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    // p1 fires + costs > cap → loop short-circuits BEFORE checking p2.
    // dedupe is BELOW the per-run budget check in the loop, so p3/p4
    // never reach dedupe inspection.
    expect(client.calls).toBe(1);
    expect(result.cost.promptsCompleted).toBe(1);
    expect(result.skipReason).toBe("per_run_blocked");
  });
});

// ── Backward compatibility: a normal full-native run is unchanged ──────

describe("pollPerplexityForTenant — normal-run behavior preserved", () => {
  it("100-prompt-equivalent (3-prompt mock) produces same observation count + status", async () => {
    const client = makeMockClient({});
    const result = await pollPerplexityForTenant(TENANT, {
      client,
      now: () => FROZEN_NOW,
      trackedPrompts: [
        makePrompt("p1"),
        makePrompt("p2"),
        makePrompt("p3"),
      ],
      trackedEntities: [makeOwnedEntity()],
    });
    expect(result.observations).toHaveLength(3);
    expect(result.errorCount).toBe(0);
    expect(result.observationRun.status).toBe("completed");
    expect(result.skipReason).toBeNull();
  });
});
