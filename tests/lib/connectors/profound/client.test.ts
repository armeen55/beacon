/**
 * Profound client tests (2026-06-12 night shift). The load-bearing
 * piece is the POSITIONAL envelope decoder — dimensions[i]/metrics[i]
 * map to the i-th REQUESTED name (official response-format doc); a
 * misaligned decode would silently attribute one model's citations to
 * another. Plus connector fail-soft contract + EST date semantics.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/connector-store", () => ({
  getConnectorToken: vi.fn(async () => null),
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  decodeProfoundEnvelope,
  fetchProfoundCategories,
  getProfoundScope,
  profoundKeyPresent,
  queryProfoundReport,
} from "@/lib/connectors/profound/client";
import {
  profoundEstDateString,
  syncProfoundNightlyForTenant,
} from "@/lib/connectors/profound/sync-nightly";

describe("decodeProfoundEnvelope (positional contract)", () => {
  const DIMS = ["date", "model", "root_domain", "url"] as const;
  const METS = ["count", "citation_share"] as const;

  it("re-keys dimensions/metrics by REQUESTED order", () => {
    const out = decodeProfoundEnvelope(DIMS, METS, {
      info: { total_rows: 1 },
      data: [
        {
          dimensions: ["2026-06-10", "ChatGPT", "iranopedia.com", "https://iranopedia.com/persepolis"],
          metrics: [10, 0.05],
        },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.totalRows).toBe(1);
    expect(out!.rows[0]!.dims).toEqual({
      date: "2026-06-10",
      model: "ChatGPT",
      root_domain: "iranopedia.com",
      url: "https://iranopedia.com/persepolis",
    });
    expect(out!.rows[0]!.mets).toEqual({ count: 10, citation_share: 0.05 });
  });

  it("drops rows whose arity breaks the positional contract (never misaligns)", () => {
    const out = decodeProfoundEnvelope(DIMS, METS, {
      info: { total_rows: 2 },
      data: [
        { dimensions: ["2026-06-10", "ChatGPT"], metrics: [10, 0.05] }, // short dims
        {
          dimensions: ["2026-06-10", "Claude", "x.com", "https://x.com/a"],
          metrics: [3, 0.01, 99], // extra metric
        },
      ],
    });
    expect(out!.rows).toEqual([]);
  });

  it("coerces non-numeric metrics to 0 and null dims to empty string", () => {
    const out = decodeProfoundEnvelope(["date"], ["count"], {
      data: [{ dimensions: [null], metrics: ["NaN-ish"] }],
    });
    expect(out!.rows[0]!.dims.date).toBe("");
    expect(out!.rows[0]!.mets.count).toBe(0);
  });

  it("null on malformed envelopes (no data array)", () => {
    expect(decodeProfoundEnvelope(["date"], ["count"], null)).toBeNull();
    expect(decodeProfoundEnvelope(["date"], ["count"], { info: {} })).toBeNull();
  });
});

describe("fail-soft contract", () => {
  it("no token → null (never throws)", async () => {
    expect(await fetchProfoundCategories("tenant-a")).toBeNull();
  });

  it("non-2xx → null", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const out = await queryProfoundReport(
      {
        tenantId: "tenant-a",
        report: "citations",
        categoryId: "cat-1",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["count"],
        dimensions: ["date"],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "k" },
    );
    expect(out).toBeNull();
  });

  it("fail-soft null on a 200 response with an unparseable JSON body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>not json</html>", { status: 200 }),
    );
    const out = await queryProfoundReport(
      {
        tenantId: "tenant-a",
        report: "citations",
        categoryId: "cat-1",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["count"],
        dimensions: ["date"],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "k" },
    );
    expect(out).toBeNull();
  });

  it("fail-soft null on a network fault (fetch throws)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const out = await fetchProfoundCategories("tenant-a", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getApiKey: async () => "k",
    });
    expect(out).toBeNull();
  });

  it("sends X-API-Key + the documented report body shape", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ info: { total_rows: 0 }, data: [] }), {
        status: 200,
      });
    });
    await queryProfoundReport(
      {
        tenantId: "tenant-a",
        report: "visibility",
        categoryId: "cat-1",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["visibility_score"],
        dimensions: ["date", "model"],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "key-123" },
    );
    expect(captured.url).toBe("https://api.tryprofound.com/v1/reports/visibility");
    expect((captured.init!.headers as Record<string, string>)["X-API-Key"]).toBe("key-123");
    const body = JSON.parse(String(captured.init!.body));
    expect(body).toMatchObject({
      category_id: "cat-1",
      start_date: "2026-06-10",
      end_date: "2026-06-12",
      date_interval: "day",
      metrics: ["visibility_score"],
      dimensions: ["date", "model"],
    });
    expect(body.pagination.limit).toBeGreaterThan(0);
  });

  it("categories: tolerates bare-array and {data:[...]} shapes", async () => {
    const bare = vi.fn(async () =>
      new Response(JSON.stringify([{ id: "c1", name: "Builders" }]), { status: 200 }),
    );
    const wrapped = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "c2", name: "Tea" }] }), { status: 200 }),
    );
    expect(
      await fetchProfoundCategories("t", {
        fetchImpl: bare as unknown as typeof fetch,
        getApiKey: async () => "k",
      }),
    ).toEqual([{ id: "c1", name: "Builders" }]);
    expect(
      await fetchProfoundCategories("t", {
        fetchImpl: wrapped as unknown as typeof fetch,
        getApiKey: async () => "k",
      }),
    ).toEqual([{ id: "c2", name: "Tea" }]);
  });
});

// #88 (2026-06-14) — Profound 0-rows / no-key / api-error were all conflated
// into one `no_key_or_api_error` reason, making a real auth/API failure look
// like a harmless skip and zero genuine results look like a failure. The sync
// now splits "no key connected" (benign) from "key present, call failed"
// (real failure); a successful zero-result run stays synced:true.
describe("profoundKeyPresent (honest no-key vs api-error split, #88)", () => {
  it("true when a key resolves, false when none", async () => {
    expect(await profoundKeyPresent("t", { getApiKey: async () => "k" })).toBe(true);
    expect(await profoundKeyPresent("t", { getApiKey: async () => null })).toBe(false);
  });
});

describe("syncProfoundNightlyForTenant — honest failure classification (#88)", () => {
  it("no key connected → reason no_profound_key (a benign skip)", async () => {
    const out = await syncProfoundNightlyForTenant(
      { tenantId: "t" },
      { getApiKey: async () => null },
    );
    expect(out).toEqual({ synced: false, reason: "no_profound_key" });
  });

  it("key present but the categories call fails → reason profound_api_error (a real failure)", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const out = await syncProfoundNightlyForTenant(
      { tenantId: "t" },
      {
        getApiKey: async () => "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(out).toEqual({ synced: false, reason: "profound_api_error" });
  });
});

describe("getProfoundScope (topic-scoping resolver, 2026-06-24)", () => {
  it("honors the getScope test seam", async () => {
    expect(
      await getProfoundScope("t", {
        getScope: async () => ({ categoryId: "cat-1", topicId: "topic-uuid" }),
      }),
    ).toEqual({ categoryId: "cat-1", topicId: "topic-uuid" });
  });
  it("a null scope → empty (full-category behavior)", async () => {
    expect(await getProfoundScope("t", { getScope: async () => null })).toEqual({});
  });
  it("no Supabase / no token → empty (soft-fail, never throws)", async () => {
    // getConnectorToken soft-fails to null without Supabase env → empty scope.
    expect(await getProfoundScope("t")).toEqual({});
  });
});

describe("queryProfoundReport — topic filter passthrough (2026-06-24)", () => {
  it("adds `filters` to the report body when provided (the sync's topic-scoping call)", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ info: { total_rows: 0 }, data: [] }), {
        status: 200,
      });
    });
    await queryProfoundReport(
      {
        tenantId: "t",
        report: "citations",
        categoryId: "cat-1",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["count"],
        dimensions: ["date", "url"],
        filters: [{ field: "topic", operator: "is", value: "topic-uuid" }],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "k" },
    );
    expect(body!.filters).toEqual([
      { field: "topic", operator: "is", value: "topic-uuid" },
    ]);
  });
  it("omits `filters` entirely when none provided (back-compat)", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ info: { total_rows: 0 }, data: [] }), {
        status: 200,
      });
    });
    await queryProfoundReport(
      {
        tenantId: "t",
        report: "citations",
        categoryId: "cat-1",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["count"],
        dimensions: ["date", "url"],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "k" },
    );
    expect(body!.filters).toBeUndefined();
  });
});

describe("profoundEstDateString (official EST date semantics)", () => {
  it("renders the EST calendar day, not UTC", () => {
    // 2026-06-12T03:00Z is still 2026-06-11 23:00 in America/New_York (EDT).
    expect(profoundEstDateString(new Date("2026-06-12T03:00:00Z"))).toBe("2026-06-11");
    expect(profoundEstDateString(new Date("2026-06-12T12:00:00Z"))).toBe("2026-06-12");
  });
});

describe("v2 Agent Analytics reports", () => {
  it("posts the raw-domain body to /v2/reports/{report} and decodes positionally", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          info: { total_rows: 1 },
          data: [
            { dimensions: ["2026-06-10", "/persepolis", "GPTBot", "training"], metrics: [42, 3] },
          ],
        }),
        { status: 200 },
      );
    });
    const { queryProfoundV2Report } = await import("@/lib/connectors/profound/client");
    const out = await queryProfoundV2Report(
      {
        tenantId: "tenant-a",
        report: "bots",
        domain: "iranopedia.com",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["count", "citations"],
        dimensions: ["date", "path", "bot_name", "bot_type"],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "k" },
    );
    expect(captured.url).toBe("https://api.tryprofound.com/v2/reports/bots");
    const body = JSON.parse(String(captured.init!.body));
    expect(body.domain).toBe("iranopedia.com");
    expect(body.category_id).toBeUndefined();
    expect(out!.rows[0]!.dims).toEqual({
      date: "2026-06-10",
      path: "/persepolis",
      bot_name: "GPTBot",
      bot_type: "training",
    });
    expect(out!.rows[0]!.mets).toEqual({ count: 42, citations: 3 });
  });

  it("fail-soft null when the tenant's plan lacks Agent Analytics (4xx)", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const { queryProfoundV2Report } = await import("@/lib/connectors/profound/client");
    const out = await queryProfoundV2Report(
      {
        tenantId: "tenant-a",
        report: "referrals",
        domain: "iranopedia.com",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        metrics: ["visits"],
        dimensions: ["date"],
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: async () => "k" },
    );
    expect(out).toBeNull();
  });
});
