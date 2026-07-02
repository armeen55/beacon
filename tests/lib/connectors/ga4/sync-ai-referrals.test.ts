/**
 * 2026-07-01 - GA4 AI-referral sync tests (BEACON_500 item 6).
 *
 * Pins the dormant-until-key contract + the classify/aggregate/upsert path of
 * src/lib/connectors/ga4/sync-ai-referrals.ts with the GA4 report and
 * Supabase both mocked:
 *   - no token -> no_token; token without property -> no_property (report never runs)
 *   - report failure -> reason passthrough, Supabase never touched
 *   - variant sources (chat.openai.com + chatgpt.com) collapse into ONE
 *     canonical row per (page, day, source_domain); non-AI rows are dropped
 *   - zero AI rows -> synced true with 0 upserts and NO upsert call (honest zero)
 *   - upsert error -> persist_failed (never throws)
 *   - success reports sessions, sources, and the truncated flag
 *   - date window: bounded days back from now UTC, capped at 420
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const _getTokenMock = vi.fn();
vi.mock("@/lib/connector-store", () => ({
  getGoogleConnectorToken: (...a: unknown[]) => _getTokenMock(...a),
}));

const _reportMock = vi.fn();
vi.mock("@/lib/connectors/ga4/data-api", () => ({
  runGa4AiReferralReport: (...a: unknown[]) => _reportMock(...a),
}));

const _upsertMock = vi.fn();
const _fromMock = vi.fn(() => ({ upsert: _upsertMock }));
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: _fromMock }),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  aggregateAiReferralRows,
  computeAiReferralDateRange,
  pullGa4AiReferralsForTenant,
} from "@/lib/connectors/ga4/sync-ai-referrals";
import type { Ga4AiReferralRow } from "@/lib/connectors/ga4/types";

const raw = (over: Partial<Ga4AiReferralRow>): Ga4AiReferralRow => ({
  date: "2026-06-30",
  pagePath: "/iran-cheetah",
  sessionSource: "chatgpt.com",
  sessions: 1,
  engaged_sessions: 1,
  key_events: 0,
  ...over,
});

beforeEach(() => {
  _getTokenMock.mockReset();
  _reportMock.mockReset();
  _upsertMock.mockReset();
  _fromMock.mockClear();
});

describe("pullGa4AiReferralsForTenant - dormant until key", () => {
  it("no token -> no_token; the report never runs", async () => {
    _getTokenMock.mockResolvedValue(null);
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "no_token" });
    expect(_reportMock).not.toHaveBeenCalled();
  });

  it("token without a property -> no_property; the report never runs", async () => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "" });
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "no_property" });
    expect(_reportMock).not.toHaveBeenCalled();
  });
});

describe("pullGa4AiReferralsForTenant - report and persist paths", () => {
  beforeEach(() => {
    _getTokenMock.mockResolvedValue({ provider: "google_ga4", ga4_property_id: "properties/123" });
  });

  it("report failure -> reason passthrough; Supabase never touched", async () => {
    _reportMock.mockResolvedValue({ ok: false, reason: "token_expired" });
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "token_expired" });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("zero AI rows -> honest zero: synced true, 0 upserts, upsert NOT called", async () => {
    _reportMock.mockResolvedValue({
      ok: true,
      // Request-side over-fetch can return non-AI sources; all are dropped.
      rows: [raw({ sessionSource: "google" }), raw({ sessionSource: "thankyou.com" })],
    });
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toEqual({
      synced: true,
      property: "properties/123",
      rows_fetched: 2,
      rows_upserted: 0,
      sessions: 0,
      sources: [],
    });
    expect(_upsertMock).not.toHaveBeenCalled();
  });

  it("collapses variants, upserts canonical rows on the 4-column conflict key", async () => {
    _reportMock.mockResolvedValue({
      ok: true,
      rows: [
        raw({ sessionSource: "chatgpt.com", sessions: 3, engaged_sessions: 2, key_events: 1 }),
        raw({ sessionSource: "chat.openai.com", sessions: 2, engaged_sessions: 1, key_events: 0.5 }),
        raw({ sessionSource: "perplexity.ai", pagePath: "/farsi-numbers", sessions: 4 }),
        raw({ sessionSource: "bing" }), // dropped
      ],
    });
    _upsertMock.mockResolvedValue({ error: null });
    const now = new Date("2026-07-01T12:00:00Z");
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1", now });
    expect(r).toEqual({
      synced: true,
      property: "properties/123",
      rows_fetched: 4,
      rows_upserted: 2,
      sessions: 9,
      sources: ["chatgpt.com", "perplexity.ai"],
    });
    expect(_fromMock).toHaveBeenCalledWith("ga4_ai_referral_daily");
    expect(_upsertMock).toHaveBeenCalledTimes(1);
    const [rows, opts] = _upsertMock.mock.calls[0]!;
    expect(opts).toEqual({ onConflict: "tenant_id,page_path,day,source_domain" });
    expect(rows).toEqual([
      {
        tenant_id: "t1",
        page_path: "/iran-cheetah",
        day: "2026-06-30",
        source_domain: "chatgpt.com",
        sessions: 5,
        engaged_sessions: 3,
        key_events: 1.5,
        last_synced_at: now.toISOString(),
      },
      {
        tenant_id: "t1",
        page_path: "/farsi-numbers",
        day: "2026-06-30",
        source_domain: "perplexity.ai",
        sessions: 4,
        engaged_sessions: 1,
        key_events: 0,
        last_synced_at: now.toISOString(),
      },
    ]);
  });

  it("upsert error -> persist_failed, never throws", async () => {
    _reportMock.mockResolvedValue({ ok: true, rows: [raw({})] });
    _upsertMock.mockResolvedValue({ error: { message: "boom", code: "XX000" } });
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toEqual({ synced: false, reason: "persist_failed" });
  });

  it("propagates the truncated flag on a partial pull", async () => {
    _reportMock.mockResolvedValue({ ok: true, rows: [raw({ sessions: 7 })], truncated: true });
    _upsertMock.mockResolvedValue({ error: null });
    const r = await pullGa4AiReferralsForTenant({ tenantId: "t1" });
    expect(r).toMatchObject({ synced: true, sessions: 7, truncated: true });
  });
});

describe("aggregateAiReferralRows - pure classification and rollup", () => {
  it("keys by (page, day, canonical source) and normalizes an empty path to /", () => {
    const rows = aggregateAiReferralRows({
      rows: [
        raw({ pagePath: "", sessionSource: "claude.ai", sessions: 2 }),
        raw({ pagePath: "  ", sessionSource: "claude.ai", sessions: 3 }),
        raw({ pagePath: "/a", date: "2026-06-29", sessionSource: "m.chatgpt.com", sessions: 1 }),
      ],
      tenantId: "t9",
      nowIso: "2026-07-01T00:00:00.000Z",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ page_path: "/", source_domain: "claude.ai", sessions: 5 });
    expect(rows[1]).toMatchObject({
      page_path: "/a",
      day: "2026-06-29",
      source_domain: "chatgpt.com",
      sessions: 1,
    });
  });
});

describe("computeAiReferralDateRange", () => {
  const now = new Date("2026-07-01T15:30:00Z");

  it("goes `days` back from today UTC, inclusive", () => {
    expect(computeAiReferralDateRange(30, now)).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-07-01",
    });
  });

  it("caps at 420 days and floors at 1", () => {
    expect(computeAiReferralDateRange(9999, now).startDate).toBe("2025-05-07");
    expect(computeAiReferralDateRange(0, now)).toEqual({
      startDate: "2026-06-30",
      endDate: "2026-07-01",
    });
  });
});
