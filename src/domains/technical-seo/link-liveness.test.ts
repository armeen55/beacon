import { describe, expect, it, vi } from "vitest";

import { probeLiveness, probeLivenessBatch, MAX_REDIRECT_HOPS } from "./link-liveness";

/** A mock fetch that answers per-URL from a table. Robots.txt requests return an
 *  empty (permissive) body. */
function mockFetch(
  table: Record<string, { status: number; location?: string }>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/robots.txt")) {
      return new Response("", { status: 200 });
    }
    const entry = table[url];
    if (!entry) throw new Error("network error for " + url);
    const headers = new Headers();
    if (entry.location) headers.set("location", entry.location);
    return new Response(null, { status: entry.status, headers });
  }) as unknown as typeof fetch;
}

describe("probeLiveness", () => {
  it("reports a 200 target as live with no chain", async () => {
    const r = await probeLiveness(
      "https://x.com/ok",
      new Map(),
      { fetchImpl: mockFetch({ "https://x.com/ok": { status: 200 } }) },
    );
    expect(r).toEqual({ liveness: "live", redirectChain: [] });
  });

  it("reports a 404 target as dead", async () => {
    const r = await probeLiveness(
      "https://x.com/gone",
      new Map(),
      { fetchImpl: mockFetch({ "https://x.com/gone": { status: 404 } }) },
    );
    expect(r.liveness).toBe("dead");
  });

  it("resolves a multi-hop redirect chain and lands live", async () => {
    const r = await probeLiveness("https://x.com/a", new Map(), {
      fetchImpl: mockFetch({
        "https://x.com/a": { status: 301, location: "https://x.com/b" },
        "https://x.com/b": { status: 302, location: "https://x.com/c" },
        "https://x.com/c": { status: 200 },
      }),
    });
    expect(r.liveness).toBe("live");
    expect(r.redirectChain).toEqual(["https://x.com/b", "https://x.com/c"]);
  });

  it("stops chasing at MAX_REDIRECT_HOPS (runaway loop reported as a long chain)", async () => {
    // Build a chain longer than the cap.
    const table: Record<string, { status: number; location?: string }> = {};
    for (let i = 0; i <= MAX_REDIRECT_HOPS + 3; i++) {
      table[`https://x.com/h${i}`] = { status: 301, location: `https://x.com/h${i + 1}` };
    }
    const r = await probeLiveness("https://x.com/h0", new Map(), { fetchImpl: mockFetch(table) });
    expect(r.redirectChain.length).toBeLessThanOrEqual(MAX_REDIRECT_HOPS + 1);
    expect(r.liveness).toBe("live");
  });

  it("fail-soft: a fetch error yields unknown (never a false dead)", async () => {
    const r = await probeLiveness("https://x.com/err", new Map(), {
      fetchImpl: mockFetch({}), // throws for the target
    });
    expect(r).toEqual({ liveness: "unknown", redirectChain: [] });
  });

  it("robots-blocked yields unknown (we never fetch what robots forbids)", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /", { status: 200 });
      }
      throw new Error("should not fetch a disallowed page");
    }) as unknown as typeof fetch;
    const r = await probeLiveness("https://x.com/blocked", new Map(), { fetchImpl });
    expect(r.liveness).toBe("unknown");
  });
});

describe("probeLivenessBatch", () => {
  it("probes a capped list and returns a per-URL map", async () => {
    const table = {
      "https://x.com/1": { status: 200 },
      "https://x.com/2": { status: 404 },
    };
    const out = await probeLivenessBatch(
      ["https://x.com/1", "https://x.com/2"],
      { fetchImpl: mockFetch(table) },
      10,
    );
    expect(out.get("https://x.com/1")!.liveness).toBe("live");
    expect(out.get("https://x.com/2")!.liveness).toBe("dead");
  });

  it("respects the cap (URLs beyond it stay unprobed -> not in the map)", async () => {
    const urls = ["https://x.com/1", "https://x.com/2", "https://x.com/3"];
    const table = {
      "https://x.com/1": { status: 200 },
      "https://x.com/2": { status: 200 },
      "https://x.com/3": { status: 200 },
    };
    const out = await probeLivenessBatch(urls, { fetchImpl: mockFetch(table) }, 2);
    expect(out.size).toBe(2);
    expect(out.has("https://x.com/3")).toBe(false);
  });

  it("returns an empty map for an empty input", async () => {
    const out = await probeLivenessBatch([], { fetchImpl: mockFetch({}) });
    expect(out.size).toBe(0);
  });
});
