/**
 * 2026-06-09 — CallRail connector tests (§9.B). No network, no real key:
 * fetchImpl + token injected. Pins fail-soft, request shape, qualified
 * classification, per-URL/day grouping, and refresh assembly.
 */

import { describe, it, expect, vi } from "vitest";
import { callrailFetchCalls, CALLRAIL_BASE_URL } from "@/lib/connectors/callrail/client";
import {
  isQualifiedCall,
  groupCallsByUrlDay,
  sumQualifiedForUrl,
} from "@/lib/connectors/callrail/calls-by-url";
import { refreshCallRailCalls } from "@/lib/connectors/callrail/persist-url-calls";
import type { CallRailCall } from "@/lib/connectors/callrail/types";

function fakeRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const TOKEN = { api_key: "secret", account_id: "227799611" };

describe("callrailFetchCalls — fail-soft + request shape", () => {
  it("no_key when token null (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const r = await callrailFetchCalls(
      { tenantId: "t" },
      { token: null, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(r).toEqual({ ok: false, reason: "no_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disconnected when soft-disconnected", async () => {
    const r = await callrailFetchCalls(
      { tenantId: "t" },
      { token: { ...TOKEN, disconnected_at: "2026-06-09T00:00:00Z" } },
    );
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });

  it("builds the account-scoped URL + token header", async () => {
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    const fetchImpl = (async (u: string, init: RequestInit) => {
      calledUrl = u;
      calledHeaders = (init.headers ?? {}) as Record<string, string>;
      return fakeRes({ calls: [] });
    }) as unknown as typeof fetch;
    await callrailFetchCalls({ tenantId: "t", startDate: "2026-05-01", endDate: "2026-06-01" }, { token: TOKEN, fetchImpl });
    expect(calledUrl.startsWith(`${CALLRAIL_BASE_URL}/v3/a/227799611/calls.json`)).toBe(true);
    expect(calledUrl).toContain("start_date=2026-05-01");
    expect(calledUrl).toContain("fields=landing_page_url");
    expect(calledHeaders.Authorization).toBe("Token token=secret");
  });

  it("api_error on non-2xx / missing calls array / network throw", async () => {
    const non2xx = await callrailFetchCalls({ tenantId: "t" }, { token: TOKEN, fetchImpl: (async () => fakeRes({}, false, 401)) as unknown as typeof fetch });
    expect(non2xx.ok).toBe(false);
    const noArr = await callrailFetchCalls({ tenantId: "t" }, { token: TOKEN, fetchImpl: (async () => fakeRes({ nope: 1 })) as unknown as typeof fetch });
    expect(noArr.ok).toBe(false);
    const threw = await callrailFetchCalls({ tenantId: "t" }, { token: TOKEN, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
    expect(threw).toEqual({ ok: false, reason: "api_error", detail: "ECONNRESET" });
  });

  it("parses calls on success", async () => {
    const body = { calls: [{ landing_page_url: "https://x.com/a", answered: true, duration: 90, lead_status: "good_lead", start_time: "2026-06-01T10:00:00Z" }] };
    const r = await callrailFetchCalls({ tenantId: "t" }, { token: TOKEN, fetchImpl: (async () => fakeRes(body)) as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.calls[0]!.landingPageUrl).toBe("https://x.com/a");
      expect(r.calls[0]!.durationSec).toBe(90);
      expect(r.calls[0]!.leadStatus).toBe("good_lead");
    }
  });
});

function call(over: Partial<CallRailCall>): CallRailCall {
  return { landingPageUrl: "https://ritzbuilders.com/adu", answered: true, durationSec: 120, leadStatus: null, startTimeIso: "2026-06-01T10:00:00Z", ...over };
}

describe("isQualifiedCall", () => {
  it("good_lead → qualified regardless of duration", () => {
    expect(isQualifiedCall(call({ leadStatus: "good_lead", answered: false, durationSec: 0 }))).toBe(true);
  });
  it("answered + long enough → qualified", () => {
    expect(isQualifiedCall(call({ leadStatus: null, answered: true, durationSec: 60 }))).toBe(true);
  });
  it("answered but too short → not qualified", () => {
    expect(isQualifiedCall(call({ leadStatus: null, answered: true, durationSec: 15 }))).toBe(false);
  });
  it("unanswered → not qualified", () => {
    expect(isQualifiedCall(call({ leadStatus: "not_scored", answered: false, durationSec: 0 }))).toBe(false);
  });
});

describe("groupCallsByUrlDay", () => {
  it("groups by URL+day; counts qualified vs total; drops un-attributable", () => {
    const rows = groupCallsByUrlDay([
      call({ durationSec: 120, startTimeIso: "2026-06-01T10:00:00Z" }), // qualified
      call({ answered: true, durationSec: 5, startTimeIso: "2026-06-01T11:00:00Z" }), // total only
      call({ landingPageUrl: null }), // dropped (no url)
      call({ startTimeIso: null }), // dropped (no date)
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalCalls).toBe(2);
    expect(rows[0]!.qualifiedCalls).toBe(1);
  });

  it("separates different URLs and different days", () => {
    const rows = groupCallsByUrlDay([
      call({ landingPageUrl: "https://ritzbuilders.com/adu", startTimeIso: "2026-06-01T10:00:00Z" }),
      call({ landingPageUrl: "https://ritzbuilders.com/kitchen", startTimeIso: "2026-06-01T10:00:00Z" }),
      call({ landingPageUrl: "https://ritzbuilders.com/adu", startTimeIso: "2026-06-02T10:00:00Z" }),
    ]);
    expect(rows).toHaveLength(3);
  });

  it("sumQualifiedForUrl sums only the matching canonical URL", () => {
    const rows = groupCallsByUrlDay([
      call({ startTimeIso: "2026-06-01T10:00:00Z" }),
      call({ startTimeIso: "2026-06-02T10:00:00Z" }),
      call({ landingPageUrl: "https://ritzbuilders.com/other", startTimeIso: "2026-06-01T10:00:00Z" }),
    ]);
    const target = rows.find((r) => r.url.includes("/adu"))!.url;
    expect(sumQualifiedForUrl(rows, target)).toBe(2);
  });
});

describe("refreshCallRailCalls — assembly", () => {
  const body = {
    calls: [
      { landing_page_url: "https://ritzbuilders.com/adu", answered: true, duration: 120, lead_status: "good_lead", start_time: "2026-06-01T10:00:00Z" },
      { landing_page_url: "https://ritzbuilders.com/adu", answered: true, duration: 5, lead_status: "not_scored", start_time: "2026-06-01T12:00:00Z" },
    ],
  };
  it("reports rowsUpserted=0 when the write did NOT persist (wave-2 #6: honest count)", async () => {
    const r = await refreshCallRailCalls(
      { tenantId: "t", now: new Date("2026-06-09T00:00:00Z") },
      { token: TOKEN, fetchImpl: (async () => fakeRes(body)) as unknown as typeof fetch },
    );
    expect(r.ok).toBe(true); // the CallRail FETCH succeeded
    if (r.ok) {
      // No admin client in test → upsert can't persist. rowsUpserted must
      // reflect REALITY (0 written), not the pre-fix lie of rows.length.
      expect(r.persisted).toBe(false);
      expect(r.rowsUpserted).toBe(0);
    }
  });
  it("passes through no_key", async () => {
    const r = await refreshCallRailCalls({ tenantId: "t" }, { token: null });
    expect(r).toEqual({ ok: false, reason: "no_key" });
  });
  it("ok with rowsUpserted 0 when no attributable calls", async () => {
    const r = await refreshCallRailCalls(
      { tenantId: "t" },
      { token: TOKEN, fetchImpl: (async () => fakeRes({ calls: [] })) as unknown as typeof fetch },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rowsUpserted).toBe(0);
  });
});
