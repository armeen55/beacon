/**
 * robots.txt parser + AI crawler rule detector.
 *
 * Fetches `${siteDomain}/robots.txt`, parses User-agent blocks, and for each
 * owned URL returns whether it is Allowed/Disallowed by each of the major AI
 * crawlers. If any AI bot is disallowed on cited pages, a critical finding
 * should fire — that's a silent AEO killer no other check catches.
 *
 * This module is green-field. It does NOT touch the existing scan orchestrator
 * or page extractor. Callers (scan run, on-demand refresh) own when to fetch.
 *
 * AI crawlers we care about (2026 consensus):
 *   - GPTBot           → OpenAI (ChatGPT retrieval + training)
 *   - ChatGPT-User     → OpenAI (live browsing from ChatGPT clients)
 *   - PerplexityBot    → Perplexity AI
 *   - ClaudeBot        → Anthropic
 *   - Google-Extended  → Google AI Overviews / SGE (separate from Googlebot)
 *   - CCBot            → Common Crawl (feeds many LLM training sets)
 *   - Applebot-Extended → Apple Intelligence
 *
 * Parsing rules follow the REP (https://datatracker.ietf.org/doc/html/rfc9309):
 *   - User-agent: * applies if no specific block for that bot
 *   - Longest path-prefix match wins between conflicting Allow / Disallow
 *   - Wildcards (*) and end-of-path ($) are honored
 */

import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
] as const;

export type AiCrawler = (typeof AI_CRAWLERS)[number];

export type RobotsRule = {
  /** "allow" or "disallow". */
  kind: "allow" | "disallow";
  /** The raw path pattern from robots.txt, e.g. "/admin/", "/*.json$", "/" */
  pattern: string;
};

export type RobotsDirectives = {
  /** Crawler name as it appeared in User-agent (case-preserved for logging). */
  userAgent: string;
  rules: RobotsRule[];
};

export type RobotsFile = {
  /** Raw parsed directives, one per User-agent block. */
  directives: RobotsDirectives[];
  /** Sitemap: lines found. */
  sitemaps: string[];
  /** Source URL the robots.txt was fetched from. */
  source: string;
  /** HTTP status of the fetch. 404 is treated as "no rules" not error. */
  status: number;
  fetchedAt: string;
};

export type AiBotAccessVerdict = {
  /** Path we evaluated (normalized, e.g. "/services/foo"). */
  path: string;
  /** Per-crawler allow/disallow conclusion. */
  perCrawler: Record<AiCrawler, { allowed: boolean; matchedRule: RobotsRule | null }>;
  /** True when at least one AI crawler is disallowed. */
  anyDisallowed: boolean;
  /** Crawlers that are disallowed for this path (most useful surface for findings). */
  blockedCrawlers: AiCrawler[];
};

// ---------------------------------------------------------------------------
// State file (cached parsed directives per site — mirrors scan-state shape).
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), ".data");
const STATE_FILE_NAME = "robots-state";

export type RobotsStateFile = {
  schemaVersion: 1;
  siteDomain: string;
  parsed: RobotsFile | null;
  lastFetchedAt: string;
  lastFetchError: string | null;
};

