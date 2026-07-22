/**
 * PLATFORM — self-healing + recovery (Core 100K terminal suite; merged from
 * src/domains/ops/{recovery-actions,recover-abandoned-work,
 * autonomous-run-claim}.test.ts).
 *
 * Pins: every connector/cron failure state maps to a plain problem + exact
 * next step (Beacon voice, no dashes, no dead-end apologies), the failure-state
 * derivation ladder, abandoned-work recovery, and the cross-instance atomic
 * day-claim that makes the on-visit cycle single-owner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getSupabaseAdminMock = vi.fn();
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => getSupabaseAdminMock(),
}));

import {
  recoveryForConnectorFailure,
  recoveryForCronFailure,
  recoveryForSiteDown,
  recoveryForSetupItem,
  deriveConnectorFailureState,
  type ConnectorFailureState,
  type ConnectorKind,
} from "@/domains/ops/recovery-actions";
import { recoverAbandonedPageFactoryForTenant, type PageFactoryRecoveryDeps } from "@/domains/ops/recover-abandoned-work";
import type { CronRunRow } from "@/domains/ops/cron-runs-store";
import type { ProductionLineSummary } from "@/domains/page-factory/production-line";
import { claimAutonomousRun, releaseAutonomousRun } from "@/domains/ops/autonomous-run-claim";

const NO_DASH = /[‒–—―]/;

describe("recoveryForConnectorFailure", () => {
  it("token_expired on Google names the reconnect self-serve; sync_failing never claims the login expired", () => {
    const expired = recoveryForConnectorFailure("google_gsc", "token_expired");
    expect(expired!.plainProblem).toContain("expired");
    expect(expired!.href).toBe("/settings/connectors");
    expect(expired!.selfServe).toEqual({ kind: "reconnect_google", connectorKind: "gsc" });

    const failing = recoveryForConnectorFailure("google_gsc", "sync_failing");
    expect(failing!.plainProblem.toLowerCase()).not.toContain("expired");
    expect(failing!.exactFix).toContain("Reconnecting usually fixes this");
    // States only apply where they make sense.
    expect(recoveryForConnectorFailure("profound", "sync_failing")).toBeNull();
    expect(recoveryForConnectorFailure("wix", "token_expired")).toBeNull();
  });

  it("wix_url_map_empty deep-links to Discover collections; never_connected on Wix says nothing publishes yet", () => {
    const map = recoveryForConnectorFailure("wix", "wix_url_map_empty");
    expect(map!.exactFix).toContain("Discover collections");
    expect(map!.selfServe).toEqual({ kind: "wix_map_collections" });
    const fresh = recoveryForConnectorFailure("wix", "never_connected");
    expect(fresh!.exactFix.toLowerCase()).toContain("nothing publishes");
    expect(recoveryForConnectorFailure("google_gsc", "wix_url_map_empty")).toBeNull();
  });

  it("every mapped action across the full connector x state matrix is dash-free (Beacon voice)", () => {
    const connectors: ConnectorKind[] = ["google_gsc", "google_ga4", "wix", "profound", "clarity"];
    const states: ConnectorFailureState[] = [
      "token_expired",
      "never_connected",
      "sync_stale",
      "zero_rows_written",
      "wix_url_map_empty",
      "gsc_property_mismatch",
    ];
    for (const c of connectors) {
      for (const s of states) {
        const action = recoveryForConnectorFailure(c, s);
        if (!action) continue;
        expect(action.plainProblem).not.toMatch(NO_DASH);
        expect(action.exactFix).not.toMatch(NO_DASH);
      }
    }
  });
});

describe("recoveryForCronFailure + recoveryForSiteDown", () => {
  it("describes self-recovery without assigning the operator homework, and never dead-ends", () => {
    const sync = recoveryForCronFailure("sync-connectors", "The nightly data sync", "stalled");
    expect(sync.exactFix).toContain("retry stale connected sources automatically");
    expect(sync.exactFix.toLowerCase()).not.toContain("yourself");
    const measure = recoveryForCronFailure("measure-due", "The nightly results check", "stalled");
    expect(measure.exactFix.toLowerCase()).not.toContain("contact support");
    const unknown = recoveryForCronFailure("some-future-job", "The future job", "late");
    expect(unknown.exactFix).toContain("as you keep using Beacon");
    for (const job of ["sync-connectors", "measure-due", "autopilot", "unknown-job"]) {
      for (const state of ["late", "stalled"] as const) {
        const a = recoveryForCronFailure(job, "The job", state);
        expect(a.plainProblem).not.toMatch(NO_DASH);
        expect(a.exactFix).not.toMatch(NO_DASH);
      }
    }
  });

  it("site-down points at the host, not something inside Beacon", () => {
    const action = recoveryForSiteDown();
    expect(action.plainProblem).toContain("did not answer");
    expect(action.exactFix).toContain("your host or Wix");
  });
});

describe("deriveConnectorFailureState ladder", () => {
  const now = new Date("2026-07-03T12:00:00.000Z");

  it("a proven auth failure outranks everything, including the needs_attention marker", () => {
    expect(
      deriveConnectorFailureState(
        { status: "connected", authFailedAt: "2026-07-01T00:00:00.000Z", needsAttentionAt: "2026-07-03T00:00:00.000Z" },
        now,
      ),
    ).toBe("token_expired");
    expect(
      deriveConnectorFailureState({ status: "connected", needsAttentionAt: "2026-07-03T00:00:00.000Z" }, now),
    ).toBe("sync_failing");
  });

  it("quiet states stay quiet: never-synced and unparseable stamps do not false-alarm", () => {
    expect(deriveConnectorFailureState({ status: "disconnected" }, now)).toBe("never_connected");
    expect(deriveConnectorFailureState({ status: "connected", lastSyncedAt: null }, now)).toBeNull();
    expect(deriveConnectorFailureState({ status: "connected", lastSyncedAt: "not-a-date" }, now)).toBeNull();
    expect(deriveConnectorFailureState({ status: "connected", lastSyncedAt: "2026-07-02T00:00:00.000Z" }, now)).toBeNull();
    expect(deriveConnectorFailureState({ status: "connected", lastSyncedAt: "2026-06-01T00:00:00.000Z" }, now)).toBe("sync_stale");
  });
});

describe("recoveryForSetupItem", () => {
  it("self-hides when done; pending items carry a plain problem + fix + link, dash-free", () => {
    expect(recoveryForSetupItem({ kind: "revenue_model", done: true })).toBeNull();
    const kinds = ["digest_email", "indexnow_key", "gsc_full_backfill", "revenue_model", "wix_page_mapping"] as const;
    for (const kind of kinds) {
      const action = recoveryForSetupItem({ kind, done: false });
      expect(action).not.toBeNull();
      expect(action!.plainProblem.length).toBeGreaterThan(5);
      expect(action!.href.startsWith("/")).toBe(true);
      expect(action!.plainProblem).not.toMatch(NO_DASH);
      expect(action!.exactFix).not.toMatch(NO_DASH);
    }
    expect(recoveryForSetupItem({ kind: "gsc_full_backfill", done: false })!.selfServe).toEqual({ kind: "gsc_backfill_start" });
  });
});

// ── recover-abandoned-work ──────────────────────────────────────────────────

describe("recoverAbandonedPageFactoryForTenant", () => {
  const NOW = new Date("2026-07-14T20:00:00.000Z");
  const run = (phase: "running" | "finished", startedAt: string): CronRunRow => ({
    id: "run-1",
    tenant_id: null,
    job: "page-factory",
    started_at: startedAt,
    finished_at: startedAt,
    duration_ms: 0,
    ok: phase === "finished",
    per_source: [],
    notes: {},
    created_at: startedAt,
    phase,
  });
  const summary = (reason = "ok"): ProductionLineSummary => ({
    tenantId: "tenant-iranopedia",
    weekOf: "2026-07-13",
    ran: reason === "ok",
    reason,
    drafted: reason === "ok" ? 3 : 0,
    queued: 1,
    rejected: 2,
    costUsd: 0.12,
    batch: null,
  });
  const deps = (over: Partial<PageFactoryRecoveryDeps> = {}): Partial<PageFactoryRecoveryDeps> => ({
    listRuns: vi.fn(async () => [run("running", "2026-07-13T13:49:00.000Z")]),
    hasBatch: vi.fn(async () => false),
    runFactory: vi.fn(async () => summary()),
    recordRun: vi.fn(async () => {}),
    ...over,
  });

  it("does nothing when healthy; reconciles when this week's batch already exists", async () => {
    const healthy = deps({ listRuns: vi.fn(async () => [run("finished", "2026-07-13T13:49:00.000Z")]) });
    expect((await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, healthy)).status).toBe("not_needed");
    expect(healthy.runFactory).not.toHaveBeenCalled();

    const batched = deps({ hasBatch: vi.fn(async () => true) });
    expect((await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, batched)).status).toBe("reconciled");
    expect(batched.runFactory).not.toHaveBeenCalled();
  });

  it("reruns the idempotent current-week factory on an abandoned receipt; a failed rerun keeps the alarm", async () => {
    const d = deps();
    expect((await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, d)).status).toBe("recovered");
    expect(d.runFactory).toHaveBeenCalledWith("tenant-iranopedia", "2026-07-13", NOW);
    expect(d.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, notes: expect.objectContaining({ recovered_on_visit: true }) }),
    );

    const failing = deps({ runFactory: vi.fn(async () => summary("error: graph load failed")) });
    expect((await recoverAbandonedPageFactoryForTenant("tenant-iranopedia", NOW, failing)).status).toBe("failed");
    expect(failing.recordRun).not.toHaveBeenCalled();
  });
});

// ── autonomous-run-claim ────────────────────────────────────────────────────

describe("claimAutonomousRun / releaseAutonomousRun", () => {
  const T = "tenant-iranopedia";
  const DAY = "2026-07-18";

  function makeAdmin(rows = new Set<string>()) {
    const key = (t: unknown, d: unknown) => `${t}|${d}`;
    return {
      rows,
      from() {
        return {
          insert(row: { tenant_id: string; day_key: string }) {
            const k = key(row.tenant_id, row.day_key);
            if (rows.has(k)) return Promise.resolve({ error: { code: "23505", message: "duplicate key value" } });
            rows.add(k);
            return Promise.resolve({ error: null });
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return builder;
              },
              then(resolve: (v: { error: null }) => unknown) {
                rows.delete(key(filters.tenant_id, filters.day_key));
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return builder;
          },
        };
      },
    };
  }

  beforeEach(() => {
    getSupabaseAdminMock.mockReset();
  });

  it("first insert wins; a concurrent duplicate loses; a released claim can be re-owned for a retry", async () => {
    const rows = new Set<string>();
    getSupabaseAdminMock.mockReturnValue(makeAdmin(rows));
    expect(await claimAutonomousRun(T, DAY)).toBe("claimed");
    expect(await claimAutonomousRun(T, DAY)).toBe("already-claimed");
    await releaseAutonomousRun(T, DAY);
    expect(rows.size).toBe(0);
    expect(await claimAutonomousRun(T, DAY)).toBe("claimed");
  });

  it("falls back to 'unavailable' (best-effort mode) on missing env, missing table, or transport errors", async () => {
    getSupabaseAdminMock.mockImplementation(() => {
      throw new Error("Missing required environment variable");
    });
    expect(await claimAutonomousRun(T, DAY)).toBe("unavailable");
    await expect(releaseAutonomousRun(T, DAY)).resolves.toBeUndefined();

    getSupabaseAdminMock.mockReturnValue({
      from() {
        return { insert: () => Promise.resolve({ error: { code: "PGRST205", message: "Could not find the table" } }) };
      },
    });
    expect(await claimAutonomousRun(T, DAY)).toBe("unavailable");
    // Empty inputs never touch the client.
    expect(await claimAutonomousRun("", DAY)).toBe("unavailable");
  });
});
