import "server-only";

/**
 * perf-log (P0-B Wave 1, 2026-07-10) --- lightweight, opt-in stage timing + external-call
 * counting for the page GET/render paths (Today `/`, `/changes`, `/results`).
 *
 * OFF by default: every helper is a no-op unless `BEACON_PERF_LOG=1`. It never runs on a
 * prod render path unless the operator explicitly turns it on, so it adds zero latency and
 * zero log noise to normal traffic. It records ONLY stage names, elapsed milliseconds, and
 * a coarse per-request external-call tally --- no secrets, no PII, no query text, no URLs.
 *
 * Two things it measures:
 *   1) STAGE TIMING --- `perfStage(stage, startMs)` logs how long a labelled stage took
 *      (tenant resolve, canonical ledger read, GSC, GA4, AEO, keyword research,
 *      SERP/competitor, ranking, source/draft hydration, render assembly).
 *   2) EXTERNAL-CALL COUNT --- `perfCountExternal(kind)` is called at the PAID/LIVE entry
 *      points (the SERP runner, the LLM gateway, live crawls). It both logs the call and
 *      bumps a process-level tally so a GET can be checked to fire ZERO paid/SERP calls
 *      after the Wave-1 guard.
 */

/** Turn on with BEACON_PERF_LOG=1. Read lazily so a test can toggle process.env. */
export function perfLogEnabled(): boolean {
  return process.env.BEACON_PERF_LOG === "1";
}

/** A monotonic start mark. Cheap; safe to call unconditionally. */
export function perfMark(): number {
  return Date.now();
}

/** Log the elapsed time of a labelled render stage. No-op unless enabled. `meta` must be
 *  non-PII (counts/flags only) --- never a URL, query, or secret. */
export function perfStage(stage: string, startMs: number, meta?: Record<string, number | string | boolean>): void {
  if (!perfLogEnabled()) return;
  const ms = Date.now() - startMs;
  const extra = meta ? " " + JSON.stringify(meta) : "";
  // console.info so it lands on the dev server stdout and Vercel function logs alike.
  console.info(`[perf] stage=${stage} ms=${ms}${extra}`);
}

/** The paid/live sinks a page GET must NEVER reach after the Wave-1 guard. */
export type ExternalCallKind = "serp" | "llm" | "dataforseo" | "crawl";

// Process-level tally. Best-effort visibility, not a hard budget. Reset per measurement run.
const externalCallCounts: Record<ExternalCallKind, number> = { serp: 0, llm: 0, dataforseo: 0, crawl: 0 };

/** Record that a paid/live external call is about to fire. Always tallies (cheap); only
 *  logs when enabled. Call this at the transport entry (SERP runner, LLM gateway, crawler)
 *  so the "external calls per GET" count is honest. */
export function perfCountExternal(kind: ExternalCallKind, detail?: string): void {
  externalCallCounts[kind] += 1;
  if (!perfLogEnabled()) return;
  const suffix = detail ? ` detail=${detail}` : "";
  console.warn(`[perf][external] kind=${kind} total=${externalCallCounts[kind]}${suffix}`);
}

/** Snapshot the running external-call tally (for a diagnostics endpoint or a test). */
export function readExternalCallCounts(): Readonly<Record<ExternalCallKind, number>> {
  return { ...externalCallCounts };
}

/** Zero the tally (call at the start of a measurement window). */
export function resetExternalCallCounts(): void {
  externalCallCounts.serp = 0;
  externalCallCounts.llm = 0;
  externalCallCounts.dataforseo = 0;
  externalCallCounts.crawl = 0;
}
