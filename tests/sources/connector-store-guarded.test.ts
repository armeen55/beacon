/**
 * DB-side guarded persistence routing (operator guardrails, 2026-07-09).
 *
 * The never-erase rule and the refresh compare-and-swap are enforced in
 * Postgres (save_connector_token_guarded_v1); the app must (1) route Google
 * token writes through that RPC, (2) fall back to the app-side guarded path
 * ONLY when the RPC is missing (PGRST202/PGRST205/42883), loudly, and
 * (3) mirror the same safety rules in that fallback:
 *   - an empty refresh_token is never written, under any stored state
 *   - a staler concurrent refresh (older expires_at) no-ops (the CAS mirror,
 *     the operator's 7th regression: cross-instance losers must not clobber)
 *
 * HERMETIC: Supabase admin is a fake in-memory client; no network, no env.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type RpcCall = { name: string; params: Record<string, unknown> };
const _rpcCalls: RpcCall[] = [];
let _rpcError: { code?: string; message?: string } | null = null;
const _upserts: Array<Record<string, unknown>> = [];
let _readRow: { payload: unknown } | null = null;

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    rpc: async (name: string, params: Record<string, unknown>) => {
      _rpcCalls.push({ name, params });
      return { data: _rpcError == null ? { ok: true } : null, error: _rpcError };
    },
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        _upserts.push(row);
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: _readRow, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Only needed by test (e): drive the REAL refreshAndPersistGscToken (via
// resolveGscAccessToken) through the REAL persistRefreshedGoogleToken so we can
// assert the direct site routes token fields through the guarded RPC (mode
// 'refresh'). connector-store itself does not import google-auth, so this mock
// only affects search-analytics.
const _refreshGoogleAccessTokenMock = vi.fn();
vi.mock("@/lib/connectors/google-auth", () => ({
  refreshGoogleAccessToken: (...a: unknown[]) =>
    _refreshGoogleAccessTokenMock(...a),
}));

import {
  saveConnectorToken,
  updateConnectorToken,
  persistRefreshedGoogleToken,
  type GoogleConnectorToken,
} from "@/lib/connector-store";
import { resolveGscAccessToken } from "@/lib/connectors/gsc/search-analytics";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const MISSING_RPC = { code: "PGRST202", message: "Could not find the function public.save_connector_token_guarded_v1" };

function googleToken(over: Partial<GoogleConnectorToken> = {}): GoogleConnectorToken {
  return {
    provider: "google_gsc",
    access_token: "acc",
    refresh_token: "ref",
    expires_at: 1_000_000,
    connected_at: "2026-07-01T00:00:00.000Z",
    scopes: [],
    ...over,
  };
}

beforeEach(() => {
  _rpcCalls.length = 0;
  _upserts.length = 0;
  _rpcError = null;
  _readRow = null;
  _refreshGoogleAccessTokenMock.mockReset();
});

describe("saveConnectorToken routes Google writes through the guarded RPC", () => {
  it("calls save_connector_token_guarded_v1 mode=connect and does NOT plain-upsert", async () => {
    await saveConnectorToken(googleToken(), "tenant-x");
    expect(_rpcCalls).toHaveLength(1);
    expect(_rpcCalls[0]!.name).toBe("save_connector_token_guarded_v1");
    expect(_rpcCalls[0]!.params.p_mode).toBe("connect");
    expect(_rpcCalls[0]!.params.p_tenant).toBe("tenant-x");
    expect(_upserts).toHaveLength(0);
  });

  it("a NON-missing RPC error surfaces (never silently falls back)", async () => {
    _rpcError = { code: "P0001", message: "refused connect write" };
    await expect(saveConnectorToken(googleToken({ refresh_token: "" }), "t")).rejects.toThrow(/guarded save failed/);
    expect(_upserts).toHaveLength(0);
  });

  it("missing RPC -> app-side fallback upserts a NORMAL (non-empty refresh) token", async () => {
    _rpcError = MISSING_RPC;
    await saveConnectorToken(googleToken(), "tenant-x");
    expect(_upserts).toHaveLength(1);
    expect((_upserts[0] as { tenant_id: string }).tenant_id).toBe("tenant-x");
  });

  it("missing RPC + EMPTY refresh over a stored non-empty one -> throws, nothing written", async () => {
    _rpcError = MISSING_RPC;
    _readRow = { payload: googleToken({ refresh_token: "stored-healthy" }) };
    await expect(saveConnectorToken(googleToken({ refresh_token: "" }), "t")).rejects.toThrow(/refused to overwrite/);
    expect(_upserts).toHaveLength(0);
  });

  it("missing RPC + EMPTY refresh + nothing stored -> still refuses (a Google row is never written without a refresh token)", async () => {
    _rpcError = MISSING_RPC;
    _readRow = null;
    await expect(saveConnectorToken(googleToken({ refresh_token: "" }), "t")).rejects.toThrow(/no usable refresh token/);
    expect(_upserts).toHaveLength(0);
  });

  it("non-Google providers keep the plain upsert path (no RPC)", async () => {
    await saveConnectorToken(
      { provider: "wix", api_key: "k", site_id: "s", connected_at: "2026-07-01T00:00:00.000Z" },
      "tenant-x",
    );
    expect(_rpcCalls).toHaveLength(0);
    expect(_upserts).toHaveLength(1);
  });
});

describe("persistRefreshedGoogleToken, the cross-instance CAS", () => {
  it("routes through the RPC with mode=refresh and only non-empty rotation fields", async () => {
    await persistRefreshedGoogleToken("google_ga4", { access_token: "new", expires_in: 3600 }, "tenant-x");
    expect(_rpcCalls).toHaveLength(1);
    expect(_rpcCalls[0]!.params.p_mode).toBe("refresh");
    const payload = _rpcCalls[0]!.params.p_payload as Record<string, unknown>;
    expect(payload.access_token).toBe("new");
    expect(typeof payload.expires_at).toBe("number");
    expect("refresh_token" in payload).toBe(false); // no rotation -> field omitted entirely
    expect(_upserts).toHaveLength(0);
  });

  it("includes refresh_token in the RPC payload ONLY when Google rotated it", async () => {
    await persistRefreshedGoogleToken("google_ga4", { access_token: "new", expires_in: 3600, refresh_token: "rotated" }, "t");
    const payload = _rpcCalls[0]!.params.p_payload as Record<string, unknown>;
    expect(payload.refresh_token).toBe("rotated");
  });

  it("OPERATOR REGRESSION 7 (CAS mirror): missing RPC + a FRESHER stored token -> the staler write no-ops", async () => {
    _rpcError = MISSING_RPC;
    // Stored token expires far in the future (a concurrent refresh already won).
    _readRow = { payload: googleToken({ expires_at: Date.now() + 100 * 3_600_000 }) };
    await persistRefreshedGoogleToken("google_gsc", { access_token: "staler", expires_in: 3600 }, "t");
    expect(_upserts).toHaveLength(0); // loser no-ops; the fresher token survives
  });

  it("missing RPC + a STALER stored token -> the fresher write persists via the merge path", async () => {
    _rpcError = MISSING_RPC;
    _readRow = { payload: googleToken({ expires_at: 1 }) }; // long expired
    await persistRefreshedGoogleToken("google_gsc", { access_token: "fresher", expires_in: 3600 }, "t");
    expect(_upserts).toHaveLength(1);
    const payload = (_upserts[0] as { payload: GoogleConnectorToken }).payload;
    expect(payload.access_token).toBe("fresher");
    expect(payload.refresh_token).toBe("ref"); // stored refresh token untouched by the merge
  });

  it("no stored row -> refresh persistence never INSERTS (fail-soft no-op)", async () => {
    _rpcError = MISSING_RPC;
    _readRow = null;
    await persistRefreshedGoogleToken("google_gsc", { access_token: "x", expires_in: 3600 }, "t");
    expect(_upserts).toHaveLength(0);
  });
});

describe("updateConnectorToken routes Google patches through the guarded RPC (patch mode)", () => {
  it("(a) calls save_connector_token_guarded_v1 mode=patch with ONLY the patch fields (never refresh_token)", async () => {
    // A stored row exists WITH a refresh_token, but the patch payload must carry
    // only the patch fields: the SQL merges the patch onto the row and never
    // receives refresh_token, so a patch can neither resurrect nor erase it.
    _readRow = { payload: googleToken({ refresh_token: "stored-healthy" }) };
    await updateConnectorToken(
      "google_gsc",
      { last_synced_at: "2026-07-09T00:00:00.000Z" },
      "tenant-x",
    );
    expect(_rpcCalls).toHaveLength(1);
    expect(_rpcCalls[0]!.name).toBe("save_connector_token_guarded_v1");
    expect(_rpcCalls[0]!.params.p_mode).toBe("patch");
    expect(_rpcCalls[0]!.params.p_tenant).toBe("tenant-x");
    const payload = _rpcCalls[0]!.params.p_payload as Record<string, unknown>;
    expect(payload.last_synced_at).toBe("2026-07-09T00:00:00.000Z");
    expect("refresh_token" in payload).toBe(false);
    expect(_upserts).toHaveLength(0);
  });

  it("(b) a Google patch carrying a refresh_token THROWS (rotations must use persistRefreshedGoogleToken)", async () => {
    // The type excludes refresh_token; a JS/any caller that smuggles one in must
    // still be refused at runtime so the read-merge-write race can't return.
    const smuggled = { refresh_token: "should-not-be-here" } as unknown as {
      last_synced_at?: string;
    };
    await expect(
      updateConnectorToken("google_gsc", smuggled, "t"),
    ).rejects.toThrow(/must not carry a refresh_token/);
    expect(_rpcCalls).toHaveLength(0);
    expect(_upserts).toHaveLength(0);
  });

  it("(c) missing RPC -> app-side read-merge-write fallback still patches, retaining the stored refresh_token", async () => {
    _rpcError = MISSING_RPC;
    _readRow = { payload: googleToken({ refresh_token: "stored-healthy" }) };
    await updateConnectorToken(
      "google_gsc",
      { last_synced_at: "2026-07-09T00:00:00.000Z" },
      "t",
    );
    expect(_upserts).toHaveLength(1);
    const payload = (_upserts[0] as { payload: GoogleConnectorToken }).payload;
    expect(payload.last_synced_at).toBe("2026-07-09T00:00:00.000Z");
    expect(payload.refresh_token).toBe("stored-healthy");
  });

  it("(d) a legacy EMPTY-refresh row is still patchable: the patch RPC fires and never raises", async () => {
    // RPC present. Stored row has an empty refresh_token (legacy dead grant).
    // The patch path must NOT route through the connect never-erase raise; it
    // just issues the patch RPC (the SQL no-raise is verified against prod).
    _rpcError = null;
    _readRow = { payload: googleToken({ refresh_token: "" }) };
    await expect(
      updateConnectorToken("google_gsc", { auth_failed_at: null }, "t"),
    ).resolves.toBeUndefined();
    expect(_rpcCalls).toHaveLength(1);
    expect(_rpcCalls[0]!.params.p_mode).toBe("patch");
  });

  it("non-Google providers keep the app-side read-merge-write (no patch RPC)", async () => {
    _readRow = {
      payload: {
        provider: "profound",
        api_key: "k",
        connected_at: "2026-07-01T00:00:00.000Z",
      },
    };
    await updateConnectorToken(
      "profound",
      { last_synced_at: "2026-07-09T00:00:00.000Z" },
      "t",
    );
    expect(_rpcCalls).toHaveLength(0);
    expect(_upserts).toHaveLength(1);
  });
});

describe("(e) the GSC direct site persists refreshed tokens via the guarded CAS (mode 'refresh')", () => {
  it("resolveGscAccessToken routes a stale-token refresh through the RPC with p_mode='refresh'", async () => {
    _refreshGoogleAccessTokenMock.mockResolvedValue({
      access_token: "cas-new",
      expires_in: 3600,
    });
    _readRow = {
      payload: googleToken({
        access_token: "old-access",
        refresh_token: "ref",
        // just expired -> evaluateExpiry = stale_under_7d -> refresh + persist
        expires_at: Date.now() - 60_000,
        scopes: [GSC_SCOPE],
      }),
    };

    const access = await resolveGscAccessToken("tenant-x");

    expect(access).toBe("cas-new");
    const refreshCall = _rpcCalls.find((c) => c.params.p_mode === "refresh");
    expect(refreshCall).toBeDefined();
    expect(refreshCall!.name).toBe("save_connector_token_guarded_v1");
    const payload = refreshCall!.params.p_payload as Record<string, unknown>;
    expect(payload.access_token).toBe("cas-new");
    expect(typeof payload.expires_at).toBe("number");
  });
});
