import "server-only";

import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

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
 *      hostnames are rejected pre-DNS. The FIRST validated address is kept
 *      as the pinned address for this hop (see below).
 *   3. fetch the ONE hop with redirect:"manual", an identified UA, a per-hop
 *      AbortSignal timeout (tracking a running total against the overall
 *      deadline), and a dedicated undici `Agent` whose `connect.lookup`
 *      returns ONLY the pinned address from step 2 - the socket that
 *      actually opens is the exact address we validated, never a fresh
 *      re-resolution. The request URL keeps the original hostname (so TLS
 *      SNI and the Host header are unchanged); only the DNS step is
 *      overridden. `rejectUnauthorized` is left untouched - TLS verification
 *      still runs against the real hostname.
 *   4. a 3xx absolutizes Location and RE-RUNS steps 1-3 on the target before
 *      the next hop (bounded by maxRedirects + a visited-URL set for loops),
 *      building a FRESH pinned Agent for that hop's own validated address; a
 *      non-http(s) Location is refused.
 *   5. a 2xx checks the content-type allowlist, then streams the body up to
 *      maxBytes and aborts on overflow.
 *
 * Never logs credentials or response bodies (callers get a host + reason
 * only). Pure exports assertSafeUrl / isBlockedAddress are unit-tested on
 * their own; the whole flow is hermetic under injected resolve + fetchImpl
 * (dispatcher is simply ignored by an injected fetchImpl in tests).
 *
 * DNS TOCTOU - CLOSED (2026-07-09, per-hop socket pinning): earlier versions
 * of this module resolved + validated the host, then handed the plain
 * HOSTNAME to fetch, which re-resolved at connect time (undici) - a hostile
 * authoritative server could return a public address to our resolve() call
 * and a private one microseconds later at connect (classic DNS rebinding).
 * That gap is now closed: every hop pins its socket lookup to the exact
 * address validated in step 2/4 above via a per-hop undici `Agent({ connect:
 * { lookup } })`, so the byte that actually gets fetched can never diverge
 * from the byte that was checked. The hostname is preserved in the request
 * URL purely for SNI/Host - it never drives a second, unpinned DNS lookup.
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

/**
 * IP/CIDR classification (2026-07-09, P1 complete-SSRF hardening). Every
 * address is canonicalized with node:net.isIP first (rejects octet overflow,
 * leading-zero octal ambiguity, and malformed group counts - see node's own
 * strict parser), then expanded to a BigInt (32-bit for v4, 128-bit for v6)
 * and matched against an explicit CIDR table with `inCidr`. No dependency;
 * the WHATWG URL parser (assertSafeUrl's `new URL()`) already normalizes
 * decimal/octal/hex IPv4 literals and v6 shorthand into the canonical forms
 * net.isIP expects, so a hostile literal like http://0x7f000001/ arrives here
 * as plain "127.0.0.1" before this function ever sees it.
 */

type Cidr = { base: bigint; prefix: number };

/** Strict dotted-quad -> 32-bit unsigned BigInt. Assumes the caller already
 *  confirmed `net.isIP(ip) === 4` (or is feeding a known-good literal base);
 *  still validates defensively and returns null on anything malformed. */
function ipv4StringToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v < 0 || v > 255) return null;
    n = (n << BigInt(8)) | BigInt(v);
  }
  return n;
}

/** A net.isIP-validated IPv6 string (no zone id, no brackets) -> 128-bit
 *  unsigned BigInt. Handles "::" compression and an embedded dotted-quad
 *  IPv4 tail (e.g. ::ffff:127.0.0.1) by folding it into the low 32 bits, so
 *  the dotted and hex-mapped spellings of the same address always produce
 *  the same numeric value. Returns null on anything that fails to expand
 *  (defensive; net.isIP should already have ruled this out upstream). */
