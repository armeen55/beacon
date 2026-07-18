import type { PageSnapshot } from "@/domains/pages/types";
import type { RecommendationCandidateRow } from "./emitter/candidate-row";

export const CRAWL_STALE_AFTER_DAYS = 45;

function urlKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

function ageDays(iso: string, now: Date): number | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

/**
 * Label and conservatively downgrade recommendations grounded in an old crawl.
 * Staleness alone never hides a customer option: high becomes medium; medium
 * stays visible at medium with the explicit caveat; pre-existing low stays low.
 */
export function annotateCrawlStaleness(args: {
  candidates: ReadonlyArray<RecommendationCandidateRow>;
  snapshots: ReadonlyArray<PageSnapshot>;
  now: Date;
}): RecommendationCandidateRow[] {
  const latest = new Map<string, PageSnapshot>();
  for (const snapshot of args.snapshots) {
    for (const raw of [snapshot.url, snapshot.canonical_url]) {
      const key = urlKey(raw);
      if (!key) continue;
      const prior = latest.get(key);
      if (!prior || snapshot.fetched_at > prior.fetched_at) latest.set(key, snapshot);
    }
  }

  return args.candidates.map((candidate) => {
    const key = urlKey(candidate.target_url);
    const snapshot = key ? latest.get(key) : undefined;
    if (!snapshot) return candidate;
    const days = ageDays(snapshot.fetched_at, args.now);
    if (days == null || days <= CRAWL_STALE_AFTER_DAYS) return candidate;

    const note = `The page data behind this is ${days} days old, so confidence is lower until Beacon refreshes it.`;
    return {
      ...candidate,
      confidence: candidate.confidence === "high" ? "medium" : candidate.confidence,
      customer_copy: candidate.customer_copy.includes(note)
        ? candidate.customer_copy
        : `${candidate.customer_copy} ${note}`,
      operator_evidence: candidate.operator_evidence.includes("crawl_age_days=")
        ? candidate.operator_evidence
        : `${candidate.operator_evidence}; crawl_age_days=${days}; crawl_fetched_at=${snapshot.fetched_at}`,
    };
  });
}
