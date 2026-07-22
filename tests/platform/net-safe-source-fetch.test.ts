/**
 * PLATFORM — safe-source-fetch SSRF guard (Core 100K terminal suite; trimmed
 * from src/lib/net/safe-source-fetch.test.ts, keeping every named boundary:
 * the SSRF seven, socket pinning against DNS rebind, encoded-literal hosts,
 * and the blocked-address matrix condensed to representatives per range).
 * All hermetic: resolve + fetchImpl injected, never a real network call.
 */

import { describe, it, expect, vi } from "vitest";
import { safeFetchSourceText, assertSafeUrl, isBlockedAddress, buildPinnedLookup } from "@/lib/net/safe-source-fetch";

function resp(init: { status: number; body?: string; location?: string; contentType?: string }): Response {
  const headers = new Map<string, string>();
  if (init.location) headers.set("location", init.location);
  if (init.contentType) headers.set("content-type", init.contentType);
  return {
    status: init.status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: null,
    text: async () => init.body ?? "",
  } as unknown as Response;
}

function resolverFrom(map: Record<string, string[]>): (host: string) => Promise<string[]> {
  return async (host: string) => {
    const addrs = map[host];
    if (!addrs) throw new Error("ENOTFOUND");
    return addrs;
  };
}

describe("assertSafeUrl (pure)", () => {
  it("accepts plain http(s); rejects other schemes, embedded credentials, and non-default ports", () => {
    expect(assertSafeUrl("https://example.com/page").ok).toBe(true);
    expect(assertSafeUrl("http://example.com:80/x").ok).toBe(true);
    expect(assertSafeUrl("file:///etc/passwd")).toEqual({ ok: false, reason: "blocked_scheme" });
    expect(assertSafeUrl("https://user:pass@example.com/x")).toEqual({ ok: false, reason: "blocked_credentials" });
    expect(assertSafeUrl("http://example.com:8080/x")).toEqual({ ok: false, reason: "blocked_port" });
  });
});

