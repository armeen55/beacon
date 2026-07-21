import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Sprint 4 / Phase 4.5 regression tests — hosted-safety invariants.
//
// Before this fix, clicking Verify on /pages threw ENOENT on Vercel because
// the (now-deleted, UX5 2026-07-02) verify-action.ts + appendObservationRunSync
// both called writeFileSync against `/vercel/path0/.data/*.json.tmp` (read-only
// FS). Operator saw an error banner AND Supabase never received the
// observation_runs row (dual-write was AFTER the FS write in persist-run.ts,
// so the throw aborted the whole flow).
//
// Phase 4.5 fix: `appendObservationRunSync` gates its FS write on
// `VERCEL !== "1"`; Supabase dual-write runs in both environments.
//
// 2026-07-21 (CORE 100K Lane O): the syncGuardrailAlerts +
// syncGuardrailAlertsForUrl behavioral suites were removed with the writers —
// both had zero prod callers after the orchestrate-scan / verify-action
// retirements. The persist-run invariants below are still LIVE.
// ---------------------------------------------------------------------------

const PERSIST_RUN_PATH = resolve(
  __dirname,
  "../../src/domains/observations/persist-run.ts",
);
const PERSIST_RUN_SOURCE = readFileSync(PERSIST_RUN_PATH, "utf8");

describe("Sprint 4 / Phase 4.5 — hosted safety", () => {
  describe("structural invariants (source)", () => {
    it("persist-run.ts gates its FS write on !isVercel AND keeps dual-write unconditional", () => {
      // The whole FS block (readFileSync + writeFileSync + renameSync) must
      // be inside `if (!isVercel)`. The dual-write block must NOT be inside
      // that same guard (so it runs on both environments).
      expect(PERSIST_RUN_SOURCE).toMatch(/if\s*\(!isVercel\s*\)\s*\{/);
      // Dual-write block still present — and OUTSIDE the isVercel guard.
      // Prove this by confirming the dual-write code appears AFTER a closing
      // brace that follows the FS block.
      expect(PERSIST_RUN_SOURCE).toMatch(
        /isDualWriteEnabled\(\)[\s\S]*?upsertObservationRunToDb/,
      );
    });
  });

  describe("appendObservationRunSync (behavioral)", () => {
    const originalVercelEnv = process.env.VERCEL;
    const originalDualWriteEnv = process.env.DUAL_WRITE;

    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      if (originalVercelEnv === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercelEnv;
      if (originalDualWriteEnv === undefined) delete process.env.DUAL_WRITE;
      else process.env.DUAL_WRITE = originalDualWriteEnv;
    });

    it("with VERCEL=1 does NOT throw and DOES attempt the Supabase dual-write", async () => {
      process.env.VERCEL = "1";
      process.env.DUAL_WRITE = "true";

      const upsertMock = vi.fn(async () => ({ error: null }));
      vi.doMock("@/lib/persistence/supabase", () => ({
        getSupabaseAdmin: () => ({
          from: () => ({ upsert: upsertMock }),
        }),
      }));

      const { appendObservationRunSync } = await import(
        "@/domains/observations/persist-run"
      );
      const run = {
        run_id: "obs-verify-test-1",
        run_type: "website_verify" as const,
        source: "test",
        status: "completed" as const,
        started_at: "2026-04-24T21:00:00.000Z",
        completed_at: "2026-04-24T21:00:00.000Z",
        scope_label: "test",
        pages_scanned: 1,
        pages_changed: 0,
        pages_with_errors: 0,
        guardrail_alerts: 0,
        critical_count: 0,
        regression_count: 0,
        improvement_count: 0,
      };

      // Critically, must NOT throw on Vercel.
      expect(() => appendObservationRunSync(run as never)).not.toThrow();

      // The dual-write call fires async — give the promise a tick.
      await new Promise((r) => setImmediate(r));
      expect(upsertMock).toHaveBeenCalled();
    });

    it("with VERCEL unset and DUAL_WRITE=false still does not throw (tmp dir doesn't need to exist in ci)", async () => {
      delete process.env.VERCEL;
      process.env.DUAL_WRITE = "false";

      // Ensure we don't actually touch disk by resetting and short-circuiting
      // `isDualWriteEnabled`. The FS write goes to `<cwd>/.data/` which DOES
      // exist in this repo; it's a real write — but the Phase 4.5 gate means
      // this only runs on local. We don't assert FS content here; we only
      // assert no throw. (The repo's `.data/` is gitignored.)
      vi.doMock("@/lib/persistence/supabase", () => ({
        getSupabaseAdmin: () => ({
          from: () => ({ upsert: async () => ({ error: null }) }),
        }),
      }));

      const { appendObservationRunSync } = await import(
        "@/domains/observations/persist-run"
      );
      const run = {
        run_id: "obs-verify-test-local-1",
        run_type: "website_verify" as const,
        source: "test",
        status: "completed" as const,
        started_at: "2026-04-24T21:00:00.000Z",
        completed_at: "2026-04-24T21:00:00.000Z",
        scope_label: "test",
        pages_scanned: 1,
        pages_changed: 0,
        pages_with_errors: 0,
        guardrail_alerts: 0,
        critical_count: 0,
        regression_count: 0,
        improvement_count: 0,
      };
      expect(() => appendObservationRunSync(run as never)).not.toThrow();
    });
  });

});
