import "server-only";

/**
 * IndexNow protocol client (BEACON_500 item 75, 2026-07-02).
 *
 * ChatGPT's browsing rides Bing's index (and Yandex/Seznam also consume
 * IndexNow), so a page absent from Bing cannot be cited by ChatGPT regardless
 * of quality. IndexNow is the standards-based way to tell Bing "this URL
 * changed" the moment a change goes live - a single documented endpoint:
 *
 *   POST https://api.indexnow.org/indexnow
 *   Content-Type: application/json
 *   { "host": "example.com", "key": "<opaque key>",
 *     "keyLocation": "https://example.com/<key>.txt" (optional),
 *     "urlList": ["https://example.com/page"] }
 *
 * The protocol requires a key file hosted at https://<host>/<key>.txt (or a
 * custom keyLocation) BEFORE any ping can be trusted - this client never
 * fakes that. If the tenant has not configured a key, `pingIndexNow` is not
 * even reachable from the wiring point (see `ping-on-verify.ts`); this
 * module only knows how to speak the protocol once a key exists.
 *
 * Fail-soft by design: a failed ping NEVER fails the publish it rides along
 * with. One retry on any non-2xx/network failure, then give up loudly (log
 * only - the caller records a receipt either way).
 */

import { log } from "@/lib/logger";

const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 10_000;

export type IndexNowPingArgs = {
  host: string;
  key: string;
  keyLocation?: string;
  urlList: string[];
};

export type IndexNowPingResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; error: string };

/**
 * One attempt at the IndexNow POST. Never throws - network/timeout errors
 * resolve to `{ ok: false, status: null }` so the caller can retry without a
 * try/catch of its own.
 */
async function attemptPing(
  args: IndexNowPingArgs,
  fetchImpl: typeof fetch,
): Promise<IndexNowPingResult> {
  try {
    const body: Record<string, unknown> = {
      host: args.host,
      key: args.key,
      urlList: args.urlList,
    };
    if (args.keyLocation) body.keyLocation = args.keyLocation;

    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // IndexNow returns 200 (OK) or 202 (Accepted) on success; both mean the
    // ping was received. Anything else is a failure worth one retry.
    if (res.status === 200 || res.status === 202) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status, error: `unexpected status ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ping IndexNow for one or more URLs on one host, with a single retry on
 * failure. NEVER throws - the caller (the verify-live wiring point) treats
 * this as fire-and-forget and always records a receipt from the result.
 */
export async function pingIndexNow(
  args: IndexNowPingArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowPingResult> {
  const first = await attemptPing(args, fetchImpl);
  if (first.ok) return first;

  log.warn("[indexnow] ping failed, retrying once", {
    host: args.host,
    urlCount: args.urlList.length,
    status: first.status,
    error: first.error,
  });

  const second = await attemptPing(args, fetchImpl);
  if (!second.ok) {
    log.warn("[indexnow] ping failed after retry (fail-soft, publish unaffected)", {
      host: args.host,
      urlCount: args.urlList.length,
      status: second.status,
      error: second.error,
    });
  } else {
    log.info("[indexnow] ping accepted on retry", { host: args.host, status: second.status });
  }
  return second;
}

/** Convenience: ping a single URL, deriving `host` from the URL itself. */
export async function pingIndexNowForUrl(
  args: { url: string; key: string; keyLocation?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowPingResult> {
  let host: string;
  try {
    host = new URL(args.url).host;
  } catch {
    return { ok: false, status: null, error: `invalid URL: ${args.url}` };
  }
  return pingIndexNow(
    { host, key: args.key, keyLocation: args.keyLocation, urlList: [args.url] },
    fetchImpl,
  );
}