function ipv6StringToBigInt(ip: string): bigint | null {
  let head = ip;
  let v4Tail: bigint | null = null;
  const dotIdx = ip.indexOf(".");
  if (dotIdx >= 0) {
    const lastColon = ip.lastIndexOf(":");
    if (lastColon < 0 || lastColon > dotIdx) return null;
    v4Tail = ipv4StringToBigInt(ip.slice(lastColon + 1));
    if (v4Tail == null) return null;
    head = ip.slice(0, lastColon);
    // "::a.b.c.d" (the v4 tail sits directly against the "::" compression,
    // e.g. the v4-compatible/NAT64 forms): slicing off everything from the
    // separator colon onward drops ONE of the two colons that make up "::",
    // so restore it before the "::" check below.
    if (ip[lastColon - 1] === ":") head += ":";
  }
  const groupsNeeded = v4Tail != null ? 6 : 8;
  let groups: string[];
  if (head.includes("::")) {
    const sides = head.split("::");
    if (sides.length > 2) return null; // "::" may appear at most once
    const left = sides[0] ? sides[0].split(":") : [];
    const right = sides[1] ? sides[1].split(":") : [];
    const missing = groupsNeeded - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = head.split(":");
  }
  if (groups.length !== groupsNeeded) return null;
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  if (v4Tail != null) n = (n << BigInt(32)) | v4Tail;
  return n;
}

function v4Cidr(base: string, prefix: number): Cidr {
  const b = ipv4StringToBigInt(base);
  if (b == null) throw new Error(`invalid IPv4 CIDR base: ${base}`);
  return { base: b, prefix };
}

function v6Cidr(base: string, prefix: number): Cidr {
  const b = ipv6StringToBigInt(base);
  if (b == null) throw new Error(`invalid IPv6 CIDR base: ${base}`);
  return { base: b, prefix };
}

/** Is `ipBig` within `base/prefix` under a `totalBits`-wide address space? */
function inCidr(ipBig: bigint, base: bigint, prefix: number, totalBits: number): boolean {
  const shift = BigInt(totalBits - prefix);
  return ipBig >> shift === base >> shift;
}

/** Every IPv4 range this fetcher must never reach: unspecified, loopback,
 *  RFC1918 private, CGNAT, link-local (incl. cloud metadata), the IETF
 *  protocol/documentation/benchmarking ranges, and multicast/reserved. */
const BLOCKED_IPV4_CIDRS: readonly Cidr[] = [
  v4Cidr("0.0.0.0", 8),
  v4Cidr("10.0.0.0", 8),
  v4Cidr("100.64.0.0", 10),
  v4Cidr("127.0.0.0", 8),
  v4Cidr("169.254.0.0", 16),
  v4Cidr("172.16.0.0", 12),
  v4Cidr("192.0.0.0", 24),
  v4Cidr("192.0.2.0", 24),
  v4Cidr("192.88.99.0", 24),
  v4Cidr("192.168.0.0", 16),
  v4Cidr("198.18.0.0", 15),
  v4Cidr("198.51.100.0", 24),
  v4Cidr("203.0.113.0", 24),
  v4Cidr("224.0.0.0", 4),
  v4Cidr("240.0.0.0", 4),
];

function isBlockedIPv4Big(ipBig: bigint): boolean {
  return BLOCKED_IPV4_CIDRS.some((c) => inCidr(ipBig, c.base, c.prefix, 32));
}

/** IPv6 ranges blocked outright (no embedded address to unwrap): loopback,
 *  unspecified, discard-only, IETF protocol assignments (incl. Teredo
 *  2001::/32), documentation, unique-local, link-local, deprecated
 *  site-local, and multicast. */
const BLOCKED_IPV6_CIDRS: readonly Cidr[] = [
  v6Cidr("::", 128),
  v6Cidr("::1", 128),
  v6Cidr("100::", 64),
  v6Cidr("2001::", 23),
  v6Cidr("2001:db8::", 32),
  v6Cidr("fc00::", 7),
  v6Cidr("fe80::", 10),
  v6Cidr("fec0::", 10),
  v6Cidr("ff00::", 8),
];

