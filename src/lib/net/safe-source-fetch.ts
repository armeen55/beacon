import "server-only";

import { lookup } from "node:dns/promises";

/**
 * safe-source-fetch (W5 stop-ship F1, 2026-07-09) - the SSRF-safe outbound
 * fetcher for LLM-PROPOSED source URLs. A structured draft's cited source URL
 * is untrusted, model-generated text; fetching it to verify a claim is a
 * server-side request whose destination the attacker (the model, or a
 * poisoned brief) partially controls. That is exactly the shape of an SSRF:
 * a URL that points at 169.254.169.254 (cloud metadata), 127.0.0.1, an
 * internal 10.x service, or a public host that DNS-resolves to a private
 * address, and then a naive follow-redirect fetch happily reaches it.
 *
 * This module is the ONLY thing allowed to fetch a source URL. It is
 * DEDICATED and separate from competitor-intel/polite-fetch.ts on purpose:
 * that crawler keeps redirect:"follow" because it only ever crawls the
 * tenant's OWN host-checked domain; this one fetches arbitrary model-proposed
 * hosts, so it does manual, host-revalidated-per-hop redirects and fails
 * closed on anything private/reserved.
 *
 * Per-hop algorithm (initial request AND every redirect target re-run the
 * full check before a byte is sent):
 *   1. assertSafeUrl - http/https only, no user:pass@ credentials, no
 *      non-default/unsafe port.
 *   2. resolve the host and run EVERY returned A/AAAA address (plus a
 *      host-literal IP) through isBlockedAddress; ANY private/reserved
 *      address fails the whole fetch closed (blocked_private). Metadata
 *      hostnames are rejected pre-DNS.
 *   3. fetch the ONE hop with redirect:"manual", an identified UA, and a
 *      per-hop AbortSignal timeout, tracking a running total against the
 *      overall deadline.
 *   4. a 3xx absolutizes Location and RE-RUNS steps 1-2 on the target before
 *      the next hop (bounded by maxRedirects + a visited-URL set for loops);
 *      a non-http(s) Location is refused.
 *   5. a 2xx checks the content-type allowlist, then streams the body up to
 *      maxBytes and aborts on overflow.
 *
 * Never logs credentials or response bodies (callers get a host + reason
 * only). Pure exports assertSafeUrl / isBlockedAddress are unit-tested on
 * their own; the whole flow is hermetic under injected resolve + fetchImpl.
 *
 * DNS TOCTOU residual (documented, deliberately NOT closed here): step 2
 * resolves the host and validates every returned address, then hands the
 * HOSTNAME (not a pinned IP) to fetch, which re-resolves at connect time
 * (undici). A hostile authoritative server can return a public address to our
 * resolve() call and a private one microseconds later at connect (classic DNS
 * rebinding). Fully closing this requires a custom undici Agent whose own
 * `lookup` returns ONLY the address we already validated (pinning the socket
 * to the checked IP). We intentionally do not implement that here: the
 * validate-then-fetch pass, applied to the initial host AND every redirect
 * hop, already raises the bar substantially while staying dependency-light.
 * The hardening path is a pinned-lookup Agent when this fetcher graduates
 * beyond source-verification.
 */

const SOURCE_VERIFY_UA = "BeaconBot/1.0 (source-verify)";
const DEFAULT_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"] as const;

/** Named hosts refused BEFORE any DNS lookup (cloud metadata + loopback). */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata",
  "localhost",
]);

export type SafeFetchReason =
  | "blocked_scheme"
  | "blocked_credentials"
  | "blocked_port"
  | "blocked_private"
  | "dns_error"
  | "too_many_redirects"
  | "redirect_loop"
  | "oversized"
  | "wrong_content_type"
  | "timeout"
  | "deadline_exceeded"
  | "fetch_failed";

export type SafeFetchResult =
  | { ok: true; text: string; finalUrl: string; status: number }
  | { ok: false; reason: SafeFetchReason };

export type SafeFetchDeps = {
  /** Injectable transport. Default = global fetch, ALWAYS called redirect:"manual". */
  fetchImpl?: typeof fetch;
  /** Injectable resolver. Default = node dns lookup(host,{all:true}) -> every A/AAAA. */
  resolve?: (host: string) => Promise<string[]>;
  /** Injectable clock (ms epoch), for the overall deadline. Default = Date.now. */
  now?: () => number;
};

