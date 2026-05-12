/**
 * Perf bundle 7 (2026-05-12) — tests for the production-safe perf trace.
 *
 * Pin three contracts:
 *   1. Tracing is DISABLED by default (BEACON_PERF_TRACE unset / != "true").
 *      In that state every API on the trace is a zero-side-effect NOOP and
 *      no log line is emitted.
 *   2. When enabled, the log line contains structured timings (label, ms,
 *      value) but NEVER payload content. Specifically: passing a value
 *      containing prompt/answer/customer text to `measureSize` must log
 *      only the byte count, never the text.
 *   3. The `time()` wrapper returns the wrapped function's value
 *      unchanged in both enabled and disabled modes — no behavior drift.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  delete process.env.BEACON_PERF_TRACE;
  vi.restoreAllMocks();
});

async function importFresh() {
  // Re-import to pick up the current env value (the module reads the
  // flag at call time, not import time — so this isn't strictly needed
  // for correctness, but isolates each test cleanly).
  vi.resetModules();
  return import("@/lib/perf-trace");
}

describe("perf-trace: disabled by default", () => {
  it("perfTraceEnabled() returns false when BEACON_PERF_TRACE is unset", async () => {
    delete process.env.BEACON_PERF_TRACE;
    const { perfTraceEnabled } = await importFresh();
    expect(perfTraceEnabled()).toBe(false);
  });

  it("perfTraceEnabled() returns false when BEACON_PERF_TRACE is some other string", async () => {
    process.env.BEACON_PERF_TRACE = "1";
    const { perfTraceEnabled } = await importFresh();
    expect(perfTraceEnabled()).toBe(false);
  });

  it("perfTraceEnabled() returns true ONLY when BEACON_PERF_TRACE === 'true'", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { perfTraceEnabled } = await importFresh();
    expect(perfTraceEnabled()).toBe(true);
  });

  it("returns NOOP trace when disabled — flush emits zero log lines", async () => {
    delete process.env.BEACON_PERF_TRACE;
    const { createPerfTrace } = await importFresh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = createPerfTrace("test", { route: "/" });
    await trace.time("op", async () => "v");
    trace.mark("checkpoint");
    trace.data("k", "v");
    trace.measureSize("payload", { huge: "x".repeat(1_000_000) });
    trace.flush();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("NOOP trace.id is empty string", async () => {
    delete process.env.BEACON_PERF_TRACE;
    const { createPerfTrace } = await importFresh();
    const trace = createPerfTrace("test");
    expect(trace.id).toBe("");
  });
});

describe("perf-trace: enabled mode", () => {
  it("flush logs a single structured line with phase / route / id / total / entries", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = createPerfTrace("loader:/today", {
      route: "/today",
      traceId: "abc12345",
    });
    await trace.time("loadTodayPageData", async () => "ok");
    trace.data("queue_count", 7);
    trace.flush();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[perf-trace\]/);
    expect(line).toContain("phase=loader:/today");
    expect(line).toContain("route=/today");
    expect(line).toContain("id=abc12345");
    expect(line).toMatch(/total_ms=\d+(\.\d+)?/);
    expect(line).toContain('"label":"loadTodayPageData"');
    expect(line).toContain('"label":"queue_count"');
    expect(line).toContain('"value":7');
  });

  it("flush is idempotent — calling twice emits one log line", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = createPerfTrace("test");
    trace.flush();
    trace.flush();
    trace.flush();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("trace.id is non-empty when enabled (fresh generated)", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const trace = createPerfTrace("test");
    expect(trace.id.length).toBeGreaterThan(0);
  });

  it("trace.id uses the provided traceId when given", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const trace = createPerfTrace("test", { traceId: "fixed-id-42" });
    expect(trace.id).toBe("fixed-id-42");
  });

  it("measureSize logs only the byte count, NEVER the payload content", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // A payload containing customer-sensitive-looking text. The test
    // proves none of it appears in the log line.
    const SECRET = "sk-supabase-key-shhh-customer-prompt-text-pii";
    const payload = {
      promptText: SECRET,
      answerText: `answer: ${SECRET}`,
      rows: [{ prompt: SECRET, answer: SECRET }],
    };

    const trace = createPerfTrace("loader:/prompts");
    trace.measureSize("payload", payload);
    trace.flush();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    // Must contain a size label and a numeric byte count.
    expect(line).toContain('"label":"payload_bytes"');
    expect(line).toMatch(/"value":\d+/);
    // Must NEVER contain the secret content.
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("answer:");
    expect(line).not.toContain("promptText");
    expect(line).not.toContain("answerText");
  });

  it("measureSize on a cyclic object returns -1 (no throw)", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const trace = createPerfTrace("test");
    trace.measureSize("payload", cyclic);
    trace.flush();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain('"value":-1');
  });

  it("data() truncates over-long string values to 64 chars", async () => {
    process.env.BEACON_PERF_TRACE = "true";
    const { createPerfTrace } = await importFresh();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = createPerfTrace("test");
    trace.data("long_value", "x".repeat(200));
    trace.flush();
    const line = logSpy.mock.calls[0][0] as string;
    // The 200-char string is truncated to 64. The substring "x".repeat(65)
    // would only appear if truncation did NOT happen.
    expect(line).not.toContain("x".repeat(65));
    expect(line).toContain("x".repeat(64));
  });
});

describe("perf-trace: time() preserves return values + behavior in both modes", () => {
  for (const enabled of ["true", undefined]) {
    const label = enabled === "true" ? "enabled" : "disabled";

    it(`returns the wrapped function's resolved value (${label})`, async () => {
      if (enabled) process.env.BEACON_PERF_TRACE = enabled;
      else delete process.env.BEACON_PERF_TRACE;
      const { createPerfTrace } = await importFresh();
      const trace = createPerfTrace("test");
      const result = await trace.time("op", async () => 42);
      expect(result).toBe(42);
    });

    it(`propagates thrown errors (${label})`, async () => {
      if (enabled) process.env.BEACON_PERF_TRACE = enabled;
      else delete process.env.BEACON_PERF_TRACE;
      const { createPerfTrace } = await importFresh();
      const trace = createPerfTrace("test");
      await expect(
        trace.time("op", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    });

    it(`accepts a synchronous function too (${label})`, async () => {
      if (enabled) process.env.BEACON_PERF_TRACE = enabled;
      else delete process.env.BEACON_PERF_TRACE;
      const { createPerfTrace } = await importFresh();
      const trace = createPerfTrace("test");
      const result = await trace.time("op", () => "sync-result");
      expect(result).toBe("sync-result");
    });
  }
});

describe("perf-trace: header name is stable", () => {
  it("PERF_TRACE_HEADER_NAME equals x-beacon-perf-trace-id", async () => {
    const { PERF_TRACE_HEADER_NAME } = await importFresh();
    expect(PERF_TRACE_HEADER_NAME).toBe("x-beacon-perf-trace-id");
  });
});
