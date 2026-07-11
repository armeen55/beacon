import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── connector-store mock: per (tenant, provider) info + captured patches ─────
type Info = {
  status: "connected" | "disconnected";
  auth_failed_at?: string | null;
  needs_attention_at?: string | null;
  needs_attention_since?: string | null;
};
const infos: Record<string, Info> = {};
const patches: Array<{ provider: string; tenantId: string; patch: Record<string, unknown> }> = [];

vi.mock("@/lib/connector-store", () => ({
  getConnectorInfo: async (provider: string, tenantId: string): Promise<Info> =>
    infos[`${tenantId}:${provider}`] ?? { status: "disconnected" },
  updateConnectorToken: async (
    provider: string,
    patch: Record<string, unknown>,
    tenantId: string,
  ) => {
    patches.push({ provider, tenantId, patch });
  },
}));

// ── refresh-runs-store mock: per (tenant, source) cron rows ──────────────────
type Row = { started_at: string; result: "ok" | "partial" | "failed"; trigger: "cron" | "manual" | "on-use" };
const ledger: Record<string, Row[]> = {};
vi.mock("@/domains/ops/refresh-runs-store", () => ({
  listRecentRefreshRuns: async (
    tenantId: string,
    opts: { source?: string } = {},
  ) => (ledger[`${tenantId}:${opts.source}`] ?? []),
}));

import {
  deriveAuthEscalation,
  evaluateAuthEscalationForTenant,
  AUTH_ESCALATION_MIN_RUNS,
  AUTH_ESCALATION_MIN_DAYS,
} from "./auth-escalation";

const NOW = new Date("2026-07-11T12:00:00Z");

/** Newest-first cron rows, one per day counting back from `endIso`. */
function nightly(endIso: string, results: Array<"ok" | "partial" | "failed">): Row[] {
  const end = Date.parse(endIso);
  return results.map((result, i) => ({
    started_at: new Date(end - i * 24 * 60 * 60 * 1000).toISOString(),
    result,
    trigger: "cron" as const,
  }));
}

beforeEach(() => {
  for (const k of Object.keys(infos)) delete infos[k];
  for (const k of Object.keys(ledger)) delete ledger[k];
  patches.length = 0;
});

