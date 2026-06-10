/**
 * Regression test for the 2026-06-03 → 06-09 ChatGPT poll outage.
 *
 * History: two polls fired on June 3 (~20 min apart). The second run's
 * rows had new ids but the same (tenant, prompt, platform, UTC-day), so
 * the id-keyed upsert INSERTed into the day-uniqueness EXPRESSION index
 * `ux_pao_tenant_prompt_platform_day` → threw → the run was marked
 * PERSISTENCE FAILED → the R6 paid-poll gate latched for 6 days.
 *
 * Fix under test: `syncPromptAnswerObservations` catches THAT specific
 * collision, reads the day's existing (platform, day, prompt_id) keys,
 * and writes only the genuinely-missing rows (rescuing prompts an
 * earlier partial run missed). Any other error still throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const DUP_MSG =
  'duplicate key value violates unique constraint "ux_pao_tenant_prompt_platform_day"';

// Scriptable supabase admin: upsert results consumed in order; select
// returns the configured existing prompt_ids.
const _upsertResults: Array<{ error: { message: string } | null }> = [];
const _upsertCalls: Array<Array<Record<string, unknown>>> = [];
let _existingPromptIds: string[] = [];
let _selectError: { message: string } | null = null;
let _selectCalls = 0;

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        _upsertCalls.push(rows);
        return _upsertResults.shift() ?? { error: null };
      },
      select: (_cols: string) => {
        const terminator = {
          eq: () => terminator,
          gte: () => terminator,
          lt: async () => {
            _selectCalls++;
            return _selectError != null
              ? { data: null, error: _selectError }
              : {
                  data: _existingPromptIds.map((prompt_id) => ({ prompt_id })),
                  error: null,
                };
          },
        };
        return terminator;
      },
    }),
  }),
}));

import { syncPromptAnswerObservations } from "@/lib/persistence/dual-write";

function obs(promptId: string) {
  return {
    id: `obs-${promptId}-${Math.abs(promptId.length * 7919)}`,
    prompt_id: promptId,
    answer_hash: "h",
    platform: "chatgpt",
    observed_at: "2026-06-03T12:01:31Z",
    citation_domains: [],
  } as unknown as Parameters<typeof syncPromptAnswerObservations>[0][number];
}

beforeEach(() => {
  vi.stubEnv("DUAL_WRITE", "true");
  _upsertResults.length = 0;
  _upsertCalls.length = 0;
  _existingPromptIds = [];
  _selectError = null;
  _selectCalls = 0;
});

describe("syncPromptAnswerObservations — same-day re-poll recovery", () => {
  it("happy path: one upsert, no recovery read", async () => {
    _upsertResults.push({ error: null });
    await syncPromptAnswerObservations([obs("p1")], "tenant-test");
    expect(_upsertCalls).toHaveLength(1);
    expect(_selectCalls).toBe(0);
  });

  it("day-collision: writes ONLY the missing rows (rescues a partial run's gap)", async () => {
    _upsertResults.push({ error: { message: DUP_MSG } }); // initial batch collides
    _upsertResults.push({ error: null }); // recovery write succeeds
    _existingPromptIds = ["p1"]; // p1 already recorded today; p2 missing
    await syncPromptAnswerObservations([obs("p1"), obs("p2")], "tenant-test");
    expect(_selectCalls).toBe(1);
    expect(_upsertCalls).toHaveLength(2);
    const recoveryRows = _upsertCalls[1]!;
    expect(recoveryRows).toHaveLength(1);
    expect(recoveryRows[0]!.prompt_id).toBe("p2");
  });

  it("all-duplicates: no second write, no throw (the June 3 shape)", async () => {
    _upsertResults.push({ error: { message: DUP_MSG } });
    _existingPromptIds = ["p1", "p2"];
    await syncPromptAnswerObservations([obs("p1"), obs("p2")], "tenant-test");
    expect(_upsertCalls).toHaveLength(1); // only the initial attempt
  });

  it("other constraint errors still throw (gate keeps its job)", async () => {
    _upsertResults.push({
      error: { message: 'violates unique constraint "something_else"' },
    });
    await expect(
      syncPromptAnswerObservations([obs("p1")], "tenant-test"),
    ).rejects.toThrow(/something_else/);
    expect(_selectCalls).toBe(0);
  });

  it("recovery read failure surfaces the ORIGINAL collision error", async () => {
    _upsertResults.push({ error: { message: DUP_MSG } });
    _selectError = { message: "read down" };
    await expect(
      syncPromptAnswerObservations([obs("p1")], "tenant-test"),
    ).rejects.toThrow(/ux_pao_tenant_prompt_platform_day/);
  });
});
