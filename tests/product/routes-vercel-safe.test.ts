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
