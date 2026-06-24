import { describe, it, expect } from "vitest";
import {
  pullProfoundAnswers,
  createProfoundPrompts,
  decodeProfoundAnswers,
} from "@/lib/connectors/profound/client";

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
const deps = (fetchImpl: typeof fetch) => ({
  getApiKey: async () => "test-key",
  fetchImpl,
});

describe("decodeProfoundAnswers", () => {
  it("extracts mentions + citation hostnames + topic/model/asset", () => {
    const r = decodeProfoundAnswers({
      info: { total_rows: 1 },
      data: [
        {
          prompt_id: "p1",
          prompt: "best persian restaurants",
          response: "...",
          mentions: ["Iranopedia", "Yelp"],
          citation_details: [
            { hostname: "yelp.com", url: "https://yelp.com/x" },
            { hostname: "reddit.com" },
            { notahost: true },
          ],
          topic: "Restaurants",
          model: "ChatGPT",
          asset: "Iranopedia",
          created_at: "2026-06-20",
        },
      ],
    });
    expect(r.totalRows).toBe(1);
    expect(r.rows[0]!.mentions).toEqual(["Iranopedia", "Yelp"]);
    expect(r.rows[0]!.citationHostnames).toEqual(["yelp.com", "reddit.com"]);
    expect(r.rows[0]!.topic).toBe("Restaurants");
  });
  it("tolerates a missing/garbage envelope", () => {
    expect(decodeProfoundAnswers(null)).toEqual({ rows: [], totalRows: 0 });
    expect(decodeProfoundAnswers({ data: "nope" })).toEqual({ rows: [], totalRows: 0 });
  });
});

describe("pullProfoundAnswers", () => {
  it("paginates until total is reached", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init.body));
      const offset = body.pagination.offset;
      // 3 total rows, page size forced small via maxRows handling
      const page = offset === 0
        ? [{ prompt: "a", topic: "T" }, { prompt: "b", topic: "T" }]
        : [{ prompt: "c", topic: "T" }];
      return jsonRes({ info: { total_rows: 3 }, data: page });
    }) as unknown as typeof fetch;
    const r = await pullProfoundAnswers(
      { tenantId: "t", categoryId: "c", startDate: "2026-06-01", endDate: "2026-06-03" },
      deps(fetchImpl),
    );
    expect(r).not.toBeNull();
    expect(r!.totalRows).toBe(3);
    expect(r!.rows.map((x) => x.prompt)).toEqual(["a", "b", "c"]);
    expect(calls).toBe(2);
  });
  it("returns null with no API key", async () => {
    const r = await pullProfoundAnswers(
      { tenantId: "t", categoryId: "c", startDate: "x", endDate: "y" },
      { getApiKey: async () => null },
    );
    expect(r).toBeNull();
  });
  it("passes a topic filter through to the request body (topic-scoping)", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return jsonRes({ info: { total_rows: 0 }, data: [] });
    }) as unknown as typeof fetch;
    await pullProfoundAnswers(
      {
        tenantId: "t",
        categoryId: "c",
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        filters: [{ field: "topic", operator: "is", value: "topic-uuid" }],
      },
      deps(fetchImpl),
    );
    expect(body!.filters).toEqual([{ field: "topic", operator: "is", value: "topic-uuid" }]);
  });
});

describe("createProfoundPrompts", () => {
  it("no-ops on empty prompts (no fetch)", async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; return jsonRes({}); }) as unknown as typeof fetch;
    const r = await createProfoundPrompts(
      { tenantId: "t", categoryId: "c", prompts: [] },
      deps(fetchImpl),
    );
    expect(called).toBe(false);
    expect(r).toEqual({ created: 0, topicsCreated: 0, tagsCreated: 0, dryRun: false, promptIds: [] });
  });
  it("posts to the category prompts path, maps body + parses response", async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return jsonRes({ created: 2, topics_created: 1, tags_created: 0, dry_run: true, prompts: [{ id: "np1" }, { id: "np2" }] });
    }) as unknown as typeof fetch;
    const r = await createProfoundPrompts(
      {
        tenantId: "t",
        categoryId: "cat-123",
        dryRun: true,
        prompts: [
          { prompt: "cities in iran", topic: "Cities", regions: ["US"], platforms: ["ChatGPT"] },
        ],
      },
      deps(fetchImpl),
    );
    expect(captured!.url).toContain("/v1/org/categories/cat-123/prompts");
    expect((captured!.body.prompts as unknown[]).length).toBe(1);
    const p0 = (captured!.body.prompts as Record<string, unknown>[])[0]!;
    expect(p0.analysis_types).toEqual(["visibility"]); // default
    expect(p0.language).toBe("en"); // default
    expect(captured!.body.dry_run).toBe(true);
    expect(r).toEqual({ created: 2, topicsCreated: 1, tagsCreated: 0, dryRun: true, promptIds: ["np1", "np2"] });
  });
});
