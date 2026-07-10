/**
 * safe-source-fetch.test.ts (W5 stop-ship F1, 2026-07-09).
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
 * Plus assertSafeUrl scheme/credentials/port units.
 */
import { describe, it, expect, vi } from "vitest";
import { safeFetchSourceText, assertSafeUrl, isBlockedAddress } from "./safe-source-fetch";

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
