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
import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { compileCandidates, missingExactSearch, strongestInvestigation } from "@/domains/decision";

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
  const add = (raw: string | null | undefined): void => {
    const q = (raw ?? "").trim();
    const key = q.toLowerCase();
    if (!q || seen.has(key) || queries.length >= MAX_PRIORITY_QUERIES) return;
    seen.add(key);
    queries.push(q);
  };
  // A RESERVED SLOT for the strongest research packet's own missing look. It is
  // stuck on exactly one purchase too, and simply appending it behind the page
  // gaps meant a week with three gaps advanced the research not at all.
  for (const c of open.slice(0, MAX_PRIORITY_QUERIES - 1)) add(c.query);
  add(researchGap(snapshot));
  for (const c of open) add(c.query);
  return queries;
}

/** The exact search my strongest open investigation cannot close without, or null
 *  when it already holds a current look at that results page. Pure and fail-soft:
 *  no packet means no priority, never a stalled agenda. */
function researchGap(snapshot: EvidenceSnapshot): string | null {
  try {
    // ASKABLE PACKETS ONLY. Ranking by fewest missing pieces picks the most COMPLETE
    // packet, and a complete packet is by definition one whose results page is already
    // current, so the winner had nothing to ask for and this whole reservation bought
    // exactly nothing. Choose the strongest packet that actually needs a look.
    const askable = buildTopicInvestigations(snapshot).filter((i) => missingExactSearch(i) != null);
    return missingExactSearch(strongestInvestigation(askable));
  } catch {
    return null;
  }
}