function ensureDataDir(): void {
  if (process.env.VERCEL === "1") return;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function statePath(): string {
  return join(DATA_DIR, `${STATE_FILE_NAME}.json`);
}

/**
 * Phase A.3 (post-A.3.5, 2026-05-15) — async + tenant-scoped robots-
 * state read/write. Routes through the tenant repository
 * (`getRepository().forTenant(tenantId)`):
 *
 *   • On production (supabase-backend), reads `public.robots_state`
 *     filtered by tenant_id; soft-fails to null on the
 *     undefined-table error code 42P01 (sequencing model A — code
 *     is safe to deploy before the migration applies).
 *   • In dev (file-backend), routes through
 *     `readDotDataJson("robots-state")` /
 *     `writeDotDataJson("robots-state")` — `robots-state` is
 *     classified as SINGLETON in `store-classification.ts`, so
 *     the path resolves to `.data/tenants/{slug}/robots-state.json`
 *     via the AsyncLocalStorage tenant context.
 *
 * The pre-A.3 flat-path file (`.data/robots-state.json`) is RETIRED.
 * Legacy `statePath()` / `ensureDataDir()` / synchronous helpers are
 * kept inside the module only because `writeRobotsState`'s file-side
 * write delegates to the tenant-routed `writeDotDataJson` — which
 * itself uses atomic rename. Any caller still importing the old
 * flat-path helpers will fail-loud at the type level: the public
 * signatures are now async and take `tenantId`.
 */
export async function readRobotsState(opts: {
  tenantId: string;
}): Promise<RobotsStateFile | null> {
  const { getRepository } = await import("@/lib/persistence/repositories");
  try {
    const repo = getRepository().forTenant(opts.tenantId);
    return await repo.getRobotsState();
  } catch (e) {
    // Defensive: any unexpected repository failure (e.g.,
    // misconfigured backend during early init) degrades to null
    // rather than throwing — the indexability loader treats null
    // as "no evidence" and the verdict falls to `unknown`.
    // eslint-disable-next-line no-console
    console.warn(
      "[robots-parser] readRobotsState repository read failed",
      e,
    );
    return null;
  }
}

export async function writeRobotsState(opts: {
  tenantId: string;
  state: RobotsStateFile;
}): Promise<void> {
  const { getRepository } = await import("@/lib/persistence/repositories");
  const repo = getRepository().forTenant(opts.tenantId);
  // Fail-loud (sequencing model A): if Supabase rejects the upsert
  // (e.g., undefined_table because migration hasn't applied), the
  // error propagates to the scan orchestrator and surfaces in
  // GH Actions logs. Operator notices and applies the migration.
  await repo.setRobotsState(opts.state);
}

// ---------------------------------------------------------------------------
// Parser (pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Parse raw robots.txt text into structured directives.
 * Handles grouped User-agent blocks (multiple User-agent lines share the rules
 * until the next directive block).
 */
export function parseRobotsText(
  text: string,
  source: string,
  status: number,
): RobotsFile {
  const lines = text.split(/\r?\n/);
  const blocks: RobotsDirectives[] = [];
  const sitemaps: string[] = [];

  let currentAgents: string[] = [];
  let currentRules: RobotsRule[] = [];
  let inAgentBlock = false;

  const flushBlock = () => {
    if (currentAgents.length > 0 && currentRules.length > 0) {
      for (const agent of currentAgents) {
        blocks.push({ userAgent: agent, rules: [...currentRules] });
      }
    }
    currentAgents = [];
    currentRules = [];
    inAgentBlock = false;
  };

  for (const rawLine of lines) {
    // Strip comments and trim.
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // If we were building rules and now see a new User-agent, the previous
      // block ended. Flush it. Multi-agent grouping: consecutive user-agents
      // before any rule share the same ruleset.
      if (inAgentBlock && currentRules.length === 0) {
        currentAgents.push(value);
      } else {
        flushBlock();
        currentAgents = [value];
        inAgentBlock = true;
      }
    } else if (field === "allow" || field === "disallow") {
      // Disallow with empty value means "allow everything" per REP — we record
      // it as an allow of "/" so that `evaluateRulesForPath` treats it correctly.
      if (field === "disallow" && value === "") {
        currentRules.push({ kind: "allow", pattern: "/" });
      } else if (value !== "") {
        currentRules.push({ kind: field, pattern: value });
      }
      inAgentBlock = true;
    } else if (field === "sitemap") {
      if (value) sitemaps.push(value);
    }
    // Ignore other fields (crawl-delay, host, etc.)
  }

  flushBlock();

  return {
    directives: blocks,
    sitemaps,
    source,
    status,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fetcher (does I/O)
// ---------------------------------------------------------------------------

export async function fetchAndParseRobots(siteDomain: string): Promise<RobotsFile> {
  const url = normalizeRobotsUrl(siteDomain);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "BeaconScanner/1.0" } });
    const text = res.ok ? await res.text() : "";
    return parseRobotsText(text, url, res.status);
  } catch (err) {
    return {
      directives: [],
      sitemaps: [],
      source: url,
      status: 0,
      fetchedAt: new Date().toISOString(),
    };
  }
}

function normalizeRobotsUrl(siteDomain: string): string {
  let base = siteDomain.trim();
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, "");
  return `${base}/robots.txt`;
}

export async function refreshRobotsState(opts: {
  siteDomain: string;
  tenantId: string;
}): Promise<RobotsStateFile> {
  const parsed = await fetchAndParseRobots(opts.siteDomain);
  const state: RobotsStateFile = {
    schemaVersion: 1,
    siteDomain: opts.siteDomain,
    parsed,
    lastFetchedAt: new Date().toISOString(),
    lastFetchError: parsed.status >= 400 ? `HTTP ${parsed.status}` : null,
  };
  await writeRobotsState({ tenantId: opts.tenantId, state });
  return state;
}

// ---------------------------------------------------------------------------
// Path evaluation — standard REP longest-prefix-match
// ---------------------------------------------------------------------------

/**
 * Compile a robots.txt pattern to a regex.
 * - `*` matches any sequence of characters
 * - `$` at end of pattern anchors to end-of-path
 * - Everything else literal
 */
