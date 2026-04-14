/**
 * Competitor Monitoring — types for sitemap crawling and change detection.
 */

export type CompetitorSitemapEntry = {
  loc: string;
  lastmod: string | null;
};

export type CompetitorSitemapSnapshot = {
  domain: string;
  displayName: string;
  crawledAt: string;
  pageCount: number;
  entries: CompetitorSitemapEntry[];
  error: string | null;
};

export type CompetitorPageChange = {
  domain: string;
  displayName: string;
  type: "added" | "removed" | "updated";
  url: string;
  /** Path portion for display */
  path: string;
  /** For updated pages, the new lastmod */
  lastmod: string | null;
  /** For updated pages, the previous lastmod */
  previousLastmod: string | null;
  detectedAt: string;
};

export type CompetitorMonitoringState = {
  lastCrawlAt: string | null;
  snapshots: CompetitorSitemapSnapshot[];
  /** Changes detected in most recent crawl */
  recentChanges: CompetitorPageChange[];
};

export type CompetitorAlert = {
  domain: string;
  displayName: string;
  headline: string;
  detail: string;
  changeType: "added" | "removed" | "updated";
  url: string;
  path: string;
  detectedAt: string;
};
