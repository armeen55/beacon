import { describe, expect, it } from "vitest";
import {
  classifyPollError,
  dominantFailureKind,
  isRetryablePollErrorKind,
  type PollErrorKind,
} from "./poll-error-classifier";

describe("classifyPollError — Step 1.5", () => {
  it("classifies ETIMEDOUT as retryable timeout", () => {
    const err = Object.assign(new Error("Operation timed out"), {
      code: "ETIMEDOUT",
    });
    const c = classifyPollError(err);
    expect(c.kind).toBe("timeout");
    expect(c.retryable).toBe(true);
  });

  it("classifies HTTP 408 as retryable timeout", () => {
    const err = Object.assign(new Error("Request Timeout"), { status: 408 });
    expect(classifyPollError(err).kind).toBe("timeout");
  });

  it("classifies ECONNRESET as retryable transient_network", () => {
    const err = Object.assign(new Error("connection reset"), {
      code: "ECONNRESET",
    });
    const c = classifyPollError(err);
    expect(c.kind).toBe("transient_network");
    expect(c.retryable).toBe(true);
  });

  it("classifies fetch failed (TypeError network) as transient_network", () => {
    const err = Object.assign(new TypeError("fetch failed"), {});
    expect(classifyPollError(err).kind).toBe("transient_network");
  });

  it("classifies HTTP 401 as non-retryable auth", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    const c = classifyPollError(err);
    expect(c.kind).toBe("auth");
    expect(c.retryable).toBe(false);
  });

  it("classifies invalid_api_key code as non-retryable auth", () => {
    const err = Object.assign(new Error("bad key"), {
      code: "invalid_api_key",
    });
    expect(classifyPollError(err).kind).toBe("auth");
  });

  it("classifies HTTP 429 as non-retryable rate_limit (per operator brief)", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const c = classifyPollError(err);
    expect(c.kind).toBe("rate_limit");
    expect(c.retryable).toBe(false);
  });

  it("classifies HTTP 503 as retryable server_5xx", () => {
    const err = Object.assign(new Error("Service Unavailable"), {
      status: 503,
    });
    const c = classifyPollError(err);
    expect(c.kind).toBe("server_5xx");
    expect(c.retryable).toBe(true);
  });

  it("classifies HTTP 500 as retryable server_5xx", () => {
    const err = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    expect(classifyPollError(err).retryable).toBe(true);
  });

  it("classifies HTTP 400 as non-retryable invalid_request", () => {
    const err = Object.assign(new Error("Bad Request"), { status: 400 });
    const c = classifyPollError(err);
    expect(c.kind).toBe("invalid_request");
    expect(c.retryable).toBe(false);
  });

  it("classifies SyntaxError as non-retryable parse_error", () => {
    const err = new SyntaxError("Unexpected token } in JSON at position 47");
    const c = classifyPollError(err);
    expect(c.kind).toBe("parse_error");
    expect(c.retryable).toBe(false);
  });

  it("classifies unknown errors as non-retryable unknown", () => {
    const err = new Error("something weird");
    const c = classifyPollError(err);
    expect(c.kind).toBe("unknown");
    expect(c.retryable).toBe(false);
  });
});

describe("isRetryablePollErrorKind", () => {
  it("returns true only for transient kinds", () => {
    const retryable: PollErrorKind[] = ["transient_network", "timeout", "server_5xx"];
    const nonRetryable: PollErrorKind[] = [
      "rate_limit",
      "auth",
      "invalid_request",
      "parse_error",
      "unknown",
    ];
    for (const k of retryable) expect(isRetryablePollErrorKind(k)).toBe(true);
    for (const k of nonRetryable) expect(isRetryablePollErrorKind(k)).toBe(false);
  });
});

describe("dominantFailureKind", () => {
  it("returns null when all counts are zero", () => {
    expect(
      dominantFailureKind({
        transient_network: 0,
        timeout: 0,
        server_5xx: 0,
        rate_limit: 0,
        auth: 0,
        invalid_request: 0,
        parse_error: 0,
        unknown: 0,
      }),
    ).toBeNull();
  });

  it("returns the kind with the highest count", () => {
    expect(
      dominantFailureKind({
        transient_network: 5,
        timeout: 1,
        server_5xx: 0,
        rate_limit: 0,
        auth: 0,
        invalid_request: 0,
        parse_error: 0,
        unknown: 0,
      }),
    ).toBe("transient_network");
  });

  it("breaks ties by priority: auth wins over transient_network", () => {
    // Both have count=2; "auth" should win because operators want
    // systemic problems surfaced first.
    expect(
      dominantFailureKind({
        transient_network: 2,
        timeout: 0,
        server_5xx: 0,
        rate_limit: 0,
        auth: 2,
        invalid_request: 0,
        parse_error: 0,
        unknown: 0,
      }),
    ).toBe("auth");
  });
});