export type SafeFetchOptions = {
  /** Per-hop request timeout. Default 8s. */
  timeoutMs?: number;
  /** Total wall-clock budget across all hops. Default 15s. */
  deadlineMs?: number;
  /** Maximum redirects to follow before giving up. Default 3. */
  maxRedirects?: number;
  /** Maximum body bytes to read before aborting as oversized. Default 2MB. */
  maxBytes?: number;
  /** Content-types allowed on a 2xx. Default html/xhtml/plain. */
  allowedContentTypes?: readonly string[];
};

export type AssertSafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: "blocked_scheme" | "blocked_credentials" | "blocked_port" };

/**
 * Pure URL policy check: http/https scheme only, no embedded credentials,
 * and no non-default port (URL normalizes 80/443 to empty, so any non-empty
 * port is an explicit non-standard one). Never throws.
 */
export function assertSafeUrl(raw: string): AssertSafeUrlResult {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // An unparseable URL cannot be proven safe; refuse it as a bad scheme.
    return { ok: false, reason: "blocked_scheme" };
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return { ok: false, reason: "blocked_scheme" };
  if (u.username !== "" || u.password !== "") return { ok: false, reason: "blocked_credentials" };
  // URL() drops a default port (80 for http, 443 for https) to "", so a
  // non-empty port here is always an explicit non-standard/unsafe one.
  if (u.port !== "") return { ok: false, reason: "blocked_port" };
  return { ok: true, url: u };
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true; // malformed -> fail closed
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host" / unspecified
  if (a === 127) return true; // 127/8 loopback
  if (a === 10) return true; // 10/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224 && a <= 239) return true; // 224/4 multicast
  if (a >= 240) return true; // 240/4 reserved (incl. 255.255.255.255 broadcast)
  return false;
}

function isBlockedIPv6(raw: string): boolean {
  let addr = raw.trim().toLowerCase();
  const zone = addr.indexOf("%"); // strip any scope-id
  if (zone >= 0) addr = addr.slice(0, zone);
  addr = addr.replace(/^\[/, "").replace(/\]$/, "");
  // IPv4-mapped IPv6, dotted (::ffff:a.b.c.d) - unwrap and re-check as IPv4.
  const mappedDotted = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isBlockedIPv4(mappedDotted[1]!);
  // IPv4-mapped IPv6, hex form (::ffff:7f00:1) - unwrap and re-check as IPv4.
  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIPv4(v4);
  }
  if (addr === "::1") return true; // loopback
  if (addr === "::") return true; // unspecified
  const first = addr.split(":")[0] ?? "";
  if (/^f[cd]/.test(first)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(first)) return true; // fe80::/10 link-local
  if (/^ff/.test(first)) return true; // ff00::/8 multicast
  return false;
}

/**
 * Pure predicate: is this resolved IP a private/reserved/loopback/link-local/
 * metadata address we must never fetch? Handles IPv4, IPv6, and IPv4-mapped
 * IPv6 (unwrapped and re-checked). Fails CLOSED on anything unparseable.
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = (ip ?? "").trim().toLowerCase();
  if (!addr) return true; // fail closed on an empty/unknown address
  if (addr.includes(":")) return isBlockedIPv6(addr);
  return isBlockedIPv4(addr);
}

/** True when `host` is a metadata/loopback hostname refused before DNS. */
function isBlockedHostname(host: string): boolean {
  const h = host.replace(/\.$/, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  return h === "localhost" || h.endsWith(".localhost");
}

/** The bare IP string when `host` is an IP literal (IPv4 dotted or bracketed
 *  IPv6), else null (a name that must be resolved). */
function hostLiteralIp(host: string): string | null {
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return host;
  return null;
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

type BodyReadResult = { ok: true; text: string } | { ok: false; reason: "oversized" | "fetch_failed" };

/** Stream a response body up to `maxBytes`, aborting on overflow. Falls back to
 *  `res.text()` (size-guarded) when the response exposes no readable stream. */
async function readCappedBody(res: Response, maxBytes: number): Promise<BodyReadResult> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    try {
      const t = await res.text();
      if (Buffer.byteLength(t, "utf8") > maxBytes) return { ok: false, reason: "oversized" };
      return { ok: true, text: t };
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return { ok: false, reason: "oversized" };
        }
        chunks.push(Buffer.from(value));
      }
    }
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

