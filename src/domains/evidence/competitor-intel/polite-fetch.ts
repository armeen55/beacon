/**
 * 2026-06-09 — Polite external page fetching for competitor intel.
 *
 * Mirrors the posture of `scripts/scan-competitor-pages.ts` and the
 * sitemap crawler: identified User-Agent, robots.txt respected per
 * origin, hard timeout, sequential callers only. `fetchImpl` is
 * injectable so tests never touch the network.
 *
 * robots.txt parsing is deliberately minimal + conservative: we honor
 * `Disallow` rules under `User-agent: *` and `User-agent: BeaconBot`.
 * A robots fetch failure is treated as PERMISSIVE (we already identify
 * ourselves + fetch rarely and sequentially) — same call the scanner
 * script made.
 */

import type { ResearchWinningAppearance } from "@/domains/evidence/funnel/research-evidence";
import { perfCountExternal } from "@/lib/obs/perf-log";
import { isSafeRedirectHopUrl } from "@/lib/net/safe-source-fetch";

export const COMPETITOR_INTEL_UA = "BeaconBot/1.0 (competitor-intel)";
const TIMEOUT_MS = 10_000;

/** Gemini's grounding redirect wrapper. A live Gemini observation (2026-07-24)
 *  returned citations whose host is EXACTLY this, each redirecting to the real
 *  source. The wrapper is infrastructure, never a page that can win. THE single
 *  source of this host string for the funnel. */
export const GEMINI_WRAPPER_HOST = "vertexaisearch.cloud.google.com";

type PoliteFetchDeps = {
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Default 10s (competitor-intel posture).
   *  Onboarding derivation passes 20s — live check 2026-06-11: a real
   *  Wix homepage (iranopedia.com) exceeds 10s cold, and silently
   *  losing derivation for slow-but-fine sites is worse than a slower
   *  one-time launch step. */
  timeoutMs?: number;
};

type RobotsVerdict = "allowed" | "blocked";

/** Parse robots.txt: collect Disallow prefixes for UA groups `*` and
 *  `beaconbot`. Empty Disallow ("Disallow:") allows everything. */
function parseRobotsDisallows(robotsTxt: string): string[] {
  const disallows: string[] = [];
  let applies = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua.includes("beaconbot");
    } else if (field === "disallow" && applies) {
      if (value !== "") disallows.push(value);
    }
  }
  return disallows;
}

function isPathAllowed(
  path: string,
  disallows: ReadonlyArray<string>,
): boolean {
  for (const rule of disallows) {
    if (rule === "/") return false;
    if (path.startsWith(rule)) return false;
  }
  return true;
}

/**
 * Robots verdict for a URL. One robots.txt fetch per origin — caller
 * passes a shared cache map across a refresh run.
 */
async function robotsVerdictFor(
  url: string,
  robotsCache: Map<string, string[]>,
  deps: PoliteFetchDeps = {},
): Promise<RobotsVerdict> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let origin: string;
  let path: string;
  try {
    const u = new URL(url);
    origin = u.origin;
    path = u.pathname || "/";
  } catch {
    return "blocked"; // unfetchable URL — never try
  }

  let disallows = robotsCache.get(origin);
  if (disallows == null) {
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, {
        headers: { "User-Agent": COMPETITOR_INTEL_UA },
        signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      });
      disallows = res.ok ? parseRobotsDisallows(await res.text()) : [];
    } catch {
      disallows = []; // fetch failure → permissive (identified UA + rare, sequential pulls)
    }
    robotsCache.set(origin, disallows);
  }
  return isPathAllowed(path, disallows) ? "allowed" : "blocked";
}

type PoliteHtmlResult =
  | {
      ok: true;
      html: string;
      status: number;
      /** W5 P2 (2026-07-09), additive: the FINAL URL after any redirects
       *  (`Response.url`), so a caller can confirm the fetch didn't land on a
       *  different host. Optional so every existing caller/mock is unaffected;
       *  absent when the fetch layer doesn't surface it (e.g. a test stub). */
      finalUrl?: string;
    }
  | { ok: false; reason: "robots_blocked" | "fetch_failed"; detail?: string };