describe("isBlockedAddress (pure)", () => {
  it("blocks the IPv4 private/reserved matrix and allows ordinary public addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.5.5",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "192.0.2.123", // TEST-NET-1
      "198.18.0.0", // benchmarking
      "203.0.113.5", // TEST-NET-3
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    // Edges just outside the blocks are NOT over-blocked.
    expect(isBlockedAddress("100.63.255.255")).toBe(false);
    expect(isBlockedAddress("198.20.0.0")).toBe(false);
  });

  it("blocks the IPv6 matrix and unwraps mapped/NAT64/6to4 embeddings before re-checking", () => {
    for (const ip of ["::1", "::", "fc00::1", "fe80::1", "ff02::1", "100::1", "2001:db8::1", "fec0::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
    expect(isBlockedAddress("64:ff9b::c0a8:101")).toBe(true); // NAT64-embedded 192.168.1.1
    expect(isBlockedAddress("64:ff9b::8.8.8.8")).toBe(false);
    expect(isBlockedAddress("2002:c0a8:0101::")).toBe(true); // 6to4-embedded 192.168.1.1
    expect(isBlockedAddress("2002:0808:0404::")).toBe(false);
  });

  it("fails closed on garbage or malformed addresses", () => {
    for (const ip of ["", "not-an-ip", "999.1.1.1", "1.1.1", "192.168.001.001", "gggg::1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });
});

describe("encoded IPv4 literal hosts are canonicalized before the block check", () => {
  it.each([
    ["decimal", "http://2130706433/admin"],
    ["hex", "http://0x7f000001/admin"],
    ["octal", "http://017700000001/admin"],
    ["decimal metadata", "http://2852039166/latest/meta-data/"],
  ])("blocks a %s-encoded private literal before any fetch", async (_label, url) => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText(url, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({}),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("socket pinning closes the DNS-TOCTOU gap", () => {
  it("buildPinnedLookup always answers with exactly the pinned address", () => {
    const lookup = buildPinnedLookup("93.184.216.34", 4);
    const callback = vi.fn();
    lookup("totally-different-host.example", { all: true } as unknown as Parameters<typeof lookup>[1], callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("DNS-rebind simulation: a resolver that would answer PRIVATE on a second call is never asked twice", async () => {
    let calls = 0;
    const resolve = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? ["93.184.216.34"] : ["10.0.0.1"];
    });
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit & { dispatcher?: unknown }) =>
      resp({ status: 200, contentType: "text/html", body: "<html>safe</html>" }),
    );
    const r = await safeFetchSourceText("https://rebind.example/x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve,
    });
    expect(r.ok).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
    // The fetched URL keeps the ORIGINAL hostname (SNI/Host) with a pinned dispatcher.
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe("https://rebind.example/x");
    expect(calledInit?.dispatcher).toBeDefined();
  });

  it("a redirect across a hostname change re-validates AND re-pins for the new host", async () => {
    const resolve = vi.fn(resolverFrom({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.99"] }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit & { dispatcher?: unknown }) => {
      const url = String(input);
      if (url.startsWith("https://a.example")) return resp({ status: 302, location: "https://b.example/next" });
      return resp({ status: 200, contentType: "text/html", body: "<html>b</html>" });
    });
    const r = await safeFetchSourceText("https://a.example/start", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve,
    });
    expect(r).toEqual({ ok: true, text: "<html>b</html>", finalUrl: "https://b.example/next", status: 200 });
    expect(resolve.mock.calls.map((c) => c[0])).toEqual(["a.example", "b.example"]);
    const dispatchers = fetchImpl.mock.calls.map((c) => c[1]?.dispatcher);
    expect(dispatchers[0]).not.toBe(dispatchers[1]);
  });
});

describe("the SSRF seven", () => {
  it("1+2. blocks a private host literal AND a public host that resolves private (no fetch)", async () => {
    const fetchImpl = vi.fn();
    expect(
      await safeFetchSourceText("http://10.0.0.1/admin", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: resolverFrom({}),
      }),
    ).toEqual({ ok: false, reason: "blocked_private" });
    expect(
      await safeFetchSourceText("https://intranet.evil.example/x", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: resolverFrom({ "intranet.evil.example": ["10.0.0.5"] }),
      }),
    ).toEqual({ ok: false, reason: "blocked_private" });
    // ANY private answer in a mixed public/private DNS reply blocks the whole host.
    expect(
      await safeFetchSourceText("https://multi.example/x", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: resolverFrom({ "multi.example": ["93.184.216.34", "10.0.0.9"] }),
      }),
    ).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("3. blocks a public -> public -> private redirect chain on the private hop", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://a.example")) return resp({ status: 302, location: "https://b.example/next" });
      if (url.startsWith("https://b.example")) return resp({ status: 302, location: "https://c.example/final" });
      throw new Error("should never fetch the private host");
    });
    const r = await safeFetchSourceText("https://a.example/start", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({
        "a.example": ["93.184.216.34"],
        "b.example": ["93.184.216.35"],
        "c.example": ["10.10.10.10"],
      }),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("4. catches a redirect loop and gives up after too many redirects", async () => {
    const loopFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://a.example")) return resp({ status: 302, location: "https://b.example/x" });
      return resp({ status: 302, location: "https://a.example/start" });
    });
    expect(
      await safeFetchSourceText("https://a.example/start", {
        fetchImpl: loopFetch as unknown as typeof fetch,
        resolve: resolverFrom({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.35"] }),
      }),
    ).toEqual({ ok: false, reason: "redirect_loop" });

    let n = 0;
    const hopFetch = vi.fn(async () => resp({ status: 302, location: `https://hop${n++}.example/x` }));
    expect(
      await safeFetchSourceText(
        "https://start.example/x",
        { fetchImpl: hopFetch as unknown as typeof fetch, resolve: async () => ["93.184.216.34"] },
        { maxRedirects: 2 },
      ),
    ).toEqual({ ok: false, reason: "too_many_redirects" });
  });

  it("5. aborts an oversized body, including an ENDLESS stream (cancels, never buffers it all)", async () => {
    let cancelled = false;
    let chunksProduced = 0;
    const endlessBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced += 1;
        controller.enqueue(new TextEncoder().encode("y".repeat(2000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => {
      const headers = new Map([["content-type", "text/html"]]);
      return {
        status: 200,
        headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
        body: endlessBody,
        text: async () => "unused",
      } as unknown as Response;
    });
    const r = await safeFetchSourceText(
      "https://endless.example/stream",
      { fetchImpl: fetchImpl as unknown as typeof fetch, resolve: resolverFrom({ "endless.example": ["93.184.216.34"] }) },
      { maxBytes: 3000 },
    );
    expect(r).toEqual({ ok: false, reason: "oversized" });
    expect(cancelled).toBe(true);
    expect(chunksProduced).toBeLessThan(10);
  });

  it("6. refuses a disallowed content-type AND a missing content-type header (fail closed)", async () => {
    const pdf = vi.fn(async () => resp({ status: 200, contentType: "application/pdf", body: "%PDF-1.4" }));
    expect(
      await safeFetchSourceText("https://ok.example/file.pdf", {
        fetchImpl: pdf as unknown as typeof fetch,
        resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }),
      }),
    ).toEqual({ ok: false, reason: "wrong_content_type" });
    const unlabeled = vi.fn(async () => resp({ status: 200, body: "<html>unlabeled</html>" }));
    expect(
      await safeFetchSourceText("https://ok.example/no-ct", {
        fetchImpl: unlabeled as unknown as typeof fetch,
        resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }),
      }),
    ).toEqual({ ok: false, reason: "wrong_content_type" });
  });

  it("7. returns text + finalUrl + status for a valid public https 2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      resp({ status: 200, contentType: "text/html; charset=utf-8", body: "<html>hello</html>" }),
    );
    expect(
      await safeFetchSourceText("https://good.example/page", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: resolverFrom({ "good.example": ["93.184.216.34"] }),
      }),
    ).toEqual({ ok: true, text: "<html>hello</html>", finalUrl: "https://good.example/page", status: 200 });
  });
});

describe("metadata + status mapping guards", () => {
  it("refuses the cloud-metadata hostname before DNS and a redirect to a non-http(s) scheme", async () => {
    const noFetch = vi.fn();
    expect(
      await safeFetchSourceText("http://metadata.google.internal/computeMetadata/v1/", {
        fetchImpl: noFetch as unknown as typeof fetch,
        resolve: resolverFrom({}),
      }),
    ).toEqual({ ok: false, reason: "blocked_private" });
    expect(noFetch).not.toHaveBeenCalled();

    const fileRedirect = vi.fn(async () => resp({ status: 302, location: "file:///etc/passwd" }));
    expect(
      await safeFetchSourceText("https://ok.example/x", {
        fetchImpl: fileRedirect as unknown as typeof fetch,
        resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }),
      }),
    ).toEqual({ ok: false, reason: "blocked_scheme" });
  });

  it("403/401/429/451 map to access_blocked; 404/500 stay fetch_failed; DNS failure is dns_error", async () => {
    const resolve = resolverFrom({ "blocked.example": ["93.184.216.34"] });
    const fetchStatus = (status: number) => (async () => resp({ status })) as unknown as typeof fetch;
    for (const s of [403, 401, 429, 451]) {
      expect(await safeFetchSourceText("https://blocked.example/x", { fetchImpl: fetchStatus(s), resolve })).toEqual({
        ok: false,
        reason: "access_blocked",
      });
    }
    for (const s of [404, 500]) {
      expect(await safeFetchSourceText("https://blocked.example/x", { fetchImpl: fetchStatus(s), resolve })).toEqual({
        ok: false,
        reason: "fetch_failed",
      });
    }
    expect(
      await safeFetchSourceText("https://nope.example/x", { fetchImpl: fetchStatus(200), resolve: resolverFrom({}) }),
    ).toEqual({ ok: false, reason: "dns_error" });
  });
});
