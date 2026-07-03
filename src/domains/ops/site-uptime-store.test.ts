import { describe, it, expect, vi } from "vitest";

import { homepageUrlForDomain, probeHomepage } from "./site-uptime-store";

function response(status: number): Response {
  return { status } as Response;
}

describe("homepageUrlForDomain", () => {
  it("builds https from a bare domain", () => {
    expect(homepageUrlForDomain("iranopedia.com")).toBe("https://iranopedia.com/");
  });
  it("keeps an explicit scheme", () => {
    expect(homepageUrlForDomain("http://www.ritzbuilders.com")).toBe("http://www.ritzbuilders.com/");
  });
  it("refuses empty and placeholder domains", () => {
    expect(homepageUrlForDomain("")).toBeNull();
    expect(homepageUrlForDomain("   ")).toBeNull();
    expect(homepageUrlForDomain(null)).toBeNull();
    expect(homepageUrlForDomain("example.com")).toBeNull();
    expect(homepageUrlForDomain("www.example.com")).toBeNull();
  });
});

describe("probeHomepage", () => {
  it("records an ok probe with status + time to first byte", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => response(200));
    const out = await probeHomepage("https://iranopedia.com/", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(out.error).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ method: "HEAD" });
  });

  it("retries once as GET when the host rejects HEAD", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(405))
      .mockResolvedValueOnce(response(200));
    const out = await probeHomepage("https://iranopedia.com/", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]).toMatchObject({ method: "GET" });
  });

  it("a 5xx answer is not ok but still carries the status", async () => {
    const fetchImpl = vi.fn(async () => response(503));
    const out = await probeHomepage("https://iranopedia.com/", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(503);
  });

  it("a thrown fetch (DNS dead, TLS expired, refused) records the error and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed: certificate has expired");
    });
    const out = await probeHomepage("https://iranopedia.com/", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.ok).toBe(false);
    expect(out.status).toBeNull();
    expect(out.error).toContain("certificate has expired");
  });

  it("a timeout records a plain no-answer error", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const out = await probeHomepage("https://iranopedia.com/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(out.ok).toBe(false);
    expect(out.error).toBe("no answer within 0s");
  });
});
