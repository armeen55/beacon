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
  queryProfoundReport,
} from "@/lib/connectors/profound/client";
import { profoundEstDateString } from "@/lib/connectors/profound/sync-nightly";

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

describe("profoundEstDateString (official EST date semantics)", () => {
  it("renders the EST calendar day, not UTC", () => {
    // 2026-06-12T03:00Z is still 2026-06-11 23:00 in America/New_York (EDT).
    expect(profoundEstDateString(new Date("2026-06-12T03:00:00Z"))).toBe("2026-06-11");
    expect(profoundEstDateString(new Date("2026-06-12T12:00:00Z"))).toBe("2026-06-12");
  });
});
