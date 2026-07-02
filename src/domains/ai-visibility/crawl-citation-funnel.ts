/**
 * crawl-citation-funnel (2026-07-02, BEACON_500 item 7) - PURE per-page join of
 * the AI funnel that already exists as islands:
 *
 *   shipped -> crawled by AI bots (profound_bot_rows, via bot-coverage.ts)
 *           -> cited in AI answers (profound_citation_rows + native poll rows)
 *           -> clicked from an AI surface (ga4_ai_referral_daily)
 *           -> session value (GA4 key events)
 *
 * Every stalled page names its EXACT bottleneck (never crawled vs crawled but
 * not cited vs cited but no clicks), because each routes to a different fix.
 * Honesty rules: a stage claim needs its feed to be reporting tenant-wide
 * ("never crawled" is only sayable when the crawler feed has rows at all);
 * missing feeds soften the sentence instead of fabricating a zero. No I/O
 * here - the loader lives in load-crawl-citation-funnel.ts.
 *
 * Copy contract (Beacon voice): first person, concrete numbers, a next step,
 * no lab jargon, no em or en dashes ever. Pinned by crawl-citation-funnel.test.ts.
 */

export type FunnelStage =
  | "not_crawled"
  | "crawled_not_cited"
  | "cited_no_clicks"
  | "converting"
  | "no_signal";

/** Which feeds are reporting AT ALL for this tenant. Gates every absence claim. */
export type FunnelFeedPresence = {
  /** profound_bot_rows has rows for this tenant. */
  crawl: boolean;
  /** Any citation source (imported rows or the native poll) has rows. */
  cited: boolean;
  /** ga4_ai_referral_daily has rows. */
  clicks: boolean;
  /** How many distinct pages the crawler feed covers tenant-wide (the evidence
   *  number behind a "never crawled" claim). */
  crawledPageCount: number;
};

export type PageFunnelCrawl = {
  count: number;
  /** Latest crawl day (YYYY-MM-DD) or null. */
  lastAt: string | null;
  bots: Array<{ bot: string; hits: number }>;
};

export type PageFunnelCited = {
  count: number;
  /** Distinct tracked questions whose answers cited this page (0 when only
   *  the imported feed, which has no question grain, saw the citations). */
  prompts: number;
  lastAt: string | null;
};

export type PageFunnelClicks = {
  sessions: number;
  keyEvents: number;
  /** Plain assistant name (e.g. "ChatGPT") that sent the most sessions. */
  topSource: string | null;
};

export type PageFunnelInputs = {
  pagePath: string;
  crawled: PageFunnelCrawl;
  cited: PageFunnelCited;
  aiClicks: PageFunnelClicks;
  /** Google impressions over the trailing 90 days - the demand proxy that
   *  ranks stalled pages and powers the internal-link hint. */
  demand: number;
  feeds: FunnelFeedPresence;
};

export type PageFunnel = {
  pagePath: string;
  crawled: PageFunnelCrawl;
  cited: PageFunnelCited;
  aiClicks: PageFunnelClicks;
  demand: number;
  stage: FunnelStage;
  bottleneckSentence: string;
};

import { normalizeUrl } from "@/lib/url/normalize";

/** Canonical join key: origin stripped (INCLUDING the schemeless host form
 *  "iranopedia.com/path" that profound_citation_rows stores, ground-truthed
 *  2026-07-02), query/hash stripped, trailing slash stripped, lowercased, "/"
 *  for root. Delegates to the canonical path normalizer so every feed's paths
 *  meet on the same key. */
export function funnelPathKey(url: string): string {
  return normalizeUrl(url) ?? "/";
}

const n = (v: number): string => Math.round(v).toLocaleString("en-US");

