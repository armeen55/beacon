/**
 * 2026-06-09 — Semrush connector client + report-reader tests.
 *
 * Never touches the network or a real key: `fetchImpl` + `token` are
 * injected. Pins fail-soft behavior, CSV parsing, and the typed
 * domain-report mappings.
 */

import { describe, it, expect, vi } from "vitest";
import {
  semrushRawFetch,
  parseSemrushCsv,
  semrushNum,
  SEMRUSH_BASE_URL,
} from "@/lib/connectors/semrush/client";
import {
  fetchDomainOverview,
  fetchOrganicCompetitors,
} from "@/lib/connectors/semrush/domain-reports";

function fakeRes(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => body,
  } as unknown as Response;
}

const TOKEN = { api_key: "secret-key", database: "us" };

describe("semrushRawFetch — fail-soft auth gates", () => {
  it("no_key when token is null (and never fetches)", async () => {
    const fetchImpl = vi.fn();
    const r = await semrushRawFetch(
      { tenantId: "t", type: "domain_ranks", domain: "x.com" },
      { token: null, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(r).toEqual({ ok: false, reason: "no_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disconnected when the token is soft-disconnected", async () => {
    const r = await semrushRawFetch(
      { tenantId: "t", type: "domain_ranks", domain: "x.com" },
      { token: { ...TOKEN, disconnected_at: "2026-06-09T00:00:00Z" } },
    );
    expect(r).toEqual({ ok: false, reason: "disconnected" });
  });
});

describe("semrushRawFetch — request shape (key never leaks beyond the URL)", () => {
  it("builds the documented URL with key/type/domain/database/display_limit", async () => {
    let calledUrl = "";
    const fetchImpl = (async (u: string) => {
      calledUrl = u;
      return fakeRes("Dn\nx.com");
    }) as unknown as typeof fetch;
    await semrushRawFetch(
      {
        tenantId: "t",
        type: "domain_ranks",
        domain: "ritzbuilders.com",
        exportColumns: "Db,Dn,Rk",
        displayLimit: 1,
      },
      { token: TOKEN, fetchImpl },
    );
    expect(calledUrl.startsWith(SEMRUSH_BASE_URL)).toBe(true);
    expect(calledUrl).toContain("type=domain_ranks");
    expect(calledUrl).toContain("key=secret-key");
    expect(calledUrl).toContain("domain=ritzbuilders.com");
    expect(calledUrl).toContain("database=us");
    expect(calledUrl).toContain("display_limit=1");
    expect(calledUrl).toContain("export_columns=Db%2CDn%2CRk");
  });
});

describe("semrushRawFetch — error handling", () => {
  it("api_error on non-2xx", async () => {
    const fetchImpl = (async () => fakeRes("", false, 503)) as unknown as typeof fetch;
    const r = await semrushRawFetch(
      { tenantId: "t", type: "domain_ranks", domain: "x.com" },
      { token: TOKEN, fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("api_error");
  });

  it("api_error on a 200 ERROR body (bad key / no units)", async () => {
    const fetchImpl = (async () =>
      fakeRes("ERROR 50 :: NOTHING FOUND")) as unknown as typeof fetch;
    const r = await semrushRawFetch(
      { tenantId: "t", type: "domain_ranks", domain: "x.com" },
      { token: TOKEN, fetchImpl },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("api_error");
      expect(r.detail).toContain("ERROR 50");
    }
  });

  it("api_error (never throws) on a network fault", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await semrushRawFetch(
      { tenantId: "t", type: "domain_ranks", domain: "x.com" },
      { token: TOKEN, fetchImpl },
    );
    expect(r).toEqual({ ok: false, reason: "api_error", detail: "ECONNRESET" });
  });
});

describe("parseSemrushCsv + semrushNum", () => {
  it("parses header + rows (semicolon-separated)", () => {
    const rows = parseSemrushCsv("Dn;Rk;Or\nritzbuilders.com;1200;340\nother.com;9000;50");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Dn: "ritzbuilders.com", Rk: "1200", Or: "340" });
  });

  it("returns [] for header-only or empty", () => {
    expect(parseSemrushCsv("Dn;Rk")).toEqual([]);
    expect(parseSemrushCsv("")).toEqual([]);
    expect(parseSemrushCsv("   ")).toEqual([]);
  });

  it("semrushNum: number / blank / garbage", () => {
    expect(semrushNum("340")).toBe(340);
    expect(semrushNum("3.5")).toBe(3.5);
    expect(semrushNum("")).toBeNull();
    expect(semrushNum(undefined)).toBeNull();
    expect(semrushNum("n/a")).toBeNull();
  });
});

describe("fetchDomainOverview", () => {
  it("maps the domain_ranks row to a normalized overview", async () => {
    const csv = "Db;Dn;Rk;Or;Ot;Oc;Ad\nus;ritzbuilders.com;152000;340;1200;5400.5;12";
    const fetchImpl = (async () => fakeRes(csv)) as unknown as typeof fetch;
    const r = await fetchDomainOverview(
      { tenantId: "t", domain: "ritzbuilders.com" },
      { token: TOKEN, fetchImpl },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0]).toEqual({
        database: "us",
        domain: "ritzbuilders.com",
        rank: 152000,
        organicKeywords: 340,
        organicTraffic: 1200,
        organicCostUsd: 5400.5,
        adwordsKeywords: 12,
      });
    }
  });

  it("empty when the body is header-only", async () => {
    const fetchImpl = (async () => fakeRes("Db;Dn;Rk;Or;Ot;Oc;Ad")) as unknown as typeof fetch;
    const r = await fetchDomainOverview(
      { tenantId: "t", domain: "x.com" },
      { token: TOKEN, fetchImpl },
    );
    expect(r).toEqual({ ok: false, reason: "empty" });
  });

  it("passes through no_key", async () => {
    const r = await fetchDomainOverview(
      { tenantId: "t", domain: "x.com" },
      { token: null },
    );
    expect(r).toEqual({ ok: false, reason: "no_key" });
  });
});

describe("fetchOrganicCompetitors", () => {
  it("maps competitor rows and drops blank domains", async () => {
    const csv =
      "Dn;Cr;Np;Or;Ot;Oc\nsupplehomes.com;0.83;120;5000;9000;3000\n;0.1;1;2;3;4\nrival.com;0.5;40;800;1200;500";
    const fetchImpl = (async () => fakeRes(csv)) as unknown as typeof fetch;
    const r = await fetchOrganicCompetitors(
      { tenantId: "t", domain: "ritzbuilders.com" },
      { token: TOKEN, fetchImpl },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows.map((c) => c.domain)).toEqual(["supplehomes.com", "rival.com"]);
      expect(r.rows[0]!.competitionLevel).toBe(0.83);
      expect(r.rows[0]!.commonKeywords).toBe(120);
    }
  });
});
