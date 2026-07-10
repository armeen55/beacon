/**
 * safe-source-fetch.test.ts (W5 stop-ship F1, 2026-07-09; P1 complete-SSRF
 * hardening + socket pinning, 2026-07-09).
 *
 * The SSRF seven (all hermetic - resolve + fetchImpl injected, never a real
 * network call):
 *   1. an initial URL whose host literal is private is blocked pre-fetch.
 *   2. a public host that DNS-resolves to a private address is blocked pre-fetch.
 *   3. a public -> public -> private redirect chain is blocked on the hop that
 *      lands private (every hop re-runs the host check).
 *   4. a redirect loop is caught by the visited-URL set.
 *   5. an oversized body aborts as oversized.
 *   6. a disallowed content-type is refused.
 *   7. a valid public https 2xx returns text + finalUrl + status.
 * Plus assertSafeUrl scheme/credentials/port units, the full IPv4/IPv6 CIDR
 * matrix on isBlockedAddress, decimal/octal/hex IPv4 literal hosts (resolved
 * by the WHATWG URL parser before isBlockedAddress ever runs), and the
 * per-hop socket-pinning fix (buildPinnedLookup unit + the pinned-Agent
 * plumbing observed through the injected fetchImpl).
 */
import { describe, it, expect, vi } from "vitest";
import { safeFetchSourceText, assertSafeUrl, isBlockedAddress, buildPinnedLookup } from "./safe-source-fetch";

/** A minimal Response-like stub (no real stream; readCappedBody falls back to
 *  text()). `location`/`content-type` set the corresponding headers. */
