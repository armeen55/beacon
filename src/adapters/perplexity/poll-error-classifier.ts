/**
 * Step 1.5 (master plan) — failure classification for the native poll
 * adapter.
 *
 * Provider SDKs surface errors in a handful of recognisable shapes
 * (OpenAI: { name, status, code }; Perplexity / fetch: { code, cause };
 * generic Node errors: { code: ECONNRESET, ETIMEDOUT, ... }).  This
 * module collapses them into a small enum the adapter can act on.
 *
 * Retry policy is conservative — we ONLY retry when the error is
 * categorically transient (network blip, timeout, 5xx, transport drop).
 * Rate-limit / auth / invalid-request / parse errors are intentionally
 * non-retryable so a misconfigured key or schema bug doesn't burn the
 * whole chunk timeout in a futile loop.
 */

export type PollErrorKind =
  | "transient_network"
  | "timeout"
  | "server_5xx"
  | "rate_limit"
  | "auth"
  | "invalid_request"
  | "parse_error"
  | "unknown";

export type PollErrorClassification = {
  kind: PollErrorKind;
  /** True ⇒ adapter may retry this prompt once. */
  retryable: boolean;
  /** Short, machine-readable reason for the run summary. */
  reason: string;
};

const RETRYABLE_KINDS: ReadonlySet<PollErrorKind> = new Set([
  "transient_network",
  "timeout",
  "server_5xx",
]);

/** True when the error kind is safe to retry inside a single chunk. */
export function isRetryablePollErrorKind(kind: PollErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

const TRANSIENT_NODE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
]);

const TIMEOUT_NODE_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function lower(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  return "";
}

function getStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown; statusCode?: unknown };
  const raw = e.status ?? e.statusCode;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getCode(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const e = err as { code?: unknown };
  return typeof e.code === "string" ? e.code : "";
}

function getName(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const e = err as { name?: unknown };
  return typeof e.name === "string" ? e.name : "";
}

function getMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err !== "object" || err === null) return "";
  const e = err as { message?: unknown };
  return typeof e.message === "string" ? e.message : String(err);
}

/**
 * Classify an error thrown from `client.sample()` (or downstream parse
 * logic). Best-effort heuristic that prefers concrete signals (status
 * code, error code) over message regex.
 */
export function classifyPollError(err: unknown): PollErrorClassification {
  const status = getStatus(err);
  const code = getCode(err);
  const name = getName(err);
  const message = lower(getMessage(err));

  // Timeout — distinct from generic transient because some operators may
  // want different retry policies in the future.
  if (TIMEOUT_NODE_CODES.has(code)) {
    return {
      kind: "timeout",
      retryable: true,
      reason: `timeout (${code})`,
    };
  }
  if (status === 408 || message.includes("timeout") || message.includes("timed out")) {
    return {
      kind: "timeout",
      retryable: true,
      reason: status === 408 ? "timeout (HTTP 408)" : "timeout (message)",
    };
  }

  // Transient network — connection reset / refused / DNS blip.
  if (TRANSIENT_NODE_CODES.has(code)) {
    return {
      kind: "transient_network",
      retryable: true,
      reason: `transient_network (${code})`,
    };
  }
  if (
    name === "APIConnectionError" ||
    name === "FetchError" ||
    name === "TypeError" /* fetch() rejects with TypeError on net failure */
      && (message.includes("fetch failed") || message.includes("network"))
  ) {
    return {
      kind: "transient_network",
      retryable: true,
      reason: `transient_network (${name})`,
    };
  }

  // Auth — never retry; signals a key / permission problem.
  if (status === 401 || status === 403) {
    return {
      kind: "auth",
      retryable: false,
      reason: `auth (HTTP ${status})`,
    };
  }
  if (
    name === "AuthenticationError" ||
    code === "invalid_api_key" ||
    message.includes("unauthorized") ||
    message.includes("api key")
  ) {
    return { kind: "auth", retryable: false, reason: `auth (${code || name})` };
  }

  // Rate limit — intentionally non-retryable in v1. The chunk has a
  // 320s ceiling and a per-prompt retry would burn budget without
  // backoff long enough to clear the limiter.
  if (status === 429 || code === "rate_limit_exceeded") {
    return {
      kind: "rate_limit",
      retryable: false,
      reason: status === 429 ? "rate_limit (HTTP 429)" : `rate_limit (${code})`,
    };
  }

  // Server 5xx — retry once.  503 is included; some operators may want
  // longer-backoff handling, but a single short retry is fine inside a
  // chunk's budget.
  if (status !== null && status >= 500 && status <= 599) {
    return {
      kind: "server_5xx",
      retryable: true,
      reason: `server_5xx (HTTP ${status})`,
    };
  }

  // Invalid request — schema / parameter problem, never retry.
  if (status === 400) {
    return {
      kind: "invalid_request",
      retryable: false,
      reason: "invalid_request (HTTP 400)",
    };
  }
  if (
    code === "invalid_request_error" ||
    code === "validation_error" ||
    name === "BadRequestError"
  ) {
    return {
      kind: "invalid_request",
      retryable: false,
      reason: `invalid_request (${code || name})`,
    };
  }

  // Parse / schema — JSON.parse failures, missing required field after a
  // billed response. Non-retryable: same payload would parse the same
  // way on retry.
  if (
    name === "SyntaxError" ||
    message.includes("unexpected token") ||
    message.includes("json") ||
    message.includes("parse")
  ) {
    return {
      kind: "parse_error",
      retryable: false,
      reason: `parse_error (${name || "message"})`,
    };
  }

  return { kind: "unknown", retryable: false, reason: `unknown (${name || "Error"})` };
}

/**
 * Pick the failure kind with the highest count for chunk-summary
 * reporting. Returns null when there are no failures. Ties broken by
 * `PRIORITY_ORDER` so "auth" wins over "transient_network" when both
 * have equal counts — the operator wants to know about the systemic
 * problem first.
 */
const PRIORITY_ORDER: ReadonlyArray<PollErrorKind> = [
  "auth",
  "invalid_request",
  "rate_limit",
  "parse_error",
  "server_5xx",
  "timeout",
  "transient_network",
  "unknown",
];

export function dominantFailureKind(
  counts: Readonly<Record<string, number>>,
): PollErrorKind | null {
  let bestKind: PollErrorKind | null = null;
  let bestCount = 0;
  let bestRank = PRIORITY_ORDER.length;
  for (const k of PRIORITY_ORDER) {
    const c = counts[k] ?? 0;
    if (c <= 0) continue;
    const rank = PRIORITY_ORDER.indexOf(k);
    if (c > bestCount || (c === bestCount && rank < bestRank)) {
      bestKind = k;
      bestCount = c;
      bestRank = rank;
    }
  }
  return bestKind;
}
