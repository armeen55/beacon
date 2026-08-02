/**
 * robots.txt parsing.
 *
 * TWO THINGS COME OUT OF ONE FETCH: the Sitemap: directives (the site's OWN answer to "where is
 * everything?", which is where owned-page discovery starts) and the User-agent rule blocks. Parsing
 * follows RFC 9309: grouped User-agent lines share a ruleset, an empty Disallow means allow-all,
 * comments are stripped.
 *
 * Pure string to data. The AI-crawler access evaluators that used to live here were deleted
 * 2026-08-03 with zero callers; the crawl's own robots respect lives in polite-fetch.ts, which is
 * the one place a fetch is ever gated.
 */

import "server-only";

export type RobotsRule = {
  kind: "allow" | "disallow";
  /** The raw path pattern from robots.txt, e.g. "/admin/", "/*.json$", "/" */
  pattern: string;
};

export type RobotsDirectives = {
  /** Crawler name as it appeared in User-agent (case preserved for logging). */
  userAgent: string;
  rules: RobotsRule[];
};

export type RobotsFile = {
  directives: RobotsDirectives[];
  /** Sitemap: lines, in the order the file listed them. THE discovery seed. */
  sitemaps: string[];
  source: string;
  /** HTTP status of the fetch. 404 is "no rules", never an error. */
  status: number;
  fetchedAt: string;
};

/** The persisted shape the tenant repository reads and writes. */
export type RobotsStateFile = {
  schemaVersion: 1;
  siteDomain: string;
  parsed: RobotsFile | null;
  lastFetchedAt: string;
  lastFetchError: string | null;
};

/** Parse raw robots.txt text into directives plus the Sitemap: lines. */
export function parseRobotsText(text: string, source: string, status: number): RobotsFile {
  const blocks: RobotsDirectives[] = [];
  const sitemaps: string[] = [];
  let currentAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let inAgentBlock = false;

  const flushBlock = () => {
    if (currentAgents.length > 0 && currentRules.length > 0) {
      for (const agent of currentAgents) blocks.push({ userAgent: agent, rules: [...currentRules] });
    }
    currentAgents = [];
    currentRules = [];
    inAgentBlock = false;
  };

  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (!line || colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines before any rule share the next ruleset.
      if (inAgentBlock && currentRules.length === 0) currentAgents.push(value);
      else {
        flushBlock();
        currentAgents = [value];
        inAgentBlock = true;
      }
    } else if (field === "allow" || field === "disallow") {
      // "Disallow:" with no value means allow everything, per REP.
      if (field === "disallow" && value === "") currentRules.push({ kind: "allow", pattern: "/" });
      else if (value !== "") currentRules.push({ kind: field, pattern: value });
      inAgentBlock = true;
    } else if (field === "sitemap" && value) {
      sitemaps.push(value);
    }
  }
  flushBlock();
  return { directives: blocks, sitemaps, source, status, fetchedAt: new Date().toISOString() };
}
