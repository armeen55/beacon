/** Connector refresh ledger: recordSourceRefresh outcome classification and the honest Recent-upkeep sentences (retired sources render nothing false). */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({})); // ── on-use refresh + clarity: connector-store overrides ──────────────
const TOKEN = { provider: "clarity", api_token: "tok", connected_at: "2026-06-12T00:00:00Z" } as unknown;
const state = vi.hoisted(() => ({ connected: { google_gsc: true, google_ga4: true, clarity: true } as Record<string, boolean>, throw: false, owner: true, retryAfter: null as string | null,
  clarityToken: { provider: "clarity", api_token: "tok", connected_at: "2026-06-12T00:00:00Z" } as unknown, googleToken: null as unknown, patches: [] as unknown[], persisted: [] as unknown[],
  refresh: (async () => ({ access_token: "fresh", expires_in: 3600 })) as (...a: unknown[]) => Promise<unknown> }));
vi.mock("@/lib/connector-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/connector-store")>()), // never synced → stale → the on-use refresh runs it
  getConnectorInfo: async (provider: string) => (state.throw ? Promise.reject(new Error("connector store unreachable"))
    : { status: state.connected[provider] ? "connected" : "disconnected", last_synced_at: null, connected_at: null, expires_at: null, retry_after: provider === "clarity" ? state.retryAfter : null }) as never,
  updateConnectorToken: async (_p: string, patch: unknown) => { state.patches.push(patch); }, getConnectorToken: async () => state.clarityToken, getGoogleConnectorToken: async () => state.googleToken,
  persistRefreshedGoogleToken: async (_p: string, refreshed: unknown) => { state.persisted.push(refreshed); },}));
vi.mock("@/lib/connectors/google-auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/connectors/google-auth")>()), refreshGoogleAccessToken: (...a: unknown[]) => state.refresh(...a) }));
vi.mock("@/lib/auth/can-publish", () => ({ isAccountOwner: async () => state.owner, canPublishForCurrentTenant: async () => state.owner }));
vi.mock("@/lib/connectors/gsc/sync-search-analytics", () => ({ syncGscSearchAnalyticsForTenant: async () => ({ synced: true }) }));
vi.mock("@/lib/connectors/ga4/sync-url-traffic", () => ({ syncGa4UrlTrafficForTenant: async () => ({ synced: true }) }));
vi.mock("@/lib/connectors/clarity/sync-daily-metrics", () => ({ syncClarityDailyMetricsForTenant: async () => ({ synced: true }) }));
vi.mock("@/domains/account/tenants/store", () => ({ getTenant: vi.fn(async () => ({ domain: "example.com" })) }));
import { syncSucceeded } from "@/lib/connectors/on-use-refresh";
import { fetchClarityUrlMetrics } from "@/lib/connectors/clarity/client"; // THE DAY THIS FIXTURE CLAIMS MUST BE THE DAY THE CODE READS. Building it with `toISOString()` made a UTC day while `due-work` compares against the PACIFIC reporting day, so from 17:00 Pacific until midnight the two disagreed, `stockClosed` went false, and this test failed on every machine including CI for about seven hours a day.
import { reportingDay } from "@/lib/reporting-day";
import { resolveGscAccessToken } from "@/lib/connectors/gsc/search-analytics"; import { computeRefreshDateRange } from "@/lib/connectors/ga4/persist-url-traffic"; import { autoRefreshStaleConnectorsForTenant } from "@/lib/connectors/on-use-refresh";
beforeEach(() => { state.connected = { google_gsc: true, google_ga4: true, clarity: true }; state.clarityToken = TOKEN; state.owner = true; state.retryAfter = null; state.patches = []; state.persisted = []; }); afterEach(() => { vi.unstubAllGlobals(); });
const NO_WINNERS = { winners: [], serps: [], own: "own.example" };  // nothing on file at all: no winner, no results page bought, and the account's own address, which never wins its own searches
describe("what a stale source is allowed to open on its own", () => {
  it("GA4 and Clarity are modifiers: only Search Console staleness makes a refresh owed", async () => {
    const { dueWork } = await import("@/domains/runtime/ops/due-work"); // nothing below has ever synced, so every connected source is stale
    const rest = { checks: async () => ({ done: 0, total: 0, answers: 0, unavailable: 0, unsupported: 0, due: 0 }), basis: async () => "b1", evidenceVersion: async () => 7,
      surfaceStale: async () => false, debt: async () => ({ measurable: 0, unverified: 0 }), pagesToCrawl: async () => false, answersToAnalyze: async () => false, analysisFingerprint: async () => "fp1", consumedAnalyses: async () => "fp1", factDebt: async () => ({ owed: 0, everChecked: true }), readyStock: async () => 5, creditHeld: async () => false, winnerRows: async () => NO_WINNERS, run: async () => ({ open: false, progress: { decided: { basis: "b1", rowVersion: 7 }, replenish: { day: reportingDay(), jobs: {}, closed: "candidates_exhausted" as const, closedUnder: "b1::v7" } } }) };
    state.connected = { google_gsc: false, google_ga4: true, clarity: true }; expect((await dueWork("t1", new Date(), rest)).due).toEqual([]); // behaviour data going stale never wakes the run
    state.connected = { google_gsc: true, google_ga4: false, clarity: false }; expect((await dueWork("t1", new Date(), rest)).due).toEqual(["refresh_sources"]); // and that refresh still pulls every connected source
    state.throw = true; const blind = await dueWork("t1", new Date(), rest); state.throw = false; expect([blind.readable, blind.due]).toEqual([false, []]); }); // A SOURCE I COULD NOT READ IS NOT A FRESH ONE: this leg swallowed its own failure per provider, so it could never make dueWork unreadable
}); // ───────── syncSucceeded, the positive freshness gate (audit-3 #5) ─────────
describe("syncSucceeded (audit-3 #5)", () => {
  it("treats { synced: true } as success and { synced: false } as failure with reason", () => {
    expect(syncSucceeded({ synced: true, rows_upserted: 12 })).toEqual({ ok: true }); expect(syncSucceeded({ synced: true, truncated: true }).ok).toBe(false); const v = syncSucceeded({ synced: false, reason: "no_token" }); expect([v.ok, v.ok ? null : v.reason]).toEqual([false, "no_token"]); });
  it("regression: the old { ok: false } shape and unrecognized shapes are NOT success", () => {
    expect([syncSucceeded({ ok: false }).ok, syncSucceeded({}).ok, syncSucceeded(null).ok, syncSucceeded("synced").ok]).toEqual([false, false, false, false]); });}); // ───────── Clarity Data Export parser ─────────