describe("deriveAuthEscalation (pure)", () => {
  it("8 consecutive failed nights spanning > 3 days escalates", () => {
    const rows = nightly("2026-07-11T00:00:00Z", Array(8).fill("failed") as Array<"failed">);
    const out = deriveAuthEscalation(rows, NOW);
    expect(out.escalate).toBe(true);
    // No good pull in-window -> since dates from the oldest failing run.
    expect(out.since).toBe(rows[rows.length - 1]!.started_at);
  });

  it("uses the last GOOD pull before the streak as the since date", () => {
    // newest 6 failed, then a success (the last good pull).
    const rows: Array<{ started_at: string; result: "ok" | "partial" | "failed" }> = [
      ...nightly("2026-07-11T00:00:00Z", Array(6).fill("failed") as Array<"failed">),
      { started_at: "2026-07-04T00:00:00Z", result: "ok" },
    ];
    const out = deriveAuthEscalation(rows, NOW);
    expect(out.escalate).toBe(true);
    expect(out.since).toBe("2026-07-04T00:00:00Z");
  });

  it("a single transient failure does NOT escalate", () => {
    const rows = nightly("2026-07-11T00:00:00Z", ["failed", "ok", "ok"]);
    expect(deriveAuthEscalation(rows, NOW).escalate).toBe(false);
  });

  it("a recent success inside the window breaks the streak (no escalation)", () => {
    const rows = nightly("2026-07-11T00:00:00Z", [
      "failed",
      "failed",
      "ok", // breaks it: only 2 leading failures
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
    expect(deriveAuthEscalation(rows, NOW).escalate).toBe(false);
  });

  it("a partial (synced, no new data) counts as auth-working and breaks the streak", () => {
    const rows = nightly("2026-07-11T00:00:00Z", [
      "failed",
      "failed",
      "failed",
      "partial",
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
    expect(deriveAuthEscalation(rows, NOW).escalate).toBe(false);
  });

  it("enough failures but spanning < M days does not escalate", () => {
    // 5 failures all stamped within the SAME day -> span 0 days < 3.
    const same = "2026-07-11T00:00:00Z";
    const rows = Array(5)
      .fill(null)
      .map(() => ({ started_at: same, result: "failed" as const }));
    const out = deriveAuthEscalation(rows, NOW, {
      minRuns: AUTH_ESCALATION_MIN_RUNS,
      minDays: AUTH_ESCALATION_MIN_DAYS,
    });
    expect(out.escalate).toBe(false);
  });
});

describe("evaluateAuthEscalationForTenant (I/O, invariants)", () => {
  it("8-consecutive-failure GSC stamps needs_attention_at, NEVER auth_failed_at", async () => {
    infos["tenant-a:google_gsc"] = { status: "connected", auth_failed_at: null, needs_attention_at: null };
    ledger["tenant-a:gsc"] = nightly("2026-07-11T00:00:00Z", Array(8).fill("failed") as Array<"failed">);

    await evaluateAuthEscalationForTenant("tenant-a", NOW);

    const stamp = patches.find((p) => p.tenantId === "tenant-a" && p.provider === "google_gsc");
    expect(stamp).toBeDefined();
    expect(stamp!.patch.needs_attention_at).toBe(NOW.toISOString());
    expect(stamp!.patch.needs_attention_since).toBeTruthy();
    // The probe-before-stamp invariant: escalation NEVER claims revocation.
    expect("auth_failed_at" in stamp!.patch).toBe(false);
  });

  it("a single transient failure does not stamp anything", async () => {
    infos["tenant-a:google_ga4"] = { status: "connected", needs_attention_at: null };
    ledger["tenant-a:ga4"] = nightly("2026-07-11T00:00:00Z", ["failed", "ok", "ok", "ok"]);
    await evaluateAuthEscalationForTenant("tenant-a", NOW);
    expect(patches).toHaveLength(0);
  });

  it("a proven-dead grant (auth_failed_at set) is left to the Reconnect path, never re-marked revoked", async () => {
    infos["tenant-a:google_gsc"] = {
      status: "connected",
      auth_failed_at: "2026-07-05T00:00:00Z",
      needs_attention_at: null,
    };
    ledger["tenant-a:gsc"] = nightly("2026-07-11T00:00:00Z", Array(8).fill("failed") as Array<"failed">);
    await evaluateAuthEscalationForTenant("tenant-a", NOW);
    // No patch: proven-dead already shows Reconnect; we do not touch it.
    expect(patches.find((p) => p.provider === "google_gsc")).toBeUndefined();
  });

  it("latest run succeeded clears a stale needs-attention marker", async () => {
    infos["tenant-a:google_ga4"] = {
      status: "connected",
      needs_attention_at: "2026-07-06T00:00:00Z",
    };
    ledger["tenant-a:ga4"] = nightly("2026-07-11T00:00:00Z", ["ok", "failed", "failed"]);
    await evaluateAuthEscalationForTenant("tenant-a", NOW);
    const clear = patches.find((p) => p.provider === "google_ga4");
    expect(clear).toBeDefined();
    expect(clear!.patch.needs_attention_at).toBeNull();
  });

  it("two-tenant isolation: escalating A never marks B", async () => {
    infos["tenant-a:google_gsc"] = { status: "connected", needs_attention_at: null };
    infos["tenant-b:google_gsc"] = { status: "connected", needs_attention_at: null };
    ledger["tenant-a:gsc"] = nightly("2026-07-11T00:00:00Z", Array(8).fill("failed") as Array<"failed">);
    ledger["tenant-b:gsc"] = nightly("2026-07-11T00:00:00Z", ["ok", "ok"]);

    await evaluateAuthEscalationForTenant("tenant-a", NOW);
    expect(patches.some((p) => p.tenantId === "tenant-b")).toBe(false);
    expect(patches.some((p) => p.tenantId === "tenant-a" && p.patch.needs_attention_at)).toBe(true);
  });

  it("a not-connected source is never escalated", async () => {
    infos["tenant-a:google_gsc"] = { status: "disconnected" };
    ledger["tenant-a:gsc"] = nightly("2026-07-11T00:00:00Z", Array(8).fill("failed") as Array<"failed">);
    await evaluateAuthEscalationForTenant("tenant-a", NOW);
    expect(patches).toHaveLength(0);
  });
});
