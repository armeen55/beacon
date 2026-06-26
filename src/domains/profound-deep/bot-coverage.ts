/**
 * bot-coverage (2026-06-25, Sprint 6) — turn the DEAD `profound_bot_rows` table into
 * a crawlability signal. PURE / deterministic / no I/O.
 *
 * Bot rows record which AI crawlers (GPTBot, PerplexityBot, ClaudeBot, …) hit which
 * pages. The high-value insight: a page with real demand/value that AI crawlers are
 * NOT hitting can never be cited — that's a crawlability gap worth a technical Move.
 * No fabrication — empty rows → no claims.
 *
 * Pinned by bot-coverage.test.ts.
 */

export type ProfoundBotRow = {
  date: string;
  path: string;
  botName: string; // e.g. "GPTBot", "PerplexityBot", "ClaudeBot"
  botType: string;
  hitCount: number;
  citations: number;
};

function canonPath(p: string): string {
  if (!p) return "/";
  let path = p;
  try {
    path = p.startsWith("http") ? new URL(p).pathname : p;
  } catch {
    /* raw */
  }
  path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path.toLowerCase();
}

export type BotCoverageByPage = {
  path: string;
  totalHits: number;
  totalCitations: number;
  bots: { bot: string; hits: number }[];
};

/** Aggregate AI-crawler coverage per page. PURE. */
export function aggregateBotCoverageByPage(rows: ProfoundBotRow[]): BotCoverageByPage[] {
  const byPage = new Map<string, { hits: number; cites: number; bots: Map<string, number> }>();
  for (const r of rows) {
    if (!r.path) continue;
    const key = canonPath(r.path);
    const e = byPage.get(key) ?? { hits: 0, cites: 0, bots: new Map() };
    e.hits += r.hitCount ?? 0;
    e.cites += r.citations ?? 0;
    if (r.botName) e.bots.set(r.botName, (e.bots.get(r.botName) ?? 0) + (r.hitCount ?? 0));
    byPage.set(key, e);
  }
  return [...byPage.entries()]
    .map(([path, e]) => ({
      path,
      totalHits: e.hits,
      totalCitations: e.cites,
      bots: [...e.bots.entries()].map(([bot, hits]) => ({ bot, hits })).sort((a, b) => b.hits - a.hits),
    }))
    .sort((a, b) => b.totalHits - a.totalHits);
}

export type ValuablePage = {
  path: string;
  /** A relative importance score (GSC clicks, GA4 value, demand — caller-supplied). */
  value: number;
};

export type CrawlabilityGap = {
  path: string;
  value: number;
  botHits: number;
  reason: string;
  severity: "high" | "medium";
};

/**
 * Pages that MATTER (value) but AI crawlers barely hit (≤ `minHits`). These can't be
 * cited by AI until they're crawlable — a high-leverage technical Move. PURE.
 * Fail-soft: with NO bot data at all, returns [] (we don't guess crawl status).
 */
export function findCrawlabilityGaps(
  botRows: ProfoundBotRow[],
  valuablePages: ValuablePage[],
  opts: { minHits?: number; minValue?: number } = {},
): CrawlabilityGap[] {
  if (botRows.length === 0) return []; // no crawl evidence → no claims (fail closed)
  const minHits = opts.minHits ?? 0;
  const minValue = opts.minValue ?? 1;
  const coverage = new Map(aggregateBotCoverageByPage(botRows).map((c) => [c.path, c.totalHits]));
  const gaps: CrawlabilityGap[] = [];
  for (const vp of valuablePages) {
    if ((vp.value ?? 0) < minValue) continue;
    const hits = coverage.get(canonPath(vp.path)) ?? 0;
    if (hits <= minHits) {
      gaps.push({
        path: canonPath(vp.path),
        value: vp.value,
        botHits: hits,
        reason:
          hits === 0
            ? "AI crawlers haven't hit this valuable page — it can't be cited until they can crawl it."
            : "AI crawlers barely hit this valuable page — improve crawlability/links to it.",
        severity: hits === 0 ? "high" : "medium",
      });
    }
  }
  return gaps.sort((a, b) => b.value - a.value);
}

export function summarizeBots(rows: ProfoundBotRow[]): {
  totalHits: number;
  pages: number;
  topBots: { bot: string; hits: number }[];
} {
  const byBot = new Map<string, number>();
  let total = 0;
  const pages = new Set<string>();
  for (const r of rows) {
    total += r.hitCount ?? 0;
    if (r.path) pages.add(canonPath(r.path));
    if (r.botName) byBot.set(r.botName, (byBot.get(r.botName) ?? 0) + (r.hitCount ?? 0));
  }
  return {
    totalHits: total,
    pages: pages.size,
    topBots: [...byBot.entries()].map(([bot, hits]) => ({ bot, hits })).sort((a, b) => b.hits - a.hits).slice(0, 8),
  };
}
