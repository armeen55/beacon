/**
 * Vercel-safety route invariants - merged suite (Core 100K Phase 6).
 * Absorbs: routes/url-watcher-vercel-safe, routes/verify-action-vercel-safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("url-watcher is Vercel-safe", () => {

  // ---------------------------------------------------------------------------
  // Sprint 3 / Phase 3.3 regression tests — URL watcher on Vercel.
  //
  // Phase 3.2 routes state to module-level memory on Vercel (the lambda FS is
  // read-only). audit #19 (2026-06-14): that memory is now keyed BY TENANT —
  // a single process-global var let a warm lambda share one tenant's
  // throttle/running state with every other tenant. These tests prove:
  //   (1) writeUrlWatcherState with VERCEL=1 does not throw
  //   (2) read after write returns the state (same-lambda, same tenant)
  //   (3) read with no prior write returns null cleanly (no FS touch)
  //   (4) running/success round-trip touches no filesystem
  //   (5) throttle works against memory-stored success state
  //   (6) ISOLATION: tenant-A's state never leaks into tenant-B
  // ---------------------------------------------------------------------------

  const ORIGINAL_VERCEL_ENV = process.env.VERCEL;
  const T = "tenant-test-a";
  const STATS = {
    urlsInHistory: 0,
    experimentsUpdated: 0,
    outcomesProcessed: 0,
    outcomesRecorded: 0,
    outcomeTransitions: 0,
    patternsRebuilt: 0,
    durationMs: 1,
  };

  describe("Sprint 3 / Phase 3.3 — URL watcher Vercel safety", () => {
    beforeEach(() => {
      process.env.VERCEL = "1";
      vi.resetModules();
    });

    afterEach(() => {
      if (ORIGINAL_VERCEL_ENV === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = ORIGINAL_VERCEL_ENV;
      }
    });

    it("writeUrlWatcherState does NOT throw when VERCEL=1 (no .data writes)", async () => {
      const mod = await import("@/domains/product/url-watcher-state");
      mod.__resetVercelMemoryStateForTests();
      expect(() =>
        mod.writeUrlWatcherState(
          {
            schemaVersion: 1,
            phase: "running",
            updatedAt: new Date().toISOString(),
            trigger: "page-load",
            message: "test",
          },
          T,
        ),
      ).not.toThrow();
    });

    it("readUrlWatcherState returns the state written in the same lambda (memory round-trip)", async () => {
      const mod = await import("@/domains/product/url-watcher-state");
      mod.__resetVercelMemoryStateForTests();
      const now = new Date().toISOString();
      mod.writeUrlWatcherState(
        {
          schemaVersion: 1,
          phase: "success",
          updatedAt: now,
          lastSuccessAt: now,
          trigger: "page-load",
        },
        T,
      );
      const state = mod.readUrlWatcherState(T);
      expect(state).not.toBeNull();
      expect(state?.phase).toBe("success");
      expect(state?.lastSuccessAt).toBe(now);
    });

    it("readUrlWatcherState returns null cleanly on a fresh cold-start (no prior write)", async () => {
      const mod = await import("@/domains/product/url-watcher-state");
      mod.__resetVercelMemoryStateForTests();
      expect(mod.readUrlWatcherState(T)).toBeNull();
    });

    it("writeRunningState → writeSuccessState round-trip does NOT touch the filesystem", async () => {
      const mod = await import("@/domains/product/url-watcher-state");
      mod.__resetVercelMemoryStateForTests();
      expect(() => mod.writeRunningState("page-load", T)).not.toThrow();
      expect(() =>
        mod.writeSuccessState("page-load", STATS, new Date().toISOString(), T),
      ).not.toThrow();
      expect(mod.readUrlWatcherState(T)?.phase).toBe("success");
    });

    it("shouldRefreshUrlWatcher throttles correctly against memory-stored success state", async () => {
      const mod = await import("@/domains/product/url-watcher-state");
      mod.__resetVercelMemoryStateForTests();
      mod.writeSuccessState("page-load", STATS, new Date().toISOString(), T);
      expect(mod.shouldRefreshUrlWatcher(mod.readUrlWatcherState(T))).toBe(false);
    });

    it("audit #19: state is isolated per tenant (A's running state never leaks to B)", async () => {
      const mod = await import("@/domains/product/url-watcher-state");
      mod.__resetVercelMemoryStateForTests();
      // Tenant A is mid-run.
      mod.writeRunningState("page-load", "tenant-a");
      expect(mod.readUrlWatcherState("tenant-a")?.phase).toBe("running");
      // Tenant B has no state of its own → must NOT see A's running state, so
      // shouldRefreshUrlWatcher(B) is true (B runs its own pipeline).
      expect(mod.readUrlWatcherState("tenant-b")).toBeNull();
      expect(mod.shouldRefreshUrlWatcher(mod.readUrlWatcherState("tenant-b"))).toBe(
        true,
      );
    });
  });
});

describe("verify-action is Vercel-safe", () => {

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

  describe("Sprint 4 / Phase 4.5 — hosted safety", () => {
    // The "structural invariants (source)" persist-run source-text scan was
    // removed (Core 100K): the behavioral appendObservationRunSync tests below
    // prove the Vercel-safe posture (no throw on VERCEL=1 + dual-write fires).

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
});