const CLARITY_SAMPLE = [{ metricName: "Traffic", information: [{ totalSessionCount: "120", Url: "https://x.com/a" }, { totalSessionCount: "40", Url: "https://x.com/b" }] },
  { metricName: "RageClickCount", information: [{ subTotal: 7, Url: "https://x.com/a" }] }, { metricName: "DeadClickCount", information: [{ subTotal: 3, Url: "https://x.com/b" }] }];
const mockClarityFetch = (body: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body })));
describe("fetchClarityUrlMetrics", () => {
  it("groups metrics by URL across the metric array (happy path)", async () => {
    mockClarityFetch(CLARITY_SAMPLE); const out = await fetchClarityUrlMetrics({ tenantId: "t" }); if (!out.ok) throw new Error(out.reason); const a = out.metrics.find((m) => m.url === "https://x.com/a")!;
    expect([a.sessions, a.rageClicks, out.metrics.find((m) => m.url === "https://x.com/b")!.deadClicks]).toEqual([120, 7, 3]); });
  it("names why a pull returned nothing: quota, rejected token, other, or no token (fail-closed, no fabricated metrics)", async () => {
    const reasons: string[] = []; for (const status of [429, 401, 500]) { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status, json: async () => [] }))); const r = await fetchClarityUrlMetrics({ tenantId: "t" }); reasons.push(r.ok ? "ok" : r.reason); }
    state.clarityToken = null; mockClarityFetch(CLARITY_SAMPLE, true); const r = await fetchClarityUrlMetrics({ tenantId: "t" }); reasons.push(r.ok ? "ok" : r.reason); expect(reasons).toEqual(["http_429", "http_401", "api_error", "no_token"]); });
  it("a refused pull stamps a 24 hour retry-after on the token and the on-use refresh honors it, so ten requests a day are never spent retrying", async () => {
    const { syncClarityDailyMetricsForTenant } = await vi.importActual<typeof import("@/lib/connectors/clarity/sync-daily-metrics")>("@/lib/connectors/clarity/sync-daily-metrics"); const now = new Date("2026-09-14T10:00:00Z");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => [] }))); expect(await syncClarityDailyMetricsForTenant({ tenantId: "t", now })).toEqual({ synced: false, reason: "http_429" });
    expect(state.patches).toEqual([{ retry_after: "2026-09-15T10:00:00.000Z" }]); state.connected = { google_gsc: false, google_ga4: false, clarity: true };
    state.retryAfter = "2026-09-15T10:00:00.000Z"; expect(await autoRefreshStaleConnectorsForTenant("t", now)).toEqual([]); state.retryAfter = "2026-09-14T09:00:00.000Z";
    expect((await autoRefreshStaleConnectorsForTenant("t", now)).map((r) => r.provider)).toEqual(["clarity"]); });}); // AN IDLE GRANT IS NOT A DEAD GRANT: the old 7 day rule refused to refresh without one HTTP call, and only Google's invalid_grant answer proves a grant dead.
