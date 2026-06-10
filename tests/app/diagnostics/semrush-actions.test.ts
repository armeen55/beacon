/**
 * 2026-06-09 — Semrush operator action tests: operator gate + connect /
 * refresh / disconnect. All collaborators mocked (no Supabase, no key,
 * no network).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let _operator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _operator,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));

const saveConnectorToken = vi.fn(async (..._a: unknown[]) => {});
const updateConnectorToken = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/connector-store", () => ({
  saveConnectorToken: (...a: unknown[]) => saveConnectorToken(...a),
  updateConnectorToken: (...a: unknown[]) => updateConnectorToken(...a),
}));

let _domain = "ritzbuilders.com";
vi.mock("@/lib/business-config", () => ({
  getBusinessConfigForCurrentTenant: async () => ({ domain: _domain }),
}));

let _refreshResult: unknown = {
  ok: true,
  snapshot: { organic_competitors: [{ domain: "x.com" }, { domain: "y.com" }] },
  persisted: false,
};
const refreshSemrushDomainMetrics = vi.fn(async (..._a: unknown[]) => _refreshResult);
vi.mock("@/lib/connectors/semrush/persist-domain-metrics", () => ({
  refreshSemrushDomainMetrics: (...a: unknown[]) =>
    refreshSemrushDomainMetrics(...a),
}));

import {
  connectSemrush,
  refreshSemrushMetrics,
  disconnectSemrush,
} from "@/app/(shell)/diagnostics/semrush/actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  _operator = true;
  _domain = "ritzbuilders.com";
  _refreshResult = {
    ok: true,
    snapshot: { organic_competitors: [{ domain: "x.com" }, { domain: "y.com" }] },
    persisted: false,
  };
  saveConnectorToken.mockClear();
  updateConnectorToken.mockClear();
  refreshSemrushDomainMetrics.mockClear();
});

describe("connectSemrush", () => {
  it("rejects non-operators (no token saved)", async () => {
    _operator = false;
    const r = await connectSemrush(fd({ api_key: "k" }));
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });

  it("missing_key on blank key", async () => {
    const r = await connectSemrush(fd({ api_key: "   " }));
    expect(r).toEqual({ ok: false, reason: "missing_key" });
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });

  it("saves a semrush token on success", async () => {
    const r = await connectSemrush(fd({ api_key: "secret", database: "uk" }));
    expect(r).toEqual({ ok: true });
    expect(saveConnectorToken).toHaveBeenCalledTimes(1);
    const [token] = saveConnectorToken.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(token.provider).toBe("semrush");
    expect(token.api_key).toBe("secret");
    expect(token.database).toBe("uk");
  });

  it("defaults database to us", async () => {
    await connectSemrush(fd({ api_key: "secret" }));
    const [token] = saveConnectorToken.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(token.database).toBe("us");
  });
});

describe("refreshSemrushMetrics", () => {
  it("rejects non-operators (no fetch)", async () => {
    _operator = false;
    const r = await refreshSemrushMetrics();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(refreshSemrushDomainMetrics).not.toHaveBeenCalled();
  });

  it("no_domain when business-config has no domain", async () => {
    _domain = "";
    const r = await refreshSemrushMetrics();
    expect(r).toEqual({ ok: false, reason: "no_domain" });
    expect(refreshSemrushDomainMetrics).not.toHaveBeenCalled();
  });

  it("returns competitor count on success", async () => {
    const r = await refreshSemrushMetrics();
    expect(r).toEqual({ ok: true, persisted: false, competitorCount: 2 });
    expect(refreshSemrushDomainMetrics).toHaveBeenCalledTimes(1);
  });

  it("passes through a fetch failure reason", async () => {
    _refreshResult = { ok: false, reason: "no_key" };
    const r = await refreshSemrushMetrics();
    expect(r).toEqual({ ok: false, reason: "no_key", detail: undefined });
  });
});

describe("disconnectSemrush", () => {
  it("rejects non-operators", async () => {
    _operator = false;
    const r = await disconnectSemrush();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(updateConnectorToken).not.toHaveBeenCalled();
  });

  it("soft-disconnects (sets disconnected_at)", async () => {
    const r = await disconnectSemrush();
    expect(r).toEqual({ ok: true });
    expect(updateConnectorToken).toHaveBeenCalledTimes(1);
    const [provider, patch] = updateConnectorToken.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(provider).toBe("semrush");
    expect(typeof patch.disconnected_at).toBe("string");
  });
});