/** Validate one host (initial or redirect target): scheme/creds/port, metadata
 *  hostname, and every resolved (or literal) IP. Returns the parsed URL or a
 *  failure reason. */
async function validateHop(
  raw: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<{ ok: true; url: URL } | { ok: false; reason: SafeFetchReason }> {
  const safe = assertSafeUrl(raw);
  if (!safe.ok) return safe;
  const u = safe.url;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedHostname(host)) return { ok: false, reason: "blocked_private" };
  const literal = hostLiteralIp(host);
  if (literal != null) {
    if (isBlockedAddress(literal)) return { ok: false, reason: "blocked_private" };
    return { ok: true, url: u };
  }
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    return { ok: false, reason: "dns_error" };
  }
  if (!addrs || addrs.length === 0) return { ok: false, reason: "dns_error" };
  for (const a of addrs) {
    if (isBlockedAddress(a)) return { ok: false, reason: "blocked_private" };
  }
  return { ok: true, url: u };
}

/**
 * SSRF-safe fetch of an untrusted source URL's visible bytes. See the module
 * doc for the per-hop algorithm and the documented DNS-TOCTOU residual.
 * Never throws; every failure resolves to a typed `{ ok: false, reason }`.
 */
export async function safeFetchSourceText(
  url: string,
  deps: SafeFetchDeps = {},
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolve = deps.resolve ?? defaultResolve;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? 8000;
  const deadlineMs = opts.deadlineMs ?? 15000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const allowed = opts.allowedContentTypes ?? DEFAULT_CONTENT_TYPES;

  const startedAt = now();
  const visited = new Set<string>();
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (now() - startedAt > deadlineMs) return { ok: false, reason: "deadline_exceeded" };

    // Steps 1-2: full host revalidation for THIS hop before any bytes are sent.
    const validated = await validateHop(current, resolve);
    if (!validated.ok) return { ok: false, reason: validated.reason };
    const u = validated.url;

    const key = u.toString();
    if (visited.has(key)) return { ok: false, reason: "redirect_loop" };
    visited.add(key);

    // Step 3: fetch exactly one hop, manual redirect, per-hop timeout bounded
    // by whatever remains of the overall deadline.
    const remaining = deadlineMs - (now() - startedAt);
    if (remaining <= 0) return { ok: false, reason: "deadline_exceeded" };
    const hopTimeout = Math.max(1, Math.min(timeoutMs, remaining));
    let res: Response;
    try {
      res = await fetchImpl(key, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": SOURCE_VERIFY_UA, Accept: allowed.join(", ") },
        signal: AbortSignal.timeout(hopTimeout),
      });
    } catch (e) {
      return { ok: false, reason: isAbortError(e) ? "timeout" : "fetch_failed" };
    }

    const status = res.status;

    // Step 4: a redirect re-runs the full host check on its (http/https) target.
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      try {
        await (res.body as ReadableStream | null | undefined)?.cancel?.();
      } catch {
        /* ignore */
      }
      if (!location) return { ok: false, reason: "fetch_failed" };
      let next: URL;
      try {
        next = new URL(location, u);
      } catch {
        return { ok: false, reason: "fetch_failed" };
      }
      const nextScheme = next.protocol.toLowerCase();
      if (nextScheme !== "http:" && nextScheme !== "https:") return { ok: false, reason: "blocked_scheme" };
      current = next.toString();
      continue;
    }

    if (status < 200 || status >= 300) {
      try {
        await (res.body as ReadableStream | null | undefined)?.cancel?.();
      } catch {
        /* ignore */
      }
      return { ok: false, reason: "fetch_failed" };
    }

    // Step 5: content-type allowlist, then stream-read up to maxBytes. A
    // MISSING content-type fails closed too - an unlabeled body from an
    // untrusted host cannot be presumed text.
    const ctHeader = (res.headers.get("content-type") ?? "").toLowerCase();
    const ctType = ctHeader.split(";")[0]!.trim();
    if (!ctType || !allowed.includes(ctType)) {
      try {
        await (res.body as ReadableStream | null | undefined)?.cancel?.();
      } catch {
        /* ignore */
      }
      return { ok: false, reason: "wrong_content_type" };
    }

    const bodyRead = await readCappedBody(res, maxBytes);
    if (!bodyRead.ok) return { ok: false, reason: bodyRead.reason };
    return { ok: true, text: bodyRead.text, finalUrl: key, status };
  }

  return { ok: false, reason: "too_many_redirects" };
}