/** Fetch one page's HTML with the identified UA + timeout. */
export async function fetchPageHtml(
  url: string,
  robotsCache: Map<string, string[]>,
  deps: PoliteFetchDeps = {},
): Promise<PoliteHtmlResult> {
  const verdict = await robotsVerdictFor(url, robotsCache, deps);
  if (verdict === "blocked") return { ok: false, reason: "robots_blocked" };
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    // W2-B - count the live page crawl at its transport, so the per-GET external-
    // call tally shows any crawl a render path accidentally triggers (it must be 0).
    perfCountExternal("crawl");
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": COMPETITOR_INTEL_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, reason: "fetch_failed", detail: `http_${res.status}` };
    }
    return {
      ok: true,
      html: await res.text(),
      status: res.status,
      finalUrl: typeof res.url === "string" && res.url ? res.url : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: err instanceof Error ? err.message : "unknown",
    };
  }
}

// -- Slice 6I: bounded redirect-only resolution of Gemini wrapper citations ---

const MAX_REDIRECT_HOPS = 4;
const MAX_RESOLUTIONS_PER_CALL = 10;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when a URL's host is EXACTLY the Gemini wrapper (never a suffix match:
 *  a real source must never be mistaken for infrastructure). */
function isGeminiWrapperUrl(url: string): boolean {
  return hostOf(url) === GEMINI_WRAPPER_HOST;
}

/** Follow a wrapper URL by Location header ONLY. Never downloads or parses a
 *  body (redirect: "manual" + immediate body cancel); requests go ONLY to the
 *  wrapper host, and the FIRST off-wrapper Location IS the resolved source
 *  (no confirmation request to the final host, so its robots posture is never
 *  touched here; a later content GET flows through fetchPageHtml with robots
 *  on the final host). Every hop target passes isSafeRedirectHopUrl, the SAME
 *  hardened screen the safe-source fetcher uses (metadata hosts, intranet
 *  names, private/reserved literal IPs): a redirect chain is attacker-shaped
 *  input and may never point inside the deployment. Null on any failure. */
async function resolveOneRedirect(startUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  let current = startUrl;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    let res: Response;
    try {
      perfCountExternal("crawl", "gemini-wrapper-hop");
      res = await fetchImpl(current, {
        method: "GET",
        headers: { "User-Agent": COMPETITOR_INTEL_UA, Accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "manual",
      });
    } catch {
      return null;
    }
    // Never read the body: cancel the stream the moment headers are in.
    try {
      await res.body?.cancel?.();
    } catch {
      /* body already closed or absent (test stub) - nothing to release */
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return null; // the wrapper always redirects; anything else is not a resolution
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      return null;
    }
    if (!isSafeRedirectHopUrl(next)) return null;
    if (hostOf(next) !== GEMINI_WRAPPER_HOST) return next; // first off-wrapper target IS the source
    current = next;
  }
  return null; // hop budget spent mid-chain: unresolved, never a guess
}

/**
 * Resolve Gemini wrapper citations to their real target, in place, order
 * preserved. ONLY appearances whose citedUrl host is exactly
 * GEMINI_WRAPPER_HOST are touched; everything else passes through untouched
 * with zero fetches. Per-call: at most MAX_RESOLUTIONS_PER_CALL chains, one
 * chain per distinct URL (deduped). On success citedUrl becomes the final URL
 * and viaUrl keeps the raw wrapper URL; on ANY failure the appearance is
 * returned UNCHANGED (the raw wrapper stays as honest unresolved evidence).
 */
export async function resolveCitationTargets(
  appearances: ResearchWinningAppearance[],
  fetchImpl?: typeof fetch,
  /** Absolute epoch ms; past it, remaining wrappers stay raw (the caller's unit budget bounds us). */
  deadlineMs?: number,
): Promise<ResearchWinningAppearance[]> {
  const impl = fetchImpl ?? fetch;
  const resolved = new Map<string, string | null>();
  const out: ResearchWinningAppearance[] = [];
  for (const a of appearances) {
    if (!a.citedUrl || !isGeminiWrapperUrl(a.citedUrl)) {
      out.push(a);
      continue;
    }
    let target = resolved.get(a.citedUrl);
    if (target === undefined) {
      if (resolved.size >= MAX_RESOLUTIONS_PER_CALL || (deadlineMs != null && Date.now() > deadlineMs)) {
        out.push(a); // budget or deadline spent: leave the rest raw
        continue;
      }
      target = await resolveOneRedirect(a.citedUrl, impl);
      resolved.set(a.citedUrl, target);
    }
    out.push(target ? { ...a, citedUrl: target, viaUrl: a.citedUrl } : a);
  }
  return out;
}