function sentenceFor(inputs: PageFunnelInputs, stage: FunnelStage): string {
  const { crawled, cited, aiClicks, demand, feeds } = inputs;
  switch (stage) {
    case "converting": {
      let line = `This page works end to end. ${n(aiClicks.sessions)} visitor${aiClicks.sessions === 1 ? "" : "s"} arrived from AI assistants`;
      if (aiClicks.topSource) line += `, most from ${aiClicks.topSource}`;
      if (cited.count > 0) line += `, and AI answers cited it ${n(cited.count)} time${cited.count === 1 ? "" : "s"}`;
      line += ".";
      if (aiClicks.keyEvents > 0) {
        line += ` ${n(aiClicks.keyEvents)} of those visits completed a key action.`;
      }
      return line;
    }
    case "cited_no_clicks": {
      const citedPart = `AI answers cited this page ${n(cited.count)} time${cited.count === 1 ? "" : "s"}${
        cited.prompts > 0 ? ` across ${n(cited.prompts)} question${cited.prompts === 1 ? "" : "s"}` : ""
      }`;
      if (!feeds.clicks) {
        return `${citedPart}, but I cannot see AI visitors yet because the visitor feed has no rows. Once GA4 reports AI referrals I will know if these citations convert.`;
      }
      return `${citedPart}, but no visitor has arrived from an AI assistant yet. Citations usually come first, so I would keep the answer on this page sharp and check back in two weeks.`;
    }
    case "crawled_not_cited": {
      const crawlPart = `AI crawlers fetched this page ${n(crawled.count)} time${crawled.count === 1 ? "" : "s"}`;
      if (!feeds.cited) {
        return `${crawlPart}, and I have no citation data yet, so I cannot tell whether AI answers use it. The page is reachable, which is the hard part.`;
      }
      return `${crawlPart} but no AI answer cites it yet. The page is reachable, so the content is the gap. I would lead with a direct answer to what people actually ask.`;
    }
    case "not_crawled": {
      const demandPart =
        demand > 0
          ? `People see this page ${n(demand)} times in Google search over 90 days, but AI crawlers have never fetched it.`
          : "AI crawlers have never fetched this page.";
      return `${demandPart} Until they do, it cannot be recommended. They fetched ${n(feeds.crawledPageCount)} of your other pages, so I suggest linking to this one from your most crawled pages.`;
    }
    case "no_signal":
      return "I have no AI crawler or citation data for this page yet, so I cannot name its bottleneck. Once a crawler or citation feed reports, I will.";
  }
}

/**
 * One page's funnel. Stage = the furthest PROVEN step:
 *   converting > cited_no_clicks > crawled_not_cited > not_crawled > no_signal.
 * "not_crawled" needs the crawler feed to be reporting tenant-wide; with every
 * feed dark the honest answer is no_signal, never a fabricated zero. PURE.
 */
export function buildPageFunnel(inputs: PageFunnelInputs): PageFunnel {
  const stage: FunnelStage =
    inputs.aiClicks.sessions > 0
      ? "converting"
      : inputs.cited.count > 0
        ? "cited_no_clicks"
        : inputs.crawled.count > 0
          ? "crawled_not_cited"
          : inputs.feeds.crawl
            ? "not_crawled"
            : "no_signal";
  return {
    pagePath: inputs.pagePath,
    crawled: inputs.crawled,
    cited: inputs.cited,
    aiClicks: inputs.aiClicks,
    demand: inputs.demand,
    stage,
    bottleneckSentence: sentenceFor(inputs, stage),
  };
}

// ── Tenant-wide join ─────────────────────────────────────────────────────────

export type FunnelJoinInputs = {
  /** Per-page AI crawler coverage (already aggregated; paths in any casing). */
  botPages: Array<{ path: string; hits: number; lastAt: string | null; bots: Array<{ bot: string; hits: number }> }>;
  /** Per-page owned citations (imported + native combined by the loader). */
  citedPages: Array<{ path: string; count: number; prompts: number; lastAt: string | null }>;
  /** Per-page AI-referred GA4 sessions. */
  clickPages: Array<{ path: string; sessions: number; keyEvents: number; topSource: string | null }>;
  /** Demand proxy per path (Google impressions, 90d). Used to rank stalled
   *  pages and to pull high-demand never-crawled pages INTO the funnel. */
  demandByPath?: Map<string, number>;
};

export type FunnelReport = {
  /** True when at least one feed produced at least one page. */
  hasData: boolean;
  feeds: FunnelFeedPresence;
  pages: PageFunnel[];
  /** Pages stuck before the money (not converting, not no_signal), ranked by
   *  demand desc, then citations desc, then crawl hits desc. */
  stalled: PageFunnel[];
  stageCounts: Record<FunnelStage, number>;
};

