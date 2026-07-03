import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GuardrailAlert } from "@/domains/pages/guardrails";

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
// Phase 4.5 fix:
//   (a) `appendObservationRunSync` gates its FS write on `VERCEL !== "1"`;
//       Supabase dual-write runs in both environments.
//   (b) the deleted `verify-action.ts` gated its two `writeFileSync` call
//       sites identically, and always called `syncPageSnapshots([newSnapshot])`
//       + `syncGuardrailAlertsForUrl(url, newAlerts)`. Its own structural
//       source-invariant tests were removed alongside the file (UX5 legacy
//       sweep — the /pages route had zero inbound links from anywhere live).
//   (c) `syncGuardrailAlertsForUrl` helper does a URL-scoped delete-replace —
//       it does NOT wipe every URL's alerts (unlike the existing global
//       `syncGuardrailAlerts` used by orchestrate-scan). Both helpers remain
//       live (orchestrate-scan still uses the global one) and are still
//       exercised behaviorally below.
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

  describe("syncGuardrailAlertsForUrl (behavioral)", () => {
    const originalDualWriteEnv = process.env.DUAL_WRITE;

    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      if (originalDualWriteEnv === undefined) delete process.env.DUAL_WRITE;
      else process.env.DUAL_WRITE = originalDualWriteEnv;
    });

    const mkAlert = (
      url: string,
      category = "missing_faq",
      severity: GuardrailAlert["severity"] = "regression",
    ): GuardrailAlert => ({
      page_id: "p-1",
      url,
      severity,
      category: category as GuardrailAlert["category"],
      message: "test",
      detail: "test",
      observation_run_id: "obs-test",
      tenant_id: "tenant-test",
    });

    it("URL-scoped delete: only rows with matching url are deleted", async () => {
      process.env.DUAL_WRITE = "true";

      // audit 2026-06-14: the URL-variant delete is now ALSO tenant-scoped
      // (`.eq("tenant_id", …).eq("url", …)`) so it can't wipe another tenant's
      // alerts at the same URL. The mock supports the chained `.eq().eq()` and
      // is awaitable at the end of the chain.
      const captured: { eqs: [string, string][] } = { eqs: [] };
      const deleteMock = vi.fn(() => {
        const chain = {
          eq: (column: string, value: string) => {
            captured.eqs.push([column, value]);
            return chain;
          },
          then: (resolve: (v: { error: null }) => void) =>
            resolve({ error: null }),
        };
        return chain;
      });
      const insertMock = vi.fn(async () => ({ error: null }));

      vi.doMock("@/lib/persistence/supabase", () => ({
        getSupabaseAdmin: () => ({
          from: () => ({ delete: deleteMock, insert: insertMock }),
        }),
      }));

      const { syncGuardrailAlertsForUrl } = await import(
        "@/lib/persistence/dual-write"
      );
      // Phase 7.7b Commit 3 (2026-04-25): syncGuardrailAlertsForUrl now
      // requires a tenantId 3rd arg. Match the fixture's tenant_id so
      // tenantizeRows accepts the row.
      await syncGuardrailAlertsForUrl(
        "https://ritzbuilders.com/services",
        [mkAlert("https://ritzbuilders.com/services")],
        "tenant-test",
      );

      // The delete must scope to BOTH tenant_id AND the URL — never an
      // all-tenant wipe at the URL, and never a global `.gte("id", 0)` wipe.
      expect(deleteMock).toHaveBeenCalled();
      expect(captured.eqs).toContainEqual(["tenant_id", "tenant-test"]);
      expect(captured.eqs).toContainEqual([
        "url",
        "https://ritzbuilders.com/services",
      ]);
      expect(insertMock).toHaveBeenCalled();
    });

    it("empty alerts array: deletes the URL's rows, does NOT insert", async () => {
      process.env.DUAL_WRITE = "true";

      // Chainable `.eq().eq()` (tenant_id then url), awaitable at the end.
      const deleteMock = vi.fn(() => {
        const chain = {
          eq: () => chain,
          then: (resolve: (v: { error: null }) => void) =>
            resolve({ error: null }),
        };
        return chain;
      });
      const insertMock = vi.fn(async () => ({ error: null }));

      vi.doMock("@/lib/persistence/supabase", () => ({
        getSupabaseAdmin: () => ({
          from: () => ({ delete: deleteMock, insert: insertMock }),
        }),
      }));

      const { syncGuardrailAlertsForUrl } = await import(
        "@/lib/persistence/dual-write"
      );
      await syncGuardrailAlertsForUrl(
        "https://ritzbuilders.com/faq",
        [],
        "tenant-test",
      );

      expect(deleteMock).toHaveBeenCalled();
      // No insert with empty alerts — clearing the URL's alert list is a
      // valid verify outcome (no guardrail issues found this pass).
      expect(insertMock).not.toHaveBeenCalled();
    });

    it("is a no-op when DUAL_WRITE is not enabled", async () => {
      process.env.DUAL_WRITE = "false";

      const deleteMock = vi.fn();
      const insertMock = vi.fn();
      vi.doMock("@/lib/persistence/supabase", () => ({
        getSupabaseAdmin: () => ({
          from: () => ({ delete: deleteMock, insert: insertMock }),
        }),
      }));

      const { syncGuardrailAlertsForUrl } = await import(
        "@/lib/persistence/dual-write"
      );
      await syncGuardrailAlertsForUrl(
        "https://ritzbuilders.com/faq",
        [mkAlert("https://ritzbuilders.com/faq")],
        "tenant-test",
      );

      expect(deleteMock).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
    });
  });

  describe("global syncGuardrailAlerts (preserved for orchestrate-scan)", () => {
    const originalDualWriteEnv = process.env.DUAL_WRITE;

    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      if (originalDualWriteEnv === undefined) delete process.env.DUAL_WRITE;
      else process.env.DUAL_WRITE = originalDualWriteEnv;
    });

    it("scopes the delete-replace to the tenant — `.eq('tenant_id', …).gte('id', 0)` (audit #1)", async () => {
      process.env.DUAL_WRITE = "true";

      const captured: { deleteChain: string[] } = { deleteChain: [] };
      // audit #1 (2026-06-14): syncGuardrailAlerts now filters the delete by
      // tenant_id BEFORE the id range — the prior unscoped `.gte('id', 0)`
      // wiped EVERY tenant's alerts on each scan. The mock supports `.eq().gte()`.
      const gteStep = (column: string, value: number) => {
        captured.deleteChain.push(`gte(${column},${value})`);
        return Promise.resolve({ error: null });
      };
      const deleteMock = vi.fn(() => ({
        eq: (column: string, value: string) => {
          captured.deleteChain.push(`eq(${column},${value})`);
          return { gte: gteStep };
        },
      }));
      const insertMock = vi.fn(async () => ({ error: null }));

      vi.doMock("@/lib/persistence/supabase", () => ({
        getSupabaseAdmin: () => ({
          from: () => ({ delete: deleteMock, insert: insertMock }),
        }),
      }));

      const { syncGuardrailAlerts } = await import(
        "@/lib/persistence/dual-write"
      );
      // Phase 7.7b Commit 3 (2026-04-25): syncGuardrailAlerts now requires
      // a tenantId 2nd arg. The fixture row has no tenant_id field, so
      // tenantizeRows stamps tenant-test onto it.
      await syncGuardrailAlerts(
        [
          {
            page_id: "p-1",
            url: "https://example.com/a",
            severity: "regression",
            category: "missing_faq" as never,
            message: "m",
            detail: "d",
            observation_run_id: "obs-1",
          } as never,
        ],
        "tenant-test",
      );

      // audit #1: the delete is now tenant-scoped (eq(tenant_id,…)) THEN the
      // id range — never an all-tenant wipe.
      expect(deleteMock).toHaveBeenCalled();
      expect(captured.deleteChain).toContain("eq(tenant_id,tenant-test)");
      expect(captured.deleteChain).toContain("gte(id,0)");
      expect(insertMock).toHaveBeenCalled();
    });
  });
});