function resp(init: {
  status: number;
  body?: string;
  location?: string;
  contentType?: string;
}): Response {
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

/** resolve() from a host->addresses map; throws dns_error semantics via reject. */
function resolverFrom(map: Record<string, string[]>): (host: string) => Promise<string[]> {
  return async (host: string) => {
    const addrs = map[host];
    if (!addrs) throw new Error("ENOTFOUND");
    return addrs;
  };
}

describe("assertSafeUrl (pure)", () => {
  it("accepts a plain https URL", () => {
    const r = assertSafeUrl("https://example.com/page");
    expect(r.ok).toBe(true);
  });
  it("rejects a non-http(s) scheme", () => {
    expect(assertSafeUrl("ftp://example.com").ok).toBe(false);
    expect(assertSafeUrl("file:///etc/passwd")).toEqual({ ok: false, reason: "blocked_scheme" });
    expect(assertSafeUrl("gopher://example.com")).toEqual({ ok: false, reason: "blocked_scheme" });
  });
  it("rejects embedded credentials", () => {
    expect(assertSafeUrl("https://user:pass@example.com/x")).toEqual({
      ok: false,
      reason: "blocked_credentials",
    });
  });
  it("rejects a non-default port", () => {
    expect(assertSafeUrl("http://example.com:8080/x")).toEqual({ ok: false, reason: "blocked_port" });
    expect(assertSafeUrl("https://example.com:8443/x")).toEqual({ ok: false, reason: "blocked_port" });
  });
  it("treats a normalized default port as fine (URL drops :80/:443)", () => {
    expect(assertSafeUrl("http://example.com:80/x").ok).toBe(true);
    expect(assertSafeUrl("https://example.com:443/x").ok).toBe(true);
  });
});

describe("isBlockedAddress (pure)", () => {
  it("blocks IPv4 loopback / private / link-local / CGNAT / multicast / reserved", () => {
    for (const ip of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.5.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  it("allows an ordinary public IPv4", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });
  it("blocks IPv6 loopback / unspecified / ULA / link-local / multicast", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  it("unwraps IPv4-mapped IPv6 and re-checks (dotted + hex)", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true); // 127.0.0.1 hex-mapped
    expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
  });
  it("fails closed on an empty/garbage address", () => {
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
  it("fails closed on a malformed address (bad octet range, wrong group count, leading-zero octal ambiguity)", () => {
    for (const ip of [
      "999.1.1.1", // octet > 255
      "1.1.1", // too few octets
      "1.1.1.1.1", // too many octets
      "192.168.001.001", // leading-zero octal ambiguity - net.isIP rejects
      "1:2:3", // too few IPv6 groups, no "::"
      "1:2:3:4:5:6:7:8:9", // too many groups
      "gggg::1", // non-hex group
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  it("blocks the full IPv4 reserved/CGNAT/benchmarking/documentation/protocol matrix (P1)", () => {
    for (const ip of [
      "0.0.0.0", // this-host
      "0.255.255.255", // 0.0.0.0/8 upper edge
      "100.64.0.0", // CGNAT lower edge
      "100.127.255.255", // CGNAT upper edge
      "192.0.0.5", // IETF protocol assignments 192.0.0.0/24
      "192.0.2.123", // documentation (TEST-NET-1)
      "192.88.99.1", // 6to4 relay anycast (deprecated)
      "198.18.0.0", // benchmarking lower edge
      "198.19.255.255", // benchmarking upper edge
      "198.51.100.77", // documentation (TEST-NET-2)
      "203.0.113.5", // documentation (TEST-NET-3)
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  it("allows the addresses just outside the CGNAT/benchmarking edges (no over-blocking)", () => {
    expect(isBlockedAddress("100.63.255.255")).toBe(false); // just below CGNAT
    expect(isBlockedAddress("100.128.0.0")).toBe(false); // just above CGNAT
    expect(isBlockedAddress("198.17.255.255")).toBe(false); // just below benchmarking
    expect(isBlockedAddress("198.20.0.0")).toBe(false); // just above benchmarking
  });
  it("blocks the full IPv6 discard/protocol/documentation/deprecated-site-local matrix (P1)", () => {
    for (const ip of [
      "100::1", // discard-only 100::/64
      "2001::1", // IETF protocol assignments (covers Teredo 2001::/32)
      "2001:0:1234::1", // Teredo specifically, still within 2001::/23
      "2001:db8::1", // documentation
      "2001:db8:abcd::1", // documentation, deeper address
      "fec0::1", // deprecated site-local
      "ff00::1", // multicast lower edge
      "ffff::1", // multicast upper edge
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });
  it("allows an address just outside the narrow 2001::/23 protocol block (no over-blocking)", () => {
    expect(isBlockedAddress("2001:200::1")).toBe(false);
  });
  it("unwraps IPv4-compatible IPv6 (::a.b.c.d) and re-checks as IPv4", () => {
    expect(isBlockedAddress("::10.1.2.3")).toBe(true); // embedded private
    expect(isBlockedAddress("::0.0.0.1")).toBe(true); // embedded 0.0.0.0/8
    expect(isBlockedAddress("::8.8.4.4")).toBe(false); // embedded public
  });
  it("unwraps NAT64 (64:ff9b::/96) and re-checks the embedded IPv4", () => {
    expect(isBlockedAddress("64:ff9b::c0a8:101")).toBe(true); // hex-embedded 192.168.1.1
    expect(isBlockedAddress("64:ff9b::192.168.1.1")).toBe(true); // dotted-embedded, same address
    expect(isBlockedAddress("64:ff9b::8.8.8.8")).toBe(false); // embedded public
  });
  it("unwraps 6to4 (2002::/16, embedded in bits 16-47) and re-checks the embedded IPv4", () => {
    expect(isBlockedAddress("2002:c0a8:0101::")).toBe(true); // embeds 192.168.1.1
    expect(isBlockedAddress("2002:0808:0404::")).toBe(false); // embeds 8.8.4.4 (public)
  });
});

describe("safeFetchSourceText - decimal/octal/hex IPv4 literal hosts (P1)", () => {
  // The WHATWG URL parser (assertSafeUrl's `new URL()`) normalizes every one
  // of these into the canonical "127.0.0.1" BEFORE isBlockedAddress ever runs
  // - so a model that hands back an obfuscated loopback/metadata literal
  // gains nothing from the encoding.
  it.each([
    ["decimal", "http://2130706433/admin"],
    ["hex", "http://0x7f000001/admin"],
    ["octal", "http://017700000001/admin"],
    ["mixed hex octet", "http://0x7f.0.0.1/admin"],
  ])("blocks a %s-encoded loopback literal before any fetch", async (_label, url) => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText(url, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({}),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks a decimal-encoded metadata-address literal (169.254.169.254 == 2852039166)", async () => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText("http://2852039166/latest/meta-data/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({}),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("safeFetchSourceText - mixed public/private multi-answer DNS", () => {
  it("blocks a host that resolves to a mix of public and private addresses (ANY private blocks all)", async () => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText("https://multi.example/x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "multi.example": ["93.184.216.34", "10.0.0.9", "93.184.216.99"] }),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a host that resolves to several public addresses", async () => {
    const fetchImpl = vi.fn(async () =>
      resp({ status: 200, contentType: "text/html", body: "<html>ok</html>" }),
    );
    const r = await safeFetchSourceText("https://multi-ok.example/x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "multi-ok.example": ["93.184.216.34", "93.184.216.99"] }),
    });
    expect(r.ok).toBe(true);
  });
});

describe("buildPinnedLookup (pure) - the DNS-TOCTOU fix in isolation", () => {
  it("always answers with exactly the pinned address, ignoring the hostname/options it's handed", () => {
    const lookup = buildPinnedLookup("93.184.216.34", 4);
    const callback = vi.fn();
    lookup("totally-different-host.example", { all: true } as unknown as Parameters<typeof lookup>[1], callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });
  it("never reports an error and never consults any real DNS", () => {
    const lookup = buildPinnedLookup("2001:4860:4860::8888", 6);
    const callback = vi.fn();
    lookup("anything", {} as unknown as Parameters<typeof lookup>[1], callback);
    expect(callback).toHaveBeenCalledTimes(1);
    const [err, addrs] = callback.mock.calls[0]!;
    expect(err).toBeNull();
    expect(addrs).toEqual([{ address: "2001:4860:4860::8888", family: 6 }]);
  });
});

describe("safeFetchSourceText - per-hop socket pinning closes the DNS-TOCTOU gap", () => {
  it("preserves the ORIGINAL hostname in the fetched URL while resolving only once (the pinned address never gets re-queried)", async () => {
    const resolve = vi.fn(resolverFrom({ "good.example": ["93.184.216.34"] }));
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit & { dispatcher?: unknown }) =>
      resp({ status: 200, contentType: "text/html", body: "<html>pinned</html>" }),
    );
    const r = await safeFetchSourceText("https://good.example/page", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve,
    });
    expect(r).toEqual({ ok: true, text: "<html>pinned</html>", finalUrl: "https://good.example/page", status: 200 });
    // the URL fetchImpl actually receives keeps the ORIGINAL hostname (SNI/Host) -
    // it is never rewritten to the resolved IP.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0]!;
    expect(String(calledUrl)).toBe("https://good.example/page");
    expect(calledInit?.dispatcher).toBeDefined();
    // exactly one application-level DNS lookup for the whole hop - the fetch
    // itself is pinned to that answer rather than re-resolving at connect time.
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("DNS-rebind simulation: a resolver that would answer PRIVATE on a second call is never asked twice", async () => {
    let calls = 0;
    const resolve = vi.fn(async (host: string) => {
      calls += 1;
      if (calls === 1) return ["93.184.216.34"]; // what validateHop sees and pins
      return ["10.0.0.1"]; // the "rebind": a hostile answer if queried again
    });
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit & { dispatcher?: unknown }) =>
      resp({ status: 200, contentType: "text/html", body: "<html>safe</html>" }),
    );
    const r = await safeFetchSourceText("https://rebind.example/x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve,
    });
    expect(r.ok).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1); // never re-queried, so the "rebind" answer is never seen
  });

  it("a redirect across a hostname change re-validates AND re-pins for the new host", async () => {
    const resolve = vi.fn(
      resolverFrom({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.99"] }),
    );
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit & { dispatcher?: unknown }) => {
        const url = String(input);
        if (url.startsWith("https://a.example")) return resp({ status: 302, location: "https://b.example/next" });
        return resp({ status: 200, contentType: "text/html", body: "<html>b</html>" });
      },
    );
    const r = await safeFetchSourceText("https://a.example/start", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve,
    });
    expect(r).toEqual({ ok: true, text: "<html>b</html>", finalUrl: "https://b.example/next", status: 200 });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls.map((c) => c[0])).toEqual(["a.example", "b.example"]);
    // each hop got its own dispatcher (a fresh pinned Agent, never reused across hosts).
    const dispatchers = fetchImpl.mock.calls.map((c) => c[1]?.dispatcher);
    expect(dispatchers[0]).toBeDefined();
    expect(dispatchers[1]).toBeDefined();
    expect(dispatchers[0]).not.toBe(dispatchers[1]);
  });
});

describe("safeFetchSourceText - the SSRF seven", () => {
  it("1. blocks an initial URL whose host literal is a private IP (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText(
      "http://10.0.0.1/admin",
      { fetchImpl: fetchImpl as unknown as typeof fetch, resolve: resolverFrom({}) },
    );
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("2. blocks a public host that DNS-resolves to a private address (no fetch)", async () => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText("https://intranet.evil.example/x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "intranet.evil.example": ["10.0.0.5"] }),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
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
        "c.example": ["10.10.10.10"], // private -> blocked before the 3rd fetch
      }),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    // fetched a and b only; c was blocked at the host check before any request.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("4. catches a redirect loop via the visited-URL set", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://a.example")) return resp({ status: 302, location: "https://b.example/x" });
      if (url.startsWith("https://b.example")) return resp({ status: 302, location: "https://a.example/start" });
      throw new Error("unexpected");
    });
    const r = await safeFetchSourceText("https://a.example/start", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.35"] }),
    });
    expect(r).toEqual({ ok: false, reason: "redirect_loop" });
  });

  it("5. aborts an oversized body", async () => {
    const fetchImpl = vi.fn(async () =>
      resp({ status: 200, contentType: "text/html", body: "x".repeat(5000) }),
    );
    const r = await safeFetchSourceText(
      "https://ok.example/big",
      { fetchImpl: fetchImpl as unknown as typeof fetch, resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }) },
      { maxBytes: 1000 },
    );
    expect(r).toEqual({ ok: false, reason: "oversized" });
  });

  it("5b. aborts an ENDLESS streamed body (cancels the reader once maxBytes is exceeded, never buffers it all)", async () => {
    let cancelled = false;
    let chunksProduced = 0;
    const endlessBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksProduced += 1;
        controller.enqueue(new TextEncoder().encode("y".repeat(2000)));
        // A real endless body never calls controller.close() on its own -
        // only reader.cancel() (triggered by the overflow) ends it.
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
    // aborted within a handful of 2000-byte chunks past the 3000-byte cap,
    // never buffering the whole (infinite) stream.
    expect(chunksProduced).toBeLessThan(10);
  });

  it("6. refuses a disallowed content-type", async () => {
    const fetchImpl = vi.fn(async () =>
      resp({ status: 200, contentType: "application/pdf", body: "%PDF-1.4" }),
    );
    const r = await safeFetchSourceText("https://ok.example/file.pdf", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }),
    });
    expect(r).toEqual({ ok: false, reason: "wrong_content_type" });
  });

  it("6b. refuses a response with NO content-type header (fail closed, never presumed text)", async () => {
    const fetchImpl = vi.fn(async () => resp({ status: 200, body: "<html>unlabeled</html>" }));
    const r = await safeFetchSourceText("https://ok.example/no-ct", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }),
    });
    expect(r).toEqual({ ok: false, reason: "wrong_content_type" });
  });

  it("7. returns text + finalUrl + status for a valid public https 2xx", async () => {
    const fetchImpl = vi.fn(async () =>
      resp({ status: 200, contentType: "text/html; charset=utf-8", body: "<html>hello</html>" }),
    );
    const r = await safeFetchSourceText("https://good.example/page", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "good.example": ["93.184.216.34"] }),
    });
    expect(r).toEqual({
      ok: true,
      text: "<html>hello</html>",
      finalUrl: "https://good.example/page",
      status: 200,
    });
  });
});

describe("safeFetchSourceText - metadata + redirect-scheme guards", () => {
  it("refuses the cloud-metadata hostname before DNS", async () => {
    const fetchImpl = vi.fn();
    const r = await safeFetchSourceText("http://metadata.google.internal/computeMetadata/v1/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({}),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_private" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a non-http(s) scheme", async () => {
    const fetchImpl = vi.fn(async () => resp({ status: 302, location: "file:///etc/passwd" }));
    const r = await safeFetchSourceText("https://ok.example/x", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolve: resolverFrom({ "ok.example": ["93.184.216.34"] }),
    });
    expect(r).toEqual({ ok: false, reason: "blocked_scheme" });
  });

  it("gives up after too many redirects", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => resp({ status: 302, location: `https://hop${n++}.example/x` }));
    const r = await safeFetchSourceText(
      "https://start.example/x",
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolve: async () => ["93.184.216.34"], // every hop resolves public
      },
      { maxRedirects: 2 },
    );
    expect(r).toEqual({ ok: false, reason: "too_many_redirects" });
  });
});
