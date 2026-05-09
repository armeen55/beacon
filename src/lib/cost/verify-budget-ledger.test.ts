/**
 * verifyBudgetLedger contract tests — Phase 2 Stage B.2 verifier.
 *
 * Pins the 7 invariants from the operator brief:
 *   1. Reports a row per expected platform (perplexity + openai).
 *   2. spent_usd > 0 contributes to ok; zero or negative → failed.
 *   3. prompt_count agreement with prompt_answer_observations count.
 *   4. chunk_count agreement with completed observation_runs count.
 *   5. last_run_id present in completed runs.
 *   6. Duplicate rows at PK grain → overall=failed.
 *   7. Empty-state (no runs, no rows) → status=pending, exit 0 from CLI.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verifyBudgetLedger } from "./verify-budget-ledger";

type Row = Record<string, unknown>;
type Result<T> = { data: T | null; error: { message: string } | null };
type CountResult = { count: number | null; error: { message: string } | null };

const STATE: {
  ledgerByDate: Map<string, Row[]>;
  obsRuns: Row[];
  obsCountsByPlatform: Map<string, number>;
} = {
  ledgerByDate: new Map(),
  obsRuns: [],
  obsCountsByPlatform: new Map(),
};

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      if (table === "llm_budget_ledger") {
        return {
          select(_cols: string) {
            let date: string | null = null;
            const chain = {
              eq(col: string, val: unknown) {
                if (col === "date_utc") date = String(val);
                return chain;
              },
              then(resolve: (v: Result<Row[]>) => unknown) {
                const rows = (date ? STATE.ledgerByDate.get(date) : []) ?? [];
                return Promise.resolve({ data: rows, error: null }).then(resolve);
              },
            };
            return chain;
          },
        };
      }
      if (table === "observation_runs") {
        return {
          select(_cols: string) {
            const filters: Record<string, unknown> = {};
            const chain = {
              gte(col: string, val: unknown) {
                filters[`gte:${col}`] = val;
                return chain;
              },
              lte(col: string, val: unknown) {
                filters[`lte:${col}`] = val;
                return chain;
              },
              in(col: string, vals: unknown[]) {
                filters[`in:${col}`] = vals;
                return chain;
              },
              then(resolve: (v: Result<Row[]>) => unknown) {
                const sources = (filters["in:source"] as string[]) ?? [];
                const dayStart = String(filters["gte:completed_at"] ?? "");
                const dayEnd = String(filters["lte:completed_at"] ?? "");
                const matches = STATE.obsRuns.filter((r) => {
                  if (sources.length && !sources.includes(String(r.source))) return false;
                  const ts = String(r.completed_at ?? "");
                  if (dayStart && ts < dayStart) return false;
                  if (dayEnd && ts > dayEnd) return false;
                  return true;
                });
                return Promise.resolve({ data: matches, error: null }).then(resolve);
              },
            };
            return chain;
          },
        };
      }
      if (table === "prompt_answer_observations") {
        return {
          select(_cols: string, _opts?: unknown) {
            const filters: Record<string, unknown> = {};
            const chain = {
              gte(col: string, val: unknown) {
                filters[`gte:${col}`] = val;
                return chain;
              },
              lte(col: string, val: unknown) {
                filters[`lte:${col}`] = val;
                return chain;
              },
              eq(col: string, val: unknown) {
                filters[`eq:${col}`] = val;
                return chain;
              },
              then(resolve: (v: CountResult) => unknown) {
                const platform = String(filters["eq:platform"] ?? "");
                const count = STATE.obsCountsByPlatform.get(platform) ?? 0;
                return Promise.resolve({ count, error: null }).then(resolve);
              },
            };
            return chain;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

function reset() {
  STATE.ledgerByDate = new Map();
  STATE.obsRuns = [];
  STATE.obsCountsByPlatform = new Map();
}

beforeEach(() => reset());
afterEach(() => reset());

const DATE = "2026-05-09";
const TENANT = "tenant-ritz-founder";

function happyPathSetup() {
  STATE.ledgerByDate.set(DATE, [
    {
      tenant_id: TENANT,
      platform: "perplexity",
      spent_usd: 0.0917,
      call_count: 1,
      prompt_count: 100,
      chunk_count: 1,
      last_run_id: "pollrun-PPL",
    },
    {
      tenant_id: TENANT,
      platform: "openai",
      spent_usd: 2.8809,
      call_count: 1,
      prompt_count: 100,
      chunk_count: 1,
      last_run_id: "pollrun-OAI",
    },
  ]);
  STATE.obsRuns = [
    {
      run_id: "pollrun-PPL",
      source: "perplexity-native-poll",
      status: "completed",
      scope_label:
        "Native perplexity poll · chunk offset=0 limit=all · 100/100 prompts · cost=$0.0917",
      tenant_id: TENANT,
      completed_at: `${DATE}T09:28:03.000Z`,
    },
    {
      run_id: "pollrun-OAI",
      source: "openai-native-poll",
      status: "completed",
      scope_label:
        "Native chatgpt poll · chunk offset=0 limit=all · 100/100 prompts · cost=$2.8809",
      tenant_id: TENANT,
      completed_at: `${DATE}T09:17:47.000Z`,
    },
  ];
  STATE.obsCountsByPlatform.set("perplexity", 100);
  STATE.obsCountsByPlatform.set("chatgpt", 100);
}

// ── 1. Both expected platforms reported ──

describe("verifyBudgetLedger — Invariant 1: per-platform shape", () => {
  it("reports both perplexity and openai always", async () => {
    const r = await verifyBudgetLedger(DATE);
    expect(r.perPlatform).toHaveLength(2);
    expect(r.perPlatform.map((p) => p.ledgerPlatform).sort()).toEqual([
      "openai",
      "perplexity",
    ]);
  });

  it("rejects bad date format", async () => {
    await expect(verifyBudgetLedger("not-a-date")).rejects.toThrow();
  });
});

// ── Happy path ──

describe("verifyBudgetLedger — happy path: dual-write working", () => {
  it("returns overall ok when ledger matches runs + observations", async () => {
    happyPathSetup();
    const r = await verifyBudgetLedger(DATE);
    expect(r.overall).toBe("ok");
    for (const p of r.perPlatform) {
      expect(p.status).toBe("ok");
      expect(p.ledgerRow).not.toBeNull();
      expect(p.notes).toEqual([]);
    }
    expect(r.duplicateRowsDetected).toBe(false);
  });
});

// ── 2. spent_usd ≤ 0 ──

describe("verifyBudgetLedger — Invariant 2: spent_usd > 0", () => {
  it("flags zero spend as failed", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].spent_usd = 0;
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("failed");
    expect(ppl.notes.join(" ")).toMatch(/spent_usd is 0/);
    expect(r.overall).toBe("failed");
  });
});

// ── 3. prompt_count mismatch → warn ──

describe("verifyBudgetLedger — Invariant 3: prompt_count vs observations", () => {
  it("flags prompt_count drift as warn", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].prompt_count = 95; // ledger says 95
    STATE.obsCountsByPlatform.set("perplexity", 100); // observations say 100
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("warn");
    expect(ppl.notes.join(" ")).toMatch(/prompt_count 95.*persisted observations 100/);
    expect(r.overall).toBe("warn");
  });
});

// ── 4. chunk_count mismatch → warn ──

describe("verifyBudgetLedger — Invariant 4: chunk_count vs runs", () => {
  it("flags chunk_count drift as warn", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].chunk_count = 2;
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("warn");
    expect(ppl.notes.join(" ")).toMatch(/chunk_count 2.*completed observation_runs 1/);
  });
});

// ── 5. last_run_id correspondence ──

describe("verifyBudgetLedger — Invariant 5: last_run_id is real", () => {
  it("flags unknown last_run_id as warn", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].last_run_id = "pollrun-GHOST";
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("warn");
    expect(ppl.notes.join(" ")).toMatch(/last_run_id.*not found/);
  });

  it("null last_run_id does not trigger the check", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].last_run_id = null;
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("ok");
  });
});

// ── Cost drift > tolerance → warn ──

describe("verifyBudgetLedger — cost drift", () => {
  it("flags spent_usd vs scope_label cost mismatch beyond $0.01", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].spent_usd = 5.0; // way off
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("warn");
    expect(ppl.notes.join(" ")).toMatch(/differs from observation_runs cost sum/);
  });

  it("tolerates drift within $0.01", async () => {
    happyPathSetup();
    STATE.ledgerByDate.get(DATE)![0].spent_usd = 0.0925; // 0.0008 above
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("ok");
  });
});

// ── 6. Duplicate rows ──

describe("verifyBudgetLedger — Invariant 6: duplicate rows", () => {
  it("detects duplicate rows at PK grain → overall failed", async () => {
    happyPathSetup();
    const dup = { ...STATE.ledgerByDate.get(DATE)![0] };
    STATE.ledgerByDate.get(DATE)!.push(dup);
    const r = await verifyBudgetLedger(DATE);
    expect(r.duplicateRowsDetected).toBe(true);
    expect(r.overall).toBe("failed");
  });
});

// ── 7. Empty / pending state ──

describe("verifyBudgetLedger — Invariant 7: empty state", () => {
  it("no runs and no ledger rows → both platforms pending, overall pending", async () => {
    // STATE is empty by default.
    const r = await verifyBudgetLedger(DATE);
    expect(r.perPlatform.every((p) => p.status === "pending")).toBe(true);
    expect(r.overall).toBe("pending");
    expect(r.ledgerRows).toEqual([]);
  });

  it("runs exist but ledger row missing → failed (dual-write flag was off?)", async () => {
    STATE.obsRuns = [
      {
        run_id: "pollrun-PPL",
        source: "perplexity-native-poll",
        status: "completed",
        scope_label:
          "Native perplexity poll · chunk offset=0 limit=all · 100/100 prompts · cost=$0.0917",
        tenant_id: TENANT,
        completed_at: `${DATE}T09:28:03.000Z`,
      },
    ];
    STATE.obsCountsByPlatform.set("perplexity", 100);
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("failed");
    expect(ppl.notes.join(" ")).toMatch(/no ledger row|dual-write flag may be off/);
    expect(r.overall).toBe("failed");
  });

  it("ledger row exists but no runs → failed (orphan)", async () => {
    STATE.ledgerByDate.set(DATE, [
      {
        tenant_id: TENANT,
        platform: "perplexity",
        spent_usd: 0.05,
        call_count: 1,
        prompt_count: 100,
        chunk_count: 1,
        last_run_id: null,
      },
    ]);
    const r = await verifyBudgetLedger(DATE);
    const ppl = r.perPlatform.find((p) => p.ledgerPlatform === "perplexity")!;
    expect(ppl.status).toBe("failed");
    expect(ppl.notes.join(" ")).toMatch(/orphan ledger row|clock skew/);
  });
});