describe("Google grants self-heal after any idle period", () => { const stale = { provider: "google_gsc", access_token: "old", refresh_token: "rt", expires_at: Date.parse("2026-08-01T00:00:00Z"), connected_at: "2026-07-01T00:00:00Z", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] };
  it("refreshes a token expired 44 days ago and persists the new access token even when the refresh token did not rotate", async () => {
    state.googleToken = stale; expect(await resolveGscAccessToken("t", new Date("2026-09-14T00:00:00Z"))).toBe("fresh"); expect(state.persisted).toEqual([{ access_token: "fresh", expires_in: 3600 }]); expect(state.patches).toEqual([]); });
  it("stamps auth_failed_at only on invalid_grant, and returns null without a stamp on a transient failure", async () => {
    state.googleToken = stale; state.refresh = async () => { throw new Error("Google token refresh failed (400): invalid_grant"); }; expect(await resolveGscAccessToken("t", new Date("2026-09-14T00:00:00Z"))).toBeNull();
    expect(state.patches.map((p) => Object.keys(p as object))).toEqual([["auth_failed_at"]]); state.patches = []; state.refresh = async () => { throw new Error("Google token refresh failed (503)"); };
    expect([await resolveGscAccessToken("t", new Date("2026-09-14T00:00:00Z")), state.patches]).toEqual([null, []]); state.refresh = async () => ({ access_token: "fresh", expires_in: 3600 }); });}); // GA4 IS A WATERMARK, NOT A REWRITE: 420 days once, then the last 7 days plus anything newer.
describe("computeRefreshDateRange", () => {
  it("cold start pulls 420 days; a stored date re-reads 7 days behind it; the floor and today bound both ends", () => { const now = new Date("2026-09-14T15:00:00Z"); const win = (d: string | null) => { const r = computeRefreshDateRange(d, now); return `${r.startDate}..${r.endDate}`; };
    expect([win(null), win("2026-09-10"), win("2024-01-01"), win("2026-12-01")]).toEqual(["2025-07-21..2026-09-14", "2026-09-03..2026-09-14", "2025-07-21..2026-09-14", "2026-09-14..2026-09-14"]); });}); // A CONNECTIONS FAILURE IS THE OPERATOR'S OWN SENTENCE, never the exception's: raw store and network messages used to reach the screen as if they were advice.
describe("what Connections says when something goes wrong", () => {
  it("hands back plain language instead of the raw error, and a member who is not the owner gets the owner refusal before anything runs", async () => {
    const { getGoogleAuthUrl, disconnectClarity } = await import("@/app/(shell)/settings/connectors/actions"); expect(await getGoogleAuthUrl("gsc")).toEqual({ url: null, error: "The Google sign in could not start just now. Try again in a moment." });
    state.owner = false; expect([await getGoogleAuthUrl("gsc"), await disconnectClarity()]).toEqual([{ url: null, error: "Only this account's owner can change connections." }, { success: false, error: "Only this account's owner can change connections." }]); }); // A CHECK THAT FAILED IS NOT A DISCONNECTION: an unreadable store used to render "Not connected" plus a Connect button at a customer whose grant never moved.
  it("an unreadable token store is the could-not-check state, never not_connected", async () => {
    vi.resetModules(); vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { throw new Error("supabase unreachable"); } }));
    const store = await vi.importActual<typeof import("@/lib/connector-store")>("@/lib/connector-store"); const h = await store.getConnectorHealth("google_gsc", "t1"); vi.doUnmock("@/lib/persistence/supabase");
    expect([h.status, h.health, h.healthReason, h.countsAsConnected]).toEqual(["unknown", "unknown", "Could not check just now. The connection is unchanged. Reload to check again.", false]); });});
