/**
 * link-liveness (2026-07-03, BEACON_500 P11 v1 319/475/517) - the OPTIONAL live
 * pass that fills in the liveness of link targets we have no stored snapshot for,
 * and resolves redirect chains hop by hop.
 *
 * Deliberately NOT pure and NOT imported by the pure engines. It is called only
 * from the trigger loader / nightly liveness pass, and every network call is:
 *   • MOCKABLE - `fetchImpl` is injectable, so tests never touch the network.
 *   • POLITE - identified BeaconBot UA, robots.txt respected via the shared
 *     polite-fetch robots cache, sequential (the caller awaits each).
 *   • CAPPED - the caller passes a hard cap on how many URLs to probe per run.
 *   • FAIL-SOFT - any error on a URL yields "unknown" for that URL (never a false
 *     "dead"), and the whole pass is wrapped so one failure never breaks the run.
 *
 * A HEAD request with manual redirect handling lets us both classify liveness
 * (2xx/3xx live, 4xx/5xx dead) and count redirect hops without downloading bodies.
 */

import {
  COMPETITOR_INTEL_UA,
  robotsVerdictFor,
  type PoliteFetchDeps,
} from "@/domains/competitor-intel/polite-fetch";
import type { TargetLiveness } from "./broken-links";

const TIMEOUT_MS = 8_000;
/** A single URL is never chased through more hops than this (a runaway redirect
 *  loop is itself a defect, reported as a long chain). */
export const MAX_REDIRECT_HOPS = 5;

export type LivenessResult = {
  /** live (2xx/3xx landed) / dead (4xx/5xx or robots-blocked-as-unknown-safe) /
   *  unknown (never probed / fetch error). */
  liveness: TargetLiveness;
  /** The resolved redirect chain EXCLUDING the start URL: [hop1, ..., final].
   *  Empty when the URL did not redirect or was not probed. */
  redirectChain: string[];
};

const UNKNOWN: LivenessResult = { liveness: "unknown", redirectChain: [] };

/**
 * Probe ONE URL's liveness + redirect chain with a polite, manual-redirect HEAD
 * request. robots-blocked -> unknown (we do not fetch what robots forbids, and we
 * never call a page "dead" just because we could not check it). Any fetch error ->
 * unknown. Sequential; the caller controls how many URLs get here.
 */
export async function probeLiveness(
  url: string,
  robotsCache: Map<string, string[]>,
  deps: PoliteFetchDeps = {},
): Promise<LivenessResult> {
  const verdict = await robotsVerdictFor(url, robotsCache, deps).catch(
    () => "allowed" as const,
  );
  if (verdict === "blocked") return UNKNOWN;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  const chain: string[] = [];
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const res = await fetchImpl(current, {
        method: "HEAD",
        headers: { "User-Agent": COMPETITOR_INTEL_UA },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
      const status = res.status;
      // Redirect: record the next hop and continue (bounded by MAX_REDIRECT_HOPS).
      if (status >= 300 && status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          // A redirect status with no Location is malformed; treat as live-ish
          // (it responded) but stop chasing.
          return { liveness: "live", redirectChain: chain };
        }
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          return { liveness: "live", redirectChain: chain };
        }
        chain.push(next);
        current = next;
        if (hop === MAX_REDIRECT_HOPS) {
          // Chased the cap and still redirecting: report the chain, liveness live
          // (each hop responded), the long chain is the finding.
          return { liveness: "live", redirectChain: chain };
        }
        continue;
      }
      if (status >= 400) return { liveness: "dead", redirectChain: chain };
      // 2xx landed.
      return { liveness: "live", redirectChain: chain };
    }
    return { liveness: "live", redirectChain: chain };
  } catch {
    return UNKNOWN;
  }
}

/**
 * Probe a CAPPED list of URLs sequentially and return a canonical-URL -> result
 * map. `cap` bounds the number of live probes per run (default 25) so a nightly
 * pass stays polite and cheap; URLs beyond the cap are simply not probed (they
 * stay "unknown", never guessed). Fully fail-soft: a throw on any URL yields
 * unknown for that URL and never aborts the batch.
 */
export async function probeLivenessBatch(
  urls: ReadonlyArray<string>,
  deps: PoliteFetchDeps = {},
  cap = 25,
): Promise<Map<string, LivenessResult>> {
  const out = new Map<string, LivenessResult>();
  const robotsCache = new Map<string, string[]>();
  const capped = urls.slice(0, Math.max(0, cap));
  for (const url of capped) {
    try {
      out.set(url, await probeLiveness(url, robotsCache, deps));
    } catch {
      out.set(url, UNKNOWN);
    }
  }
  return out;
}
