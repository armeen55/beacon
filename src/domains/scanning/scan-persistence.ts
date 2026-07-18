import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageSnapshot } from "@/domains/pages/types";

const MIN_TRUSTWORTHY_HTML_CHARS = 500;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Reject responses that cannot safely become a new crawl baseline.
 * A CMS shell or an HTTP error page is an observation failure, not a page
 * change: persisting either would manufacture title/body/schema regressions.
 */
export function pageFetchRejectionReason(input: {
  html: string;
  status: number;
}): string | null {
  if (input.status < 200 || input.status >= 300) {
    return `HTTP ${input.status}`;
  }

  if (input.html.trim().length < MIN_TRUSTWORTHY_HTML_CHARS) {
    return `response contained only ${input.html.trim().length} HTML characters (likely an incomplete rendering shell)`;
  }

  return null;
}

/**
 * Build a complete latest-known snapshot store for the current canonical
 * sitemap. Fresh observations win; canonical pages that were not fetched (or
 * failed) retain their last trustworthy observation. URLs removed from the
 * sitemap intentionally fall out of the latest store.
 */
export function mergeLatestCanonicalSnapshots(input: {
  canonicalUrls: string[];
  freshSnapshots: PageSnapshot[];
  previousSnapshots: PageSnapshot[];
}): PageSnapshot[] {
  const freshByUrl = new Map(
    input.freshSnapshots.map((snapshot) => [normalizeUrl(snapshot.url), snapshot]),
  );
  const previousByUrl = new Map(
    input.previousSnapshots.map((snapshot) => [normalizeUrl(snapshot.url), snapshot]),
  );

  return input.canonicalUrls.flatMap((url) => {
    const key = normalizeUrl(url);
    const latest = freshByUrl.get(key) ?? previousByUrl.get(key);
    return latest ? [latest] : [];
  });
}

/** Same preservation rule as snapshots, applied to the full-replace element store. */
export function mergeLatestCanonicalInventory(input: {
  canonicalUrls: string[];
  freshRows: PageElementInventoryRow[];
  previousRows: PageElementInventoryRow[];
  freshSnapshotUrls: string[];
}): PageElementInventoryRow[] {
  const canonical = new Set(input.canonicalUrls.map(normalizeUrl));
  const fresh = new Set(input.freshSnapshotUrls.map(normalizeUrl));

  const carried = input.previousRows.filter((row) => {
    const key = normalizeUrl(row.url);
    return canonical.has(key) && !fresh.has(key);
  });

  return [...input.freshRows, ...carried];
}
