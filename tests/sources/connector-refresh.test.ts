/**
 * Connector refresh ledger: recordSourceRefresh outcome classification and the honest Recent-upkeep sentences (retired sources render nothing false).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
// ── on-use refresh + clarity: connector-store overrides ──────────────
const TOKEN = { provider: "clarity", api_token: "tok", connected_at: "2026-06-12T00:00:00Z" } as unknown;
const state = vi.hoisted(() => ({ connected: { google_gsc: true, google_ga4: true, clarity: true } as Record<string, boolean>, throw: false,
  clarityToken: { provider: "clarity", api_token: "tok", connected_at: "2026-06-12T00:00:00Z" } as unknown }));
vi.mock("@/lib/connector-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connector-store")>()),
  // never synced → stale → the on-use refresh runs it
  getConnectorInfo: async (provider: string) => (state.throw ? Promise.reject(new Error("connector store unreachable"))
    : { status: state.connected[provider] ? "connected" : "disconnected", last_synced_at: null, connected_at: null, expires_at: null }) as never,
  updateConnectorToken: async () => {}, getConnectorToken: async () => state.clarityToken,
}));
vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({ syncGscSearchAnalyticsForTenant: async () => ({ synced: true }) }));
vi.mock("@/lib/connectors/ga4/sync-url-traffic", () => ({ syncGa4UrlTrafficForTenant: async () => ({ synced: true }) }));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({ syncClarityDailyMetricsForTenant: async () => ({ synced: true }) }));
vi.mock("@/domains/account/tenants/store", () => ({ getTenant: vi.fn(async () => ({ domain: "example.com" })) }));
import { syncSucceeded } from "@/lib/connectors/on-use-refresh";
import { fetchClarityUrlMetrics } from "@/lib/connectors/clarity/client";
beforeEach(() => { state.connected = { google_gsc: true, google_ga4: true, clarity: true }; state.clarityToken = TOKEN; });
afterEach(() => { vi.unstubAllGlobals(); });
describe("what a stale source is allowed to open on its own", () => {
  it("GA4 and Clarity are modifiers: only Search Console staleness makes a refresh owed", async () => {
    const { dueWork } = await import("@/domains/runtime/ops/due-work"); // nothing below has ever synced, so every connected source is stale
    const rest = { checks: async () => ({ done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0, due: 0 }), basis: async () => "b1", evidenceVersion: async () => 7,
      surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), pagesToCrawl: async () => false, answersToAnalyze: async () => false, analysisFingerprint: async () => "fp1", consumedAnalyses: async () => "fp1", run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 } } }) };
    state.connected = { google_gsc: false, google_ga4: true, clarity: true }; expect((await dueWork("t1", new Date(), rest)).due).toEqual([]); // behaviour data going stale never wakes the run
    state.connected = { google_gsc: true, google_ga4: false, clarity: false }; expect((await dueWork("t1", new Date(), rest)).due).toEqual(["refresh_sources"]); // and that refresh still pulls every connected source
    state.throw = true; const blind = await dueWork("t1", new Date(), rest); state.throw = false; expect([blind.readable, blind.due]).toEqual([false, []]); }); // A SOURCE I COULD NOT READ IS NOT A FRESH ONE: this leg swallowed its own failure per provider, so it could never make dueWork unreadable
});
// ───────── syncSucceeded, the positive freshness gate (audit-3 #5) ─────────
describe("syncSucceeded (audit-3 #5)", () => {
  it("treats { synced: true } as success and { synced: false } as failure with reason", () => {
    expect(syncSucceeded({ synced: true, rows_upserted: 12 })).toEqual({ ok: true }); const v = syncSucceeded({ synced: false, reason: "no_token" });
    expect([v.ok, v.ok ? null : v.reason]).toEqual([false, "no_token"]);
  });
  it("regression: the old { ok: false } shape and unrecognized shapes are NOT success", () => {
    expect([syncSucceeded({ ok: false }).ok, syncSucceeded({}).ok, syncSucceeded(null).ok, syncSucceeded("synced").ok]).toEqual([false, false, false, false]);
  });
});
// ───────── Clarity Data Export parser ─────────
const CLARITY_SAMPLE = [
  { metricName: "Traffic", information: [{ totalSessionCount: "120", Url: "https://x.com/a" }, { totalSessionCount: "40", Url: "https://x.com/b" }] },
  { metricName: "RageClickCount", information: [{ subTotal: 7, Url: "https://x.com/a" }] },
  { metricName: "DeadClickCount", information: [{ subTotal: 3, Url: "https://x.com/b" }] },
];
function mockClarityFetch(body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body })));
}
describe("fetchClarityUrlMetrics", () => {
  it("groups metrics by URL across the metric array (happy path)", async () => {
    mockClarityFetch(CLARITY_SAMPLE); const out = await fetchClarityUrlMetrics({ tenantId: "t" }); const a = out!.find((m) => m.url === "https://x.com/a")!;
    expect([a.sessions, a.rageClicks, out!.find((m) => m.url === "https://x.com/b")!.deadClicks]).toEqual([120, 7, 3]);
  });
  it("fail-softs to null on non-2xx and on missing token (fail-closed, no fabricated metrics)", async () => {
    mockClarityFetch(CLARITY_SAMPLE, false); expect(await fetchClarityUrlMetrics({ tenantId: "t" })).toBeNull();
    state.clarityToken = null; mockClarityFetch(CLARITY_SAMPLE, true);
    expect(await fetchClarityUrlMetrics({ tenantId: "t" })).toBeNull();
  });
});
// A CONNECTIONS FAILURE IS THE OPERATOR'S OWN SENTENCE, never the exception's: raw store and network messages used to reach the screen as if they were advice.
describe("what Connections says when something goes wrong", () => {
  it("hands back plain language instead of the raw error", async () => {
    const { getGoogleAuthUrl } = await import("@/app/(shell)/settings/connectors/actions");
    expect(await getGoogleAuthUrl("gsc")).toEqual({ url: null, error: "The Google sign in could not start just now. Try again in a moment." });
  });
});
