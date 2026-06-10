/**
 * 2026-06-09 — CallRail operator action tests (§9.B): operator gate +
 * connect / refresh / disconnect. All collaborators mocked (no Supabase,
 * no key, no network).
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

let _refreshResult: unknown = { ok: true, rowsUpserted: 3, persisted: false };
const refreshCallRailCalls = vi.fn(async (..._a: unknown[]) => _refreshResult);
vi.mock("@/lib/connectors/callrail/persist-url-calls", () => ({
  refreshCallRailCalls: (...a: unknown[]) => refreshCallRailCalls(...a),
}));

import {
  connectCallRail,
  refreshCallRailMetrics,
  disconnectCallRail,
} from "@/app/(shell)/diagnostics/callrail/actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  _operator = true;
  _refreshResult = { ok: true, rowsUpserted: 3, persisted: false };
  saveConnectorToken.mockClear();
  updateConnectorToken.mockClear();
  refreshCallRailCalls.mockClear();
});

describe("connectCallRail", () => {
  it("rejects non-operators (no token saved)", async () => {
    _operator = false;
    const r = await connectCallRail(fd({ api_key: "k", account_id: "123" }));
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });

  it("missing_key on blank key", async () => {
    const r = await connectCallRail(fd({ api_key: "   ", account_id: "123" }));
    expect(r).toEqual({ ok: false, reason: "missing_key" });
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });

  it("missing_account on blank account id", async () => {
    const r = await connectCallRail(fd({ api_key: "secret", account_id: " " }));
    expect(r).toEqual({ ok: false, reason: "missing_account" });
    expect(saveConnectorToken).not.toHaveBeenCalled();
  });

  it("saves a callrail token on success", async () => {
    const r = await connectCallRail(
      fd({ api_key: "secret", account_id: "227799611" }),
    );
    expect(r).toEqual({ ok: true });
    expect(saveConnectorToken).toHaveBeenCalledTimes(1);
    const [token] = saveConnectorToken.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(token.provider).toBe("callrail");
    expect(token.api_key).toBe("secret");
    expect(token.account_id).toBe("227799611");
  });
});

describe("refreshCallRailMetrics", () => {
  it("rejects non-operators (no fetch)", async () => {
    _operator = false;
    const r = await refreshCallRailMetrics();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(refreshCallRailCalls).not.toHaveBeenCalled();
  });

  it("returns rowsUpserted on success", async () => {
    const r = await refreshCallRailMetrics();
    expect(r).toEqual({ ok: true, persisted: false, rowsUpserted: 3 });
    expect(refreshCallRailCalls).toHaveBeenCalledTimes(1);
  });

  it("passes through a fetch failure reason", async () => {
    _refreshResult = { ok: false, reason: "no_key" };
    const r = await refreshCallRailMetrics();
    expect(r).toEqual({ ok: false, reason: "no_key", detail: undefined });
  });
});

describe("disconnectCallRail", () => {
  it("rejects non-operators", async () => {
    _operator = false;
    const r = await disconnectCallRail();
    expect(r).toEqual({ ok: false, reason: "not_operator" });
    expect(updateConnectorToken).not.toHaveBeenCalled();
  });

  it("soft-disconnects (sets disconnected_at)", async () => {
    const r = await disconnectCallRail();
    expect(r).toEqual({ ok: true });
    expect(updateConnectorToken).toHaveBeenCalledTimes(1);
    const [provider, patch] = updateConnectorToken.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(provider).toBe("callrail");
    expect(typeof patch.disconnected_at).toBe("string");
  });
});
