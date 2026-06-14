/**
 * Competitor Change Detection — diffs current vs previous sitemap snapshots.
 *
 * Detects: new pages, removed pages, updated pages (lastmod changed).
 */

import type {
  CompetitorSitemapSnapshot,
  CompetitorPageChange,
  CompetitorAlert,
} from "./types";

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

export function detectCompetitorChanges(
  current: CompetitorSitemapSnapshot[],
  previous: CompetitorSitemapSnapshot[],
): CompetitorPageChange[] {
  const changes: CompetitorPageChange[] = [];
  const now = new Date().toISOString();

  for (const curSnap of current) {
    const prevSnap = previous.find((p) => p.domain === curSnap.domain);

    if (!prevSnap) {
      // First crawl for this competitor — all pages are "new" but don't alert
      continue;
    }

    if (curSnap.error) continue; // Skip errored crawls

    const prevUrls = new Map(
      prevSnap.entries.map((e) => [normalizeUrl(e.loc), e]),
    );
    const curUrls = new Map(
      curSnap.entries.map((e) => [normalizeUrl(e.loc), e]),
    );

    // New pages
    for (const [url, entry] of curUrls) {
      if (!prevUrls.has(url)) {
        changes.push({
          domain: curSnap.domain,
          displayName: curSnap.displayName,
          type: "added",
          url: entry.loc,
          path: extractPath(entry.loc),
          lastmod: entry.lastmod,
          previousLastmod: null,
          detectedAt: now,
        });
      }
    }

    // Removed pages
    for (const [url, entry] of prevUrls) {
      if (!curUrls.has(url)) {
        changes.push({
          domain: curSnap.domain,
          displayName: curSnap.displayName,
          type: "removed",
          url: entry.loc,
          path: extractPath(entry.loc),
          lastmod: null,
          previousLastmod: entry.lastmod,
          detectedAt: now,
        });
      }
    }

    // Updated pages (lastmod changed)
    for (const [url, curEntry] of curUrls) {
      const prevEntry = prevUrls.get(url);
      if (
        prevEntry &&
        curEntry.lastmod &&
        prevEntry.lastmod &&
        curEntry.lastmod !== prevEntry.lastmod
      ) {
        changes.push({
          domain: curSnap.domain,
          displayName: curSnap.displayName,
          type: "updated",
          url: curEntry.loc,
          path: extractPath(curEntry.loc),
          lastmod: curEntry.lastmod,
          previousLastmod: prevEntry.lastmod,
          detectedAt: now,
        });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Alert generation — human-readable summaries for morning brief
// ---------------------------------------------------------------------------

export function generateCompetitorAlerts(
  changes: CompetitorPageChange[],
): CompetitorAlert[] {
  const alerts: CompetitorAlert[] = [];

  // Group by domain
  const byDomain = new Map<string, CompetitorPageChange[]>();
  for (const c of changes) {
    const existing = byDomain.get(c.domain) ?? [];
    existing.push(c);
    byDomain.set(c.domain, existing);
  }

  for (const [domain, domainChanges] of byDomain) {
    const displayName = domainChanges[0].displayName;
    const added = domainChanges.filter((c) => c.type === "added");
    const removed = domainChanges.filter((c) => c.type === "removed");

    // Individual alerts for new pages (most actionable)
    for (const page of added) {
      const pageTopic = inferTopicFromPath(page.path);
      alerts.push({
        domain,
        displayName,
        headline: `${displayName} added ${page.path}`,
        detail: pageTopic
          ? `They're targeting "${pageTopic}" — do you have a page for this? If not, they'll get recommended instead of you.`
          : `New page detected. Check if this competes with your services.`,
        changeType: "added",
        url: page.url,
        path: page.path,
        detectedAt: page.detectedAt,
      });
    }

    // Batch alert for removed pages (less actionable)
    if (removed.length > 0) {
      alerts.push({
        domain,
        displayName,
        headline: `${displayName} removed ${removed.length} page${removed.length !== 1 ? "s" : ""}`,
        detail: `They pulled: ${removed.slice(0, 3).map((r) => r.path).join(", ")}${removed.length > 3 ? ` + ${removed.length - 3} more` : ""}. This could be a strategy shift — opportunity for you.`,
        changeType: "removed",
        url: removed[0].url,
        path: removed[0].path,
        detectedAt: removed[0].detectedAt,
      });
    }
  }

  // Sort: added first (most actionable), then by domain
  alerts.sort((a, b) => {
    if (a.changeType !== b.changeType) {
      return a.changeType === "added" ? -1 : 1;
    }
    return a.domain.localeCompare(b.domain);
  });

  return alerts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function extractPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";
  }
}

/** Infer a rough topic from URL path for contextual alerts.
 *
 * De-verticalized (2026-06-15): derive the topic generically from the URL's
 * last meaningful slug segment (humanized) instead of hardcoded builder-service
 * + Bay-Area location pattern lists. Works for any vertical — a competitor's
 * /services/teeth-whitening → "Teeth Whitening", /cities/tehran → "Tehran",
 * /blog/2024/best-crm → "Best Crm" — with zero industry assumptions. */
function inferTopicFromPath(path: string): string | null {
  const segments = path
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) return null;

  // Walk from the end to the first content-bearing slug (skip numeric ids /
  // single chars / pure dates) and humanize it.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].toLowerCase();
    if (/^\d+$/.test(seg)) continue; // numeric id / year
    if (seg.length < 2) continue;
    return seg.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return null;
}
