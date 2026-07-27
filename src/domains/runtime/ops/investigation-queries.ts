import "server-only";

/**
 * The exact searches an open investigation cannot close without (Slice: evidence
 * qualified changes, 2026-07-27). A proven traffic gap stays an investigation until
 * the live results page for THAT EXACT SEARCH is held, so those searches must be
 * bought before any exploratory one, or every gap opens a case that never closes.
 *
 * Runtime orchestrates this on purpose: it asks Decision what it is stuck on and
 * hands Evidence plain strings. Decision never reaches the provider, and Evidence
 * never reads Decision. Fail-soft everywhere: no answer means no priority, never a
 * stalled agenda.
 */
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import { compileCandidates } from "@/domains/decision";

/** How many investigations one research pass may jump the queue for. */
const MAX_PRIORITY_QUERIES = 3;

export async function topInvestigationQueries(tenantId: string): Promise<string[]> {
  const snapshot = await loadEvidenceSnapshot(tenantId);
  // ONLY what buying evidence can actually close. An investigation that already holds
  // its results page and concluded something else (Google's own rewrite already carries
  // the search, nothing recurs across the winners, a different slice of Google) is not
  // waiting on a purchase, and leaving it in this list made it re-buy the same page every
  // week while the queries with no results page at all waited behind it.
  const open = compileCandidates(snapshot)
    .filter((c) => c.action === "research_needed" && !!c.query && (c.diagnosis == null || c.diagnosis.cause === "unknown"))
    .sort((a, b) => b.recoverableClicks - a.recoverableClicks || (a.query ?? "").localeCompare(b.query ?? ""));
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const c of open) {
    const q = (c.query ?? "").trim();
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    queries.push(q);
    if (queries.length >= MAX_PRIORITY_QUERIES) break;
  }
  return queries;
}