/** How many high-demand pages OUTSIDE the AI feeds we consider for the
 *  never-crawled check (bounded so a 5,000-page site stays cheap). */
export const MAX_DEMAND_ONLY_PAGES = 25;

export function buildFunnelReport(inputs: FunnelJoinInputs): FunnelReport {
  const demandByPath = new Map<string, number>();
  for (const [path, value] of inputs.demandByPath ?? []) {
    const key = funnelPathKey(path);
    demandByPath.set(key, Math.max(demandByPath.get(key) ?? 0, value ?? 0));
  }

  const crawlByPath = new Map<string, PageFunnelCrawl>();
  for (const b of inputs.botPages) {
    const key = funnelPathKey(b.path);
    const prev = crawlByPath.get(key);
    if (prev) {
      prev.count += b.hits ?? 0;
      if (b.lastAt && (!prev.lastAt || b.lastAt > prev.lastAt)) prev.lastAt = b.lastAt;
      prev.bots = mergeBots(prev.bots, b.bots);
    } else {
      crawlByPath.set(key, { count: b.hits ?? 0, lastAt: b.lastAt ?? null, bots: [...(b.bots ?? [])] });
    }
  }

  const citedByPath = new Map<string, PageFunnelCited>();
  for (const c of inputs.citedPages) {
    const key = funnelPathKey(c.path);
    const prev = citedByPath.get(key);
    if (prev) {
      prev.count += c.count ?? 0;
      prev.prompts += c.prompts ?? 0;
      if (c.lastAt && (!prev.lastAt || c.lastAt > prev.lastAt)) prev.lastAt = c.lastAt;
    } else {
      citedByPath.set(key, { count: c.count ?? 0, prompts: c.prompts ?? 0, lastAt: c.lastAt ?? null });
    }
  }

  const clicksByPath = new Map<string, PageFunnelClicks>();
  for (const k of inputs.clickPages) {
    const key = funnelPathKey(k.path);
    const prev = clicksByPath.get(key);
    if (prev) {
      prev.sessions += k.sessions ?? 0;
      prev.keyEvents += k.keyEvents ?? 0;
      if (!prev.topSource) prev.topSource = k.topSource ?? null;
    } else {
      clicksByPath.set(key, { sessions: k.sessions ?? 0, keyEvents: k.keyEvents ?? 0, topSource: k.topSource ?? null });
    }
  }

  const feeds: FunnelFeedPresence = {
    crawl: crawlByPath.size > 0,
    cited: citedByPath.size > 0,
    clicks: clicksByPath.size > 0,
    crawledPageCount: crawlByPath.size,
  };

  const paths = new Set<string>([...crawlByPath.keys(), ...citedByPath.keys(), ...clicksByPath.keys()]);
  // High-demand pages the AI feeds never mention only join when the crawler
  // feed is reporting: that is the only time "never crawled" is provable.
  if (feeds.crawl) {
    const demandOnly = [...demandByPath.entries()]
      .filter(([path, value]) => !paths.has(path) && value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DEMAND_ONLY_PAGES);
    for (const [path] of demandOnly) paths.add(path);
  }

  const pages: PageFunnel[] = [];
  for (const pagePath of paths) {
    pages.push(
      buildPageFunnel({
        pagePath,
        crawled: crawlByPath.get(pagePath) ?? { count: 0, lastAt: null, bots: [] },
        cited: citedByPath.get(pagePath) ?? { count: 0, prompts: 0, lastAt: null },
        aiClicks: clicksByPath.get(pagePath) ?? { sessions: 0, keyEvents: 0, topSource: null },
        demand: demandByPath.get(pagePath) ?? 0,
        feeds,
      }),
    );
  }
  pages.sort(byBottleneckPriority);

  const stageCounts: Record<FunnelStage, number> = {
    not_crawled: 0,
    crawled_not_cited: 0,
    cited_no_clicks: 0,
    converting: 0,
    no_signal: 0,
  };
  for (const p of pages) stageCounts[p.stage] += 1;

  const stalled = pages.filter((p) => p.stage !== "converting" && p.stage !== "no_signal");

  return { hasData: pages.length > 0, feeds, pages, stalled, stageCounts };
}

