/**
 * IndexNow protocol client (BEACON_500 item 75, 2026-07-02).
 *
 * Pins: exact payload shape (host/key/keyLocation/urlList), 200 and 202 both
 * count as success, one retry on failure then give up, and the client NEVER
 * throws regardless of network outcome.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { pingIndexNow, pingIndexNowForUrl } from "@/lib/connectors/indexnow/client";

function fetchReturning(...responses: Array<{ ok: boolean; status: number }>) {
  let call = 0;
  const mockFn = vi.fn(async (_url: unknown, _init?: unknown) => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: r.ok, status: r.status } as Response;
  });
  return mockFn as unknown as typeof fetch & typeof mockFn;
}

describe("pingIndexNow", () => {
  it("POSTs the exact protocol payload shape to api.indexnow.org", async () => {
    const fetchImpl = fetchReturning({ ok: true, status: 200 });
    await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      host: "example.com",
      key: "abc12345",
      urlList: ["https://example.com/a"],
    });
  });

  it("includes keyLocation only when provided", async () => {
    const fetchImpl = fetchReturning({ ok: true, status: 200 });
    await pingIndexNow(
      {
        host: "example.com",
        key: "abc12345",
        keyLocation: "https://example.com/custom/abc12345.txt",
        urlList: ["https://example.com/a"],
      },
      fetchImpl,
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init?.body));
    expect(body.keyLocation).toBe("https://example.com/custom/abc12345.txt");
  });

  it("treats both 200 and 202 as success", async () => {
    const fetch200 = fetchReturning({ ok: true, status: 200 });
    const r200 = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetch200,
    );
    expect(r200).toEqual({ ok: true, status: 200 });

    const fetch202 = fetchReturning({ ok: true, status: 202 });
    const r202 = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetch202,
    );
    expect(r202).toEqual({ ok: true, status: 202 });
  });

  it("retries exactly once on failure, then reports failure without throwing", async () => {
    const fetchImpl = fetchReturning({ ok: false, status: 500 }, { ok: false, status: 500 });
    const result = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
  });

  it("succeeds on the retry if the second attempt lands", async () => {
    const fetchImpl = fetchReturning({ ok: false, status: 503 }, { ok: true, status: 200 });
    const result = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, status: 200 });
  });

  it("never throws on a network error (fail-soft)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await pingIndexNow(
      { host: "example.com", key: "abc12345", urlList: ["https://example.com/a"] },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
  });
});

describe("pingIndexNowForUrl", () => {
  it("derives host from the URL", async () => {
    const fetchImpl = fetchReturning({ ok: true, status: 200 });
    const result = await pingIndexNowForUrl(
      { url: "https://sub.example.com/page-a", key: "abc12345" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init?.body));
    expect(body.host).toBe("sub.example.com");
    expect(body.urlList).toEqual(["https://sub.example.com/page-a"]);
  });

  it("fails soft on an invalid URL without throwing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await pingIndexNowForUrl(
      { url: "not-a-url", key: "abc12345" },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
