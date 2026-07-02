import { describe, it, expect, vi, beforeEach } from "vitest";

// json-store persistence is mocked so tests never touch disk, mirrors the
// convention used by wikipedia-client's sibling tests (in-memory Map keyed
// by store name, injected via vi.mock before the module under test imports).
const mockStores = new Map<string, unknown[]>();

vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async (name: string, fallback: unknown[] = []) => {
    return mockStores.get(name) ?? fallback;
  }),
  writeStore: vi.fn(async (name: string, data: unknown[]) => {
    mockStores.set(name, data);
  }),
}));

import {
  matchWikidataEntity,
  scoreWikidataCandidates,
} from "./client";

function fakeSleep() {
  return Promise.resolve();
}

function fixedNow(iso: string) {
  return () => new Date(iso);
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockStores.clear();
  vi.clearAllMocks();
});

describe("scoreWikidataCandidates (pure confidence scoring)", () => {
  it("returns confidence 'none' for an empty candidate list", () => {
    const result = scoreWikidataCandidates("Jonas Kettering", []);
    expect(result.confidence).toBe("none");
    expect(result.qid).toBeNull();
  });

  it("'high' confidence: exact label match corroborated by a keyword hint in the description", () => {
    const result = scoreWikidataCandidates(
      "Jonas Kettering",
      [
        {
          id: "Q999001",
          label: "Jonas Kettering",
          description: "20th-century poet",
        },
      ],
      ["poet"],
    );
    expect(result.confidence).toBe("high");
    expect(result.qid).toBe("Q999001");
    expect(result.wikidataUrl).toBe("https://www.wikidata.org/wiki/Q999001");
  });

  it("'needs-confirm': exact label match but no corroborating keyword hint", () => {
    const result = scoreWikidataCandidates(
      "Jonas Kettering",
      [
        {
          id: "Q999001",
          label: "Jonas Kettering",
          description: "a fictional character",
        },
      ],
      ["poet"],
    );
    expect(result.confidence).toBe("needs-confirm");
  });

  it("'needs-confirm': exact label match with NO keyword hints supplied at all", () => {
    const result = scoreWikidataCandidates("Jonas Kettering", [
      { id: "Q999001", label: "Jonas Kettering", description: "a poet" },
    ]);
    expect(result.confidence).toBe("needs-confirm");
  });

  it("'needs-confirm': only a near/alias match, not an exact top-candidate label match", () => {
    const result = scoreWikidataCandidates(
      "Jonas Ketering", // typo vs the candidate's real label
      [{ id: "Q999002", label: "Jonas Ketterling", description: "a poet" }],
      ["poet"],
    );
    expect(result.confidence).toBe("needs-confirm");
  });

  it("matches via an alias, not just the primary label", () => {
    const result = scoreWikidataCandidates(
      "J. Kettering",
      [
        {
          id: "Q999001",
          label: "Jonas Kettering",
          description: "a poet",
          aliases: ["J. Kettering"],
        },
      ],
      ["poet"],
    );
    expect(result.confidence).toBe("high");
    expect(result.qid).toBe("Q999001");
  });

  it("carries a Wikipedia sitelink URL only when the candidate itself returned one", () => {
    const withSitelink = scoreWikidataCandidates(
      "Jonas Kettering",
      [
        {
          id: "Q999001",
          label: "Jonas Kettering",
          description: "a poet",
          url: "//en.wikipedia.org/wiki/Jonas_Kettering",
        },
      ],
      ["poet"],
    );
    expect(withSitelink.wikipediaUrl).toBe(
      "//en.wikipedia.org/wiki/Jonas_Kettering",
    );

    const withoutSitelink = scoreWikidataCandidates(
      "Jonas Kettering",
      [{ id: "Q999001", label: "Jonas Kettering", description: "a poet" }],
      ["poet"],
    );
    expect(withoutSitelink.wikipediaUrl).toBeNull();
  });
});

describe("matchWikidataEntity (fetch + cache, mocked network)", () => {
  it("returns 'none' confidence for an empty name without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await matchWikidataEntity("  ", [], { fetchImpl, sleep: fakeSleep });
    expect(result.confidence).toBe("none");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls the live wbsearchentities endpoint exactly once for a fresh name", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        search: [
          { id: "Q999001", label: "Jonas Kettering", description: "a poet" },
        ],
      }),
    );
    const result = await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
      now: fixedNow("2026-07-02T00:00:00.000Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("wbsearchentities");
    expect(String(url)).toContain(encodeURIComponent("Jonas Kettering"));
    expect((init as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringContaining("BeaconBot"),
    });
    expect(result.confidence).toBe("high");
    expect(result.qid).toBe("Q999001");
  });

  it("serves a cached match within 30 days WITHOUT re-calling fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        search: [
          { id: "Q999001", label: "Jonas Kettering", description: "a poet" },
        ],
      }),
    );
    const now = fixedNow("2026-07-02T00:00:00.000Z");
    await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
      now,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A second lookup 10 days later, same name, must be served from cache.
    const laterNow = fixedNow("2026-07-12T00:00:00.000Z");
    const cached = await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
      now: laterNow,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still 1, no new network call
    expect(cached.qid).toBe("Q999001");
  });

  it("re-fetches once the 30-day cache TTL has expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        search: [
          { id: "Q999001", label: "Jonas Kettering", description: "a poet" },
        ],
      }),
    );
    await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
      now: fixedNow("2026-07-02T00:00:00.000Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 31 days later, cache entry has expired.
    await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
      now: fixedNow("2026-08-02T00:00:00.000Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches a miss (empty search results) so a dead name isn't re-probed within the TTL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ search: [] }));
    await matchWikidataEntity("Totally Unknown Person", [], {
      fetchImpl,
      sleep: fakeSleep,
      now: fixedNow("2026-07-02T00:00:00.000Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const secondCall = await matchWikidataEntity("Totally Unknown Person", [], {
      fetchImpl,
      sleep: fakeSleep,
      now: fixedNow("2026-07-05T00:00:00.000Z"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(secondCall.confidence).toBe("none");
  });

  it("fails soft to 'none' confidence on a network error, never throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
    });
    expect(result.confidence).toBe("none");
  });

  it("fails soft to 'none' confidence on a non-ok HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false));
    const result = await matchWikidataEntity("Jonas Kettering", ["poet"], {
      fetchImpl,
      sleep: fakeSleep,
    });
    expect(result.confidence).toBe("none");
  });

  it("cache key is case-insensitive on the queried name", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        search: [
          { id: "Q999001", label: "Jonas Kettering", description: "a poet" },
        ],
      }),
    );
    const now = fixedNow("2026-07-02T00:00:00.000Z");
    await matchWikidataEntity("Jonas Kettering", ["poet"], { fetchImpl, sleep: fakeSleep, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await matchWikidataEntity("JONAS KETTERING", ["poet"], { fetchImpl, sleep: fakeSleep, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cache hit, case-insensitive
  });
});