function patternToRegex(pattern: string): RegExp {
  // Escape ALL regex special chars (including * and $). We then convert the
  // escaped \* and trailing \$ back to their wildcard / anchor meaning.
  const escaped = pattern.replace(/[*.+?^${}()|[\]\\]/g, "\\$&");
  // Convert escaped \* into .* (wildcard match of any characters).
  let regexStr = escaped.replace(/\\\*/g, ".*");
  // If the pattern ended in \$ (originally $), strip that escape and keep $.
  if (regexStr.endsWith("\\$")) {
    regexStr = regexStr.slice(0, -2) + "$";
  }
  return new RegExp("^" + regexStr);
}

function ruleMatchLength(rule: RobotsRule, path: string): number {
  // Longer literal prefix = stronger match per REP.
  const re = patternToRegex(rule.pattern);
  const m = re.exec(path);
  if (!m) return -1;
  // Score is the length of the pattern (longer = more specific).
  return rule.pattern.length;
}

export function evaluateRulesForPath(
  rules: RobotsRule[],
  path: string,
): { allowed: boolean; matchedRule: RobotsRule | null } {
  let best: { score: number; rule: RobotsRule } | null = null;
  for (const rule of rules) {
    const score = ruleMatchLength(rule, path);
    if (score < 0) continue;
    // On tie, Allow beats Disallow (safer interpretation per Google's parser).
    if (!best || score > best.score || (score === best.score && rule.kind === "allow")) {
      best = { score, rule };
    }
  }
  if (!best) return { allowed: true, matchedRule: null };
  return {
    allowed: best.rule.kind === "allow",
    matchedRule: best.rule,
  };
}

/**
 * Pick the directive block that applies to a given bot.
 * - Exact (case-insensitive) match if present
 * - Else the "*" block
 * - Else null (no rules → allow all)
 */
function pickBlockForBot(
  robots: RobotsFile,
  bot: string,
): RobotsDirectives | null {
  const lower = bot.toLowerCase();
  const exact = robots.directives.find(
    (d) => d.userAgent.toLowerCase() === lower,
  );
  if (exact) return exact;
  const wildcard = robots.directives.find((d) => d.userAgent === "*");
  return wildcard ?? null;
}

export function evaluateAiBotAccess(
  robots: RobotsFile,
  path: string,
): AiBotAccessVerdict {
  const perCrawler = {} as AiBotAccessVerdict["perCrawler"];
  const blocked: AiCrawler[] = [];

  for (const crawler of AI_CRAWLERS) {
    const block = pickBlockForBot(robots, crawler);
    if (!block) {
      perCrawler[crawler] = { allowed: true, matchedRule: null };
      continue;
    }
    const result = evaluateRulesForPath(block.rules, path);
    perCrawler[crawler] = result;
    if (!result.allowed) blocked.push(crawler);
  }

  return {
    path,
    perCrawler,
    anyDisallowed: blocked.length > 0,
    blockedCrawlers: blocked,
  };
}

/**
 * Phase A.3 Step 3a (2026-05-14) — Googlebot allow/deny evaluator.
 *
 * Companion to `evaluateAiBotAccess`. Googlebot is intentionally
 * NOT in `AI_CRAWLERS` (the AI-bot family covers retrieval-side
 * crawlers — GPTBot, PerplexityBot, etc.); Googlebot is the
 * classical discoverability-floor signal. If Googlebot is blocked,
 * Google won't index the page at all — which downstream means AI
 * Overviews + any browse-from-ChatGPT flow that depends on
 * Google's index also can't reach it.
 *
 * Block-selection mirrors the existing AI-bot path exactly via
 * `pickBlockForBot`:
 *   1. Case-insensitive match on a specific `Googlebot` User-agent
 *      block.
 *   2. Fall back to the `*` block.
 *   3. No matching block → default allow.
 *
 * Pure. No I/O. Reuses `evaluateRulesForPath` for rule application
 * so longest-prefix-match + wildcard + end-of-path semantics stay
 * identical to AI-bot evaluation. Adding this helper does NOT
 * alter `AI_CRAWLERS`, `evaluateAiBotAccess`, or any other export.
 */
export function evaluateGooglebotAccess(
  robots: RobotsFile,
  path: string,
): { allowed: boolean; matchedRule: RobotsRule | null } {
  const block = pickBlockForBot(robots, "Googlebot");
  if (!block) {
    return { allowed: true, matchedRule: null };
  }
  return evaluateRulesForPath(block.rules, path);
}

/**
 * Convenience: given a list of owned-URL paths, return only those with AT LEAST
 * one AI bot disallow — the set that should drive critical findings.
 */
export function findBlockedOwnedUrls(
  robots: RobotsFile,
  paths: string[],
): AiBotAccessVerdict[] {
  return paths
    .map((p) => evaluateAiBotAccess(robots, normalizePathForCheck(p)))
    .filter((v) => v.anyDisallowed);
}

function normalizePathForCheck(p: string): string {
  // Accept bare paths or full URLs; always compare as a path starting with "/".
  let path = p.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // fall through
    }
  }
  if (!path.startsWith("/")) path = "/" + path;
  return path;
}
