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

export const COMPETITOR_INTEL_UA = "BeaconBot/1.0 (competitor-intel)";
const TIMEOUT_MS = 10_000;

export type PoliteFetchDeps = {
  fetchImpl?: typeof fetch;
};

export type RobotsVerdict = "allowed" | "blocked";

/** Parse robots.txt: collect Disallow prefixes for UA groups `*` and
 *  `beaconbot`. Empty Disallow ("Disallow:") allows everything. */
export function parseRobotsDisallows(robotsTxt: string): string[] {
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

export function isPathAllowed(
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
export async function robotsVerdictFor(
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
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      disallows = res.ok ? parseRobotsDisallows(await res.text()) : [];
    } catch {
      disallows = []; // fetch failure → permissive (identified UA + rare, sequential pulls)
    }
    robotsCache.set(origin, disallows);
  }
  return isPathAllowed(path, disallows) ? "allowed" : "blocked";
}

export type PoliteHtmlResult =
  | { ok: true; html: string; status: number }
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
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": COMPETITOR_INTEL_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, reason: "fetch_failed", detail: `http_${res.status}` };
    }
    return { ok: true, html: await res.text(), status: res.status };
  } catch (err) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: err instanceof Error ? err.message : "unknown",
    };
  }
}