/** IPv6 ranges that CARRY an embedded IPv4 address rather than being blocked
 *  outright: v4-mapped/v4-compatible/NAT64 carry it in the low 32 bits;
 *  6to4 carries it in bits 16-47 (2002:WWXX:YYZZ::/48 encodes WW.XX.YY.ZZ).
 *  Each is unwrapped and the embedded address is re-checked as IPv4, so e.g.
 *  ::ffff:8.8.8.8 (a v4-mapped PUBLIC address) is correctly allowed while
 *  ::ffff:127.0.0.1 is correctly blocked. */
const V4_MASK = BigInt(0xffffffff);

const EMBEDDED_V4_RANGES: ReadonlyArray<Cidr & { extract: (n: bigint) => bigint }> = [
  { ...v6Cidr("::ffff:0:0", 96), extract: (n) => n & V4_MASK }, // v4-mapped
  { ...v6Cidr("::", 96), extract: (n) => n & V4_MASK }, // v4-compatible
  { ...v6Cidr("64:ff9b::", 96), extract: (n) => n & V4_MASK }, // NAT64
  { ...v6Cidr("2002::", 16), extract: (n) => (n >> BigInt(80)) & V4_MASK }, // 6to4
];

function isBlockedIPv6Big(ipBig: bigint): boolean {
  if (BLOCKED_IPV6_CIDRS.some((c) => inCidr(ipBig, c.base, c.prefix, 128))) return true;
  for (const range of EMBEDDED_V4_RANGES) {
    if (inCidr(ipBig, range.base, range.prefix, 128)) return isBlockedIPv4Big(range.extract(ipBig));
  }
  return false;
}

/**
 * Pure predicate: is this resolved IP a private/reserved/loopback/link-local/
 * metadata address we must never fetch? Canonicalizes via node:net.isIP,
 * expands to a BigInt, and checks the explicit CIDR tables above (handles
 * IPv4, IPv6, and every embedded-v4 IPv6 form, unwrapped and re-checked).
 * Fails CLOSED on anything that doesn't parse as a clean IPv4/IPv6 address.
 */