function mergeBots(
  a: Array<{ bot: string; hits: number }>,
  b: Array<{ bot: string; hits: number }>,
): Array<{ bot: string; hits: number }> {
  const m = new Map<string, number>();
  for (const x of [...a, ...b]) m.set(x.bot, (m.get(x.bot) ?? 0) + (x.hits ?? 0));
  return [...m.entries()].map(([bot, hits]) => ({ bot, hits })).sort((x, y) => y.hits - x.hits);
}

function byBottleneckPriority(a: PageFunnel, b: PageFunnel): number {
  return (
    b.demand - a.demand ||
    b.cited.count - a.cited.count ||
    b.crawled.count - a.crawled.count ||
    a.pagePath.localeCompare(b.pagePath)
  );
}

/** One tenant-wide shape line for the band, or null when there is nothing
 *  honest to say. First person, concrete numbers, no dashes. PURE.
 *
 * A5 (operator-experience fix batch, 2026-07-02) - each clause after the first names its
 * own count against the SAME tracked-page total ("cite 43 of them"), so a single-clause
 * sentence never reads as a fragment ("AI answers cite 43." used to stop mid-thought). */
export function funnelSummaryLine(report: FunnelReport): string | null {
  if (!report.hasData) return null;
  const measured = report.pages.filter((p) => p.stage !== "no_signal");
  if (measured.length === 0) return null;
  const crawled = measured.filter((p) => p.crawled.count > 0).length;
  const cited = measured.filter((p) => p.cited.count > 0).length;
  const clicked = measured.filter((p) => p.aiClicks.sessions > 0).length;
  const parts: string[] = [];
  if (report.feeds.crawl) parts.push(`AI crawlers fetched ${n(crawled)} of them`);
  if (report.feeds.cited) parts.push(`AI answers cite ${n(cited)} of them`);
  if (report.feeds.clicks || clicked > 0) parts.push(`${n(clicked)} already bring AI visitors`);
  if (parts.length === 0) return null;
  return `I tracked ${n(measured.length)} page${measured.length === 1 ? "" : "s"} through the AI funnel: ${parts.join(", ")}.`;
}

// ── Candidate signal (deliverable 4): never-crawled high-demand pages ───────

/** Minimum 90-day Google impressions before a never-crawled page is worth an
 *  internal-link move (below this the evidence is too thin to spend a slot). */
export const MIN_HINT_DEMAND = 100;
export const MAX_FUNNEL_LINK_HINTS_PER_NIGHT = 3;

export type FunnelLinkHint = {
  pagePath: string;
  /** Google impressions over 90 days (the demand evidence). */
  demand: number;
  /** Pages the crawler feed covers (the coverage evidence). */
  crawledPageCount: number;
  actionType: "add_internal_links";
  /** Ready-to-append operator sentence (Beacon voice, no dashes). */
  sentence: string;
};

/**
 * Never-crawled pages with real demand -> deterministic internal-link hints,
 * keyed by funnelPathKey. Fail-closed: without crawler-feed data no page is
 * "not_crawled", so this returns empty (we never guess crawl status). Feeds
 * the daily candidate machinery the same way EngineGapNote does; wiring is one
 * line in the candidate builder's caller (pass this map, match by path key).
 */
export function buildFunnelLinkHints(
  report: FunnelReport,
  opts: { limit?: number; minDemand?: number } = {},
): Map<string, FunnelLinkHint> {
  const limit = opts.limit ?? MAX_FUNNEL_LINK_HINTS_PER_NIGHT;
  const minDemand = opts.minDemand ?? MIN_HINT_DEMAND;
  const out = new Map<string, FunnelLinkHint>();
  const candidates = report.pages
    .filter((p) => p.stage === "not_crawled" && p.demand >= minDemand)
    .sort((a, b) => b.demand - a.demand);
  for (const p of candidates) {
    if (out.size >= limit) break;
    out.set(p.pagePath, {
      pagePath: p.pagePath,
      demand: p.demand,
      crawledPageCount: report.feeds.crawledPageCount,
      actionType: "add_internal_links",
      sentence: `AI crawlers fetched ${n(report.feeds.crawledPageCount)} of your pages but never this one, while people see it ${n(p.demand)} times in Google over 90 days. Add links to it from your most crawled pages so AI can find and recommend it.`,
    });
  }
  return out;
}
