/**
 * Perf bundle 7 (2026-05-12) — production-safe performance tracing.
 *
 * Gated by `BEACON_PERF_TRACE=true` in the runtime environment. Disabled
 * by default; when disabled, every API on this module is a zero-cost
 * no-op (`NOOP_TRACE` is a frozen singleton — `time` calls the wrapped
 * function with no measurement, `mark`/`data`/`flush` do nothing).
 *
 * When enabled, the module logs **timings, counts, and sizes only** —
 * never payload contents, prompt text, answer text, customer rows, or
 * secrets. Each log line is structured for greppability:
 *
 *   [perf-trace] phase=<phase> route=<path> id=<trace-id> total_ms=<n>
 *                entries=[{label,ms} | {label,value}, …]
 *
 * Trace IDs flow from middleware → shell layout → route loader via the
 * `x-beacon-perf-trace-id` request header (middleware mutates it on the
 * forwarded request; downstream phases read via Next's `headers()`).
 * This lets the operator correlate all log lines for a single request
 * across runtime boundaries.
 *
 * Safe to leave deployed temporarily — when the env flag is unset, the
 * runtime cost is one branch + one frozen-object access per `time` call.
 */

import "server-only";

/** HTTP request header used to correlate middleware → layout → route
 *  trace lines across runtime boundaries. */
export const PERF_TRACE_HEADER_NAME = "x-beacon-perf-trace-id";

/** Returns whether perf tracing is enabled for the current runtime. */
export function perfTraceEnabled(): boolean {
  return process.env.BEACON_PERF_TRACE === "true";
}

/**
 * Best-effort read of the trace ID forwarded via header. Falls back to
 * `null` when:
 *   - the runtime is outside a Next.js request scope (test harnesses
 *     calling page components directly via `renderToStaticMarkup` —
 *     `headers()` throws in that context),
 *   - the header was never set (middleware short-circuited / tracing
 *     disabled).
 * The trace constructor accepts `null` and generates a fresh ID when
 * needed. Safe to call unconditionally.
 */
export async function readPerfTraceIdFromHeaders(): Promise<string | null> {
  try {
    // Dynamic import keeps the dependency optional; if the host
    // environment doesn't ship `next/headers` (e.g. plain Node test
    // runner) the import resolves to a Next module that throws on
    // call — both branches collapse to `null` here.
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get(PERF_TRACE_HEADER_NAME);
  } catch {
    return null;
  }
}

export type PerfTraceEntry =
  | { label: string; ms: number }
  | { label: string; value: number | string };

export type PerfTrace = {
  /** The trace ID for header correlation. Empty string when tracing is
   *  disabled. */
  readonly id: string;
  /** Wraps an async (or sync) function with timing. Returns the same
   *  resolved value. Even when tracing is disabled this stays safe — the
   *  NOOP path invokes the inner function and returns its result
   *  unchanged. */
  time<T>(label: string, fn: () => Promise<T> | T): Promise<T>;
  /** Records a checkpoint with elapsed-from-start ms. */
  mark(label: string): void;
  /** Records a number or short string data point (size, row count,
   *  status). NEVER pass customer/secret/payload content. */
  data(label: string, value: number | string): void;
  /** Records a payload size by serializing `obj` and counting bytes.
   *  Safe wrapper around `JSON.stringify` + `TextEncoder` — falls back
   *  to `-1` on serialization failure (cycles, non-JSON values). Only
   *  serializes when tracing is enabled; zero cost otherwise. */
  measureSize(label: string, obj: unknown): void;
  /** Logs the collected entries to console.log and resets. Idempotent —
   *  multiple flushes are silently dropped. */
  flush(): void;
};

const NOOP_TRACE: PerfTrace = Object.freeze({
  id: "",
  time: async <T>(_l: string, fn: () => Promise<T> | T): Promise<T> => fn(),
  mark: (_l: string) => {},
  data: (_l: string, _v: number | string) => {},
  measureSize: (_l: string, _o: unknown) => {},
  flush: () => {},
});

function newId(): string {
  // 8-char base36 random; collisions are extremely unlikely for a
  // single operator clicking through. Crypto.randomUUID would also
  // work but pulls in node:crypto in edge runtime.
  return Math.random().toString(36).slice(2, 10);
}

const encoder = new TextEncoder();

/**
 * Build a trace for a single phase of a single request.
 *
 *   const trace = createPerfTrace("middleware", { route: req.nextUrl.pathname });
 *   await trace.time("auth.getUser", () => supabase.auth.getUser());
 *   trace.flush();
 *
 * When tracing is disabled (default), returns the NOOP singleton — no
 * allocations, no closures, no console.log. Callers can use the API
 * unconditionally without any `if (perfTraceEnabled())` branches.
 *
 * `phase` is the named stage (e.g. "middleware", "shell-layout",
 * "loader:/today"). `opts.route` is the path. `opts.traceId` correlates
 * across phases — pass through the value from `headers().get(...)` or
 * generate fresh in the entry-point phase.
 */
export function createPerfTrace(
  phase: string,
  opts?: { traceId?: string | null; route?: string | null },
): PerfTrace {
  if (!perfTraceEnabled()) return NOOP_TRACE;

  const id = opts?.traceId && opts.traceId.length > 0 ? opts.traceId : newId();
  const route = opts?.route ?? "";
  const startMs = performance.now();
  const entries: PerfTraceEntry[] = [];
  let flushed = false;

  return {
    id,
    async time(label, fn) {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        entries.push({ label, ms: performance.now() - t0 });
      }
    },
    mark(label) {
      entries.push({ label, ms: performance.now() - startMs });
    },
    data(label, value) {
      // Defense-in-depth: numbers and short strings only. Truncate any
      // accidental long value at 64 chars so the log line stays small.
      const safeValue =
        typeof value === "string" && value.length > 64
          ? value.slice(0, 64)
          : value;
      entries.push({ label, value: safeValue });
    },
    measureSize(label, obj) {
      try {
        const json = JSON.stringify(obj);
        const size = encoder.encode(json).byteLength;
        entries.push({ label: `${label}_bytes`, value: size });
      } catch {
        entries.push({ label: `${label}_bytes`, value: -1 });
      }
    },
    flush() {
      if (flushed) return;
      flushed = true;
      const totalMs = performance.now() - startMs;
      // Structured log line — easy to grep + parse in Vercel logs.
      console.log(
        `[perf-trace] phase=${phase} route=${route} id=${id} total_ms=${totalMs.toFixed(
          1,
        )} entries=${JSON.stringify(
          entries.map((e) =>
            "ms" in e
              ? { label: e.label, ms: Number(e.ms.toFixed(1)) }
              : e,
          ),
        )}`,
      );
    },
  };
}
