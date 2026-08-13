import "server-only";
import { cache } from "react";

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
function perfLogEnabled(): boolean {
  return process.env.BEACON_PERF_LOG === "1";
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
type ExternalCallKind = "serp" | "llm" | "dataforseo" | "crawl";

type ExternalCallCounts = Record<ExternalCallKind, number>;

function zeroCounts(): ExternalCallCounts {
  return { serp: 0, llm: 0, dataforseo: 0, crawl: 0 };
}

/**
 * W2-B (2026-07-10) - PER-REQUEST tally scoping. The old tally was a single
 * process-level object, so on a warm lambda one GET's count leaked into the next
 * (a paid call from request A inflated request B's "external calls per GET" read,
 * making the guard-check dishonest). `react.cache` memoizes ONE counts object per
 * request/render, so a fresh request automatically starts at zero with NO manual
 * reset - the honest per-GET tally. OUTSIDE a request scope (crons, scripts,
 * tests) `cache()` is a passthrough that returns a fresh object on every call, so
 * we detect that (two calls return different identities) and fall back to a stable
 * module-level object, so accumulation + explicit reset still work there.
 */
const perRequestCounts = cache((): ExternalCallCounts => zeroCounts());
const fallbackCounts: ExternalCallCounts = zeroCounts();

function activeCounts(): ExternalCallCounts {
  // In a request scope both calls return the SAME memoized object (stable identity
  // -> use it, accumulates per request, auto-resets next request). Outside one,
  // each call builds a new object (identity differs -> use the module fallback).
  const a = perRequestCounts();
  const b = perRequestCounts();
  return a === b ? a : fallbackCounts;
}

/** Record that a paid/live external call is about to fire. Always tallies (cheap); only
 *  logs when enabled. Call this at the transport entry (SERP runner, LLM gateway,
 *  DataForSEO Labs/keywords transports, crawler) so the "external calls per GET" count
 *  is honest. */
export function perfCountExternal(kind: ExternalCallKind, detail?: string): void {
  const counts = activeCounts();
  counts[kind] += 1;
  if (!perfLogEnabled()) return;
  const suffix = detail ? ` detail=${detail}` : "";
  console.warn(`[perf][external] kind=${kind} total=${counts[kind]}${suffix}`);
}