export function isBlockedAddress(ip: string): boolean {
  let addr = (ip ?? "").trim().toLowerCase();
  if (!addr) return true; // fail closed on an empty/unknown address
  const zone = addr.indexOf("%"); // strip any scope-id
  if (zone >= 0) addr = addr.slice(0, zone);
  addr = addr.replace(/^\[/, "").replace(/\]$/, "");
  const family = net.isIP(addr);
  if (family === 4) {
    const big = ipv4StringToBigInt(addr);
    return big == null ? true : isBlockedIPv4Big(big);
  }
  if (family === 6) {
    const big = ipv6StringToBigInt(addr);
    return big == null ? true : isBlockedIPv6Big(big);
  }
  return true; // unparseable -> fail closed
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

/** The validated address family a pinned socket lookup reports back to
 *  undici's connector (matches node's LookupFunction family argument). */
type PinnedFamily = 4 | 6;

/** Validate one host (initial or redirect target): scheme/creds/port, metadata
 *  hostname, and every resolved (or literal) IP. On success ALSO returns the
 *  pinned address+family this hop must connect to - the host-literal IP, or
 *  the FIRST validated A/AAAA record for a resolved hostname - so the caller
 *  can build a socket-pinned Agent and close the DNS-TOCTOU gap. */
async function validateHop(
  raw: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<
  | { ok: true; url: URL; pinnedIp: string; pinnedFamily: PinnedFamily }
  | { ok: false; reason: SafeFetchReason }
> {
  const safe = assertSafeUrl(raw);
  if (!safe.ok) return safe;
  const u = safe.url;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedHostname(host)) return { ok: false, reason: "blocked_private" };
  const literal = hostLiteralIp(host);
  if (literal != null) {
    if (isBlockedAddress(literal)) return { ok: false, reason: "blocked_private" };
    return { ok: true, url: u, pinnedIp: literal, pinnedFamily: net.isIP(literal) === 6 ? 6 : 4 };
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
  const pinnedIp = addrs[0]!;
  return { ok: true, url: u, pinnedIp, pinnedFamily: net.isIP(pinnedIp) === 6 ? 6 : 4 };
}

/**
 * The DNS-TOCTOU fix, isolated as a pure, directly-testable unit: a
 * node-`LookupFunction`-shaped callback that ALWAYS answers with exactly the
 * one address already validated for this hop, no matter what hostname/options
 * the caller (undici's connector) passes in. Exported so the pinning
 * behavior itself has unit coverage without needing a real socket - the
 * Agent it gets wired into is a mature third-party library, trusted to call
 * `connect.lookup` faithfully; what THIS module owns and must prove is that
 * the lookup it hands over never answers with anything but the checked IP.
 */
export function buildPinnedLookup(pinnedIp: string, pinnedFamily: PinnedFamily): net.LookupFunction {
  return (_hostname, _options, callback) => {
    callback(null, [{ address: pinnedIp, family: pinnedFamily }]);
  };
}

/** A per-hop undici Agent whose ONLY dns behavior is to hand back the exact
 *  address `validateHop` already checked - closes the DNS-TOCTOU gap (the
 *  socket that opens can never diverge from the address that was validated).
 *  The request URL still carries the original hostname (SNI + Host), so TLS
 *  verification is untouched - only the DNS step is overridden. */
function pinnedDispatcher(pinnedIp: string, pinnedFamily: PinnedFamily): Agent {
  return new Agent({ connect: { lookup: buildPinnedLookup(pinnedIp, pinnedFamily) } });
}

/** Best-effort close of a per-hop pinned Agent; never throws (this runs on
 *  every exit path, including ones that already failed for another reason). */
async function closeDispatcher(dispatcher: Agent): Promise<void> {
  try {
    await dispatcher.close();
  } catch {
    /* ignore */
  }
}

/**
 * SSRF-safe fetch of an untrusted source URL's visible bytes. See the module
 * doc for the per-hop algorithm, including the per-hop socket-pinned Agent
 * that closes the DNS-TOCTOU gap. Never throws; every failure resolves to a
 * typed `{ ok: false, reason }`.
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

    // Socket pinning (DNS-TOCTOU fix): this hop's Agent can only connect to
    // the exact address just validated above - the request URL below still
    // carries the ORIGINAL hostname, so TLS SNI + the Host header are
    // unchanged; only the DNS step is overridden. A fresh Agent per hop
    // (never reused across redirects, closed once this hop is done).
    const dispatcher = pinnedDispatcher(validated.pinnedIp, validated.pinnedFamily);

    // Step 3: fetch exactly one hop, manual redirect, per-hop timeout bounded
    // by whatever remains of the overall deadline.
    const remaining = deadlineMs - (now() - startedAt);
    if (remaining <= 0) {
      await closeDispatcher(dispatcher);
      return { ok: false, reason: "deadline_exceeded" };
    }
    const hopTimeout = Math.max(1, Math.min(timeoutMs, remaining));
    let res: Response;
    try {
      // `dispatcher` is undici-specific (not in the DOM RequestInit type Node's
      // global fetch is typed with) - an injected test fetchImpl just ignores
      // an extra property it never reads.
      const init: RequestInit & { dispatcher?: Agent } = {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": SOURCE_VERIFY_UA, Accept: allowed.join(", ") },
        signal: AbortSignal.timeout(hopTimeout),
        dispatcher,
      };
      res = await fetchImpl(key, init);
    } catch (e) {
      await closeDispatcher(dispatcher);
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
      await closeDispatcher(dispatcher);
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
      await closeDispatcher(dispatcher);
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
      await closeDispatcher(dispatcher);
      return { ok: false, reason: "wrong_content_type" };
    }

    const bodyRead = await readCappedBody(res, maxBytes);
    await closeDispatcher(dispatcher);
    if (!bodyRead.ok) return { ok: false, reason: bodyRead.reason };
    return { ok: true, text: bodyRead.text, finalUrl: key, status };
  }

  return { ok: false, reason: "too_many_redirects" };
}
